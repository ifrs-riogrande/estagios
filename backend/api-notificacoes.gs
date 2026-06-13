/**
 * api-notificacoes.gs — Notificações in-app do SGE
 *
 * Aba do Sheets: 'Notificacoes'
 * Colunas: id | timestamp | email | perfil | idEstagio | tipo | mensagem | lida
 *
 * Perfis: admin | estudante | orientador | coordenador | supervisor | empresa
 * Tipos:  lembrete_checklist | lembrete_assinatura | lembrete_avaliacao | lembrete_adendo
 */

'use strict';

var NOTIF_SHEET = 'Notificacoes';

// ── Colunas ───────────────────────────────────────────────────────────────────
var NC = { id:0, timestamp:1, email:2, perfil:3, idEstagio:4, tipo:5, mensagem:6, lida:7 };

// ── Sheet helpers ─────────────────────────────────────────────────────────────

function _getNotifSheet_() {
  var ss    = SpreadsheetApp.openById(SS_ID);
  var sheet = ss.getSheetByName(NOTIF_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(NOTIF_SHEET);
    sheet.appendRow(['id','timestamp','email','perfil','idEstagio','tipo','mensagem','lida']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ── Criação ───────────────────────────────────────────────────────────────────

/**
 * Cria uma notificação in-app.
 * @param {Object} params
 *   email     {string}   — e-mail do destinatário
 *   perfil    {string}   — admin | estudante | orientador | coordenador | supervisor | empresa
 *   idEstagio {string}   — ID do estágio relacionado (pode ser '')
 *   tipo      {string}   — lembrete_checklist | lembrete_assinatura | ...
 *   mensagem  {string}   — texto legível da notificação
 */
function criarNotificacao_(params) {
  try {
    var sheet = _getNotifSheet_();
    var id    = Utilities.getUuid();
    sheet.appendRow([
      id,
      new Date().toISOString(),
      String(params.email  || '').toLowerCase(),
      String(params.perfil || ''),
      String(params.idEstagio || ''),
      String(params.tipo   || ''),
      String(params.mensagem || ''),
      false
    ]);
  } catch (e) {
    logErro_('criarNotificacao_', e);
  }
}

// ── Leitura ───────────────────────────────────────────────────────────────────

function _listarNotificacoesEmail_(email) {
  var sheet = _getNotifSheet_();
  var dados = sheet.getDataRange().getValues();
  var result = [];
  for (var i = 1; i < dados.length; i++) {
    var row = dados[i];
    if (String(row[NC.email]).toLowerCase() !== email) continue;
    if (row[NC.lida] === true || row[NC.lida] === 'TRUE') continue;
    result.push({
      id:        String(row[NC.id]),
      timestamp: String(row[NC.timestamp]),
      idEstagio: String(row[NC.idEstagio]),
      tipo:      String(row[NC.tipo]),
      mensagem:  String(row[NC.mensagem]),
    });
  }
  // Mais recentes primeiro, máximo 50
  result.reverse();
  return result.slice(0, 50);
}

// ── Marcar como lida ──────────────────────────────────────────────────────────

function _marcarLida_(email, id) {
  var sheet = _getNotifSheet_();
  var dados = sheet.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][NC.id]) === id && String(dados[i][NC.email]).toLowerCase() === email) {
      sheet.getRange(i + 1, NC.lida + 1).setValue(true);
      return;
    }
  }
}

function _marcarTodasLidas_(email) {
  var sheet = _getNotifSheet_();
  var dados = sheet.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][NC.email]).toLowerCase() === email && dados[i][NC.lida] !== true) {
      sheet.getRange(i + 1, NC.lida + 1).setValue(true);
    }
  }
}

// ── Handlers HTTP ─────────────────────────────────────────────────────────────

function doGetNotificacoes(e) {
  try {
    var token = e.parameter && e.parameter.authToken;
    var email = _validarTokenEObterEmail_(token);
    var notifs = _listarNotificacoesEmail_(email);
    return jsonOk_({ notificacoes: notifs });
  } catch (err) {
    if (err instanceof ErroAutenticacao) return jsonError_(err.message, 'AUTH_ERROR');
    logErro_('doGetNotificacoes', err);
    return jsonError_('Erro interno.', 'INTERNAL');
  }
}

function doPostNotificacoes(e) {
  try {
    var body   = e._body || JSON.parse(e.postData.contents);
    var action = body.action || '';
    var token  = body.authToken;
    var email  = _validarTokenEObterEmail_(token);

    if (action === 'marcarNotificacaoLida') {
      var id = String(body.id || '');
      if (!id) throw new Error('ID da notificação não informado.');
      _marcarLida_(email, id);
      return jsonOk_({ mensagem: 'Notificação marcada como lida.' });
    }
    if (action === 'marcarTodasNotificacoesLidas') {
      _marcarTodasLidas_(email);
      return jsonOk_({ mensagem: 'Todas as notificações marcadas como lidas.' });
    }
    return jsonError_('Ação desconhecida: ' + action, 'UNKNOWN_ACTION');
  } catch (err) {
    if (err instanceof ErroAutenticacao) return jsonError_(err.message, 'AUTH_ERROR');
    logErro_('doPostNotificacoes', err);
    return jsonError_('Erro interno.', 'INTERNAL');
  }
}

/**
 * Valida o token OAuth e retorna o e-mail do usuário.
 * Reutiliza o mesmo mecanismo de validarTokenAdmin_ mas sem exigir perfil admin.
 */
function _validarTokenEObterEmail_(token) {
  if (!token) throw new ErroAutenticacao('Token não informado.');
  try {
    var resp = UrlFetchApp.fetch(
      'https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + encodeURIComponent(token),
      { muteHttpExceptions: true }
    );
    if (resp.getResponseCode() !== 200) throw new ErroAutenticacao('Token inválido ou expirado.');
    var info = JSON.parse(resp.getContentText());
    if (!info.email) throw new ErroAutenticacao('Token não contém e-mail.');
    return info.email.toLowerCase();
  } catch (e) {
    if (e instanceof ErroAutenticacao) throw e;
    throw new ErroAutenticacao('Erro ao validar token.');
  }
}
