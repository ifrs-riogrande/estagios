'use strict';

// ─────────────────────────────────────────────────────────────────
// Configuração
// ─────────────────────────────────────────────────────────────────
var CFG_NAPNE = {
  ABA_FICHAS: 'NAPNE Fichas',
  ABA_LOG:    'NAPNE Log',
};

// Colunas da aba NAPNE Fichas (0-based)
var COL_NF = {
  EMAIL_ALUNO:    0,
  NOME_ALUNO:     1,
  EH_NEE:         2,
  TIPOS_NEE:      3,
  ADAPTACOES:     4,
  OBS_ORIENTADOR: 5,
  ATUALIZADO_EM:  6,
  ATUALIZADO_POR: 7,
};

var TIPOS_NEE_VALIDOS = [
  'TEA', 'TDAH', 'TAG', 'TOC', 'TOD',
  'Dislexia', 'Discalculia',
  'Def. física', 'Def. visual', 'Def. auditiva', 'Def. intelectual',
  'Altas habilidades', 'Outro',
];

// ─────────────────────────────────────────────────────────────────
// Validação de acesso
// ─────────────────────────────────────────────────────────────────
function validarTokenNapne_(token) {
  var info       = AUTH.validarToken(token);
  var email      = (info.email || '').toLowerCase().trim();
  var cfgNapne   = _obterDiretoriaAdmin_('NAPNE');
  var emailNapne = (cfgNapne.email || '').toLowerCase().trim();

  if (!emailNapne) {
    throw new ErroAutenticacao('E-mail do NAPNE não configurado. Configure em Configurações de Acesso.');
  }
  if (email !== emailNapne) {
    throw new ErroAutenticacao('Acesso restrito ao responsável do NAPNE.');
  }
  return info;
}

// ─────────────────────────────────────────────────────────────────
// Roteamento
// ─────────────────────────────────────────────────────────────────
function doGetNapne(e) {
  try {
    var token  = e.parameter && e.parameter.authToken;
    var action = e.parameter.action || '';

    if (action === 'verificarAcessoNapne') {
      var info = validarTokenNapne_(token);
      return jsonOk_({ nome: info.name, email: info.email });
    }

    validarTokenNapne_(token);

    switch (action) {
      case 'listarEstagiosNapne':
        return listarEstagiosNapne_();
      case 'obterFichaNapne':
        return jsonOk_(obterFichaNapne_(e.parameter.emailAluno || ''));
      default:
        return jsonError_('Ação GET não reconhecida: ' + action, 'UNKNOWN_ACTION');
    }
  } catch (err) {
    if (err instanceof ErroAutenticacao) return jsonError_(err.message, 'AUTH_ERROR');
    logErro_('api-napne.doGetNapne', err);
    return jsonError_('Erro interno.', 'INTERNAL');
  }
}

function doPostNapne(e) {
  try {
    var body  = e._body || JSON.parse(e.postData.contents);
    var token = body.authToken;
    validarTokenNapne_(token);
    var action = body.action || '';

    switch (action) {
      case 'salvarFichaNapne': return salvarFichaNapne_(body);
      default:
        return jsonError_('Ação POST não reconhecida: ' + action, 'UNKNOWN_ACTION');
    }
  } catch (err) {
    if (err instanceof ErroAutenticacao) return jsonError_(err.message, 'AUTH_ERROR');
    logErro_('api-napne.doPostNapne', err);
    return jsonError_('Erro interno: ' + err.message, 'INTERNAL');
  }
}

// ─────────────────────────────────────────────────────────────────
// GET — Lista estágios de alunos NEE
// ─────────────────────────────────────────────────────────────────
function listarEstagiosNapne_() {
  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var shSol = ss.getSheetByName(CFG_ADMIN.ABA_SOL);
  if (!shSol) return jsonOk_([]);

  var fichasMap = _carregarFichasMap_(ss);
  var dados     = shSol.getDataRange().getValues();
  var lista     = [];
  var STATUS_IGNORAR = ['Reprovado'];

  // Deduplica por emailEstudante — mantém o estágio mais recente
  var vistos = {};

  for (var i = 1; i < dados.length; i++) {
    var r = dados[i];
    if (!r[COL.ID_ESTAGIO]) continue;

    var status       = String(r[COL.STATUS] || '').trim();
    var neeDeclarado = String(r[COL.NEE]    || '').trim();
    var emailAluno   = String(r[COL.EMAIL_ESTUDANTE] || '').toLowerCase().trim();

    if (STATUS_IGNORAR.indexOf(status) !== -1) continue;

    var temFicha = !!fichasMap[emailAluno];

    // Exibe apenas se declarou NEE ou já tem ficha NAPNE
    if (neeDeclarado !== 'Sim' && !temFicha) continue;

    // Mantém apenas uma entrada por aluno (o mais recente no sheet)
    if (vistos[emailAluno]) continue;
    vistos[emailAluno] = true;

    var ficha = fichasMap[emailAluno] || null;

    lista.push({
      idEstagio:      String(r[COL.ID_ESTAGIO]).trim(),
      emailEstudante: emailAluno,
      nomeEstudante:  String(r[COL.NOME_ESTUDANTE] || ''),
      curso:          String(r[COL.CURSO] || ''),
      status:         status,
      neeDeclarado:   neeDeclarado === 'Sim',
      fichaPreenchida:temFicha,
      ehNee:          ficha ? ficha.ehNee : null,
      tiposNee:       ficha ? ficha.tiposNee : [],
      atualizadoEm:   ficha ? ficha.atualizadoEm : null,
    });
  }

  lista.sort(function(a, b) {
    if (!a.fichaPreenchida && b.fichaPreenchida) return -1;
    if (a.fichaPreenchida && !b.fichaPreenchida) return 1;
    return a.nomeEstudante.localeCompare(b.nomeEstudante, 'pt-BR');
  });

  return jsonOk_(lista);
}

// ─────────────────────────────────────────────────────────────────
// GET — Obtém ficha de um aluno
// ─────────────────────────────────────────────────────────────────
function obterFichaNapne_(emailAluno) {
  if (!emailAluno) throw new Error('E-mail do aluno obrigatório.');
  emailAluno = emailAluno.toLowerCase().trim();

  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sh    = _obterOuCriarAbaNapneFichas_(ss);
  var dados = sh.getDataRange().getValues();

  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][COL_NF.EMAIL_ALUNO] || '').toLowerCase().trim() === emailAluno) {
      return _rowParaFicha_(dados[i]);
    }
  }

  return {
    emailAluno:    emailAluno,
    nomeAluno:     '',
    ehNee:         null,
    tiposNee:      [],
    adaptacoes:    '',
    obsOrientador: '',
    atualizadoEm:  null,
    atualizadoPor: '',
  };
}

// ─────────────────────────────────────────────────────────────────
// POST — Salva ficha de um aluno
// ─────────────────────────────────────────────────────────────────
function salvarFichaNapne_(body) {
  var emailAluno = String(body.emailAluno || '').toLowerCase().trim();
  if (!emailAluno) return jsonError_('E-mail do aluno obrigatório.', 'VALIDATION');

  var nomeAluno     = String(body.nomeAluno     || '').trim().slice(0, 200);
  var ehNee         = (body.ehNee === true || body.ehNee === 'true' || body.ehNee === 'Sim');
  var tiposNee      = Array.isArray(body.tiposNee) ? body.tiposNee : [];
  var adaptacoes    = String(body.adaptacoes    || '').trim().slice(0, 2000);
  var obsOrientador = String(body.obsOrientador || '').trim().slice(0, 2000);

  // Valida tipos
  tiposNee = tiposNee.filter(function(t) {
    return TIPOS_NEE_VALIDOS.indexOf(String(t)) !== -1;
  });

  if (ehNee && tiposNee.length === 0) {
    return jsonError_('Selecione pelo menos um tipo de necessidade.', 'VALIDATION');
  }
  if (!ehNee) tiposNee = [];

  var ss         = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sh         = _obterOuCriarAbaNapneFichas_(ss);
  var dados      = sh.getDataRange().getValues();
  var agora      = new Date().toISOString();
  var napneEmail = (AUTH.validarToken(body.authToken) || {}).email || '';

  var novaLinha = [
    emailAluno,
    nomeAluno,
    ehNee ? 'Sim' : 'Não',
    JSON.stringify(tiposNee),
    adaptacoes,
    obsOrientador,
    agora,
    napneEmail,
  ];

  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][COL_NF.EMAIL_ALUNO] || '').toLowerCase().trim() === emailAluno) {
      sh.getRange(i + 1, 1, 1, novaLinha.length).setValues([novaLinha]);
      _registrarLogNapne_(ss, napneEmail, emailAluno, 'atualizar_ficha',
        'ehNee:' + (ehNee ? 'Sim' : 'Não') + ' tipos:' + tiposNee.join(','));
      return jsonOk_({ mensagem: 'Ficha atualizada com sucesso.' });
    }
  }

  sh.appendRow(novaLinha);
  _registrarLogNapne_(ss, napneEmail, emailAluno, 'criar_ficha',
    'ehNee:' + (ehNee ? 'Sim' : 'Não') + ' tipos:' + tiposNee.join(','));
  return jsonOk_({ mensagem: 'Ficha criada com sucesso.' });
}

// ─────────────────────────────────────────────────────────────────
// Função pública — usada por outros módulos (orientador, admin)
// ─────────────────────────────────────────────────────────────────
function obterFichaNapnePublica_(emailAluno) {
  if (!emailAluno) return null;
  var ss = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sh = ss.getSheetByName(CFG_NAPNE.ABA_FICHAS);
  if (!sh) return null;
  emailAluno = emailAluno.toLowerCase().trim();
  var dados = sh.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][COL_NF.EMAIL_ALUNO] || '').toLowerCase().trim() === emailAluno) {
      return _rowParaFicha_(dados[i]);
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────────
function _obterOuCriarAbaNapneFichas_(ss) {
  var sh = ss.getSheetByName(CFG_NAPNE.ABA_FICHAS);
  if (!sh) {
    sh = ss.insertSheet(CFG_NAPNE.ABA_FICHAS);
    sh.getRange(1, 1, 1, 8).setValues([[
      'E-mail Aluno', 'Nome Aluno', 'É NEE', 'Tipos NEE',
      'Adaptações', 'Obs. Orientador', 'Atualizado Em', 'Atualizado Por',
    ]]);
  }
  return sh;
}

function _obterOuCriarAbaLogNapne_(ss) {
  var sh = ss.getSheetByName(CFG_NAPNE.ABA_LOG);
  if (!sh) {
    sh = ss.insertSheet(CFG_NAPNE.ABA_LOG);
    sh.getRange(1, 1, 1, 5).setValues([[
      'Timestamp', 'Ator Email', 'Aluno Email', 'Ação', 'Detalhes',
    ]]);
  }
  return sh;
}

function _registrarLogNapne_(ss, atorEmail, alunoEmail, acao, detalhes) {
  try {
    var sh = _obterOuCriarAbaLogNapne_(ss);
    sh.appendRow([new Date().toISOString(), atorEmail, alunoEmail, acao, detalhes || '']);
  } catch (_) {}
}

function _carregarFichasMap_(ss) {
  var sh = ss.getSheetByName(CFG_NAPNE.ABA_FICHAS);
  if (!sh) return {};
  var dados = sh.getDataRange().getValues();
  var mapa  = {};
  for (var i = 1; i < dados.length; i++) {
    var email = String(dados[i][COL_NF.EMAIL_ALUNO] || '').toLowerCase().trim();
    if (email) mapa[email] = _rowParaFicha_(dados[i]);
  }
  return mapa;
}

function _rowParaFicha_(row) {
  var tiposRaw = String(row[COL_NF.TIPOS_NEE] || '');
  var tipos = [];
  try { tipos = JSON.parse(tiposRaw); } catch (_) { if (tiposRaw) tipos = [tiposRaw]; }
  return {
    emailAluno:    String(row[COL_NF.EMAIL_ALUNO]    || '').toLowerCase().trim(),
    nomeAluno:     String(row[COL_NF.NOME_ALUNO]     || ''),
    ehNee:         String(row[COL_NF.EH_NEE]         || '') === 'Sim',
    tiposNee:      Array.isArray(tipos) ? tipos : [],
    adaptacoes:    String(row[COL_NF.ADAPTACOES]     || ''),
    obsOrientador: String(row[COL_NF.OBS_ORIENTADOR] || ''),
    atualizadoEm:  String(row[COL_NF.ATUALIZADO_EM]  || '') || null,
    atualizadoPor: String(row[COL_NF.ATUALIZADO_POR] || ''),
  };
}
