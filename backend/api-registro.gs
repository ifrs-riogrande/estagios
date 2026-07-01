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
  var ss   = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var lista = [];

  // ── Estágios obrigatórios concluídos ────────────────────────────
  var sheetSol = ss.getSheetByName(CFG_ADMIN.ABA_SOL);
  if (sheetSol) {
    var dadosSol = sheetSol.getDataRange().getValues();
    for (var i = 1; i < dadosSol.length; i++) {
      var linha = dadosSol[i];
      if (!linha[COL_SOL.ID_ESTAGIO]) continue;
      if (String(linha[COL_SOL.STATUS]       || '').trim() !== 'Concluído')   continue;
      if (String(linha[COL_SOL.TIPO_ESTAGIO] || '').trim() !== 'Obrigatório') continue;
      lista.push({
        origem:         'estagio',
        id:             String(linha[COL_SOL.ID_ESTAGIO]      || ''),
        nomeEstudante:  String(linha[COL_SOL.NOME_ESTUDANTE]  || ''),
        matricula:      String(linha[COL_SOL.MATRICULA]        || ''),
        curso:          String(linha[COL_SOL.CURSO]            || ''),
        empresa:        String(linha[COL_SOL.NOME_EMPRESA]     || ''),
        nomeOrientador: String(linha[COL_SOL.NOME_ORIENTADOR]  || ''),
        dataInicio:     normalizarDataISO_(linha[COL_SOL.DATA_INICIO]),
        dataTermino:    normalizarDataISO_(linha[COL_SOL.DATA_TERMINO]),
        driveUrl:       String(linha[COL_SOL.DRIVE_URL]        || ''),
        dataDeferimento: '',
        cargaHomologada: '',
      });
    }
  }

  // ── Aproveitamentos deferidos ────────────────────────────────────
  var sheetAprov = ss.getSheetByName('Aproveitamento');
  if (sheetAprov) {
    var dadosAprov = sheetAprov.getDataRange().getValues();
    for (var j = 1; j < dadosAprov.length; j++) {
      var lAprov = dadosAprov[j];
      if (!lAprov[COL_APROV.ID]) continue;
      if (String(lAprov[COL_APROV.STATUS] || '').trim() !== 'Deferido') continue;
      var parecerDen = _parseJson_(lAprov[COL_APROV.PARECER_DEN_JSON], {});
      lista.push({
        origem:          'aproveitamento',
        id:              String(lAprov[COL_APROV.ID]             || ''),
        nomeEstudante:   String(lAprov[COL_APROV.NOME_ESTUDANTE] || ''),
        matricula:       String(lAprov[COL_APROV.MATRICULA]      || ''),
        curso:           String(lAprov[COL_APROV.CURSO]          || ''),
        empresa:         '',
        nomeOrientador:  '',
        dataInicio:      '',
        dataTermino:     '',
        driveUrl:        String(lAprov[COL_APROV.DRIVE_URL]        || ''),
        dataDeferimento: normalizarDataISO_(lAprov[COL_APROV.DATA_ASSINATURA_DEN]),
        cargaHomologada: String(parecerDen.horasHomologadas || lAprov[COL_APROV.CARGA_HOMOLOGADA] || ''),
      });
    }
  }

  lista.reverse();
  return jsonOk_(lista);
}
