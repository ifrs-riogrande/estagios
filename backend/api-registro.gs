'use strict';

// ─────────────────────────────────────────────────────────────────
// Validação de acesso
// ─────────────────────────────────────────────────────────────────
function validarTokenRegistro_(token) {
  var info          = AUTH.validarToken(token);
  var email         = (info.email || '').toLowerCase().trim();
  var cfgRegistro   = _obterDiretoriaAdmin_('Registro');
  var emailRegistro = (cfgRegistro.email || '').toLowerCase().trim();

  if (!emailRegistro) {
    throw new ErroAutenticacao('E-mail do Registro Acadêmico não configurado. Configure em Configurações de Acesso.');
  }
  if (email !== emailRegistro) {
    throw new ErroAutenticacao('Acesso restrito ao responsável do Registro Acadêmico.');
  }
  return info;
}

// ─────────────────────────────────────────────────────────────────
// Roteamento
// ─────────────────────────────────────────────────────────────────
function doGetRegistro(e) {
  try {
    var token  = e.parameter && e.parameter.authToken;
    var action = e.parameter.action || '';

    if (action === 'verificarAcessoRegistro') {
      var info = validarTokenRegistro_(token);
      return jsonOk_({ nome: info.name, email: info.email });
    }

    validarTokenRegistro_(token);

    switch (action) {
      case 'listarEstagiosRegistro':
        return _listarEstagiosRegistro_();
      default:
        return jsonError_('Ação GET não reconhecida: ' + action, 'UNKNOWN_ACTION');
    }
  } catch (err) {
    if (err instanceof ErroAutenticacao) {
      return jsonError_(err.message, 'AUTH_ERROR');
    }
    logErro_('doGetRegistro', err);
    return jsonError_('Erro interno: ' + err.message, 'INTERNAL');
  }
}

// ─────────────────────────────────────────────────────────────────
// Listagem de estágios
// ─────────────────────────────────────────────────────────────────
function _listarEstagiosRegistro_() {
  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sheet = ss.getSheetByName(CFG_ADMIN.ABA_SOL);
  if (!sheet) return jsonOk_([]);

  var dados = sheet.getDataRange().getValues();
  var lista = [];

  for (var i = 1; i < dados.length; i++) {
    var linha = dados[i];
    if (!linha[COL_SOL.ID_ESTAGIO]) continue;
    var statusLinha = String(linha[COL_SOL.STATUS]       || '').trim();
    var tipoLinha   = String(linha[COL_SOL.TIPO_ESTAGIO] || '').trim();
    if (statusLinha !== 'Concluído')   continue;
    if (tipoLinha   !== 'Obrigatório') continue;

    lista.push({
      id:             String(linha[COL_SOL.ID_ESTAGIO]      || ''),
      nomeEstudante:  String(linha[COL_SOL.NOME_ESTUDANTE]  || ''),
      matricula:      String(linha[COL_SOL.MATRICULA]        || ''),
      curso:          String(linha[COL_SOL.CURSO]            || ''),
      empresa:        String(linha[COL_SOL.NOME_EMPRESA]     || ''),
      nomeOrientador: String(linha[COL_SOL.NOME_ORIENTADOR]  || ''),
      dataInicio:     normalizarDataISO_(linha[COL_SOL.DATA_INICIO]),
      dataTermino:    normalizarDataISO_(linha[COL_SOL.DATA_TERMINO]),
      driveUrl:       String(linha[COL_SOL.DRIVE_URL]        || ''),
    });
  }

  lista.reverse();
  return jsonOk_(lista);
}
