/**
 * api-checklist.gs — Fluxo de Checklist de Solicitações de Estágio
 * SGE — Sistema de Gestão de Estágios · IFRS Campus Rio Grande
 *
 * Fluxo (3 atores, sequencial):
 *   1. Orientador (1º) — Aceite de orientação + itens pedagógicos + papel de coordenador
 *      → acessa via aceite-orientacao.html (magic-link por token)
 *   2. Supervisor  (2º) — Itens de supervisão + verificação da empresa
 *      → acessa via checklist/index.html (magic-link por token)
 *   3. Admin/Setor (3º) — Revisão administrativa final
 *      → acessa via painel admin (Google OAuth)
 *   Todos aprovados → fluxo de assinaturas inicia automaticamente
 *
 * Armazenamento:
 *   PropertiesService  →  "checklist_[idEstagio]"  (estado completo em JSON)
 *   Sheet "Checklists" →  resumo tabelado para relatórios e visão do Admin
 *
 * Prazos:
 *   PropertiesService  →  "config_prazos"  (dias úteis por ator, editável pelo Admin)
 */

'use strict';

// ── Constantes ───────────────────────────────────────────────────────────────

var CHECKLIST_SHEET = 'Checklists';
var PRAZOS_KEY      = 'config_prazos';
var SS_ID           = '1zVyseifVC6xeMpNjqwYd6jCq9HTJ2NS8BlN1dtM4s7Y';

var CK_STATUS = {
  PENDENTE:     'pendente',
  EM_ANDAMENTO: 'em_andamento',
  APROVADO:     'aprovado',
  AJUSTE:       'ajuste',
  RECUSADO:     'recusado',
};

// ── Itens do checklist — gerados a partir dos campos da solicitação ──────────

/**
 * Gera lista de itens do checklist baseada nos campos reais da solicitação.
 * Todos os 3 atores recebem a mesma lista; a diferença de exibição
 * (ocultar sensível, mostrar/ocultar docs) é tratada no frontend pelas flags:
 *   sensivel: true  → exibido mascarado para orientador/supervisor; admin vê tudo
 *   isDoc:    true  → supervisor não vê; orientador e admin veem com link + checkbox
 *
 * @param {Object} sol  Dados completos da solicitação (de _obterDadosSolicitacaoCompleto_)
 */
function itensCamposSolicitacao_(sol) {
  var itens = [];

  function add(id, label, valor, opts) {
    opts = opts || {};
    if (opts.skipIf) return;
    itens.push({
      id:       id,
      label:    label,
      valor:    String(valor || ''),
      sensivel: !!opts.sensivel,
      isDoc:    !!opts.isDoc,
      secao:    opts.secao  || 'geral',
      checked:  false,
      obs:      '',
      auto:     false,
    });
  }

  var temAgente    = !!(sol.nomeAgente      && String(sol.nomeAgente).trim());
  var temResp      = !!(sol.nomeResp        && String(sol.nomeResp).trim());
  var temNEE       = !!(sol.nee             && String(sol.nee).trim()
                        && String(sol.nee).toLowerCase() !== 'não'
                        && String(sol.nee).toLowerCase() !== 'nao');
  var temBolsa     = !!(sol.valorBolsa      && String(sol.valorBolsa).trim()
                        && String(sol.valorBolsa) !== '0');
  var temTransp    = !!(sol.valorTransporte && String(sol.valorTransporte).trim()
                        && String(sol.valorTransporte) !== '0');

  // ── Dados do Estudante ─────────────────────────────────────────────────────
  add('nome_estudante',  'Nome',                   sol.nomeEstudante,  { secao: 'estudante' });
  add('matricula',       'Matrícula',              sol.matricula,      { secao: 'estudante' });
  add('curso',           'Curso',                  sol.curso,          { secao: 'estudante' });
  add('turno',           'Turno',                  sol.turno,          { secao: 'estudante' });
  add('semestre',        'Semestre / Período',     sol.semestre,       { secao: 'estudante' });
  add('formando',        'Formando no período',    sol.formando,       { secao: 'estudante' });
  add('email_estudante', 'E-mail Institucional',   sol.emailEstudante, { secao: 'estudante' });
  add('telefone',        'Telefone',               sol.telefone,       { secao: 'estudante' });
  add('cpf',             'CPF',                    sol.cpf,            { secao: 'estudante', sensivel: true });
  add('data_nasc',       'Data de Nascimento',     _fmtDataCk_(sol.dataNasc), { secao: 'estudante', sensivel: true });
  if (temNEE) add('nee', 'Necessidades Específicas', sol.nee,          { secao: 'estudante' });

  // ── Dados do Estágio ───────────────────────────────────────────────────────
  add('tipo_estagio',    'Tipo de Estágio',         sol.tipoEstagio,    { secao: 'estagio' });
  add('nome_empresa',    'Empresa',                 sol.nomeEmpresa,    { secao: 'estagio' });
  add('cnpj_empresa',    'CNPJ',                    sol.cnpjEmpresa,    { secao: 'estagio' });
  add('nome_supervisor', 'Supervisor na Empresa',   sol.nomeSupervisor, { secao: 'estagio' });
  add('email_supervisor','E-mail do Supervisor',    sol.emailSupervisor,{ secao: 'estagio' });
  add('data_inicio',     'Data de Início',          _fmtDataCk_(sol.dataInicio),  { secao: 'estagio' });
  add('data_termino',    'Data de Término',         _fmtDataCk_(sol.dataTermino), { secao: 'estagio' });
  add('carga_horaria',   'Carga Horária Semanal',   sol.cargaHoraria ? sol.cargaHoraria + ' h/semana' : '', { secao: 'estagio' });
  add('horario',         'Horário',                 sol.horario,        { secao: 'estagio' });
  add('remuneracao',     'Remuneração',             sol.remuneracao,    { secao: 'estagio' });
  if (temBolsa)  add('valor_bolsa',      'Valor da Bolsa',     sol.valorBolsa,      { secao: 'estagio' });
  if (temTransp) add('valor_transporte', 'Auxílio Transporte', sol.valorTransporte, { secao: 'estagio' });

  // ── Agente de Integração ───────────────────────────────────────────────────
  if (temAgente) add('nome_agente', 'Agente de Integração', sol.nomeAgente, { secao: 'agente' });

  // ── Plano de Atividades ────────────────────────────────────────────────────
  add('plano_atividades', 'Plano de Atividades', sol.planoAtividades, { secao: 'plano' });

  // ── Responsável Legal (menores de 18) ──────────────────────────────────────
  if (temResp) {
    add('nome_resp', 'Nome do Responsável Legal',     sol.nomeResp, { secao: 'responsavel' });
    add('cpf_resp',  'CPF do Responsável Legal',      sol.cpfResp,  { secao: 'responsavel', sensivel: true });
    add('tel_resp',  'Telefone do Responsável Legal', sol.telResp,  { secao: 'responsavel' });
  }

  // ── Documentos (supervisor não vê — filtrado no frontend via isDoc) ─────────
  if (sol.linkDocMat) add('doc_matricula',  'Comprovante de Matrícula', sol.linkDocMat,  { secao: 'documentos', isDoc: true });
  if (sol.linkDocId)  add('doc_identidade', 'Documento de Identidade',  sol.linkDocId,   { secao: 'documentos', isDoc: true });
  if (sol.linkDocBol) add('doc_boletim',    'Boletim',                  sol.linkDocBol,  { secao: 'documentos', isDoc: true });

  return itens;
}

/**
 * Formata um valor de data (Date ou string) como dd/MM/yyyy.
 */
function _fmtDataCk_(v) {
  if (!v) return '';
  try {
    var d = (v instanceof Date) ? v : new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  } catch (e) { return String(v || ''); }
}

// ── Prazos ────────────────────────────────────────────────────────────────────

/** Retorna configuração de prazos em dias úteis (ou defaults). */
function obterPrazos_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(PRAZOS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* usa defaults */ }
  return {
    checklist: {
      orientador: 5,
      supervisor: 5,
      admin:      3,
    },
    assinaturas: {
      estudante:      5,
      empresa:        5,
      supervisor:     5,
      orientador:     5,
      coordenador:    5,
      centralRevisao: 3,
      direcao:        7,
      centralFinal:   3,
    },
  };
}

/** Salva configuração de prazos. */
function salvarPrazos_(prazos) {
  PropertiesService.getScriptProperties().setProperty(PRAZOS_KEY, JSON.stringify(prazos));
  return jsonOk_({ mensagem: 'Prazos salvos com sucesso.' });
}

/**
 * Calcula data de vencimento adicionando N dias úteis a partir de hoje.
 */
function calcularPrazoVencimento_(diasUteis) {
  var d = new Date();
  var adicionados = 0;
  while (adicionados < (diasUteis || 5)) {
    d.setDate(d.getDate() + 1);
    var dow = d.getDay();
    if (dow !== 0 && dow !== 6) adicionados++;
  }
  return normalizarDataISO_(d);
}

// ── CRUD principal ────────────────────────────────────────────────────────────

/**
 * Cria e salva o checklist inicial para uma solicitação.
 * Chamado em api-solicitacao.gs imediatamente após gravar a linha.
 * Começa pelo orientador (1º ator).
 *
 * @param {string} idEstagio
 * @param {Object} sol  { dataNasc, dataInicio, nomeAgente, tokenOrientador }
 */
function iniciarChecklist_(idEstagio, opts) {
  var prazos          = obterPrazos_();
  var tokenOrientador = (opts && opts.tokenOrientador) ? opts.tokenOrientador : Utilities.getUuid();

  var solCompleto = _obterDadosSolicitacaoCompleto_(idEstagio);
  var itensBase   = itensCamposSolicitacao_(solCompleto);

  // Orientador recebe o aceite formal como 1º item
  var itemAceite = {
    id:       'aceite_orientacao',
    label:    'Aceito formalmente a orientação deste estágio',
    valor:    '',
    sensivel: false,
    isDoc:    false,
    secao:    'aceite',
    checked:  false,
    obs:      '',
    auto:     false,
    obrigatorio: true,
  };
  var itensOrientador = [itemAceite].concat(itensBase);

  var checklist = {
    idEstagio:          idEstagio,
    statusGeral:        CK_STATUS.EM_ANDAMENTO,
    etapaAtiva:         'orientador',
    timestampCriacao:   new Date().toISOString(),
    timestampConclusao: null,

    // 1º ator — liberado imediatamente com token magic-link
    orientador: {
      status:            CK_STATUS.PENDENTE,
      data:              null,
      obs:               '',
      prazoVencimento:   calcularPrazoVencimento_(prazos.checklist.orientador),
      lembretesEnviados: 0,
      token:             tokenOrientador,
      itens:             itensOrientador,
    },

    // 2º ator — liberado após orientador aprovar
    supervisor: null,

    // 3º ator — liberado após supervisor aprovar
    admin: null,
  };

  salvarChecklist_(idEstagio, checklist);
  _registrarChecklistNaPlanilha_(idEstagio, checklist);
  try { _notificarOrientadorNovoChecklist_(idEstagio, checklist); } catch (e) { logErro_('iniciarChecklist_.notificarOrientador', e); }
  return checklist;
}

/**
 * Orientador ou Supervisor salva sua resposta.
 * Caso especial: orientador com decisao='recusado' → aciona fluxo de troca.
 *
 * @param {string} idEstagio
 * @param {string} ator       'orientador' | 'supervisor'
 * @param {Array}  itens      Itens com checked/obs atualizados
 * @param {string} decisao    'aprovado' | 'ajuste' | 'recusado' (recusado só para orientador)
 * @param {string} obs        Observação geral
 * @param {string} emailAtor  E-mail do ator (para auditoria; pode ser null para token-auth)
 * @param {string} token      Token magic-link (validação; pode ser null para OAuth)
 */
function salvarRespostaAtor_(idEstagio, ator, itens, decisao, obs, emailAtor, token) {
  var atoresValidos = ['orientador', 'supervisor'];
  if (atoresValidos.indexOf(ator) === -1) return jsonError_('Ator inválido: ' + ator, 'INVALID');

  var checklist = obterChecklist_(idEstagio);
  if (!checklist)           return jsonError_('Checklist não encontrado.', 'NOT_FOUND');
  if (!checklist[ator])     return jsonError_('Checklist do ator ainda não liberado.', 'NOT_READY');
  if (checklist[ator].status !== CK_STATUS.PENDENTE) {
    return jsonError_('Este checklist já foi respondido.', 'ALREADY_DONE');
  }

  // Valida token magic-link se fornecido
  if (token) {
    if (!checklist[ator].token || checklist[ator].token !== token) {
      return jsonError_('Token inválido ou expirado.', 'INVALID_TOKEN');
    }
  }

  var prazos = obterPrazos_();

  // ── Caso especial: orientador recusa orientação ──────────────────────────
  if (ator === 'orientador' && decisao === CK_STATUS.RECUSADO) {
    checklist.orientador.status = CK_STATUS.RECUSADO;
    checklist.orientador.obs    = sanitizar_(obs, 500);
    checklist.orientador.data   = new Date().toISOString();
    checklist.etapaAtiva        = 'orientador_recusado';

    salvarChecklist_(idEstagio, checklist);
    _atualizarStatusChecklistNaPlanilha_(idEstagio, checklist);

    // Atualiza planilha de solicitações
    try {
      var ss    = SpreadsheetApp.openById(CFG_SOL.SS_ID);
      var sheet = ss.getSheetByName(CFG_SOL.ABA_SOL);
      if (sheet) {
        var dados = sheet.getDataRange().getValues();
        for (var ri = 1; ri < dados.length; ri++) {
          if (String(dados[ri][COL_SOL.ID_ESTAGIO] || '') !== idEstagio) continue;
          sheet.getRange(ri + 1, COL_SOL.STATUS    + 1).setValue('Aceite recusado');
          if (obs) sheet.getRange(ri + 1, COL_SOL.OBS_SETOR + 1).setValue('Motivo de recusa: ' + obs);
          break;
        }
      }
    } catch (eSheet) { logErro_('salvarRespostaAtor_.sheetRecusa', eSheet); }

    // Notifica estudante
    var solRec = _obterDadosSolicitacaoCompleto_(idEstagio);
    try {
      MAIL.enviarEmailRespostaAceiteEstudante({
        nomeEstudante:  solRec.nomeEstudante  || '',
        emailEstudante: solRec.emailEstudante || '',
        idEstagio:      idEstagio,
        nomeOrientador: solRec.nomeOrientador || '',
        nomeEmpresa:    solRec.nomeEmpresa    || '',
        resposta:       'recusado',
        obs:            obs || '',
      });
    } catch (eMail) { logErro_('salvarRespostaAtor_.mailEstRecusado', eMail); }

    return jsonOk_({ mensagem: 'Orientação recusada. O estudante será notificado para escolher outro orientador.' });
  }

  // ── Salva resposta normal (aprovado | ajuste) ───────────────────────────
  checklist[ator].itens    = itens;
  checklist[ator].status   = decisao;
  checklist[ator].obs      = sanitizar_(obs, 500);
  checklist[ator].data     = new Date().toISOString();
  if (emailAtor) checklist[ator].emailAtor = emailAtor;

  if (decisao === CK_STATUS.AJUSTE) {
    try { _notificarAdminAjusteChecklist_(idEstagio, ator, obs); } catch (e) { logErro_('_notificarAdminAjusteChecklist_', e); }
  }

  if (decisao === CK_STATUS.APROVADO) {

    if (ator === 'orientador') {
      // Notifica estudante que orientador aceitou
      var solOri = _obterDadosSolicitacaoCompleto_(idEstagio);
      try {
        MAIL.enviarEmailRespostaAceiteEstudante({
          nomeEstudante:  solOri.nomeEstudante  || '',
          emailEstudante: solOri.emailEstudante || '',
          idEstagio:      idEstagio,
          nomeOrientador: solOri.nomeOrientador || '',
          nomeEmpresa:    solOri.nomeEmpresa    || '',
          resposta:       'aceito',
        });
      } catch (e) { logErro_('salvarRespostaAtor_.mailEstAceito', e); }

      // Libera supervisor (2º ator)
      var tokenSupervisor = Utilities.getUuid();
      checklist.supervisor = {
        status:            CK_STATUS.PENDENTE,
        data:              null,
        obs:               '',
        prazoVencimento:   calcularPrazoVencimento_(prazos.checklist.supervisor),
        lembretesEnviados: 0,
        token:             tokenSupervisor,
        itens:             itensCamposSolicitacao_(solOri),
      };
      checklist.etapaAtiva = 'supervisor';
      try { _notificarSupervisorChecklist_(idEstagio, checklist); } catch (e) { logErro_('_notificarSupervisorChecklist_', e); }
    }

    if (ator === 'supervisor') {
      // Libera admin/setor (3º ator)
      var solAdm = _obterDadosSolicitacaoCompleto_(idEstagio);
      checklist.admin = {
        status:            CK_STATUS.PENDENTE,
        data:              null,
        obs:               '',
        prazoVencimento:   calcularPrazoVencimento_(prazos.checklist.admin),
        lembretesEnviados: 0,
        itens:             itensCamposSolicitacao_(solAdm),
      };
      checklist.etapaAtiva = 'admin';
      try { _notificarAdminNovoChecklist_(idEstagio, {}, checklist); } catch (e) { logErro_('_notificarAdminNovoChecklist_', e); }
    }
  }

  salvarChecklist_(idEstagio, checklist);
  _atualizarStatusChecklistNaPlanilha_(idEstagio, checklist);
  return jsonOk_({ checklist: chelistPublico_(checklist) });
}

/**
 * Admin (Setor) salva suas respostas.
 * Se aprovado → verifica se checklist completo → dispara assinaturas.
 */
function salvarRespostaAdmin_(idEstagio, itens, decisao, obs) {
  var checklist = obterChecklist_(idEstagio);
  if (!checklist)        return jsonError_('Checklist não encontrado.', 'NOT_FOUND');
  if (!checklist.admin)  return jsonError_('Checklist do admin ainda não liberado.', 'NOT_READY');

  checklist.admin.itens  = itens;
  checklist.admin.status = decisao;
  checklist.admin.obs    = sanitizar_(obs, 500);
  checklist.admin.data   = new Date().toISOString();

  if (decisao === CK_STATUS.APROVADO) {
    var concluido = _verificarChecklistCompleto_(checklist);
    if (concluido) {
      checklist.statusGeral        = CK_STATUS.APROVADO;
      checklist.timestampConclusao = new Date().toISOString();
      checklist.etapaAtiva         = 'concluido';
      _atualizarStatusChecklistNaPlanilha_(idEstagio, checklist);
      try { iniciarFluxoAssinaturas_(idEstagio); } catch (e) { logErro_('salvarRespostaAdmin_.assinaturas', e); }
    }
  }

  if (decisao === CK_STATUS.AJUSTE) {
    // Admin sinalizou ajuste — registra apenas (setor já está ciente)
    logErro_('salvarRespostaAdmin_.ajuste', new Error('Admin solicitou ajuste no checklist ' + idEstagio + ': ' + obs));
  }

  salvarChecklist_(idEstagio, checklist);
  _atualizarStatusChecklistNaPlanilha_(idEstagio, checklist);
  return jsonOk_({ checklist: chelistPublico_(checklist) });
}

/**
 * Verifica se todos os 3 atores aprovaram.
 */
function _verificarChecklistCompleto_(checklist) {
  var atores = ['orientador', 'supervisor', 'admin'];
  for (var i = 0; i < atores.length; i++) {
    var ck = checklist[atores[i]];
    if (!ck || ck.status !== CK_STATUS.APROVADO) return false;
  }
  return true;
}

/**
 * Retorna versão pública do checklist (sem dados sensíveis desnecessários).
 */
function chelistPublico_(checklist) {
  return checklist;
}

// ── PropertiesService ─────────────────────────────────────────────────────────

function obterChecklist_(idEstagio) {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty('checklist_' + idEstagio);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    logErro_('obterChecklist_', e);
    return null;
  }
}

function salvarChecklist_(idEstagio, checklist) {
  try {
    PropertiesService.getScriptProperties()
      .setProperty('checklist_' + idEstagio, JSON.stringify(checklist));
  } catch (e) {
    logErro_('salvarChecklist_', e);
    throw e;
  }
}

// ── Planilha: aba "Checklists" ────────────────────────────────────────────────

/**
 * Layout das colunas (1-based):
 *  1  idEstagio
 *  2  statusGeral
 *  3  etapaAtiva
 *  4-6  orientador  (status, data, obs)
 *  7-9  supervisor  (status, data, obs)
 * 10-12 admin       (status, data, obs)
 * 13    prazo orientador
 * 14    prazo supervisor
 * 15    prazo admin
 * 16    timestampCriacao
 * 17    timestampConclusao
 */
function _registrarChecklistNaPlanilha_(idEstagio, checklist) {
  try {
    var sheet = SpreadsheetApp.openById(SS_ID).getSheetByName(CHECKLIST_SHEET);
    if (!sheet) return;
    var ori = checklist.orientador || {};
    sheet.appendRow([
      idEstagio,
      checklist.statusGeral,
      checklist.etapaAtiva,
      ori.status || '',  '', '',          // orientador: status, data, obs
      '', '', '',                          // supervisor (null)
      '', '', '',                          // admin (null)
      ori.prazoVencimento || '', '', '',   // prazos
      checklist.timestampCriacao || '', '', // timestamps
    ]);
  } catch (e) {
    logErro_('_registrarChecklistNaPlanilha_', e);
  }
}

function _atualizarStatusChecklistNaPlanilha_(idEstagio, checklist) {
  try {
    var sheet = SpreadsheetApp.openById(SS_ID).getSheetByName(CHECKLIST_SHEET);
    if (!sheet) return;
    var dados = sheet.getDataRange().getValues();
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][0]) !== String(idEstagio)) continue;
      var row = i + 1;
      sheet.getRange(row, 2).setValue(checklist.statusGeral);
      sheet.getRange(row, 3).setValue(checklist.etapaAtiva);
      // Orientador
      if (checklist.orientador) {
        sheet.getRange(row, 4).setValue(checklist.orientador.status || '');
        sheet.getRange(row, 5).setValue(checklist.orientador.data   || '');
        sheet.getRange(row, 6).setValue(checklist.orientador.obs    || '');
        sheet.getRange(row, 13).setValue(checklist.orientador.prazoVencimento || '');
      }
      // Supervisor
      if (checklist.supervisor) {
        sheet.getRange(row, 7).setValue(checklist.supervisor.status || '');
        sheet.getRange(row, 8).setValue(checklist.supervisor.data   || '');
        sheet.getRange(row, 9).setValue(checklist.supervisor.obs    || '');
        sheet.getRange(row, 14).setValue(checklist.supervisor.prazoVencimento || '');
      }
      // Admin
      if (checklist.admin) {
        sheet.getRange(row, 10).setValue(checklist.admin.status || '');
        sheet.getRange(row, 11).setValue(checklist.admin.data   || '');
        sheet.getRange(row, 12).setValue(checklist.admin.obs    || '');
        sheet.getRange(row, 15).setValue(checklist.admin.prazoVencimento || '');
      }
      if (checklist.timestampConclusao) {
        sheet.getRange(row, 17).setValue(checklist.timestampConclusao);
      }
      return;
    }
  } catch (e) {
    logErro_('_atualizarStatusChecklistNaPlanilha_', e);
  }
}

// ── Utilitários ───────────────────────────────────────────────────────────────

function calcularIdade_(dataNasc, dataRef) {
  var nascISO = normalizarDataISO_(dataNasc);
  var refISO  = normalizarDataISO_(dataRef);
  if (!nascISO || !refISO) return null;
  var nasc = new Date(nascISO);
  var ref  = new Date(refISO);
  if (isNaN(nasc.getTime()) || isNaN(ref.getTime())) return null;
  var anos = ref.getFullYear() - nasc.getFullYear();
  var m    = ref.getMonth() - nasc.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < nasc.getDate())) anos--;
  return anos;
}

// ── Labels ────────────────────────────────────────────────────────────────────

var LABELS_ATORES_CK_ = {
  orientador: 'Orientador(a) de Estágio',
  supervisor: 'Supervisor(a) na Empresa',
  admin:      'Setor de Estágios',
};

// ── Notificações de e-mail ────────────────────────────────────────────────────

var BASE_URL_SGE_ = 'https://ifrs-riogrande.github.io/estagios';

/** Notifica o orientador que há um novo checklist aguardando sua resposta. */
function _notificarOrientadorNovoChecklist_(idEstagio, checklist) {
  var sol = _obterDadosSolicitacaoCompleto_(idEstagio);
  if (!sol.emailOrientador) return;
  var token       = checklist.orientador.token;
  var urlChecklist = BASE_URL_SGE_ + '/orientadores/aceite-orientacao.html'
                   + '?token=' + encodeURIComponent(token)
                   + '&id='    + encodeURIComponent(idEstagio);
  MAIL.enviarEmailChecklistOrientador({
    idEstagio:       idEstagio,
    nomeEstudante:   sol.nomeEstudante   || '',
    curso:           sol.curso           || '',
    turno:           sol.turno           || '',
    semestre:        sol.semestre        || '',
    nomeEmpresa:     sol.nomeEmpresa     || '',
    tipoEstagio:     sol.tipoEstagio     || '',
    dataInicio:      formatarData_(String(sol.dataInicio   || '')),
    dataTermino:     formatarData_(String(sol.dataTermino  || '')),
    cargaHoraria:    sol.cargaHoraria    || '',
    horario:         sol.horario         || '',
    planoAtividades: sol.planoAtividades || '',
    nomeOrientador:  sol.nomeOrientador  || '',
    emailOrientador: sol.emailOrientador || '',
    urlChecklist:    urlChecklist,
    prazoVencimento: checklist.orientador.prazoVencimento || '',
  });
}

/**
 * Busca o E-mail Setor do supervisor na aba "Supervisores" pelo nome.
 * Retorna a primeira correspondência (status != 'Excluído' nem 'Processada').
 * Fallback: emailSupervisor da solicitação (email pessoal) se não encontrar.
 *
 * @param {string} nomeSupervisor  Nome completo conforme cadastro
 * @param {string} fallbackEmail   E-mail alternativo caso não encontre na tabela
 * @return {string}
 */
function _obterEmailSetorSupervisor_(nomeSupervisor, fallbackEmail) {
  try {
    var ss    = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName('Supervisores');
    if (!sheet) return fallbackEmail || '';
    var dados = sheet.getDataRange().getValues();
    var nomeNorm = String(nomeSupervisor || '').trim().toLowerCase();
    for (var i = 1; i < dados.length; i++) {
      var status = String(dados[i][COL_SUP.STATUS] || '').trim();
      if (status === 'Excluído' || status.indexOf('Processada') > -1) continue;
      var nomeRow = String(dados[i][COL_SUP.NOME] || '').trim().toLowerCase();
      if (nomeRow !== nomeNorm) continue;
      var emailSetor = String(dados[i][COL_SUP.EMAIL_SETOR_SUP] || '').trim();
      if (emailSetor) return emailSetor;
    }
  } catch (e) {
    logErro_('_obterEmailSetorSupervisor_', e);
  }
  return fallbackEmail || '';
}

/** Notifica o supervisor que é sua vez no checklist. */
function _notificarSupervisorChecklist_(idEstagio, checklist) {
  var sol = _obterDadosSolicitacaoCompleto_(idEstagio);
  // Usa o E-mail Setor do supervisor (cadastro na planilha Supervisores)
  // como destino principal; cai no e-mail pessoal da solicitação se não achar.
  var emailDestino = _obterEmailSetorSupervisor_(sol.nomeSupervisor, sol.emailSupervisor);
  if (!emailDestino) return;
  var token        = checklist.supervisor.token;
  var urlChecklist = BASE_URL_SGE_ + '/checklist/?id=' + encodeURIComponent(idEstagio)
                   + '&token=' + encodeURIComponent(token);
  MAIL.enviarEmailChecklistAtor({
    idEstagio:       idEstagio,
    nomeEstudante:   sol.nomeEstudante   || '',
    curso:           sol.curso           || '',
    nomeEmpresa:     sol.nomeEmpresa     || '',
    nomeSupervisor:  sol.nomeSupervisor  || '',
    labelAtor:       LABELS_ATORES_CK_.supervisor,
    prazoVencimento: checklist.supervisor.prazoVencimento || '',
    email:           emailDestino,
    urlChecklist:    urlChecklist,
  });
}

/** Notifica o Admin (setor) que o supervisor concluiu e é a vez do setor revisar. */
function _notificarAdminNovoChecklist_(idEstagio, _sol, checklist) {
  var dados = _obterDadosSolicitacaoCompleto_(idEstagio);
  MAIL.enviarEmailChecklistNovoAdmin({
    idEstagio:      idEstagio,
    nomeEstudante:  dados.nomeEstudante  || '',
    emailEstudante: dados.emailEstudante || '',
    curso:          dados.curso          || '',
    nomeEmpresa:    dados.nomeEmpresa    || '',
    prazoAdmin:     checklist && checklist.admin ? checklist.admin.prazoVencimento : '',
  });
}

/** Notifica o Admin que um ator sinalizou necessidade de ajuste. */
function _notificarAdminAjusteChecklist_(idEstagio, ator, obs) {
  var sol = _obterDadosSolicitacaoCompleto_(idEstagio);
  MAIL.enviarEmailChecklistAjuste({
    idEstagio:     idEstagio,
    nomeEstudante: sol.nomeEstudante || '',
    labelAtor:     LABELS_ATORES_CK_[ator] || ator,
    obs:           obs || '',
  });
}

// ── Trigger diário: verificar prazos D-2 ─────────────────────────────────────

function verificarPrazos() {
  _verificarPrazosChecklist_();
  _verificarPrazosAssinaturas_();
}

function _diasUteisAte_(dataISO) {
  if (!dataISO) return 999;
  try {
    var hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    var alvo = new Date(dataISO);
    alvo.setHours(0, 0, 0, 0);
    var d = new Date(hoje);
    d.setDate(d.getDate() + 1);
    var dias = 0;
    while (d <= alvo) {
      var dow = d.getDay();
      if (dow !== 0 && dow !== 6) dias++;
      d.setDate(d.getDate() + 1);
    }
    return dias;
  } catch (e) { return 999; }
}

function _verificarPrazosChecklist_() {
  try {
    var sheet = SpreadsheetApp.openById(SS_ID).getSheetByName(CHECKLIST_SHEET);
    if (!sheet) return;
    var dados = sheet.getDataRange().getValues();
    for (var i = 1; i < dados.length; i++) {
      var id     = String(dados[i][0]);
      var status = String(dados[i][1]);
      if (!id || status === CK_STATUS.APROVADO) continue;

      var checklist = obterChecklist_(id);
      if (!checklist) continue;

      var sol = _obterDadosSolicitacaoCompleto_(id);
      var emailsAtores = {
        orientador: sol.emailOrientador  || '',
        // Usa E-mail Setor do supervisor (mesma lógica do envio inicial)
        supervisor: _obterEmailSetorSupervisor_(sol.nomeSupervisor, sol.emailSupervisor),
        admin:      'estagios@riogrande.ifrs.edu.br',
      };

      var modificado = false;
      ['orientador', 'supervisor', 'admin'].forEach(function (ator) {
        var ck = checklist[ator];
        if (!ck || ck.status !== CK_STATUS.PENDENTE || !ck.prazoVencimento) return;
        if (_diasUteisAte_(ck.prazoVencimento) !== 2) return;
        if ((ck.lembretesEnviados || 0) >= 1) return;
        var email = emailsAtores[ator];
        if (!email) return;
        // Monta URL com token (magic-link) para supervisor; URL sem token para admin
        var urlLembrete;
        if (ator === 'supervisor' && ck.token) {
          urlLembrete = BASE_URL_SGE_ + '/checklist/?id=' + encodeURIComponent(id)
                      + '&token=' + encodeURIComponent(ck.token);
        }
        MAIL.enviarEmailLembreteChecklist({
          idEstagio:       id,
          nomeEstudante:   sol.nomeEstudante || '',
          labelAtor:       LABELS_ATORES_CK_[ator],
          prazoVencimento: ck.prazoVencimento,
          email:           email,
          urlChecklist:    urlLembrete || '',
        });
        ck.lembretesEnviados = (ck.lembretesEnviados || 0) + 1;
        modificado = true;
      });

      if (modificado) salvarChecklist_(id, checklist);
    }
  } catch (e) {
    logErro_('_verificarPrazosChecklist_', e);
  }
}

function _verificarPrazosAssinaturas_() {
  try {
    var sheet = SpreadsheetApp.openById(SS_ID).getSheetByName(ASSINATURAS_SHEET);
    if (!sheet) return;
    var dados = sheet.getDataRange().getValues();
    for (var i = 1; i < dados.length; i++) {
      var id     = String(dados[i][0]);
      var status = String(dados[i][1]);
      if (!id || status === 'concluido') continue;

      var fluxo = obterFluxoAssinaturas_(id);
      if (!fluxo) continue;

      var sol = _obterDadosSolicitacaoCompleto_(id);
      var modificado = false;

      fluxo.etapas.forEach(function (et) {
        if (et.status !== ASS_STATUS.AGUARDANDO || !et.prazoVencimento) return;
        if (_diasUteisAte_(et.prazoVencimento) !== 2) return;
        if ((et.lembretesEnviados || 0) >= 1) return;
        if (!et.email) return;
        MAIL.enviarEmailLembreteAssinatura({
          idEstagio:       id,
          nomeEstudante:   sol.nomeEstudante || '',
          labelAtor:       et.label,
          prazoVencimento: et.prazoVencimento,
          email:           et.email,
          numeroEtapa:     et.numero,
          tipo:            et.tipo,
        });
        et.lembretesEnviados = (et.lembretesEnviados || 0) + 1;
        modificado = true;
      });

      if (modificado) salvarFluxoAssinaturas_(id, fluxo);
    }
  } catch (e) {
    logErro_('_verificarPrazosAssinaturas_', e);
  }
}

// ── Histórico público do processo ─────────────────────────────────────────────

function _buildHistoricoPublico_(ck) {
  function _atorInfo(a) {
    if (!a) return { status: '', data: '' };
    return { status: String(a.status || ''), data: String(a.data || '') };
  }
  return {
    criacao:     String(ck.timestampCriacao  || ''),
    conclusao:   String(ck.timestampConclusao || ''),
    etapaAtiva:  String(ck.etapaAtiva  || ''),
    statusGeral: String(ck.statusGeral || ''),
    orientador:  _atorInfo(ck.orientador),
    supervisor:  _atorInfo(ck.supervisor),
    admin:       _atorInfo(ck.admin),
  };
}

// ── Handlers GET / POST ───────────────────────────────────────────────────────

function doGetChecklist(e) {
  var action = (e.parameter && e.parameter.action) || '';
  var id     = (e.parameter && e.parameter.id)     || '';

  switch (action) {
    case 'obterChecklist':
      if (!id) return jsonError_('Parâmetro id obrigatório.', 'MISSING_PARAM');
      var ck = obterChecklist_(id);
      if (!ck) return jsonError_('Checklist não encontrado.', 'NOT_FOUND');

      var solDados = {};
      try { solDados = _obterDadosSolicitacaoCompleto_(id); } catch (_e) {}

      var infoSol = {
        idEstagio:       id,
        nomeEstudante:   String(solDados.nomeEstudante   || ''),
        emailEstudante:  String(solDados.emailEstudante  || ''),
        matricula:       String(solDados.matricula       || ''),
        curso:           String(solDados.curso           || ''),
        nomeEmpresa:     String(solDados.nomeEmpresa     || ''),
        cnpjEmpresa:     String(solDados.cnpjEmpresa     || ''),
        nomeSupervisor:  String(solDados.nomeSupervisor  || ''),
        nomeOrientador:  String(solDados.nomeOrientador  || ''),
        tipoEstagio:     String(solDados.tipoEstagio     || ''),
        dataInicio:      String(solDados.dataInicio      || ''),
        dataTermino:     String(solDados.dataTermino     || ''),
        cargaHoraria:    String(solDados.cargaHoraria    || ''),
        horario:         String(solDados.horario         || ''),
        remuneracao:     String(solDados.remuneracao     || ''),
        valorBolsa:      String(solDados.valorBolsa      || ''),
        planoAtividades: String(solDados.planoAtividades || ''),
        nomeAgente:      String(solDados.nomeAgente      || ''),
        linkDocMat:      String(solDados.linkDocMat      || ''),
        linkDocId:       String(solDados.linkDocId       || ''),
        linkDocBol:      String(solDados.linkDocBol      || ''),
        driveUrl:        String(solDados.driveUrl        || ''),
      };

      // ── Acesso por token (supervisor ou orientador via magic-link) ───────
      var token = (e.parameter && e.parameter.token) || '';
      if (token) {
        var atoresToken = ['supervisor', 'orientador'];
        var atorToken = null;
        for (var t = 0; t < atoresToken.length; t++) {
          var secToken = ck[atoresToken[t]];
          if (secToken && secToken.token && secToken.token === token) {
            atorToken = atoresToken[t];
            break;
          }
        }
        if (!atorToken) return jsonError_('Token inválido ou link expirado.', 'INVALID_TOKEN');
        var respToken = { _meuAtor: atorToken, _infoSolicitacao: infoSol, _historico: _buildHistoricoPublico_(ck) };
        respToken[atorToken] = ck[atorToken];
        return jsonOk_(respToken);
      }

      // ── Acesso por Google OAuth (admin / orientador logado) ──────────────
      ck._emailAtores = {
        orientador: String(solDados.emailOrientador || ''),
        supervisor: String(solDados.emailSupervisor || ''),
      };
      ck._infoSolicitacao = infoSol;
      ck._historico = _buildHistoricoPublico_(ck);
      return jsonOk_(ck);

    case 'obterPrazos':
      return jsonOk_(obterPrazos_());

    default:
      return jsonError_('Ação GET desconhecida: ' + action, 'UNKNOWN_ACTION');
  }
}

function doPostChecklist(e) {
  var body   = e._body || {};
  var action = body.action || '';

  switch (action) {
    case 'salvarRespostaAdmin':
      return salvarRespostaAdmin_(
        body.idEstagio, body.itens, body.decisao, body.obs
      );

    case 'salvarRespostaAtor':
      return salvarRespostaAtor_(
        body.idEstagio, body.ator, body.itens, body.decisao, body.obs,
        body.emailAtor || null, body.token || null
      );

    case 'salvarPrazos':
      return salvarPrazos_(body.prazos);

    default:
      return jsonError_('Ação POST desconhecida: ' + action, 'UNKNOWN_ACTION');
  }
}
