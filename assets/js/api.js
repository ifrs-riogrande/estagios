/* ============================================================
   IFRS CAMPUS RIO GRANDE — CENTRAL DE ESTÁGIOS
   api.js — camada de comunicação com o Google Apps Script
   ============================================================
   Decisão de arquitetura:
   - Todas as requisições passam por um único Web App GAS.
   - O GAS roteia pelo parâmetro "action" (GET) ou no body JSON (POST).
   - O frontend nunca conhece IDs de planilhas — apenas o endpoint GAS.
   - Timeout de 30s para evitar que o usuário fique preso indefinidamente.
   - Erros de rede e erros de aplicação são tratados de forma uniforme.
   ============================================================ */

'use strict';

// ─────────────────────────────────────────
//  CONFIGURAÇÃO
//  BASE_URL: URL do Web App GAS publicado.
//  Substitua após publicar o GAS como Web App
//  (Implantar → Novo implante → Aplicativo da Web).
// ─────────────────────────────────────────
const API_CONFIG = {
  BASE_URL: 'https://script.google.com/macros/s/AKfycbx4i1zKVrelIeOFxcZEzwS_nt3zmO4M5inkPtMoLFgE811IHQDmrFLQz16ejaDl0FJO/exec',
  TIMEOUT_MS: 30000, // 30 segundos
};

// ─────────────────────────────────────────
//  TIPOS DE RESPOSTA DO GAS
//  O GAS sempre responde com:
//  { ok: boolean, data?: any, error?: string }
// ─────────────────────────────────────────

/**
 * Classe de erro de API — permite distinguir erros de rede de erros de aplicação.
 */
class ApiError extends Error {
  constructor(message, code = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

// ─────────────────────────────────────────
//  NÚCLEO — request com timeout
// ─────────────────────────────────────────

/**
 * Requisição com timeout manual via AbortController.
 * @param {string} url
 * @param {RequestInit} options
 */
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return resp;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ApiError('A requisição demorou mais de 30 segundos. Tente novamente.', 'TIMEOUT');
    }
    throw new ApiError('Falha na conexão. Verifique sua internet e tente novamente.', 'NETWORK');
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─────────────────────────────────────────
//  API PÚBLICA
// ─────────────────────────────────────────

const API = {

  /**
   * Requisição GET ao GAS.
   * Os parâmetros são adicionados à query string da URL.
   *
   * @param {string} action - Ação a ser executada no GAS (doGet route)
   * @param {Object} params - Parâmetros adicionais (ex: { empresa: 'cnpj' })
   * @returns {Promise<any>} - Campo 'data' da resposta GAS
   */
  async get(action, params = {}) {
    const url = new URL(API_CONFIG.BASE_URL);
    url.searchParams.set('action', action);
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    const resp = await fetchWithTimeout(url.toString(), {
      method: 'GET',
      // GAS não aceita cookies de terceiros — mode no-cors quebraria a leitura
      // O GAS precisa ter Access-Control-Allow-Origin no cabeçalho
      headers: { 'Accept': 'application/json' },
    });

    return this._parseResponse(resp);
  },

  /**
   * Requisição POST ao GAS.
   * O body é um JSON com a action e os dados do formulário.
   * O token OAuth (quando existir) é incluído para validação no GAS.
   *
   * @param {string} action - Ação a ser executada no GAS (doPost route)
   * @param {Object} data   - Dados a enviar
   * @returns {Promise<any>} - Campo 'data' da resposta GAS
   */
  async post(action, data = {}) {
    // Inclui token OAuth automaticamente se o usuário estiver logado
    const token = typeof getAccessToken === 'function' ? getAccessToken() : null;

    const body = {
      action,
      ...data,
      ...(token ? { authToken: token } : {}),
    };

    const resp = await fetchWithTimeout(API_CONFIG.BASE_URL, {
      method: 'POST',
      // Content-Type: text/plain evita o preflight CORS que o GAS não responde.
      // O body continua sendo JSON stringify — o GAS parseia e.postData.contents normalmente.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
    });

    return this._parseResponse(resp);
  },

  /**
   * Processa a resposta HTTP e lança ApiError em caso de falha.
   * @param {Response} resp
   */
  async _parseResponse(resp) {
    if (!resp.ok) {
      throw new ApiError(
        `Erro do servidor: ${resp.status} ${resp.statusText}`,
        'HTTP_' + resp.status
      );
    }

    let json;
    try {
      json = await resp.json();
    } catch (e) {
      throw new ApiError('A resposta do servidor não é um JSON válido.', 'PARSE_ERROR');
    }

    // Formato esperado: { ok: true, data: ... } ou { ok: false, error: '...' }
    if (json.ok === false) {
      throw new ApiError(json.error || 'Erro desconhecido no servidor.', json.code || 'APP_ERROR');
    }

    return json.data ?? json;
  },
};

// ─────────────────────────────────────────
//  HELPERS DE ALTO NÍVEL
//  Funções específicas para cada endpoint — chamadas nos formulários.
//  Centralizar aqui facilita manutenção quando o GAS muda.
// ─────────────────────────────────────────

/** Lista empresas validadas (para selects). */
async function apiListarEmpresas() {
  return API.get('listarEmpresas');
}

/**
 * Verifica o status de empresa (por CNPJ) e supervisor (por CPF) antes da solicitação.
 * Retorna { empresa: { encontrada, status, razaoSocial }, supervisor: { encontrado, status, nome } }
 */
async function apiVerificarStatusConcedente(cnpj, cpf) {
  return API.get('verificarStatusConcedente', { cnpj: cnpj || '', cpf: cpf || '' });
}

/** Lista todas as empresas cadastradas (com status) para o pré-check em cascata. */
async function apiListarEmpresasPrecheck() {
  return API.get('listarEmpresasPrecheck');
}

/** Lista todos os supervisores de uma empresa (com status) para o pré-check. */
async function apiListarSupervisoresPrecheck(cnpj) {
  return API.get('listarSupervisoresPrecheck', { cnpj: cnpj });
}

/** Lista supervisores de uma empresa específica (CNPJ normalizado). */
async function apiListarSupervisores(cnpjEmpresa) {
  return API.get('listarSupervisores', { empresa: cnpjEmpresa });
}

/** Lista orientadores de um curso específico. */
async function apiListarOrientadores(curso) {
  return API.get('listarOrientadores', { curso });
}

/** Lista agentes de integração ativos. */
async function apiListarAgentes() {
  return API.get('listarAgentes');
}

/** Lista cursos ativos (público — sem auth). Usado em todos os selects do sistema. */
async function apiListarCursos() {
  return API.get('listarCursos');
}

/** Lista todos os cursos com status (admin). */
async function apiListarTodosCursos() {
  return API.get('listarTodosCursos', { authToken: getAccessToken() });
}

/** Adiciona ou atualiza um curso (admin). */
async function apiSalvarCurso(dados) {
  return API.post('salvarCurso', { ...dados, authToken: getAccessToken() });
}

/** Exclui permanentemente um curso (admin). */
async function apiDeletarCurso(id) {
  return API.post('deletarCurso', { id, authToken: getAccessToken() });
}

/** Lista oportunidades aprovadas (portal público). */
async function apiListarOportunidades(filtros = {}) {
  return API.get('listarOportunidades', filtros);
}

/** Envia formulário de cadastro de empresa. */
async function apiCadastrarEmpresa(dados) {
  return API.post('cadastrarEmpresa', dados);
}

/** Envia formulário de cadastro de supervisor. */
async function apiCadastrarSupervisor(dados) {
  return API.post('cadastrarSupervisor', dados);
}

/** Envia formulário de cadastro de oportunidade. */
async function apiCadastrarOportunidade(dados) {
  return API.post('cadastrarOportunidade', dados);
}

/**
 * Obtém cadastro de empresa/concedente por CNPJ (PJ) ou CPF (PL/Produtor Rural).
 * Sem código → retorna apenas { existe, razaoSocial, status, tipo } (dados públicos).
 * Com código → retorna dados completos após validação do código de acesso.
 */
async function apiObterCadastroEmpresa(cnpjCpf, codigo) {
  var params = { cnpjCpf };
  if (codigo) params.codigo = String(codigo).trim().toUpperCase();
  return API.get('obterCadastroEmpresa', params);
}

/** Salva (cria ou atualiza) cadastro de empresa/concedente. Sem autenticação. */
async function apiSalvarMeuCadastroEmpresa(dados) {
  return API.post('salvarMeuCadastroEmpresa', dados);
}

/**
 * Envia documentos da empresa para uma pasta automática no Drive.
 * @param {{ cnpj, razaoSocial, documentos: Array<{tipo, nome, conteudo, mimeType}> }} dados
 */
async function apiEnviarDocumentosEmpresa(dados) {
  return API.post('enviarDocumentosEmpresa', dados);
}

/** Obtém cadastro de supervisor por CPF.
 *  Sem código retorna flag {pendente:true} ou {codigoNecessario:true}.
 *  Com código correto retorna os dados completos. */
async function apiObterCadastroSupervisor(cpf, codigo) {
  var params = { cpf: cpf };
  if (codigo) params.codigo = codigo;
  return API.get('obterCadastroSupervisor', params);
}

/** Salva (cria ou atualiza) cadastro de supervisor. Sem autenticação. */
async function apiSalvarMeuCadastroSupervisor(dados) {
  return API.post('salvarMeuCadastroSupervisor', dados);
}

/** Busca dados da solicitação pelo token de aceite (sem autenticação). */
async function apiVerificarAceiteOrientador(token) {
  return API.get('verificarAceiteOrientador', { token: token });
}

async function apiVerificarAceiteOrientadorOAuth(authToken, idEstagio) {
  return API.get('verificarAceiteOrientadorOAuth', { authToken: authToken, idEstagio: idEstagio });
}

/** Orientador aceita ou recusa a orientação. */
async function apiResponderAceiteOrientador(dados) {
  return API.post('responderAceiteOrientador', dados);
}

async function apiResponderAceiteOrientadorOAuth(dados) {
  return API.post('responderAceiteOrientadorOAuth', dados);
}

/** Estudante troca o orientador após recusa. Requer authToken. */
async function apiTrocarOrientador(dados) {
  return API.post('trocarOrientador', dados);
}

/** Verifica se um e-mail de orientador já tem cadastro ativo/pendente (sem auth). */
async function apiVerificarCadastroOrientador(email) {
  return API.get('verificarCadastroOrientador', { email: email });
}

/** Orientador convidado completa o cadastro mínimo (requer authToken + token de checklist). */
async function apiRegistrarOrientadorConvidado(dados) {
  return API.post('registrarOrientadorConvidado', dados);
}

/** Envia formulário de cadastro de estudante. */
async function apiCadastrarEstudante(dados) {
  return API.post('cadastrarEstudante', dados);
}

/** Envia solicitação de estágio. */
async function apiSolicitarEstagio(dados) {
  return API.post('solicitarEstagio', dados);
}

/** Envia relatório parcial. */
async function apiEnviarRelatorioParcial(dados) {
  return API.post('enviarRelatorioParcial', dados);
}

/** Envia relatório final. */
async function apiEnviarRelatorioFinal(dados) {
  return API.post('enviarRelatorioFinal', dados);
}

/** Envia adendo ao TCE. */
async function apiEnviarAdendo(dados) {
  return API.post('enviarAdendo', dados);
}

/** Cadastra orientador (restrito: servidores). */
async function apiCadastrarOrientador(dados) {
  return API.post('cadastrarOrientador', dados);
}

/** Cadastra agente de integração (restrito: setor). */
async function apiCadastrarAgente(dados) {
  return API.post('cadastrarAgente', dados);
}

/** Busca dados do dashboard (restrito: servidores). */
async function apiDashboard() {
  return API.get('dashboard');
}

// ─────────────────────────────────────────
//  SERVIDORES — orientadores e coordenadores
// ─────────────────────────────────────────

/** Lista estágios do orientador autenticado. */
async function apiListarMeusOrientandos() {
  return API.get('listarMeusOrientandos', { authToken: getAccessToken() });
}

/** Obtém perfil do orientador autenticado. */
async function apiObterMeuCadastroOrientador() {
  return API.get('obterMeuCadastroOrientador', { authToken: getAccessToken() });
}

/** Obtém perfil do coordenador autenticado. */
async function apiObterMeuCadastroCoordenador() {
  return API.get('obterMeuCadastroCoordenador', { authToken: getAccessToken() });
}

/** Lista estágios do curso que o coordenador autenticado gerencia. */
async function apiListarEstagiosCoordenador() {
  return API.get('listarEstagiosCoordenador', { authToken: getAccessToken() });
}

/**
 * Retorna histórico completo de um estágio:
 * relatórios parciais, relatório final, adendos e documentos avulsos.
 * Aceita token de estudante ou de servidor/admin.
 */
async function apiListarHistoricoEstagio(idEstagio) {
  return API.get('listarHistoricoEstagio', { authToken: getAccessToken(), idEstagio });
}

/**
 * Faz upload de um documento avulso (PDF) para a pasta do estágio.
 * @param {string} idEstagio
 * @param {string} titulo      Descrição livre do documento
 * @param {File}   fileObj     Objeto File da Web API
 */
async function apiUploadDocumentoEstagio(idEstagio, titulo, fileObj) {
  const base64 = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(fileObj);
  });
  return API.post('uploadDocumentoEstagio', {
    authToken: getAccessToken(),
    idEstagio,
    titulo,
    arquivo: { nome: fileObj.name, base64 },
  });
}

// ─────────────────────────────────────────
//  ADMIN — chamadas restritas ao setor
// ─────────────────────────────────────────

/** Lista solicitações para o admin (requer token Admin). */
async function apiListarSolicitacoesAdmin(filtros = {}) {
  return API.get('listarSolicitacoesAdmin', { authToken: getAccessToken(), ...filtros });
}

/** Lista documentos por etapa do fluxo. */
async function apiListarDocumentosAdmin() {
  return API.get('listarDocumentosAdmin', { authToken: getAccessToken() });
}

/**
 * Lista documentos avulsos enviados pelo estudante (e revisados ou não pelo admin).
 * Requer token Admin.
 */
async function apiListarDocumentosAvulsos(idEstagio) {
  return API.get('listarDocumentosAvulsos', { authToken: getAccessToken(), idEstagio });
}

/**
 * Marca (ou desmarca) um documento avulso como revisado pelo admin.
 * @param {string}  idEstagio
 * @param {string}  docId
 * @param {boolean} revisado
 * @param {string}  [obsAdmin]
 */
async function apiMarcarDocumentoRevisado(idEstagio, docId, revisado, obsAdmin = '') {
  return API.post('marcarDocumentoRevisado', {
    authToken: getAccessToken(),
    idEstagio,
    docId,
    revisado,
    obsAdmin,
  });
}

/** Lista alunos cadastrados. */
async function apiListarAlunosAdmin(filtros = {}) {
  return API.get('listarAlunosAdmin', { authToken: getAccessToken(), ...filtros });
}

/** Lista empresas (admin). */
async function apiListarEmpresasAdmin(filtros = {}) {
  return API.get('listarEmpresasAdmin', { authToken: getAccessToken(), ...filtros });
}

/** Envia magic link de convite para cadastro de empresa (admin). */
async function apiEnviarMagicLinkEmpresa(dados) {
  return API.post('enviarMagicLinkEmpresa', { authToken: getAccessToken(), ...dados });
}

/** Envia magic link de convite para cadastro de supervisor (admin). */
async function apiEnviarMagicLinkSupervisor(dados) {
  return API.post('enviarMagicLinkSupervisor', { authToken: getAccessToken(), ...dados });
}

/** Lista orientadores (admin). */
async function apiListarOrientadoresAdmin() {
  return API.get('listarOrientadoresAdmin', { authToken: getAccessToken() });
}

/** Lista adendos (admin). */
async function apiListarAdendosAdmin(filtros = {}) {
  return API.get('listarAdendosAdmin', { authToken: getAccessToken(), ...filtros });
}

/** Lista agentes (admin). */
async function apiListarAgentesAdmin() {
  return API.get('listarAgentesAdmin', { authToken: getAccessToken() });
}

/** Aprova uma solicitação de estágio. */
async function apiAprovarSolicitacao(idEstagio) {
  return API.post('aprovarSolicitacao', { idEstagio, authToken: getAccessToken() });
}

/** Reprova uma solicitação. */
async function apiReprovarSolicitacao(idEstagio, motivoReprovacao) {
  return API.post('reprovarSolicitacao', { idEstagio, motivoReprovacao, authToken: getAccessToken() });
}

/** Valida documentos enviados pelo estudante → notifica DG. */
async function apiValidarDocumentos(idEstagio) {
  return API.post('validarDocumentos', { idEstagio, authToken: getAccessToken() });
}

/** Ativa estágio após assinatura do DG. */
async function apiValidarDocumentosDG(idEstagio) {
  return API.post('validarDocumentosDG', { idEstagio, authToken: getAccessToken() });
}

/** Lista estágios do estudante logado. */
async function apiListarMeusEstagios() {
  return API.get('listarMeusEstagios', { authToken: getAccessToken() });
}

/** Envia documentos assinados pelo estudante (base64). */
async function apiEnviarDocumentosAssinados(dados) {
  return API.post('enviarDocumentosAssinados', { ...dados, authToken: getAccessToken() });
}

/** Cadastra coordenador de curso. */
async function apiCadastrarCoordenador(dados) {
  return API.post('cadastrarCoordenador', dados);
}

/** Atualiza dados cadastrais do estudante logado. */
async function apiAtualizarMeuCadastro(dados) {
  return API.post('atualizarMeuCadastro', dados);
}

// ─────────────────────────────────────────
//  UTILITÁRIO: wrapper com loading e feedback
//  Uso nos formulários para reduzir boilerplate.
// ─────────────────────────────────────────

/**
 * Executa uma chamada de API com controle de loading em um botão.
 *
 * @param {Function} apiFn       - A função de API a chamar (ex: () => apiCadastrarEmpresa(data))
 * @param {HTMLButtonElement} submitBtn - Botão de submit (receberá is-loading)
 * @param {string} feedbackId    - ID do elemento .form-feedback
 * @param {string} successTitle  - Título da mensagem de sucesso
 * @param {string} successMsg    - Mensagem de sucesso
 * @param {Function} [onSuccess] - Callback opcional após sucesso (ex: resetar form)
 */
async function submitWithFeedback(apiFn, submitBtn, feedbackId, successTitle, successMsg, onSuccess) {
  // Bloqueia botão e limpa feedback anterior
  submitBtn.classList.add('is-loading');
  submitBtn.disabled = true;
  if (typeof hideFormFeedback === 'function') hideFormFeedback(feedbackId);

  let succeeded = false;
  try {
    const result = await apiFn();
    succeeded = true;
    if (typeof showFormFeedback === 'function') {
      showFormFeedback(feedbackId, 'success', successTitle, successMsg);
    }
    if (typeof onSuccess === 'function') onSuccess(result);
  } catch (err) {
    const message = err instanceof ApiError
      ? err.message
      : 'Ocorreu um erro inesperado. Tente novamente ou entre em contato com o setor de estágios.';
    if (typeof showFormFeedback === 'function') {
      showFormFeedback(feedbackId, 'error', 'Erro ao enviar', message);
    }
    console.error('[API Error]', err);
  } finally {
    submitBtn.classList.remove('is-loading');
    if (!succeeded) submitBtn.disabled = false;
  }
}

// ─────────────────────────────────────────
//  HELPER: preenche um <select> com cursos
//  agrupados por optgroup, carregados da API.
// ─────────────────────────────────────────

/**
 * Preenche um elemento <select> com cursos ativos agrupados por grupo.
 *
 * @param {string}  selectId      - ID do elemento <select>
 * @param {string}  [placeholder] - Texto do option vazio inicial (default: 'Selecione o curso')
 * @param {boolean} [incluirTodos]- Se true, adiciona option "Todos os cursos" (para filtros)
 */
async function preencherSelectCursos(selectId, placeholder = 'Selecione o curso', incluirTodos = false) {
  const sel = document.getElementById(selectId);
  if (!sel) return;

  sel.innerHTML = '';
  sel.disabled = true;

  // Option inicial
  const optBlank = document.createElement('option');
  optBlank.value = '';
  optBlank.textContent = placeholder;
  sel.appendChild(optBlank);

  if (incluirTodos) {
    const optTodos = document.createElement('option');
    optTodos.value = 'todos';
    optTodos.textContent = 'Todos os cursos';
    sel.appendChild(optTodos);
  }

  try {
    const cursos = await apiListarCursos();
    if (!Array.isArray(cursos) || cursos.length === 0) {
      optBlank.textContent = 'Nenhum curso disponível';
      return;
    }

    // Agrupa por grupo mantendo ordem de inserção
    const grupos = {};
    cursos.forEach(c => {
      if (!grupos[c.grupo]) grupos[c.grupo] = [];
      grupos[c.grupo].push(c);
    });

    Object.keys(grupos).sort().forEach(g => {
      const og = document.createElement('optgroup');
      og.label = g;
      grupos[g].forEach(c => {
        const op = document.createElement('option');
        op.value = c.nome;   // valor = nome (compatível com campos existentes)
        op.textContent = c.nome;
        og.appendChild(op);
      });
      sel.appendChild(og);
    });

    sel.disabled = false;
  } catch (err) {
    optBlank.textContent = 'Erro ao carregar cursos';
    console.error('[preencherSelectCursos]', err);
  }
}

/**
 * Preenche um container com checkboxes de cursos, agrupados por grupo.
 * Substitui o conteúdo do container — ideal para formulários de orientadores.
 *
 * @param {string}   containerId    - ID do elemento container (div/fieldset)
 * @param {string}   checkboxName   - Valor do atributo name dos checkboxes
 * @param {string[]} [marcados]     - Nomes de cursos que devem iniciar marcados
 */
async function preencherCheckboxesCursos(containerId, checkboxName, marcados = []) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '<p style="color:var(--color-text-secondary)">Carregando cursos…</p>';

  try {
    const cursos = await apiListarCursos();
    if (!Array.isArray(cursos) || cursos.length === 0) {
      container.innerHTML = '<p style="color:var(--color-text-secondary)">Nenhum curso disponível.</p>';
      return;
    }

    const marcadosSet = new Set(marcados);
    const grupos = {};
    cursos.forEach(c => {
      if (!grupos[c.grupo]) grupos[c.grupo] = [];
      grupos[c.grupo].push(c);
    });

    let html = '';
    Object.keys(grupos).sort().forEach(g => {
      html += `<p class="text-sm text-muted" style="grid-column:1/-1;margin-top:var(--space-3);margin-bottom:var(--space-1);">${g}</p>`;
      grupos[g].forEach(c => {
        const checked = marcadosSet.has(c.nome) ? ' checked' : '';
        html += `
          <label class="form-check" style="align-items:flex-start;">
            <input type="checkbox" name="${checkboxName}" value="${c.nome.replace(/"/g,'&quot;')}"${checked}>
            <span class="form-check-label">${c.nome.replace(/</g,'&lt;')}</span>
          </label>`;
      });
    });

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<p style="color:var(--color-danger,#dc2626)">Erro ao carregar cursos. Recarregue a página.</p>';
    console.error('[preencherCheckboxesCursos]', err);
  }
}
