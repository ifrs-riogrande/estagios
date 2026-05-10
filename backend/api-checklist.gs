/**
 * api-checklist.gs — Fluxo de Checklist de Solicitações de Estágio
 * SGE — Sistema de Gestão de Estágios · IFRS Campus Rio Grande
 *
 * Fluxo:
 *   1. Solicitação recebida → checklist do Admin é criado automaticamente
 *   2. Admin verifica seus itens → se aprovado, libera os outros 4 em paralelo
 *   3. Orientador, Coordenador, Empresa e Supervisor respondem em paralelo
 *   4. Todos aprovados → fluxo de assinaturas inicia automaticamente
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
};

// ── Templates de itens por ator ──────────────────────────────────────────────

/**
 * Itens do Admin — dois deles são calculados automaticamente pelo sistema.
 * @param {Object} sol  Campos da solicitação: { dataNasc, dataInicio, nomeAgente }
 */
function itensChecklistAdmin_(sol) {
  var temAgente     = !!(sol.nomeAgente && String(sol.nomeAgente).trim());
  var idade         = calcularIdade_(sol.dataNasc, sol.dataInicio);
  var atingiu16     = idade !== null && idade >= 16;
  var menorDe18     = idade !== null && idade < 18;

  return [
    {
      id:      'comprovante_matricula',
      label:   'Comprovante de Matrícula enviado e atualizado',
      auto:    false,
      checked: false,
      obs:     '',
    },
    {
      id:      'matricula_ativa',
      label:   'Matrícula ativa e estudante frequente',
      auto:    false,
      checked: false,
      obs:     '',
    },
    {
      id:      'frequencia_minima',
      label:   'Frequência mínima atendida (≥75% global para EMI ou ≥75% em ao menos 1 componente curricular para cursos semestrais)',
      auto:    false,
      checked: false,
      obs:     '',
    },
    {
      id:          'acordo_cooperacao',
      label:       'Acordo de cooperação firmado com o agente de integração',
      auto:        false,
      condicional: true,
      ativo:       temAgente,
      // Se não há agente de integração, o item não se aplica e já vem marcado
      checked:     !temAgente,
      obs:         temAgente ? '' : 'Não se aplica — sem agente de integração',
    },
    {
      id:      'idade_minima_16',
      label:   'Idade mínima de 16 anos completos na data de início do estágio',
      auto:    true,
      checked: atingiu16,
      valor:   idade !== null ? idade + ' anos na data de início' : 'Data de nascimento não informada',
      obs:     '',
    },
    {
      id:      'menor_18_flag',
      label:   'Menor de 18 anos — exige autorização do responsável legal',
      auto:    true,
      flag:    true,      // informativo: não bloqueia se false, aciona sub-fluxo se true
      ativo:   menorDe18,
      checked: !menorDe18, // true = sem pendência (≥18); false = pendência (exige doc)
      valor:   menorDe18
               ? 'Sim — solicitar Autorização do Responsável Legal ao estudante'
               : 'Não se aplica',
      obs:     '',
    },
  ];
}

function itensChecklistOrientador_() {
  return [
    { id: 'dados_orientador',    label: 'Confirmar meus dados como orientador nesta solicitação', auto: false, checked: false, obs: '' },
    { id: 'coerencia_ppc',       label: 'Atividades de estágio coerentes com o PPC do curso',    auto: false, checked: false, obs: '' },
    { id: 'qualidade_pedagogica',label: 'Qualidade pedagógica das atividades propostas',          auto: false, checked: false, obs: '' },
    { id: 'compatibilidade',     label: 'Compatibilidade das atividades com a formação do estudante', auto: false, checked: false, obs: '' },
    { id: 'formacao_area',       label: 'Tenho formação ou experiência na área do estágio',      auto: false, checked: false, obs: '' },
    { id: 'disponibilidade_ch',  label: 'Tenho disponibilidade de carga horária para esta orientação', auto: false, checked: false, obs: '' },
  ];
}

function itensChecklistCoordenador_() {
  return [
    { id: 'conformidade_curso',  label: 'Estágio em conformidade com os requisitos do curso',        auto: false, checked: false, obs: '' },
    { id: 'etapa_adequada',      label: 'Estudante na etapa adequada do curso para realização do estágio', auto: false, checked: false, obs: '' },
    { id: 'carga_horaria_ok',    label: 'Carga horária semanal dentro dos limites permitidos pelo curso', auto: false, checked: false, obs: '' },
  ];
}

function itensChecklistEmpresa_() {
  return [
    { id: 'dados_empresa',      label: 'Dados da empresa corretos e atualizados',               auto: false, checked: false, obs: '' },
    { id: 'supervisor_ok',      label: 'Supervisor informado corretamente',                     auto: false, checked: false, obs: '' },
    { id: 'jornada_ch',         label: 'Jornada e carga horária conforme a solicitação',        auto: false, checked: false, obs: '' },
    { id: 'bolsa_beneficios',   label: 'Bolsa e benefícios corretos (se aplicável)',            auto: false, checked: false, obs: '' },
    { id: 'seguro_acidentes',   label: 'Seguro contra acidentes pessoais confirmado',           auto: false, checked: false, obs: '', bloqueante: true },
    { id: 'ambiente_adequado',  label: 'Ambiente de trabalho adequado para receber estagiário', auto: false, checked: false, obs: '' },
  ];
}

function itensChecklistSupervisor_() {
  return [
    { id: 'identificacao_ok',   label: 'Estou corretamente identificado como supervisor nesta solicitação', auto: false, checked: false, obs: '' },
    { id: 'plano_atividades',   label: 'Plano de atividades adequado ao perfil do estagiário',             auto: false, checked: false, obs: '' },
    { id: 'atividades_viaveis', label: 'Atividades viáveis no ambiente de trabalho da empresa',            auto: false, checked: false, obs: '' },
    { id: 'aceite_supervisao',  label: 'Aceito formalmente a responsabilidade de supervisão',              auto: false, checked: false, obs: '' },
  ];
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
      admin:       3,
      orientador:  5,
      coordenador: 5,
      empresa:     5,
      supervisor:  5,
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
 * Simplificado: ignora feriados, conta apenas fins de semana.
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
 * Chamado em api-solicitacao.gs após gravar a solicitação na planilha.
 * Neste momento apenas o Admin tem itens — os demais são null.
 *
 * @param {string} idEstagio
 * @param {Object} sol  { dataNasc, dataInicio, nomeAgente, ... }
 */
function iniciarChecklist_(idEstagio, sol) {
  var prazos = obterPrazos_();

  var checklist = {
    idEstagio:          idEstagio,
    statusGeral:        CK_STATUS.EM_ANDAMENTO,
    etapaAtiva:         'admin',
    timestampCriacao:   new Date().toISOString(),
    timestampConclusao: null,

    admin: {
      status:          CK_STATUS.PENDENTE,
      data:            null,
      obs:             '',
      prazoVencimento: calcularPrazoVencimento_(prazos.checklist.admin),
      lembretesEnviados: 0,
      itens:           itensChecklistAdmin_(sol),
    },

    // Liberados apenas após Admin aprovar
    orientador:  null,
    coordenador: null,
    empresa:     null,
    supervisor:  null,
  };

  salvarChecklist_(idEstagio, checklist);
  _registrarChecklistNaPlanilha_(idEstagio, checklist);
  // Notifica o Admin que há um novo checklist para revisar
  try { _notificarAdminNovoChecklist_(idEstagio, sol, checklist); } catch (e) { logErro_('iniciarChecklist_.notificarAdmin', e); }
  return checklist;
}

/**
 * Admin salva suas respostas e aprova ou solicita ajuste.
 * Se aprovado → libera os demais 4 atores em paralelo.
 *
 * @param {string} idEstagio
 * @param {Array}  itens       Itens com checked/obs atualizados
 * @param {string} decisao     'aprovado' | 'ajuste'
 * @param {string} obs         Observação geral do Admin
 * @param {Object} sol         Dados da solicitação (para email + liberar demais)
 */
function salvarRespostaAdmin_(idEstagio, itens, decisao, obs, sol) {
  var checklist = obterChecklist_(idEstagio);
  if (!checklist) return jsonError_('Checklist não encontrado.', 'NOT_FOUND');

  checklist.admin.itens  = itens;
  checklist.admin.status = decisao;
  checklist.admin.obs    = sanitizar_(obs, 500);
  checklist.admin.data   = new Date().toISOString();

  if (decisao === CK_STATUS.APROVADO) {
    // Libera os demais 4 atores em paralelo
    var prazos = obterPrazos_();
    checklist.orientador = {
      status: CK_STATUS.PENDENTE, data: null, obs: '',
      prazoVencimento: calcularPrazoVencimento_(prazos.checklist.orientador),
      lembretesEnviados: 0,
      itens: itensChecklistOrientador_(),
    };
    checklist.coordenador = {
      status: CK_STATUS.PENDENTE, data: null, obs: '',
      prazoVencimento: calcularPrazoVencimento_(prazos.checklist.coordenador),
      lembretesEnviados: 0,
      itens: itensChecklistCoordenador_(),
    };
    checklist.empresa = {
      status: CK_STATUS.PENDENTE, data: null, obs: '',
      prazoVencimento: calcularPrazoVencimento_(prazos.checklist.empresa),
      lembretesEnviados: 0,
      token: Utilities.getUuid(),   // magic-link para acesso sem Google
      itens: itensChecklistEmpresa_(),
    };
    checklist.supervisor = {
      status: CK_STATUS.PENDENTE, data: null, obs: '',
      prazoVencimento: calcularPrazoVencimento_(prazos.checklist.supervisor),
      lembretesEnviados: 0,
      token: Utilities.getUuid(),   // magic-link para acesso sem Google
      itens: itensChecklistSupervisor_(),
    };
    checklist.etapaAtiva = 'paralelo';

    // Notifica os 4 atores em paralelo
    try { enviarNotificacoesChecklistParalelo_(idEstagio, checklist); } catch (e) { logErro_('enviarNotificacoesChecklistParalelo_', e); }
  }

  salvarChecklist_(idEstagio, checklist);
  _atualizarStatusChecklistNaPlanilha_(idEstagio, checklist);
  return jsonOk_({ checklist: chelistPublico_(checklist) });
}

/**
 * Ator (orientador | coordenador | empresa | supervisor) salva sua resposta.
 *
 * @param {string} idEstagio
 * @param {string} ator       'orientador' | 'coordenador' | 'empresa' | 'supervisor'
 * @param {Array}  itens      Itens com checked/obs atualizados
 * @param {string} decisao    'aprovado' | 'ajuste'
 * @param {string} obs        Observação geral
 * @param {string} emailAtor  E-mail do ator (para auditoria)
 */
function salvarRespostaAtor_(idEstagio, ator, itens, decisao, obs, emailAtor) {
  var atoresValidos = ['orientador', 'coordenador', 'empresa', 'supervisor'];
  if (atoresValidos.indexOf(ator) === -1) return jsonError_('Ator inválido: ' + ator, 'INVALID');

  var checklist = obterChecklist_(idEstagio);
  if (!checklist)           return jsonError_('Checklist não encontrado.', 'NOT_FOUND');
  if (!checklist[ator])     return jsonError_('Checklist do ator ainda não liberado.', 'NOT_READY');

  checklist[ator].itens    = itens;
  checklist[ator].status   = decisao;
  checklist[ator].obs      = sanitizar_(obs, 500);
  checklist[ator].data     = new Date().toISOString();
  checklist[ator].emailAtor = emailAtor;

  if (decisao === CK_STATUS.AJUSTE) {
    // Notifica o Admin que este ator sinalizou necessidade de ajuste
    try { _notificarAdminAjusteChecklist_(idEstagio, ator, obs); } catch (e) { logErro_('_notificarAdminAjusteChecklist_', e); }
  }

  // Verifica se todos os 5 atores aprovaram
  var concluido = _verificarChecklistCompleto_(checklist);
  if (concluido) {
    checklist.statusGeral        = CK_STATUS.APROVADO;
    checklist.timestampConclusao = new Date().toISOString();
    checklist.etapaAtiva         = 'concluido';
    _atualizarStatusChecklistNaPlanilha_(idEstagio, checklist);
    // Dispara o fluxo de assinaturas
    try { iniciarFluxoAssinaturas_(idEstagio); } catch (e) { logErro_('iniciarFluxoAssinaturas_', e); }
  }

  salvarChecklist_(idEstagio, checklist);
  _atualizarStatusChecklistNaPlanilha_(idEstagio, checklist);
  return jsonOk_({ checklist: chelistPublico_(checklist), concluido: concluido });
}

/**
 * Verifica se todos os 5 atores aprovaram.
 */
function _verificarChecklistCompleto_(checklist) {
  var atores = ['admin', 'orientador', 'coordenador', 'empresa', 'supervisor'];
  for (var i = 0; i < atores.length; i++) {
    var ck = checklist[atores[i]];
    if (!ck || ck.status !== CK_STATUS.APROVADO) return false;
  }
  return true;
}

/**
 * Retorna versão do checklist segura para envio ao frontend
 * (sem dados internos desnecessários).
 */
function chelistPublico_(checklist) {
  return checklist; // por ora retorna completo; filtrar se necessário
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
 * Insere nova linha na aba Checklists ao criar o checklist.
 */
function _registrarChecklistNaPlanilha_(idEstagio, checklist) {
  try {
    var sheet = SpreadsheetApp.openById(SS_ID).getSheetByName(CHECKLIST_SHEET);
    if (!sheet) return;
    sheet.appendRow([
      idEstagio,
      checklist.statusGeral,
      checklist.etapaAtiva,
      checklist.admin.status, '', '',        // Admin status, data, obs
      '', '', '',                            // Orientador
      '', '', '',                            // Coordenador
      '', '', '',                            // Empresa
      '', '', '',                            // Supervisor
      checklist.admin.prazoVencimento, '', '', '', '', // Prazos
      checklist.timestampCriacao, '',        // ts criação, conclusão
    ]);
  } catch (e) {
    logErro_('_registrarChecklistNaPlanilha_', e);
  }
}

/**
 * Atualiza o resumo na aba Checklists.
 */
function _atualizarStatusChecklistNaPlanilha_(idEstagio, checklist) {
  try {
    var sheet = SpreadsheetApp.openById(SS_ID).getSheetByName(CHECKLIST_SHEET);
    if (!sheet) return;
    var dados  = sheet.getDataRange().getValues();
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][0]) === String(idEstagio)) {
        var row = i + 1;
        sheet.getRange(row, 2).setValue(checklist.statusGeral);
        sheet.getRange(row, 3).setValue(checklist.etapaAtiva);
        // Admin
        sheet.getRange(row, 4).setValue(checklist.admin ? checklist.admin.status : '');
        sheet.getRange(row, 5).setValue(checklist.admin && checklist.admin.data ? checklist.admin.data : '');
        sheet.getRange(row, 6).setValue(checklist.admin ? checklist.admin.obs : '');
        // Orientador
        if (checklist.orientador) {
          sheet.getRange(row, 7).setValue(checklist.orientador.status);
          sheet.getRange(row, 8).setValue(checklist.orientador.data || '');
          sheet.getRange(row, 9).setValue(checklist.orientador.obs || '');
        }
        // Coordenador
        if (checklist.coordenador) {
          sheet.getRange(row, 10).setValue(checklist.coordenador.status);
          sheet.getRange(row, 11).setValue(checklist.coordenador.data || '');
          sheet.getRange(row, 12).setValue(checklist.coordenador.obs || '');
        }
        // Empresa
        if (checklist.empresa) {
          sheet.getRange(row, 13).setValue(checklist.empresa.status);
          sheet.getRange(row, 14).setValue(checklist.empresa.data || '');
          sheet.getRange(row, 15).setValue(checklist.empresa.obs || '');
        }
        // Supervisor
        if (checklist.supervisor) {
          sheet.getRange(row, 16).setValue(checklist.supervisor.status);
          sheet.getRange(row, 17).setValue(checklist.supervisor.data || '');
          sheet.getRange(row, 18).setValue(checklist.supervisor.obs || '');
        }
        // Conclusão
        if (checklist.timestampConclusao) {
          sheet.getRange(row, 24).setValue(checklist.timestampConclusao);
        }
        return;
      }
    }
  } catch (e) {
    logErro_('_atualizarStatusChecklistNaPlanilha_', e);
  }
}

// ── Utilitários ───────────────────────────────────────────────────────────────

/**
 * Calcula a idade em anos completos na data de referência.
 * @param {string} dataNasc  ISO AAAA-MM-DD ou DD/MM/AAAA
 * @param {string} dataRef   ISO AAAA-MM-DD ou DD/MM/AAAA
 * @returns {number|null}
 */
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

// ── Notificações de E-mail ────────────────────────────────────────────────────

var LABELS_ATORES_CK_ = {
  admin:       'Setor de Estágios (Admin)',
  orientador:  'Orientador de Estágio',
  coordenador: 'Coordenador de Curso',
  empresa:     'Empresa Concedente',
  supervisor:  'Supervisor',
};

/** Notifica o Admin (setor) que há um novo checklist aguardando revisão. */
function _notificarAdminNovoChecklist_(idEstagio, sol, checklist) {
  // sol aqui pode ter apenas { dataNasc, dataInicio, nomeAgente }
  // Enriquece com dados da planilha se necessário
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

/** Notifica os 4 atores em paralelo (após Admin aprovar checklist). */
function enviarNotificacoesChecklistParalelo_(idEstagio, checklist) {
  var sol = _obterDadosSolicitacaoCompleto_(idEstagio);
  var BASE_URL = 'https://ifrs-riogrande.github.io/estagios/checklist/?id=';
  var atores = [
    { ator: 'orientador',  email: sol.emailOrientador  || '' },
    { ator: 'coordenador', email: sol.emailCoordenador || '' },
    { ator: 'empresa',     email: sol.emailEmpresa     || '' },
    { ator: 'supervisor',  email: sol.emailSupervisor  || '' },
  ];
  atores.forEach(function (a) {
    if (!a.email) return;
    var ck = checklist[a.ator];
    // Empresa e supervisor recebem link com token (não precisam de conta Google)
    var urlChecklist = BASE_URL + idEstagio;
    if (ck && ck.token) urlChecklist += '&token=' + ck.token;
    MAIL.enviarEmailChecklistAtor({
      idEstagio:       idEstagio,
      nomeEstudante:   sol.nomeEstudante || '',
      curso:           sol.curso         || '',
      nomeEmpresa:     sol.nomeEmpresa   || '',
      labelAtor:       LABELS_ATORES_CK_[a.ator],
      prazoVencimento: ck ? ck.prazoVencimento : '',
      email:           a.email,
      urlChecklist:    urlChecklist,
    });
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

/**
 * Função chamada por trigger diário do Google Apps Script.
 * Verifica prazos de checklist e assinaturas e envia lembretes quando restam 2 dias úteis.
 *
 * Como configurar o trigger:
 *   GAS Editor → Relógio (Triggers) → + Adicionar trigger
 *   Função: verificarPrazos | Implantação: Cabeçalho | Origem: Por tempo | Período: Diário
 */
function verificarPrazos() {
  _verificarPrazosChecklist_();
  _verificarPrazosAssinaturas_();
}

/** Conta dias úteis entre hoje (exclusive) e uma data alvo (inclusive). */
function _diasUteisAte_(dataISO) {
  if (!dataISO) return 999;
  try {
    var hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    var alvo = new Date(dataISO);
    alvo.setHours(0, 0, 0, 0);
    var dias = 0;
    var d = new Date(hoje);
    d.setDate(d.getDate() + 1); // começa no dia seguinte
    while (d <= alvo) {
      var dow = d.getDay();
      if (dow !== 0 && dow !== 6) dias++;
      d.setDate(d.getDate() + 1);
    }
    return dias;
  } catch (e) {
    return 999;
  }
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
        admin:       'estagios@riogrande.ifrs.edu.br',
        orientador:  sol.emailOrientador  || '',
        coordenador: sol.emailCoordenador || '',
        empresa:     sol.emailEmpresa     || '',
        supervisor:  sol.emailSupervisor  || '',
      };

      var modificado = false;
      ['admin', 'orientador', 'coordenador', 'empresa', 'supervisor'].forEach(function (ator) {
        var ck = checklist[ator];
        if (!ck || ck.status !== CK_STATUS.PENDENTE || !ck.prazoVencimento) return;
        if (_diasUteisAte_(ck.prazoVencimento) !== 2) return;
        if ((ck.lembretesEnviados || 0) >= 1) return;
        var email = emailsAtores[ator];
        if (!email) return;
        MAIL.enviarEmailLembreteChecklist({
          idEstagio:       id,
          nomeEstudante:   sol.nomeEstudante || '',
          labelAtor:       LABELS_ATORES_CK_[ator],
          prazoVencimento: ck.prazoVencimento,
          email:           email,
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

// ── Handlers GET / POST ───────────────────────────────────────────────────────

function doGetChecklist(e) {
  var action = (e.parameter && e.parameter.action) || '';
  var id     = (e.parameter && e.parameter.id)     || '';

  switch (action) {
    case 'obterChecklist':
      if (!id) return jsonError_('Parâmetro id obrigatório.', 'MISSING_PARAM');
      var ck = obterChecklist_(id);
      if (!ck) return jsonError_('Checklist não encontrado.', 'NOT_FOUND');

      // Dados completos da solicitação (tolerante a falhas)
      var solDados = {};
      try { solDados = _obterDadosSolicitacaoCompleto_(id); } catch (_e) {}

      var infoSol = {
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
        objetivos:       String(solDados.objetivos       || ''),
        nomeAgente:      String(solDados.nomeAgente      || ''),
      };

      // ── Acesso por token (empresa / supervisor sem conta Google) ─────────
      var token = (e.parameter && e.parameter.token) || '';
      if (token) {
        var atoresToken = ['empresa', 'supervisor', 'orientador', 'coordenador'];
        var atorToken = null;
        for (var t = 0; t < atoresToken.length; t++) {
          var secToken = ck[atoresToken[t]];
          if (secToken && secToken.token && secToken.token === token) {
            atorToken = atoresToken[t];
            break;
          }
        }
        if (!atorToken) return jsonError_('Token inválido ou link expirado. Solicite um novo link ao setor de estágios.', 'INVALID_TOKEN');
        var respToken = { _meuAtor: atorToken, _infoSolicitacao: infoSol };
        respToken[atorToken] = ck[atorToken];
        return jsonOk_(respToken);
      }

      // ── Acesso por Google OAuth ──────────────────────────────────────────
      ck._emailAtores = {
        orientador:  String(solDados.emailOrientador  || ''),
        coordenador: String(solDados.emailCoordenador || ''),
        empresa:     String(solDados.emailEmpresa     || ''),
        supervisor:  String(solDados.emailSupervisor  || ''),
      };
      ck._infoSolicitacao = infoSol;
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
        body.idEstagio, body.itens, body.decisao, body.obs, body.sol || {}
      );

    case 'salvarRespostaAtor':
      return salvarRespostaAtor_(
        body.idEstagio, body.ator, body.itens, body.decisao, body.obs, body.emailAtor
      );

    case 'salvarPrazos':
      return salvarPrazos_(body.prazos);

    default:
      return jsonError_('Ação POST desconhecida: ' + action, 'UNKNOWN_ACTION');
  }
}
