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
      headers: { 'Content-Type': 'application/json' },
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

/** Lista alunos cadastrados. */
async function apiListarAlunosAdmin(filtros = {}) {
  return API.get('listarAlunosAdmin', { authToken: getAccessToken(), ...filtros });
}

/** Lista empresas (admin). */
async function apiListarEmpresasAdmin(filtros = {}) {
  return API.get('listarEmpresasAdmin', { authToken: getAccessToken(), ...filtros });
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

  try {
    const result = await apiFn();
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
    submitBtn.disabled = false;
  }
}
