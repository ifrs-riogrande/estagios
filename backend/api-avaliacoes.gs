/**
 * api-avaliacoes.gs — Fluxo de Avaliações de Estágio
 * SGE — Sistema de Gestão de Estágios · IFRS Campus Rio Grande
 *
 * Dois tipos de avaliação (disparados simultaneamente por período):
 *   concedente — Supervisor preenche; Aluno e Orientador revisam e assinam
 *   aluno       — Estagiário preenche; Supervisor e Orientador revisam e assinam
 *
 * Fluxo de 3 assinaturas (botão-clique, idêntico ao checklist):
 *   aguardando_preenchimento
 *     → preenchedor preenche e auto-assina
 *   aguardando_assinatura_2
 *     → revisor1 revisa e assina
 *   aguardando_assinatura_3
 *     → revisor2 revisa e assina
 *     → PDF gerado com QR code → salvo na pasta → concluido
 *
 * Para concedente: preenchedor=Supervisor, revisor1=Aluno, revisor2=Orientador
 * Para aluno:      preenchedor=Aluno,      revisor1=Supervisor, revisor2=Orientador
 *
 * Armazenamento:
 *   PropertiesService  → "avaliacao_[avalId]"  (estado JSON completo)
 *   Sheet "Avaliações" → resumo tabelado
 *   Google Drive       → subpasta "Avaliações" na pasta do estágio
 *
 * avalId = [idEstagio]_[tipo]_[periodo]
 *   Ex.: RG25-ABCD-1234_concedente_final
 *        RG25-ABCD-1234_aluno_semestral_1
 */

'use strict';

var AVAL_SHEET_NAME = 'Avaliações';

// ── Status ────────────────────────────────────────────────────────────────────

var AVAL_ST = {
  AGUARDANDO_PREENCHIMENTO: 'aguardando_preenchimento',
  AGUARDANDO_ASSINATURA_2:  'aguardando_assinatura_2',
  AGUARDANDO_ASSINATURA_3:  'aguardando_assinatura_3',
  CONCLUIDO:                'concluido',
};

// ── Colunas da aba "Avaliações" (0-based) ────────────────────────────────────

var COL_AVAL = {
  TIMESTAMP:           0,
  AVAL_ID:             1,
  ID_ESTAGIO:          2,
  TIPO:                3,
  PERIODO:             4,
  PERIODO_REF:         5,
  STATUS:              6,
  EMAIL_PREENCHEDOR:   7,
  EMAIL_REVISOR:       8,
  DADOS_FORM:          9,
  PDF_GERADO_URL:      10,
  PDF_ASSINADO_1_URL:  11,
  PDF_ASSINADO_2_URL:  12,
  DRIVE_PASTA_ID:      13,
  TS_INICIO:           14,
  TS_PREENCHIMENTO:    15,
  TS_ASSINATURA_1:     16,
  TS_ASSINATURA_2:     17,
  TS_CONCLUSAO:        18,
};

// ── Critérios para avaliação pela Concedente ──────────────────────────────────

var CRITERIOS_CONCEDENTE = [
  { id: 'aprendizado',    label: 'Aprendizado dentro do estágio' },
  { id: 'seguranca',      label: 'Segurança na execução do trabalho' },
  { id: 'interesse',      label: 'Interesse pelo trabalho' },
  { id: 'iniciativa',     label: 'Iniciativa própria' },
  { id: 'conhecimentos',  label: 'Conhecimentos técnicos' },
  { id: 'produtividade',  label: 'Produtividade' },
  { id: 'relacionamento', label: 'Relacionamento social' },
  { id: 'esforco',        label: 'Esforço para superar falhas' },
  { id: 'pontualidade',   label: 'Pontualidade/Assiduidade' },
];

// ── PropertiesService ─────────────────────────────────────────────────────────

function obterFluxoAvaliacao_(avalId) {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty('avaliacao_' + avalId);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    logErro_('obterFluxoAvaliacao_', e);
    return null;
  }
}

function salvarFluxoAvaliacao_(avalId, fluxo) {
  try {
    PropertiesService.getScriptProperties()
      .setProperty('avaliacao_' + avalId, JSON.stringify(fluxo));
  } catch (e) {
    logErro_('salvarFluxoAvaliacao_', e);
    throw e;
  }
}

// ── Iniciar Avaliação ─────────────────────────────────────────────────────────

/**
 * Cria e inicia um novo fluxo de avaliação.
 *
 * @param {string} idEstagio
 * @param {string} tipo        'concedente' | 'aluno'
 * @param {string} periodo     'final' | 'semestral_1' | 'semestral_2' | etc.
 * @param {string} periodoRef  Texto livre: "01/01/2025 a 30/06/2025"
 * @param {string} emailAdmin  E-mail do admin que iniciou (ou 'sistema' para trigger)
 */
function iniciarAvaliacao_(idEstagio, tipo, periodo, periodoRef, emailAdmin) {
  if (tipo !== 'concedente' && tipo !== 'aluno') {
    return jsonError_('Tipo inválido. Use "concedente" ou "aluno".', 'INVALID_PARAM');
  }

  var periodoSan = sanitizar_(periodo || '', 32).replace(/[^a-z0-9_]/gi, '').toLowerCase();
  if (!periodoSan) return jsonError_('Período inválido.', 'INVALID_PARAM');
  if (!idEstagio)  return jsonError_('idEstagio obrigatório.', 'MISSING_PARAM');

  var avalId = idEstagio + '_' + tipo + '_' + periodoSan;

  // Impede duplicatas
  var existente = obterFluxoAvaliacao_(avalId);
  if (existente) {
    return jsonError_(
      'Avaliação "' + avalId + '" já existe (status: ' + existente.statusGeral + ').',
      'DUPLICATE'
    );
  }

  // Dados da solicitação
  var sol = _obterDadosSolicitacaoCompleto_(idEstagio);
  if (!sol || !sol.idEstagio) {
    return jsonError_('Estágio "' + idEstagio + '" não encontrado.', 'NOT_FOUND');
  }

  // ── Define os 3 atores ────────────────────────────────────────────────────
  // concedente: preenchedor=Supervisor, revisor1=Aluno,      revisor2=Orientador
  // aluno:      preenchedor=Aluno,      revisor1=Supervisor,  revisor2=Orientador
  var emailPreenchedor, nomePreenchedor;
  var emailRevisor1, nomeRevisor1;
  var emailRevisor2, nomeRevisor2;

  var emailOrientador = sol.emailOrientador || '';
  var nomeOrientador  = sol.nomeOrientador  || '';
  var emailSupervisor = _obterEmailSetorSupervisor_(sol.nomeSupervisor, sol.emailSupervisor);
  var nomeSupervisor  = sol.nomeSupervisor  || '';
  var emailAluno      = sol.emailEstudante  || '';
  var nomeAluno       = sol.nomeEstudante   || '';

  if (tipo === 'concedente') {
    emailPreenchedor = emailSupervisor;
    nomePreenchedor  = nomeSupervisor;
    emailRevisor1    = emailAluno;
    nomeRevisor1     = nomeAluno;
    emailRevisor2    = emailOrientador;
    nomeRevisor2     = nomeOrientador;
  } else {
    emailPreenchedor = emailAluno;
    nomePreenchedor  = nomeAluno;
    emailRevisor1    = emailSupervisor;
    nomeRevisor1     = nomeSupervisor;
    emailRevisor2    = emailOrientador;
    nomeRevisor2     = nomeOrientador;
  }

  if (!emailPreenchedor) {
    var quemFalta = tipo === 'concedente' ? 'supervisor' : 'estudante';
    return jsonError_(
      'E-mail do ' + quemFalta + ' não encontrado. Verifique o cadastro.',
      'EMAIL_NOT_FOUND'
    );
  }

  // Obtém pasta do Drive do estágio
  var drivePastaId = '';
  try {
    var pastaEst = abrirPastaEstagio_(String(sol.driveUrl || ''));
    if (pastaEst) drivePastaId = pastaEst.getId();
  } catch (_) {}

  var agora = new Date().toISOString();
  var fluxo = {
    avalId:              avalId,
    idEstagio:           idEstagio,
    tipo:                tipo,
    periodo:             periodoSan,
    periodoRef:          sanitizar_(periodoRef || '', 80),
    statusGeral:         AVAL_ST.AGUARDANDO_PREENCHIMENTO,

    // Ator 1 — Preenchedor (auto-assina ao submeter o formulário)
    emailPreenchedor:    emailPreenchedor,
    nomePreenchedor:     nomePreenchedor,
    tokenPreenchedor:    Utilities.getUuid(),
    assinaturaPreenchedor: null,

    // Ator 2 — Revisor 1 (assina via magic link após preenchimento)
    emailRevisor1:       emailRevisor1,
    nomeRevisor1:        nomeRevisor1,
    tokenRevisor1:       Utilities.getUuid(),
    assinaturaRevisor1:  null,

    // Ator 3 — Revisor 2 / Orientador (sempre o orientador)
    emailRevisor2:       emailRevisor2,
    nomeRevisor2:        nomeRevisor2,
    tokenRevisor2:       Utilities.getUuid(),
    assinaturaRevisor2:  null,

    dadosFormulario:     null,
    pdfUrl:              null,
    tokenValidacao:      null,
    drivePastaId:        drivePastaId,

    tsInicio:            agora,
    tsPreenchimento:     null,
    tsAssinatura2:       null,
    tsAssinatura3:       null,
    tsConclusao:         null,
    iniciadorEmail:      emailAdmin || '',
  };

  salvarFluxoAvaliacao_(avalId, fluxo);
  _atualizarAvaliacaoNaPlanilha_(avalId, fluxo);

  // Notifica preenchedor
  try { _notificarPreenchedor_(fluxo, sol); } catch (e) { logErro_('iniciarAvaliacao_.notif', e); }

  return jsonOk_({
    avalId:          avalId,
    status:          fluxo.statusGeral,
    emailNotificado: emailPreenchedor,
    tipo:            tipo,
    periodo:         periodoSan,
  });
}

// ── Salvar Resposta (formulário preenchido + auto-assinatura do preenchedor) ──

/**
 * Preenchedor envia o formulário.
 * Registra assinatura eletrônica do preenchedor e avança para aguardando_assinatura_2.
 */
function salvarRespostaAvaliacao_(avalId, token, dadosFormulario) {
  var fluxo = obterFluxoAvaliacao_(avalId);
  if (!fluxo) return jsonError_('Avaliação não encontrada: ' + avalId, 'NOT_FOUND');

  if (!token || fluxo.tokenPreenchedor !== token) {
    return jsonError_('Token inválido ou não autorizado.', 'AUTH_ERROR');
  }
  if (fluxo.statusGeral !== AVAL_ST.AGUARDANDO_PREENCHIMENTO) {
    return jsonError_(
      'Esta avaliação não está aguardando preenchimento (status atual: ' + fluxo.statusGeral + ').',
      'INVALID_STATE'
    );
  }

  var agora = new Date().toISOString();
  fluxo.dadosFormulario  = dadosFormulario;
  fluxo.tsPreenchimento  = agora;

  // Registra assinatura eletrônica do preenchedor automaticamente
  fluxo.assinaturaPreenchedor = _buildAssinaturaAvaliacao_(fluxo, 'preenchedor', agora);
  fluxo.statusGeral = AVAL_ST.AGUARDANDO_ASSINATURA_2;

  salvarFluxoAvaliacao_(avalId, fluxo);
  _atualizarAvaliacaoNaPlanilha_(avalId, fluxo);

  // Notifica revisor1
  try {
    var sol = _obterDadosSolicitacaoCompleto_(fluxo.idEstagio);
    _notificarRevisor_(fluxo, sol, 1);
  } catch (eN) { logErro_('salvarRespostaAvaliacao_.notifRevisor1', eN); }

  return jsonOk_({ status: fluxo.statusGeral });
}

// ── Assinar Avaliação (botão-clique — idêntico ao checklist) ─────────────────

/**
 * Revisor1 ou Revisor2 confirma a leitura e assina eletronicamente.
 * Após a 3ª assinatura (revisor2) → gera PDF com QR code → concluido.
 *
 * @param {string} avalId
 * @param {string} token
 */
function assinarAvaliacao_(avalId, token) {
  var fluxo = obterFluxoAvaliacao_(avalId);
  if (!fluxo) return jsonError_('Avaliação não encontrada: ' + avalId, 'NOT_FOUND');

  var quem = null;
  if (fluxo.tokenRevisor1 === token && fluxo.statusGeral === AVAL_ST.AGUARDANDO_ASSINATURA_2) {
    quem = 'revisor1';
  } else if (fluxo.tokenRevisor2 === token && fluxo.statusGeral === AVAL_ST.AGUARDANDO_ASSINATURA_3) {
    quem = 'revisor2';
  } else {
    return jsonError_(
      'Token inválido ou estado do fluxo não permite assinatura agora (status: ' + fluxo.statusGeral + ').',
      'AUTH_ERROR'
    );
  }

  var agora = new Date().toISOString();
  var sig   = _buildAssinaturaAvaliacao_(fluxo, quem, agora);

  if (quem === 'revisor1') {
    fluxo.assinaturaRevisor1 = sig;
    fluxo.tsAssinatura2      = agora;
    fluxo.statusGeral        = AVAL_ST.AGUARDANDO_ASSINATURA_3;

    salvarFluxoAvaliacao_(avalId, fluxo);
    _atualizarAvaliacaoNaPlanilha_(avalId, fluxo);

    // Notifica revisor2
    try {
      var solR2 = _obterDadosSolicitacaoCompleto_(fluxo.idEstagio);
      _notificarRevisor_(fluxo, solR2, 2);
    } catch (eN) { logErro_('assinarAvaliacao_.notifRevisor2', eN); }

  } else {
    // revisor2 — última assinatura: gera PDF e conclui
    fluxo.assinaturaRevisor2 = sig;
    fluxo.tsAssinatura3      = agora;
    fluxo.statusGeral        = AVAL_ST.CONCLUIDO;
    fluxo.tsConclusao        = agora;

    // Gera PDF com QR code
    try {
      var solFinal = _obterDadosSolicitacaoCompleto_(fluxo.idEstagio);
      var urlPdf   = gerarPdfAvaliacao_(fluxo, solFinal);
      fluxo.pdfUrl = urlPdf;
    } catch (ePdf) {
      logErro_('assinarAvaliacao_.gerarPdf', ePdf);
    }

    salvarFluxoAvaliacao_(avalId, fluxo);
    _atualizarAvaliacaoNaPlanilha_(avalId, fluxo);

    // Notifica todos (e-mail com link para o PDF)
    try {
      var solNotif = _obterDadosSolicitacaoCompleto_(fluxo.idEstagio);
      _notificarConclusao_(fluxo, solNotif);
    } catch (eN2) { logErro_('assinarAvaliacao_.notifConclusao', eN2); }
  }

  return jsonOk_({ status: fluxo.statusGeral, concluido: fluxo.statusGeral === AVAL_ST.CONCLUIDO });
}

// ── Monta assinatura eletrônica do ator ──────────────────────────────────────

/**
 * Busca nome, CPF e e-mail do ator conforme o papel no fluxo.
 * Reutiliza helpers do api-checklist.gs.
 */
function _buildAssinaturaAvaliacao_(fluxo, papel, dataHora) {
  try {
    var nome = '', cpf = '', email = '';
    var sol  = _obterDadosSolicitacaoCompleto_(fluxo.idEstagio);

    if (papel === 'preenchedor') {
      nome  = fluxo.nomePreenchedor  || '';
      email = fluxo.emailPreenchedor || '';
      // CPF: se for supervisor, busca na aba Supervisores; se for aluno, busca na aba Estudantes
      if (fluxo.tipo === 'concedente') {
        cpf = _ckObterCpfSupervisor_(email);
      } else {
        cpf = String(sol.cpf || '');
      }
    } else if (papel === 'revisor1') {
      nome  = fluxo.nomeRevisor1  || '';
      email = fluxo.emailRevisor1 || '';
      if (fluxo.tipo === 'concedente') {
        // revisor1 é o aluno
        cpf = String(sol.cpf || '');
      } else {
        // revisor1 é o supervisor
        cpf = _ckObterCpfSupervisor_(email);
      }
    } else if (papel === 'revisor2') {
      // Sempre o orientador
      nome  = fluxo.nomeRevisor2  || '';
      email = fluxo.emailRevisor2 || '';
      cpf   = _ckObterCpfOrientador_(email);
    }

    return { nome: nome, cpf: cpf, email: email, dataHora: String(dataHora || '') };
  } catch (e) {
    return { nome: '', cpf: '', email: '', dataHora: String(dataHora || '') };
  }
}

// ── Reenviar Notificação ──────────────────────────────────────────────────────

function reenviarNotificacaoAvaliacao_(avalId, authToken) {
  try { validarTokenAdmin_(authToken); } catch (eA) {
    return jsonError_('Não autorizado: ' + eA.message, 'AUTH_ERROR');
  }

  var fluxo = obterFluxoAvaliacao_(avalId);
  if (!fluxo) return jsonError_('Avaliação não encontrada.', 'NOT_FOUND');

  var sol = null;
  try { sol = _obterDadosSolicitacaoCompleto_(fluxo.idEstagio); } catch (_) {}

  try {
    switch (fluxo.statusGeral) {
      case AVAL_ST.AGUARDANDO_PREENCHIMENTO:
        _notificarPreenchedor_(fluxo, sol);
        return jsonOk_({ reenviado: true, para: fluxo.emailPreenchedor, status: fluxo.statusGeral });
      case AVAL_ST.AGUARDANDO_ASSINATURA_2:
        _notificarRevisor_(fluxo, sol, 1);
        return jsonOk_({ reenviado: true, para: fluxo.emailRevisor1, status: fluxo.statusGeral });
      case AVAL_ST.AGUARDANDO_ASSINATURA_3:
        _notificarRevisor_(fluxo, sol, 2);
        return jsonOk_({ reenviado: true, para: fluxo.emailRevisor2, status: fluxo.statusGeral });
      default:
        return jsonError_('Avaliação já concluída — nada a reenviar.', 'INVALID_STATE');
    }
  } catch (e) {
    return jsonError_('Erro ao reenviar: ' + e.message, 'SEND_ERROR');
  }
}

// ── Listar Avaliações de um Estágio ──────────────────────────────────────────

function listarAvaliacoesEstagio_(idEstagio, authToken) {
  try { validarTokenAdmin_(authToken); } catch (eA) {
    return jsonError_('Não autorizado: ' + eA.message, 'AUTH_ERROR');
  }

  try {
    var sheet = SpreadsheetApp.openById(SS_ID).getSheetByName(AVAL_SHEET_NAME);
    if (!sheet) return jsonOk_([]);
    var dados = sheet.getDataRange().getValues();
    var lista = [];
    for (var i = 1; i < dados.length; i++) {
      var row = dados[i];
      if (String(row[COL_AVAL.ID_ESTAGIO] || '') !== String(idEstagio)) continue;
      lista.push({
        avalId:          String(row[COL_AVAL.AVAL_ID]          || ''),
        tipo:            String(row[COL_AVAL.TIPO]              || ''),
        periodo:         String(row[COL_AVAL.PERIODO]           || ''),
        periodoRef:      String(row[COL_AVAL.PERIODO_REF]       || ''),
        status:          String(row[COL_AVAL.STATUS]            || ''),
        emailPreenchedor:String(row[COL_AVAL.EMAIL_PREENCHEDOR] || ''),
        emailRevisor:    String(row[COL_AVAL.EMAIL_REVISOR]     || ''),
        tsInicio:        String(row[COL_AVAL.TS_INICIO]         || ''),
        tsPreenchimento: String(row[COL_AVAL.TS_PREENCHIMENTO]  || ''),
        tsAssinatura1:   String(row[COL_AVAL.TS_ASSINATURA_1]   || ''),
        tsAssinatura2:   String(row[COL_AVAL.TS_ASSINATURA_2]   || ''),
        tsConclusao:     String(row[COL_AVAL.TS_CONCLUSAO]      || ''),
        temPdf:          !!(row[COL_AVAL.PDF_GERADO_URL]),
      });
    }
    return jsonOk_(lista);
  } catch (e) {
    logErro_('listarAvaliacoesEstagio_', e);
    return jsonError_('Erro ao listar avaliações.', 'INTERNAL');
  }
}

// ── Trigger diário: verificar avaliações devidas ─────────────────────────────

/**
 * Chamado por verificarPrazos() em api-checklist.gs.
 * Escaneia todos os estágios ativos e dispara avaliações nos períodos devidos.
 */
function verificarAvaliacoesDevidas() {
  try {
    var ss    = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName('Solicitações');
    if (!sheet) return;

    var dados = sheet.getDataRange().getValues();
    var hoje  = new Date();
    hoje.setHours(0, 0, 0, 0);

    for (var i = 1; i < dados.length; i++) {
      var row = dados[i];
      // Coluna de status da solicitação — só processa ativos
      var statusSol = String(row[COL_SOL.STATUS] || '').toLowerCase();
      if (statusSol.indexOf('aprovad') === -1 && statusSol.indexOf('ativo') === -1) continue;

      var idEstagio  = String(row[COL_SOL.ID_ESTAGIO]  || '').trim();
      var dataInicio = row[COL_SOL.DATA_INICIO];
      var dataFim    = row[COL_SOL.DATA_TERMINO];
      if (!idEstagio || !dataInicio || !dataFim) continue;

      try {
        var dInicio = new Date(normalizarDataISO_(dataInicio));
        var dFim    = new Date(normalizarDataISO_(dataFim));
        if (isNaN(dInicio.getTime()) || isNaN(dFim.getTime())) continue;

        var periodos = _calcularPeriodosAvaliacao_(dInicio, dFim);

        periodos.forEach(function (per) {
          var dataDisparo = new Date(per.dataDisparo);
          dataDisparo.setHours(0, 0, 0, 0);
          if (dataDisparo.getTime() !== hoje.getTime()) return; // só dispara no dia exato

          // Dispara concedente e aluno simultaneamente
          ['concedente', 'aluno'].forEach(function (tipo) {
            var avalId = idEstagio + '_' + tipo + '_' + per.tipo;
            if (obterFluxoAvaliacao_(avalId)) return; // já existe, pula

            var periodoRef = _formatarDataBr_(dInicio) + ' a ' + _formatarDataBr_(dataDisparo);
            try {
              iniciarAvaliacao_(idEstagio, tipo, per.tipo, periodoRef, 'sistema');
            } catch (eIni) {
              logErro_('verificarAvaliacoesDevidas_.iniciar.' + tipo + '.' + idEstagio, eIni);
            }
          });
        });

      } catch (eRow) {
        logErro_('verificarAvaliacoesDevidas_.row.' + idEstagio, eRow);
      }
    }
  } catch (e) {
    logErro_('verificarAvaliacoesDevidas', e);
  }
}

/**
 * Calcula os períodos de avaliação a partir das datas de início e fim.
 *
 * Regras:
 *   ≤ 6 meses → apenas [{tipo:'final', dataDisparo: dataFim}]
 *   7-12 meses → [{tipo:'semestral_1', dataDisparo: +6m}, {tipo:'final', dataDisparo: dataFim}]
 *   13-18 meses → [{tipo:'semestral_1', +6m}, {tipo:'semestral_2', +12m}, {tipo:'final', dataFim}]
 *   E assim por diante a cada 6 meses + sempre final
 *
 * @param {Date} dataInicio
 * @param {Date} dataFim
 * @return {Array<{tipo:string, dataDisparo:string}>}
 */
function _calcularPeriodosAvaliacao_(dataInicio, dataFim) {
  var periodos = [];
  var msTotal  = dataFim.getTime() - dataInicio.getTime();
  var diasTotal = Math.round(msTotal / 86400000);
  var mesesTotal = diasTotal / 30.44; // aproximação

  if (mesesTotal <= 6) {
    // Só avaliação final
    periodos.push({ tipo: 'final', dataDisparo: new Date(dataFim).toISOString() });
    return periodos;
  }

  // Avaliações semestrais: a cada 6 meses a partir do início
  var semestre = 1;
  while (true) {
    var mesesOffset = semestre * 6;
    var dSemestral  = new Date(dataInicio);
    dSemestral.setMonth(dSemestral.getMonth() + mesesOffset);

    // Se essa data já passou ou ultrapassou o fim, para
    if (dSemestral >= dataFim) break;

    periodos.push({
      tipo:        'semestral_' + semestre,
      dataDisparo: dSemestral.toISOString(),
    });
    semestre++;
  }

  // Sempre adiciona final no encerramento
  periodos.push({ tipo: 'final', dataDisparo: new Date(dataFim).toISOString() });

  return periodos;
}

// ── Gerar PDF da Avaliação ────────────────────────────────────────────────────

/**
 * Gera PDF após todas as 3 assinaturas, com QR code e bloco de assinaturas.
 * Idêntico ao padrão do gerarPdfChecklist_.
 * Salva na subpasta "Avaliações" dentro da pasta do estágio.
 *
 * @param {Object} fluxo  Estado completo com as 3 assinaturas já registradas
 * @param {Object} sol    Dados completos da solicitação
 * @return {string} URL do PDF gerado
 */
function gerarPdfAvaliacao_(fluxo, sol) {
  var docId = null;
  try {
    var dados        = fluxo.dadosFormulario || {};
    var isConcedente = (fluxo.tipo === 'concedente');
    var tipoNome     = isConcedente ? 'PELA CONCEDENTE' : 'PELO ALUNO';
    var prefixoNome  = isConcedente ? 'AvalConced' : 'AvalAluno';
    var docName      = prefixoNome + ' — ' + String(sol.nomeEstudante || fluxo.idEstagio).replace(/[\/\\]/g, '-')
                     + ' — ' + fluxo.periodo;

    // Token de validação (gerado aqui, registrado no mapa reverso)
    var tokenValidacao = fluxo.tokenValidacao || Utilities.getUuid();
    fluxo.tokenValidacao = tokenValidacao;
    PropertiesService.getScriptProperties().setProperty('val_aval_' + tokenValidacao, fluxo.avalId);
    var urlValidacao = BASE_URL + '/validar/?t=' + encodeURIComponent(tokenValidacao);

    // ── Cria Google Doc ──────────────────────────────────────────────────────
    var doc  = DocumentApp.create(docName);
    docId    = doc.getId();
    var body = doc.getBody();
    body.clear();
    body.setMarginTop(56).setMarginBottom(56).setMarginLeft(72).setMarginRight(72);

    // Helpers de formatação
    var _fmtIso = function (iso) {
      if (!iso) return '—';
      try { return Utilities.formatDate(new Date(iso), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss'); }
      catch (_) { return String(iso); }
    };

    function kv(lbl, val) {
      var v   = (val !== undefined && val !== null && String(val).trim()) ? String(val) : '—';
      var str = lbl + ': ' + v;
      var p   = body.appendParagraph(str);
      p.setSpacingBefore(2).setSpacingAfter(2);
      var t = p.editAsText();
      t.setFontFamily('Arial').setFontSize(10);
      t.setBold(0, lbl.length, true);
      if (str.length > lbl.length + 2) t.setBold(lbl.length + 2, str.length - 1, false);
    }

    function sec(titulo_) {
      var p = body.appendParagraph(titulo_);
      p.setSpacingBefore(12).setSpacingAfter(4);
      p.editAsText().setFontFamily('Arial').setFontSize(10).setBold(true);
      body.appendHorizontalRule();
    }

    // ── Cabeçalho institucional ───────────────────────────────────────────────
    var _logo = _obterLogoCabecalho_();
    if (_logo) {
      try {
        var li = body.appendImage(_logo);
        li.setWidth(54).setHeight(54);
        li.getParent().setAlignment(DocumentApp.HorizontalAlignment.CENTER).setSpacingBefore(0).setSpacingAfter(2);
      } catch (_) {}
    }
    var p1 = body.appendParagraph('MINISTÉRIO DA EDUCAÇÃO');
    p1.setAlignment(DocumentApp.HorizontalAlignment.CENTER).setSpacingBefore(0).setSpacingAfter(1);
    p1.editAsText().setFontFamily('Arial').setFontSize(8);
    var p2 = body.appendParagraph('INSTITUTO FEDERAL DE EDUCAÇÃO, CIÊNCIA E TECNOLOGIA DO RIO GRANDE DO SUL');
    p2.setAlignment(DocumentApp.HorizontalAlignment.CENTER).setSpacingBefore(1).setSpacingAfter(1);
    p2.editAsText().setFontFamily('Arial').setFontSize(9).setBold(true);
    var p3 = body.appendParagraph('Campus Rio Grande');
    p3.setAlignment(DocumentApp.HorizontalAlignment.CENTER).setSpacingBefore(1).setSpacingAfter(10);
    p3.editAsText().setFontFamily('Arial').setFontSize(8);

    // ── Título ────────────────────────────────────────────────────────────────
    var pTit = body.appendParagraph('RELATÓRIO DE ESTÁGIO — AVALIAÇÃO DO ESTÁGIO ' + tipoNome);
    pTit.setAlignment(DocumentApp.HorizontalAlignment.CENTER).setSpacingBefore(4).setSpacingAfter(2);
    pTit.editAsText().setFontFamily('Arial').setFontSize(13).setBold(true);

    if (fluxo.periodoRef) {
      var pPer = body.appendParagraph('Período: ' + fluxo.periodoRef);
      pPer.setAlignment(DocumentApp.HorizontalAlignment.CENTER).setSpacingBefore(0).setSpacingAfter(10);
      pPer.editAsText().setFontFamily('Arial').setFontSize(10).setItalic(true);
    }

    // ── Seção 1: Identificação ────────────────────────────────────────────────
    sec('1. IDENTIFICAÇÃO');
    kv('Estagiário(a)',      sol.nomeEstudante  || '');
    kv('Curso',              sol.curso          || '');
    kv('Matrícula',          sol.matricula      || '');
    kv('Tipo de Estágio',    sol.tipoEstagio    || '');
    kv('Entidade Concedente',sol.nomeEmpresa    || '');
    kv('Supervisor(a)',      sol.nomeSupervisor || '');
    kv('Professor(a) Orientador(a)', sol.nomeOrientador || '');
    kv('Período desta avaliação', fluxo.periodoRef || '—');
    if (dados.horasNoPeriodo) kv('Total de horas no período', String(dados.horasNoPeriodo) + 'h');
    if (dados.horasTotais)    kv('Soma total de horas (todas as avaliações)', String(dados.horasTotais) + 'h');
    if (dados.observacoesIdentificacao) kv('Observações', dados.observacoesIdentificacao);

    if (isConcedente) {
      // ── Seção 2: Avaliação de Desempenho (tabela de critérios) ───────────
      sec('2. AVALIAÇÃO DE DESEMPENHO');
      var pEscala = body.appendParagraph('Escala: MB = Muito Bom · B = Bom · R = Razoável');
      pEscala.setSpacingBefore(0).setSpacingAfter(6);
      pEscala.editAsText().setFontFamily('Arial').setFontSize(9).setItalic(true);

      var tbl = body.appendTable();
      var hRow = tbl.appendTableRow();
      var cells = ['Critério de Avaliação', 'Muito Bom', 'Bom', 'Razoável'];
      cells.forEach(function (c) {
        hRow.appendTableCell(c).editAsText().setFontFamily('Arial').setFontSize(9).setBold(true);
      });
      CRITERIOS_CONCEDENTE.forEach(function (crit) {
        var val = (dados.criterios && dados.criterios[crit.id]) || '';
        var r   = tbl.appendTableRow();
        r.appendTableCell(crit.label).editAsText().setFontFamily('Arial').setFontSize(9);
        ['MB','B','R'].forEach(function (op) {
          r.appendTableCell(val === op ? '✓' : '').editAsText().setFontFamily('Arial').setFontSize(10);
        });
      });

      if (dados.observacoes) {
        sec('3. OBSERVAÇÕES');
        var pObs = body.appendParagraph(dados.observacoes);
        pObs.setSpacingBefore(2).setSpacingAfter(4);
        pObs.editAsText().setFontFamily('Arial').setFontSize(10);
      }

    } else {
      // ── Avaliação pelo Aluno: seções narrativas ──────────────────────────

      // Alterações no estágio
      if (dados.rescisao) {
        kv('Rescisão de contrato',
          'Sim' + (dados.rescisaoData ? ' — ' + dados.rescisaoData : ''));
      } else {
        kv('Rescisão de contrato', 'Não');
      }
      if (dados.trocaSupervisor) {
        kv('Troca de supervisor',
          'Sim' + (dados.trocaSupervisorNome ? ' — novo supervisor: ' + dados.trocaSupervisorNome : ''));
      }
      if (dados.trocaOrientador) {
        kv('Troca de orientador',
          'Sim' + (dados.trocaOrientadorNome ? ' — novo orientador: ' + dados.trocaOrientadorNome : ''));
      }

      sec('2. ATIVIDADES DESENVOLVIDAS PELO ESTAGIÁRIO NA CONCEDENTE');
      var pAtiv = body.appendParagraph(dados.atividadesDesenvolvidas || '—');
      pAtiv.setSpacingBefore(2).setSpacingAfter(6);
      pAtiv.editAsText().setFontFamily('Arial').setFontSize(10);

      sec('3. DIFICULDADES E PONTOS POSITIVOS');
      var pDif = body.appendParagraph(dados.dificuldadesPontos || '—');
      pDif.setSpacingBefore(2).setSpacingAfter(6);
      pDif.editAsText().setFontFamily('Arial').setFontSize(10);

      sec('4. SUGESTÕES PARA APERFEIÇOAMENTO DO CURSO');
      var pSug = body.appendParagraph(dados.sugestoes || '—');
      pSug.setSpacingBefore(2).setSpacingAfter(6);
      pSug.editAsText().setFontFamily('Arial').setFontSize(10);

      sec('5. CONCLUSÃO — APROVEITAMENTO E RELAÇÃO COM DISCIPLINAS');
      var pConc = body.appendParagraph(dados.conclusao || '—');
      pConc.setSpacingBefore(2).setSpacingAfter(6);
      pConc.editAsText().setFontFamily('Arial').setFontSize(10);
    }

    // ── Assinaturas Eletrônicas ────────────────────────────────────────────────
    body.appendParagraph('');
    sec('ASSINATURAS ELETRÔNICAS');

    var CINZA = '#6b7280';

    var _blocoAssinatura = function (titulo, sig) {
      body.appendParagraph('');
      var titP = body.appendParagraph(titulo);
      titP.editAsText().setFontFamily('Arial').setFontSize(10).setBold(true);
      if (!sig || !sig.nome) {
        body.appendParagraph('(não registrada)').editAsText()
          .setFontFamily('Arial').setFontSize(10).setItalic(true);
        return;
      }
      kv('Nome',        sig.nome);
      kv('CPF',         sig.cpf);
      kv('E-mail',      sig.email);
      kv('Data e Hora', _fmtIso(sig.dataHora));
      var rodape = body.appendParagraph(
        'Assinatura realizada eletronicamente conforme os termos do SGE — IFRS Campus Rio Grande.'
      );
      rodape.getChild(0).setFontSize(8).setForegroundColor(CINZA).setItalic(true);
    };

    // Labels conforme o tipo
    if (isConcedente) {
      _blocoAssinatura('1. Supervisor(a) — ' + (sol.nomeEmpresa || 'Concedente'), fluxo.assinaturaPreenchedor);
      _blocoAssinatura('2. Estagiário(a)',                                          fluxo.assinaturaRevisor1);
      _blocoAssinatura('3. Professor(a) Orientador(a)',                             fluxo.assinaturaRevisor2);
    } else {
      _blocoAssinatura('1. Estagiário(a)',                                          fluxo.assinaturaPreenchedor);
      _blocoAssinatura('2. Supervisor(a) — ' + (sol.nomeEmpresa || 'Concedente'), fluxo.assinaturaRevisor1);
      _blocoAssinatura('3. Professor(a) Orientador(a)',                             fluxo.assinaturaRevisor2);
    }

    // ── QR Code de Validação ──────────────────────────────────────────────────
    body.appendParagraph('');
    sec('VALIDAÇÃO DO DOCUMENTO');

    var instrPar = body.appendParagraph(
      'Escaneie o QR Code ou acesse o link abaixo para verificar a autenticidade deste documento.'
    );
    instrPar.getChild(0).setFontSize(9).setForegroundColor(CINZA);
    body.appendParagraph('');

    var qrGerado = false;
    var qrApis = [
      'https://quickchart.io/qr?size=200&margin=2&text=' + encodeURIComponent(urlValidacao),
      'https://chart.googleapis.com/chart?cht=qr&chs=200x200&chld=M|1&chl=' + encodeURIComponent(urlValidacao),
    ];
    for (var qi = 0; qi < qrApis.length && !qrGerado; qi++) {
      try {
        var qrResp = UrlFetchApp.fetch(qrApis[qi], { muteHttpExceptions: true });
        if (qrResp.getResponseCode() === 200) {
          var qrBlob = qrResp.getBlob().setContentType('image/png').setName('qrcode.png');
          var qrImg  = body.appendImage(qrBlob);
          qrImg.setWidth(130).setHeight(130);
          body.appendParagraph('');
          qrGerado = true;
        }
      } catch (_qr) { /* tenta próxima API */ }
    }
    if (!qrGerado) {
      logErro_('gerarPdfAvaliacao_.qrcode', new Error('Nenhuma API de QR Code respondeu.'));
    }

    var validLabel = body.appendParagraph('🔗 Link de validação:');
    validLabel.editAsText().setFontFamily('Arial').setFontSize(9).setBold(true);
    var validPar = body.appendParagraph(urlValidacao);
    validPar.editAsText().setFontFamily('Arial').setFontSize(9);

    var rodapeFinal = body.appendParagraph(
      'Documento gerado automaticamente pelo SGE — IFRS Campus Rio Grande · '
      + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss')
    );
    rodapeFinal.editAsText().setFontFamily('Arial').setFontSize(8).setItalic(true);
    rodapeFinal.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

    doc.saveAndClose();

    // ── Exporta como PDF ──────────────────────────────────────────────────────
    var docFile = DriveApp.getFileById(docId);
    var pdfBlob = docFile.getAs('application/pdf').setName(docName + '.pdf');

    // Salva na subpasta "Avaliações" dentro da pasta do estágio
    var pastaAval = _obterPastaAvaliacao_(fluxo);
    var pdfFile   = pastaAval.createFile(pdfBlob);
    pdfFile.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);

    // Move o Google Doc para a mesma pasta (e o exclui da raiz)
    try { pastaAval.addFile(docFile); DriveApp.getRootFolder().removeFile(docFile); } catch (_mv) {}

    return pdfFile.getUrl();

  } catch (e) {
    logErro_('gerarPdfAvaliacao_', e);
    if (docId) { try { DriveApp.getFileById(docId).setTrashed(true); } catch (_) {} }
    throw e;
  }
}

// ── Pasta de avaliações no Drive ──────────────────────────────────────────────

function _obterPastaAvaliacao_(fluxo) {
  if (fluxo.drivePastaId) {
    try {
      var pastaEstagio = DriveApp.getFolderById(fluxo.drivePastaId);
      var it = pastaEstagio.getFoldersByName('Avaliações');
      if (it.hasNext()) return it.next();
      var sub = pastaEstagio.createFolder('Avaliações');
      sub.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
      return sub;
    } catch (e) {
      logErro_('_obterPastaAvaliacao_', e);
    }
  }
  return DriveApp.getFolderById(CFG_DRIVE.ESTAGIOS_ID);
}

// ── Planilha: aba "Avaliações" ─────────────────────────────────────────────────

function _atualizarAvaliacaoNaPlanilha_(avalId, fluxo) {
  try {
    var sheet = SpreadsheetApp.openById(SS_ID).getSheetByName(AVAL_SHEET_NAME);
    if (!sheet) return;

    var dadosFormStr = '';
    try { if (fluxo.dadosFormulario) dadosFormStr = JSON.stringify(fluxo.dadosFormulario); } catch (_) {}

    var linha = new Array(19).fill('');
    linha[COL_AVAL.TIMESTAMP]          = new Date().toISOString();
    linha[COL_AVAL.AVAL_ID]            = fluxo.avalId            || '';
    linha[COL_AVAL.ID_ESTAGIO]         = fluxo.idEstagio         || '';
    linha[COL_AVAL.TIPO]               = fluxo.tipo              || '';
    linha[COL_AVAL.PERIODO]            = fluxo.periodo           || '';
    linha[COL_AVAL.PERIODO_REF]        = fluxo.periodoRef        || '';
    linha[COL_AVAL.STATUS]             = fluxo.statusGeral       || '';
    linha[COL_AVAL.EMAIL_PREENCHEDOR]  = fluxo.emailPreenchedor  || '';
    linha[COL_AVAL.EMAIL_REVISOR]      = fluxo.emailRevisor1     || '';
    linha[COL_AVAL.DADOS_FORM]         = dadosFormStr;
    linha[COL_AVAL.PDF_GERADO_URL]     = fluxo.pdfUrl            || '';
    linha[COL_AVAL.PDF_ASSINADO_1_URL] = '';
    linha[COL_AVAL.PDF_ASSINADO_2_URL] = '';
    linha[COL_AVAL.DRIVE_PASTA_ID]     = fluxo.drivePastaId      || '';
    linha[COL_AVAL.TS_INICIO]          = fluxo.tsInicio          || '';
    linha[COL_AVAL.TS_PREENCHIMENTO]   = fluxo.tsPreenchimento   || '';
    linha[COL_AVAL.TS_ASSINATURA_1]    = fluxo.tsAssinatura2     || '';
    linha[COL_AVAL.TS_ASSINATURA_2]    = fluxo.tsAssinatura3     || '';
    linha[COL_AVAL.TS_CONCLUSAO]       = fluxo.tsConclusao       || '';

    var dados  = sheet.getDataRange().getValues();
    var rowIdx = -1;
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][COL_AVAL.AVAL_ID]) === String(avalId)) { rowIdx = i + 1; break; }
    }
    if (rowIdx > 0) {
      sheet.getRange(rowIdx, 1, 1, linha.length).setValues([linha]);
    } else {
      sheet.appendRow(linha);
    }
  } catch (e) {
    logErro_('_atualizarAvaliacaoNaPlanilha_', e);
  }
}

// ── E-mails ───────────────────────────────────────────────────────────────────

function _avalHtmlBase_(titulo, corpo) {
  return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">'
    + '<style>body{font-family:Arial,sans-serif;font-size:14px;color:#374151;margin:0;padding:0;background:#f9fafb;}'
    + '.w{max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;}'
    + '.h{background:#1d4ed8;padding:24px 32px;}.h h1{color:#fff;margin:0;font-size:18px;font-weight:600;}'
    + '.b{padding:32px;}.b p{margin:0 0 16px;line-height:1.6;}'
    + '.btn{display:inline-block;background:#1d4ed8;color:#fff;padding:12px 24px;border-radius:6px;'
    + '     text-decoration:none;font-weight:600;margin:8px 0;font-size:14px;}'
    + '.ft{background:#f3f4f6;padding:16px 32px;font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;}'
    + '</style></head><body><div class="w">'
    + '<div class="h"><h1>' + titulo + '</h1></div>'
    + '<div class="b">' + corpo + '</div>'
    + '<div class="ft">Central de Estágios IFRS Campus Rio Grande · '
    + '<a href="mailto:estagios@riogrande.ifrs.edu.br" style="color:#6b7280;">estagios@riogrande.ifrs.edu.br</a></div>'
    + '</div></body></html>';
}

function _avalEnviarEmail_(para, assunto, html) {
  if (!para || String(para).indexOf('@') < 0) return;
  try {
    GmailApp.sendEmail(para, assunto, '', { htmlBody: html, name: 'Central de Estágios IFRS' });
  } catch (_) {
    try { MailApp.sendEmail({ to: para, subject: assunto, htmlBody: html, name: 'Central de Estágios IFRS' }); } catch (_2) {}
  }
}

function _avalPageUrl_(fluxo, token) {
  return BASE_URL + '/avaliacoes/?aval=' + encodeURIComponent(fluxo.avalId)
       + '&token=' + encodeURIComponent(token);
}

function _notificarPreenchedor_(fluxo, sol) {
  if (!fluxo.emailPreenchedor) return;
  var tipoLabel = fluxo.tipo === 'concedente'
    ? 'Avaliação do Estágio pela Concedente'
    : 'Avaliação do Estágio pelo Aluno';
  var url = _avalPageUrl_(fluxo, fluxo.tokenPreenchedor);
  var quemPreenche = fluxo.tipo === 'concedente' ? 'Supervisor(a)' : 'Estagiário(a)';
  var html = _avalHtmlBase_(
    tipoLabel,
    '<p>Olá' + (fluxo.nomePreenchedor ? ', <strong>' + fluxo.nomePreenchedor + '</strong>' : '') + '!</p>'
    + '<p>Uma avaliação de estágio aguarda o preenchimento pelo(a) <strong>' + quemPreenche + '</strong>.</p>'
    + '<p><strong>Estagiário(a):</strong> ' + (sol ? (sol.nomeEstudante || '—') : '—') + '<br>'
    + '<strong>Período de avaliação:</strong> ' + (fluxo.periodoRef || '—') + '</p>'
    + '<a href="' + url + '" class="btn">Preencher Avaliação</a>'
    + '<p style="font-size:12px;color:#6b7280;margin-top:16px;">Ou copie o link: ' + url + '</p>'
  );
  _avalEnviarEmail_(
    fluxo.emailPreenchedor,
    '[SGE] Avaliação de Estágio para Preencher — ' + ((sol && sol.nomeEstudante) || fluxo.idEstagio),
    html
  );
}

function _notificarRevisor_(fluxo, sol, qual) {
  var email = qual === 1 ? fluxo.emailRevisor1 : fluxo.emailRevisor2;
  var nome  = qual === 1 ? fluxo.nomeRevisor1  : fluxo.nomeRevisor2;
  var token = qual === 1 ? fluxo.tokenRevisor1 : fluxo.tokenRevisor2;
  if (!email) return;

  var tipoLabel = fluxo.tipo === 'concedente' ? 'Avaliação pela Concedente' : 'Avaliação pelo Aluno';
  var url  = _avalPageUrl_(fluxo, token);
  var acao = 'A avaliação foi preenchida e assinada por '
    + (fluxo.nomePreenchedor || 'um dos responsáveis')
    + '. Por favor, revise os dados e confirme sua assinatura eletrônica no sistema.';

  var html = _avalHtmlBase_(
    tipoLabel + ' — Revisão e Assinatura Necessária',
    '<p>Olá' + (nome ? ', <strong>' + nome + '</strong>' : '') + '!</p>'
    + '<p>' + acao + '</p>'
    + '<p><strong>Estagiário(a):</strong> ' + ((sol && sol.nomeEstudante) || '—') + '<br>'
    + '<strong>Período:</strong> ' + (fluxo.periodoRef || '—') + '</p>'
    + '<a href="' + url + '" class="btn">Revisar e Assinar</a>'
    + '<p style="font-size:12px;color:#6b7280;margin-top:16px;">Ou copie o link: ' + url + '</p>'
  );
  _avalEnviarEmail_(
    email,
    '[SGE] Revisar e Assinar Avaliação de Estágio — ' + ((sol && sol.nomeEstudante) || fluxo.idEstagio),
    html
  );
}

function _notificarConclusao_(fluxo, sol) {
  var tipoLabel = fluxo.tipo === 'concedente' ? 'pela Concedente' : 'pelo Aluno';
  var urlPdf    = fluxo.pdfUrl || '';

  var dests = [
    { email: sol.emailEstudante,    nome: sol.nomeEstudante    || 'Estagiário(a)' },
    { email: fluxo.emailRevisor1,   nome: fluxo.nomeRevisor1   || '' },
    { email: fluxo.emailRevisor2,   nome: fluxo.nomeRevisor2   || '' },
    { email: 'estagios@riogrande.ifrs.edu.br', nome: 'Setor de Estágios' },
  ].filter(function (d) { return !!(d.email && String(d.email).indexOf('@') > 0); });

  // Deduplicar e-mails
  var vistos = {};
  dests = dests.filter(function (d) {
    if (vistos[d.email]) return false;
    vistos[d.email] = true;
    return true;
  });

  var html = _avalHtmlBase_(
    'Avaliação ' + tipoLabel + ' — Concluída com Todas as Assinaturas',
    '<p>A avaliação de estágio foi concluída com todos os responsáveis assinando eletronicamente.</p>'
    + '<p><strong>Estágio:</strong> ' + fluxo.idEstagio + '<br>'
    + '<strong>Estagiário(a):</strong> ' + ((sol && sol.nomeEstudante) || '—') + '<br>'
    + '<strong>Tipo:</strong> Avaliação ' + tipoLabel + '<br>'
    + '<strong>Período:</strong> ' + (fluxo.periodoRef || '—') + '</p>'
    + (urlPdf ? '<a href="' + urlPdf + '" class="btn">Baixar PDF com Assinaturas</a>' : '')
    + '<p style="font-size:12px;color:#6b7280;margin-top:16px;">'
    + 'Este documento está salvo na pasta do estágio no Google Drive.</p>'
  );

  dests.forEach(function (d) {
    _avalEnviarEmail_(
      d.email,
      '[SGE] Avaliação de Estágio Concluída — ' + ((sol && sol.nomeEstudante) || fluxo.idEstagio),
      html
    );
  });
}

// ── Handlers GET / POST ───────────────────────────────────────────────────────

function doGetAvaliacoes(e) {
  var action = (e.parameter && e.parameter.action) || '';
  var avalId  = (e.parameter && e.parameter.avalId)  || '';
  var id      = (e.parameter && e.parameter.id)      || '';

  switch (action) {

    case 'obterFluxoAvaliacao': {
      if (!avalId) return jsonError_('Parâmetro avalId obrigatório.', 'MISSING_PARAM');
      var token    = (e.parameter && e.parameter.token)     || '';
      var authTkG  = (e.parameter && e.parameter.authToken) || '';
      var fluxoG   = obterFluxoAvaliacao_(avalId);
      if (!fluxoG) return jsonError_('Avaliação não encontrada: ' + avalId, 'NOT_FOUND');

      var isAdminG  = false;
      var meuPapelG = null;

      if (authTkG) {
        try { validarTokenAdmin_(authTkG); isAdminG = true; } catch (_) {}
      }
      if (!isAdminG) {
        if (!token) return jsonError_('Token obrigatório.', 'MISSING_PARAM');
        if      (fluxoG.tokenPreenchedor === token) meuPapelG = 'preenchedor';
        else if (fluxoG.tokenRevisor1    === token) meuPapelG = 'revisor1';
        else if (fluxoG.tokenRevisor2    === token) meuPapelG = 'revisor2';
        else return jsonError_('Token inválido ou link expirado.', 'AUTH_ERROR');
      }

      var pubG = {
        avalId:          fluxoG.avalId,
        idEstagio:       fluxoG.idEstagio,
        tipo:            fluxoG.tipo,
        periodo:         fluxoG.periodo,
        periodoRef:      fluxoG.periodoRef,
        statusGeral:     fluxoG.statusGeral,
        nomePreenchedor: fluxoG.nomePreenchedor,
        nomeRevisor1:    fluxoG.nomeRevisor1,
        nomeRevisor2:    fluxoG.nomeRevisor2,
        dadosFormulario: fluxoG.dadosFormulario || null,
        temPdf:          !!(fluxoG.pdfUrl),
        pdfUrl:          fluxoG.pdfUrl || null,
        tsInicio:        fluxoG.tsInicio,
        tsPreenchimento: fluxoG.tsPreenchimento,
        tsAssinatura2:   fluxoG.tsAssinatura2,
        tsAssinatura3:   fluxoG.tsAssinatura3,
        tsConclusao:     fluxoG.tsConclusao,
      };
      if (meuPapelG) pubG._meuPapel = meuPapelG;
      if (isAdminG)  pubG._isAdmin  = true;

      // Dados da solicitação (identificação para exibição)
      try {
        var solI = _obterDadosSolicitacaoCompleto_(fluxoG.idEstagio);
        pubG._sol = {
          nomeEstudante:  solI.nomeEstudante  || '',
          nomeEmpresa:    solI.nomeEmpresa    || '',
          curso:          solI.curso          || '',
          nomeSupervisor: solI.nomeSupervisor || '',
          nomeOrientador: solI.nomeOrientador || '',
          tipoEstagio:    solI.tipoEstagio    || '',
          matricula:      solI.matricula      || '',
        };
      } catch (_) {}

      return jsonOk_(pubG);
    }

    case 'listarAvaliacoesEstagio': {
      if (!id) return jsonError_('Parâmetro id obrigatório.', 'MISSING_PARAM');
      var authTkL = (e.parameter && e.parameter.authToken) || '';
      return listarAvaliacoesEstagio_(id, authTkL);
    }

    default:
      return jsonError_('Ação GET desconhecida em avaliacoes: ' + action, 'UNKNOWN_ACTION');
  }
}

function doPostAvaliacoes(e) {
  var body   = e._body || {};
  var action = body.action || '';

  switch (action) {

    case 'iniciarAvaliacao': {
      var authTkI = body.authToken || '';
      try { validarTokenAdmin_(authTkI); } catch (eA) {
        return jsonError_('Não autorizado: ' + eA.message, 'AUTH_ERROR');
      }
      if (!body.idEstagio) return jsonError_('idEstagio obrigatório.', 'MISSING_PARAM');
      if (!body.tipo)      return jsonError_('tipo obrigatório.', 'MISSING_PARAM');
      if (!body.periodo)   return jsonError_('periodo obrigatório.', 'MISSING_PARAM');
      return iniciarAvaliacao_(
        body.idEstagio, body.tipo, body.periodo, body.periodoRef || '', authTkI
      );
    }

    case 'salvarRespostaAvaliacao':
      return salvarRespostaAvaliacao_(
        body.avalId  || '',
        body.token   || '',
        body.dadosFormulario || {}
      );

    case 'assinarAvaliacao':
      return assinarAvaliacao_(
        body.avalId || '',
        body.token  || ''
      );

    case 'reenviarNotificacaoAvaliacao':
      return reenviarNotificacaoAvaliacao_(body.avalId || '', body.authToken || '');

    default:
      return jsonError_('Ação POST desconhecida em avaliacoes: ' + action, 'UNKNOWN_ACTION');
  }
}
