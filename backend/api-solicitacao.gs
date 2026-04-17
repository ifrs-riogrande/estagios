/**
 * api-solicitacao.gs — Web App: Solicitações de Estágio, Relatórios e Adendos
 * SGE — Sistema de Gestão de Estágios · IFRS Campus Rio Grande
 *
 * Rotas POST:
 *   solicitarEstagio         — Nova solicitação de TCE
 *   enviarRelatorioParcial   — Relatório semestral
 *   enviarRelatorioFinal     — Relatório de conclusão
 *   enviarAdendo             — Adendo ao TCE
 *
 * Planilha de Solicitações ID: 1iAnurghOelZQiYMIevO1xxnx0ptz5bxyniuUe5KZx3Y
 */

'use strict';

var CFG_SOL = {
  SS_ID:         '1iAnurghOelZQiYMIevO1xxnx0ptz5bxyniuUe5KZx3Y',
  ABA_SOL:       'Solicitações',
  ABA_PARC:      'Relatórios Parciais',
  ABA_FINAL:     'Relatórios Finais',
  ABA_ADENDO:    'Adendos',
};

/**
 * Colunas da aba de Solicitações (base 0).
 * Mesmo formato do Form original para manter compatibilidade.
 */
var COL_SOL = {
  TIMESTAMP:         0,
  ID_ESTAGIO:        1,
  EMAIL_ESTUDANTE:   2,
  NOME_ESTUDANTE:    3,
  MATRICULA:         4,
  CURSO:             5,
  CPF:               6,
  DATA_NASC:         7,
  TELEFONE:          8,
  TIPO_ESTAGIO:      9,
  NOME_EMPRESA:      10,
  CNPJ_EMPRESA:      11,
  NOME_SUPERVISOR:   12,
  EMAIL_SUPERVISOR:  13,
  NOME_AGENTE:       14,
  NOME_ORIENTADOR:   15,
  EMAIL_ORIENTADOR:  16,
  DATA_INICIO:       17,
  DATA_TERMINO:      18,
  CARGA_HOR:         19,
  HORARIO:           20,
  REMUNERACAO:       21,
  VALOR_BOLSA:       22,
  VALOR_TRANSPORTE:  23,
  PLANO_ATIVIDADES:  24,
  LINK_DOC_MAT:      25,   // matrícula
  LINK_DOC_ID:       26,   // identidade
  LINK_DOC_BOL:      27,   // boletim
  STATUS:            28,   // Pendente / Em análise / Aprovado / Ativo / Encerrado / Cancelado
  LINK_PASTA_DRIVE:  29,
  OBS_SETOR:         30,
};

/** Colunas da aba Relatórios Parciais (base 0). */
var COL_PARC = {
  TIMESTAMP:           0,
  ID_ESTAGIO:          1,
  EMAIL_ESTUDANTE:     2,
  PERIODO_REF:         3,
  ATIVIDADES:          4,
  APRENDIZAGENS:       5,
  RELACAO_CURSO:       6,
  AVALIACAO:           7,
  DIFICULDADES:        8,
  SUGESTOES:           9,
};

/** Colunas da aba Relatórios Finais (base 0). */
var COL_FINAL = {
  TIMESTAMP:             0,
  ID_ESTAGIO:            1,
  EMAIL_ESTUDANTE:       2,
  DATA_ENCERRAMENTO:     3,
  RESUMO:                4,
  COMPETENCIAS:          5,
  CONTRIBUICAO:          6,
  AVAL_CONCEDENTE:       7,
  AVAL_ORIENTADOR:       8,
  RECOMENDARIA:          9,
  CONSIDERACOES:         10,
};

/** Colunas da aba Adendos (base 0). */
var COL_ADENDO = {
  TIMESTAMP:          0,
  ID_ESTAGIO:         1,
  EMAIL_ESTUDANTE:    2,
  TIPO_ADENDO:        3,
  NOVA_DATA_TERMINO:  4,
  NOVA_CARGA:         5,
  NOVO_HORARIO:       6,
  JUSTIFICATIVA:      7,
  OBS:                8,
  STATUS:             9,  // Pendente / Aprovado / Reprovado
};

// ---------------------------------------------------------------------------
// Roteamento
// ---------------------------------------------------------------------------

function doGet(e) {
  return jsonError_('Método não suportado.', 'METHOD_NOT_ALLOWED');
}

function doPost(e) {
  var dados;
  try {
    dados = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonError_('Corpo da requisição inválido.', 'PARSE_ERROR');
  }

  try {
    var action = dados.action || '';
    switch (action) {
      case 'solicitarEstagio':        return solicitarEstagio_(dados);
      case 'enviarRelatorioParcial':  return enviarRelatorioParcial_(dados);
      case 'enviarRelatorioFinal':    return enviarRelatorioFinal_(dados);
      case 'enviarAdendo':            return enviarAdendo_(dados);
      default:
        return jsonError_('Ação não reconhecida.', 'UNKNOWN_ACTION');
    }
  } catch (err) {
    logErro_('api-solicitacao.doPost[' + (dados && dados.action) + ']', err);
    if (err instanceof ErroAutenticacao) return jsonError_(err.message, 'AUTH_ERROR');
    return jsonError_('Erro interno ao processar a requisição.', 'INTERNAL');
  }
}

// ---------------------------------------------------------------------------
// POST — Solicitar estágio
// ---------------------------------------------------------------------------

function solicitarEstagio_(dados) {
  var tokenInfo = validarTokenEstudante_(dados.authToken);

  if (!checkRateLimit_('solicitarEstagio', 3)) {
    return jsonError_('Muitas requisições. Aguarde um momento.', 'RATE_LIMIT');
  }

  // Valida código de acesso e obtém dados do estudante
  var estudante;
  try {
    estudante = validarCodigoAcesso_(tokenInfo.email, dados.codigoAcesso);
  } catch (e) {
    return jsonError_(e.message, 'INVALID_CODE');
  }

  // Sanitização dos campos da solicitação
  var tipoEstagio    = sanitizar_(dados.tipoEstagio, 30);
  var nomeEmpresa    = sanitizar_(dados.nomeEmpresa, 200);
  var cnpjEmpresa    = sanitizar_(dados.cnpjEmpresa, 14).replace(/\D/g, '');
  var nomeSupervisor = sanitizar_(dados.nomeSupervisor, 200);
  var emailSupervisor= sanitizar_(dados.emailSupervisor, 100);
  var nomeAgente     = sanitizar_(dados.nomeAgente, 100);
  var nomeOrientador = sanitizar_(dados.nomeOrientador, 200);
  var emailOrientador= sanitizar_(dados.emailOrientador, 100);
  var dataInicio     = sanitizar_(dados.dataInicio, 10);
  var dataTermino    = sanitizar_(dados.dataTermino, 10);
  var cargaHor       = sanitizar_(dados.cargaHoraria, 20);
  var horario        = sanitizar_(dados.horario, 100);
  var remuneracao    = sanitizar_(dados.remunerado, 5);
  var valorBolsa     = sanitizar_(dados.valorBolsa, 20);
  var valorTransp    = sanitizar_(dados.valorTransporte, 20);
  var planoAtiv      = sanitizar_(dados.planoAtividades, 2000);
  var docMat         = sanitizar_(dados.docMatricula, 200);
  var docId          = sanitizar_(dados.docIdentidade, 200);
  var docBol         = sanitizar_(dados.docBoletim, 200);

  // Validações
  if (!tipoEstagio)    return jsonError_('Tipo de estágio é obrigatório.', 'VALIDATION');
  if (!nomeEmpresa)    return jsonError_('Empresa é obrigatória.', 'VALIDATION');
  if (!nomeSupervisor) return jsonError_('Supervisor é obrigatório.', 'VALIDATION');
  if (!nomeOrientador) return jsonError_('Orientador é obrigatório.', 'VALIDATION');
  if (!dataInicio)     return jsonError_('Data de início é obrigatória.', 'VALIDATION');
  if (!dataTermino)    return jsonError_('Data de término é obrigatória.', 'VALIDATION');
  if (!cargaHor)       return jsonError_('Carga horária é obrigatória.', 'VALIDATION');

  // Data início deve ser >= hoje + 7 dias
  var hoje    = new Date(); hoje.setHours(0, 0, 0, 0);
  var minInicio = new Date(hoje.getTime() + 7 * 86400000);
  var dtInicio  = new Date(dataInicio + 'T00:00:00');
  if (dtInicio < minInicio) {
    return jsonError_('A data de início deve ser de pelo menos 7 dias a partir de hoje.', 'VALIDATION');
  }
  if (dataTermino <= dataInicio) {
    return jsonError_('A data de término deve ser posterior à data de início.', 'VALIDATION');
  }

  // Gera ID único
  var idEstagio = gerarIdEstagio_();

  // Cria pasta no Drive
  var ano      = new Date().getFullYear();
  var linkPasta= criarPastaEstagio_(idEstagio, ano, estudante.curso, estudante.matricula, estudante.nome);

  // Monta linha
  var now  = new Date();
  var ss   = SpreadsheetApp.openById(CFG_SOL.SS_ID);
  var sheet = ss.getSheetByName(CFG_SOL.ABA_SOL) || ss.getSheets()[0];

  var linha = [];
  linha[COL_SOL.TIMESTAMP]        = now;
  linha[COL_SOL.ID_ESTAGIO]       = idEstagio;
  linha[COL_SOL.EMAIL_ESTUDANTE]  = estudante.emailInst;
  linha[COL_SOL.NOME_ESTUDANTE]   = estudante.nome;
  linha[COL_SOL.MATRICULA]        = estudante.matricula;
  linha[COL_SOL.CURSO]            = estudante.curso;
  linha[COL_SOL.CPF]              = estudante.cpf;
  linha[COL_SOL.DATA_NASC]        = estudante.dataNasc;
  linha[COL_SOL.TELEFONE]         = estudante.telefone;
  linha[COL_SOL.TIPO_ESTAGIO]     = tipoEstagio;
  linha[COL_SOL.NOME_EMPRESA]     = nomeEmpresa;
  linha[COL_SOL.CNPJ_EMPRESA]     = cnpjEmpresa;
  linha[COL_SOL.NOME_SUPERVISOR]  = nomeSupervisor;
  linha[COL_SOL.EMAIL_SUPERVISOR] = emailSupervisor;
  linha[COL_SOL.NOME_AGENTE]      = nomeAgente;
  linha[COL_SOL.NOME_ORIENTADOR]  = nomeOrientador;
  linha[COL_SOL.EMAIL_ORIENTADOR] = emailOrientador;
  linha[COL_SOL.DATA_INICIO]      = dataInicio;
  linha[COL_SOL.DATA_TERMINO]     = dataTermino;
  linha[COL_SOL.CARGA_HOR]        = cargaHor;
  linha[COL_SOL.HORARIO]          = horario;
  linha[COL_SOL.REMUNERACAO]      = remuneracao;
  linha[COL_SOL.VALOR_BOLSA]      = valorBolsa;
  linha[COL_SOL.VALOR_TRANSPORTE] = valorTransp;
  linha[COL_SOL.PLANO_ATIVIDADES] = planoAtiv;
  linha[COL_SOL.LINK_DOC_MAT]     = docMat;
  linha[COL_SOL.LINK_DOC_ID]      = docId;
  linha[COL_SOL.LINK_DOC_BOL]     = docBol;
  linha[COL_SOL.STATUS]           = 'Pendente';
  linha[COL_SOL.LINK_PASTA_DRIVE] = linkPasta;
  linha[COL_SOL.OBS_SETOR]        = '';

  sheet.appendRow(linha);

  // Notificações por e-mail
  try {
    enviarEmailSolicitacaoRecebida_({
      idEstagio:       idEstagio,
      nomeEstudante:   estudante.nome,
      emailEstudante:  estudante.emailInst,
      matricula:       estudante.matricula,
      curso:           estudante.curso,
      nomeEmpresa:     nomeEmpresa,
      nomeSupervisor:  nomeSupervisor,
      nomeOrientador:  nomeOrientador,
      emailOrientador: emailOrientador,
      tipoEstagio:     tipoEstagio,
      dataInicio:      formatarData_(dataInicio),
      dataTermino:     formatarData_(dataTermino),
    });
  } catch (e) { logErro_('solicitarEstagio_.mail', e); }

  return jsonOk_({
    idEstagio: idEstagio,
    mensagem:  'Solicitação enviada com sucesso! Seu ID de estágio é ' + idEstagio + '. Guarde este código.',
  });
}

// ---------------------------------------------------------------------------
// POST — Enviar relatório parcial
// ---------------------------------------------------------------------------

function enviarRelatorioParcial_(dados) {
  var tokenInfo = validarTokenEstudante_(dados.authToken);

  if (!checkRateLimit_('enviarRelatorioParcial')) {
    return jsonError_('Muitas requisições. Aguarde um momento.', 'RATE_LIMIT');
  }

  var idEstagio = sanitizar_(dados.idEstagio, 20).toUpperCase().trim();
  if (!idEstagio.match(/^RG\d{2}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)) {
    return jsonError_('ID do estágio inválido.', 'VALIDATION');
  }

  var periodoRef    = sanitizar_(dados.periodoRef, 10);
  var atividades    = sanitizar_(dados.atividadesRealizadas, 2000);
  var aprendizagens = sanitizar_(dados.aprendizagens, 2000);
  var relacaoCurso  = sanitizar_(dados.relacaoCurso, 1000);
  var avaliacao     = sanitizar_(dados.avaliacaoEstagio, 50);
  var dificuldades  = sanitizar_(dados.dificuldades, 1000);
  var sugestoes     = sanitizar_(dados.sugestoes, 500);

  if (!periodoRef)  return jsonError_('Período de referência é obrigatório.', 'VALIDATION');
  if (!atividades || atividades.length < 80)  return jsonError_('Descrição das atividades muito curta.', 'VALIDATION');
  if (!aprendizagens) return jsonError_('Aprendizagens são obrigatórias.', 'VALIDATION');
  if (!relacaoCurso)  return jsonError_('Relação com o curso é obrigatória.', 'VALIDATION');
  if (!avaliacao)     return jsonError_('Avaliação geral é obrigatória.', 'VALIDATION');

  // Verifica se o ID existe e pertence ao estudante
  verificarIdEstagio_(idEstagio, tokenInfo.email);

  var ss    = SpreadsheetApp.openById(CFG_SOL.SS_ID);
  var sheet = obterOuCriarAba_(ss, CFG_SOL.ABA_PARC,
    ['Timestamp','ID Estágio','E-mail Estudante','Período Ref.','Atividades Realizadas',
     'Aprendizagens','Relação com o Curso','Avaliação Geral','Dificuldades','Sugestões']);

  var linha = [];
  linha[COL_PARC.TIMESTAMP]       = new Date();
  linha[COL_PARC.ID_ESTAGIO]      = idEstagio;
  linha[COL_PARC.EMAIL_ESTUDANTE] = tokenInfo.email;
  linha[COL_PARC.PERIODO_REF]     = periodoRef;
  linha[COL_PARC.ATIVIDADES]      = atividades;
  linha[COL_PARC.APRENDIZAGENS]   = aprendizagens;
  linha[COL_PARC.RELACAO_CURSO]   = relacaoCurso;
  linha[COL_PARC.AVALIACAO]       = avaliacao;
  linha[COL_PARC.DIFICULDADES]    = dificuldades;
  linha[COL_PARC.SUGESTOES]       = sugestoes;

  sheet.appendRow(linha);

  // Notificação
  try {
    var emailOrientador = buscarEmailOrientador_(idEstagio);
    enviarEmailRelatorioParcialRecebido_({
      idEstagio:       idEstagio,
      emailEstudante:  tokenInfo.email,
      periodoRef:      periodoRef,
      avaliacaoEstagio:avaliacao,
      emailOrientador: emailOrientador,
    });
  } catch (e) { logErro_('enviarRelatorioParcial_.mail', e); }

  return jsonOk_({ mensagem: 'Relatório parcial enviado com sucesso!' });
}

// ---------------------------------------------------------------------------
// POST — Enviar relatório final
// ---------------------------------------------------------------------------

function enviarRelatorioFinal_(dados) {
  var tokenInfo = validarTokenEstudante_(dados.authToken);

  if (!checkRateLimit_('enviarRelatorioFinal')) {
    return jsonError_('Muitas requisições. Aguarde um momento.', 'RATE_LIMIT');
  }

  var idEstagio = sanitizar_(dados.idEstagio, 20).toUpperCase().trim();
  if (!idEstagio.match(/^RG\d{2}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)) {
    return jsonError_('ID do estágio inválido.', 'VALIDATION');
  }

  var dataEnc    = sanitizar_(dados.dataEncerramento, 10);
  var resumo     = sanitizar_(dados.resumoAtividades, 3000);
  var competenc  = sanitizar_(dados.competenciasDesenvolvidas, 2000);
  var contribuic = sanitizar_(dados.contribuicaoFormacao, 2000);
  var avalConced = sanitizar_(dados.avaliacaoConcedente, 50);
  var avalOri    = sanitizar_(dados.avaliacaoOrientador, 50);
  var recomend   = sanitizar_(dados.recomendaria, 30);
  var consider   = sanitizar_(dados.consideracoesFinais, 1000);

  if (!dataEnc)    return jsonError_('Data de encerramento é obrigatória.', 'VALIDATION');
  if (!resumo || resumo.length < 120) return jsonError_('Resumo das atividades muito curto.', 'VALIDATION');
  if (!competenc)  return jsonError_('Competências desenvolvidas são obrigatórias.', 'VALIDATION');
  if (!contribuic) return jsonError_('Contribuição para formação é obrigatória.', 'VALIDATION');
  if (!avalConced) return jsonError_('Avaliação da concedente é obrigatória.', 'VALIDATION');
  if (!avalOri)    return jsonError_('Avaliação do orientador é obrigatória.', 'VALIDATION');
  if (!recomend)   return jsonError_('Recomendação da empresa é obrigatória.', 'VALIDATION');

  verificarIdEstagio_(idEstagio, tokenInfo.email);

  var ss    = SpreadsheetApp.openById(CFG_SOL.SS_ID);
  var sheet = obterOuCriarAba_(ss, CFG_SOL.ABA_FINAL,
    ['Timestamp','ID Estágio','E-mail Estudante','Data Encerramento','Resumo Atividades',
     'Competências','Contribuição Formação','Aval. Concedente','Aval. Orientador','Recomendaria','Considerações']);

  var linha = [];
  linha[COL_FINAL.TIMESTAMP]         = new Date();
  linha[COL_FINAL.ID_ESTAGIO]        = idEstagio;
  linha[COL_FINAL.EMAIL_ESTUDANTE]   = tokenInfo.email;
  linha[COL_FINAL.DATA_ENCERRAMENTO] = dataEnc;
  linha[COL_FINAL.RESUMO]            = resumo;
  linha[COL_FINAL.COMPETENCIAS]      = competenc;
  linha[COL_FINAL.CONTRIBUICAO]      = contribuic;
  linha[COL_FINAL.AVAL_CONCEDENTE]   = avalConced;
  linha[COL_FINAL.AVAL_ORIENTADOR]   = avalOri;
  linha[COL_FINAL.RECOMENDARIA]      = recomend;
  linha[COL_FINAL.CONSIDERACOES]     = consider;

  sheet.appendRow(linha);

  // Atualiza status na aba principal
  try { atualizarStatusSolicitacao_(idEstagio, 'Encerrado'); } catch (e) { /* não crítico */ }

  // Notificação
  try {
    var emailOrientador = buscarEmailOrientador_(idEstagio);
    enviarEmailRelatorioFinalRecebido_({
      idEstagio:        idEstagio,
      emailEstudante:   tokenInfo.email,
      dataEncerramento: formatarData_(dataEnc),
      avaliacaoConcedente: avalConced,
      avaliacaoOrientador: avalOri,
      recomendaria:     recomend,
      emailOrientador:  emailOrientador,
    });
  } catch (e) { logErro_('enviarRelatorioFinal_.mail', e); }

  return jsonOk_({ mensagem: 'Relatório final enviado com sucesso!' });
}

// ---------------------------------------------------------------------------
// POST — Enviar adendo
// ---------------------------------------------------------------------------

function enviarAdendo_(dados) {
  var tokenInfo = validarTokenEstudante_(dados.authToken);

  if (!checkRateLimit_('enviarAdendo')) {
    return jsonError_('Muitas requisições. Aguarde um momento.', 'RATE_LIMIT');
  }

  var idEstagio = sanitizar_(dados.idEstagio, 20).toUpperCase().trim();
  if (!idEstagio.match(/^RG\d{2}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)) {
    return jsonError_('ID do estágio inválido.', 'VALIDATION');
  }

  var tipoAdendo   = sanitizar_(dados.tipoAdendo, 50);
  var novaData     = sanitizar_(dados.novaDataTermino, 10);
  var novaCarga    = sanitizar_(dados.novaCargaHoraria, 20);
  var novoHorario  = sanitizar_(dados.novoHorario, 100);
  var justificativa= sanitizar_(dados.justificativa, 2000);
  var obs          = sanitizar_(dados.obsAdicionais, 500);

  if (!tipoAdendo)        return jsonError_('Tipo de adendo é obrigatório.', 'VALIDATION');
  if (!justificativa || justificativa.length < 40)
    return jsonError_('Justificativa muito curta. Explique melhor o motivo.', 'VALIDATION');

  if ((tipoAdendo === 'Prorrogação de prazo' || tipoAdendo === 'Redução de prazo') && !novaData)
    return jsonError_('Nova data de término é obrigatória para este tipo de adendo.', 'VALIDATION');
  if (tipoAdendo === 'Alteração de carga horária' && !novaCarga)
    return jsonError_('Nova carga horária é obrigatória.', 'VALIDATION');
  if (tipoAdendo === 'Alteração de horário' && !novoHorario)
    return jsonError_('Novo horário é obrigatório.', 'VALIDATION');

  verificarIdEstagio_(idEstagio, tokenInfo.email);

  var ss    = SpreadsheetApp.openById(CFG_SOL.SS_ID);
  var sheet = obterOuCriarAba_(ss, CFG_SOL.ABA_ADENDO,
    ['Timestamp','ID Estágio','E-mail Estudante','Tipo de Adendo','Nova Data Término',
     'Nova Carga Horária','Novo Horário','Justificativa','Observações','Status']);

  var linha = [];
  linha[COL_ADENDO.TIMESTAMP]         = new Date();
  linha[COL_ADENDO.ID_ESTAGIO]        = idEstagio;
  linha[COL_ADENDO.EMAIL_ESTUDANTE]   = tokenInfo.email;
  linha[COL_ADENDO.TIPO_ADENDO]       = tipoAdendo;
  linha[COL_ADENDO.NOVA_DATA_TERMINO] = novaData;
  linha[COL_ADENDO.NOVA_CARGA]        = novaCarga;
  linha[COL_ADENDO.NOVO_HORARIO]      = novoHorario;
  linha[COL_ADENDO.JUSTIFICATIVA]     = justificativa;
  linha[COL_ADENDO.OBS]               = obs;
  linha[COL_ADENDO.STATUS]            = 'Pendente';

  sheet.appendRow(linha);

  // Notificação
  try {
    enviarEmailAdendoRecebido_({
      idEstagio:       idEstagio,
      emailEstudante:  tokenInfo.email,
      tipoAdendo:      tipoAdendo,
      novaDataTermino: novaData ? formatarData_(novaData) : '',
      novaCargaHoraria:novaCarga,
      novoHorario:     novoHorario,
      justificativa:   justificativa,
    });
  } catch (e) { logErro_('enviarAdendo_.mail', e); }

  return jsonOk_({ mensagem: 'Adendo enviado com sucesso!' });
}

// ---------------------------------------------------------------------------
// Funções auxiliares internas
// ---------------------------------------------------------------------------

/**
 * Verifica se o ID de estágio existe na planilha e pertence ao e-mail do estudante.
 * Lança erro se não encontrado ou se não pertencer ao estudante.
 */
function verificarIdEstagio_(idEstagio, emailEstudante) {
  var ss    = SpreadsheetApp.openById(CFG_SOL.SS_ID);
  var sheet = ss.getSheetByName(CFG_SOL.ABA_SOL) || ss.getSheets()[0];
  var dados = sheet.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    var linha = dados[i];
    if (String(linha[COL_SOL.ID_ESTAGIO] || '').trim() !== idEstagio) continue;
    if (String(linha[COL_SOL.EMAIL_ESTUDANTE] || '').toLowerCase().trim()
        !== emailEstudante.toLowerCase().trim()) {
      throw new Error('Este ID de estágio não pertence à sua conta.');
    }
    return; // OK
  }
  throw new Error('ID de estágio não encontrado.');
}

/**
 * Obtém o e-mail do orientador vinculado a um ID de estágio.
 * @returns {string} e-mail ou ''
 */
function buscarEmailOrientador_(idEstagio) {
  var ss    = SpreadsheetApp.openById(CFG_SOL.SS_ID);
  var sheet = ss.getSheetByName(CFG_SOL.ABA_SOL) || ss.getSheets()[0];
  var dados = sheet.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][COL_SOL.ID_ESTAGIO] || '').trim() === idEstagio) {
      return String(dados[i][COL_SOL.EMAIL_ORIENTADOR] || '');
    }
  }
  return '';
}

/**
 * Atualiza o campo STATUS de uma solicitação.
 */
function atualizarStatusSolicitacao_(idEstagio, novoStatus) {
  var ss    = SpreadsheetApp.openById(CFG_SOL.SS_ID);
  var sheet = ss.getSheetByName(CFG_SOL.ABA_SOL) || ss.getSheets()[0];
  var dados = sheet.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][COL_SOL.ID_ESTAGIO] || '').trim() === idEstagio) {
      sheet.getRange(i + 1, COL_SOL.STATUS + 1).setValue(novoStatus);
      return;
    }
  }
}

/**
 * Obtém ou cria uma aba na planilha, adicionando cabeçalho se nova.
 */
function obterOuCriarAba_(ss, nomeAba, cabecalho) {
  var sheet = ss.getSheetByName(nomeAba);
  if (!sheet) {
    sheet = ss.insertSheet(nomeAba);
    if (cabecalho && cabecalho.length) {
      sheet.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);
      sheet.getRange(1, 1, 1, cabecalho.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}
