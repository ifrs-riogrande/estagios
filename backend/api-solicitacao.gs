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
 * Planilha de Solicitações ID: 1zVyseifVC6xeMpNjqwYd6jCq9HTJ2NS8BlN1dtM4s7Y
 */

'use strict';

var CFG_SOL = {
  SS_ID:         '1zVyseifVC6xeMpNjqwYd6jCq9HTJ2NS8BlN1dtM4s7Y',
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
  STATUS:            28,   // Pendente / Em análise / Aguardando Documentos / etc.
  OBS_SETOR:         29,   // Observações do setor
  MOTIVO_REPROVACAO: 30,   // Motivo de reprovação de documentos
  DRIVE_URL:         31,   // URL da pasta no Drive (alias: LINK_PASTA_DRIVE)
  DATA_APROVACAO:    32,   // Data de aprovação da solicitação
  DATA_DOC_ENVIADO:  33,   // Data em que o estudante enviou os documentos assinados
  DATA_ATIVACAO:     34,   // Data de ativação do estágio
  OBJETIVOS:         35,   // Objetivos do estágio (campo da solicitação)
  FORMANDO:          36,   // "Sim" ou "Não" — último semestre/ano letivo
  TURNO:             37,   // Turno do estudante no curso (informado na solicitação)
  SEMESTRE_SOL:      38,   // Período/Semestre atual (informado na solicitação)
  EMAIL_INST_ESTAGIO:39,   // E-mail institucional do vínculo usado neste estágio
  NOME_RESP:         40,   // Nome do responsável legal (menores de 18 anos)
  CPF_RESP:          41,   // CPF do responsável legal
  TEL_RESP:          42,   // Telefone do responsável legal
  NEE:               43,   // Portador de Necessidades Específicas — copiado do cadastro do estudante
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
  var horario        = sanitizar_(dados.diasHorarios, 500);
  var remuneracao    = sanitizar_(dados.remunerado, 5);
  var valorBolsa     = sanitizar_(dados.valorBolsa, 20);
  var valorTransp    = sanitizar_(dados.valorTransporte, 20);
  var planoAtiv      = sanitizar_(dados.planoAtividades, 2000);
  var objetivos      = sanitizar_(dados.objetivos, 2000);
  var formando       = sanitizar_(dados.formando, 50).indexOf('Sim') === 0 ? 'Sim' : 'Não';
  var docMat         = sanitizar_(dados.docMatricula, 200);
  var docId          = sanitizar_(dados.docIdentidade, 200);
  var docBol         = sanitizar_(dados.docBoletim, 200);
  // Curso e matrícula específicos deste estágio (podem diferir do curso principal do estudante)
  var cursoEstagio     = sanitizar_(dados.cursoEstagio     || dados.curso,     100) || estudante.curso;
  var matriculaEstagio = sanitizar_(dados.matriculaEstagio || dados.matricula, 20).replace(/\D/g, '') || estudante.matricula;
  // Turno e semestre: informados na solicitação (não estão mais no cadastro)
  var turno              = sanitizar_(dados.turno, 30);
  var semestreAtual      = sanitizar_(dados.semestreAtual, 30);
  // E-mail institucional do vínculo deste estágio (pode diferir do e-mail principal do cadastro)
  var emailInstEstagio   = sanitizar_(dados.emailInstEstagio || '', 100).toLowerCase() || estudante.emailInst;

  // ── Validação de idade ────────────────────────────────────────────────────
  var idadeEstudante = 99; // fallback seguro: sem restrição
  var dnEst = String(estudante.dataNasc || '').trim();
  if (dnEst) {
    var dnObj = null;
    var partesDn = dnEst.split('-');
    if (partesDn.length >= 3 && /^\d{4}$/.test(partesDn[0])) {
      // Formato ISO YYYY-MM-DD (texto puro)
      dnObj = new Date(parseInt(partesDn[0]), parseInt(partesDn[1]) - 1, parseInt(partesDn[2]));
    } else {
      // Fallback: Google Sheets converteu para Date e String() gerou formato longo
      dnObj = new Date(dnEst);
    }
    if (dnObj && !isNaN(dnObj.getTime())) {
      var hojeEst = new Date();
      idadeEstudante = hojeEst.getFullYear() - dnObj.getFullYear();
      var mEst = hojeEst.getMonth() - dnObj.getMonth();
      if (mEst < 0 || (mEst === 0 && hojeEst.getDate() < dnObj.getDate())) idadeEstudante--;
    }
  }
  if (idadeEstudante < 16) {
    return jsonError_('Estudantes com menos de 16 anos não podem realizar estágio (Lei nº 11.788/2008).', 'VALIDATION');
  }

  // ── Responsável legal (obrigatório para menores de 18 anos) ──────────────
  var nomeResp = sanitizar_(dados.nomeResponsavel || '', 200);
  var cpfResp  = sanitizar_(dados.cpfResponsavel  || '', 14).replace(/\D/g, '');
  var telResp  = sanitizar_(dados.telResponsavel  || '', 30);
  if (idadeEstudante < 18) {
    if (!nomeResp) return jsonError_('Nome do responsável legal é obrigatório para menores de 18 anos.', 'VALIDATION');
    if (!telResp)  return jsonError_('Telefone do responsável legal é obrigatório para menores de 18 anos.', 'VALIDATION');
    if (cpfResp && !validarCPF_(cpfResp)) return jsonError_('CPF do responsável legal inválido.', 'VALIDATION');
  }

  // Validações
  if (!tipoEstagio)    return jsonError_('Tipo de estágio é obrigatório.', 'VALIDATION');
  if (!nomeEmpresa)    return jsonError_('Empresa é obrigatória.', 'VALIDATION');
  if (!nomeSupervisor) return jsonError_('Supervisor é obrigatório.', 'VALIDATION');
  if (!nomeOrientador) return jsonError_('Orientador é obrigatório.', 'VALIDATION');
  if (!dataInicio)     return jsonError_('Data de início é obrigatória.', 'VALIDATION');
  if (!dataTermino)    return jsonError_('Data de término é obrigatória.', 'VALIDATION');
  if (!cargaHor)       return jsonError_('Carga horária é obrigatória.', 'VALIDATION');
  if (!objetivos || objetivos.length < 20)
    return jsonError_('Objetivos do estágio são obrigatórios (mínimo 20 caracteres).', 'VALIDATION');

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

  // Nota: a pasta no Drive é criada somente quando o setor APROVAR a solicitação
  // (api-admin.gs :: aprovarSolicitacao_ → criarPastaEstagioNova_).
  // Não criamos pasta aqui para não gerar lixo caso a solicitação seja reprovada.

  // Monta linha
  var now  = new Date();
  var ss   = SpreadsheetApp.openById(CFG_SOL.SS_ID);
  var sheet = ss.getSheetByName(CFG_SOL.ABA_SOL) || ss.getSheets()[0];

  var linha = [];
  linha[COL_SOL.TIMESTAMP]        = now;
  linha[COL_SOL.ID_ESTAGIO]       = idEstagio;
  linha[COL_SOL.EMAIL_ESTUDANTE]  = estudante.emailInst;
  linha[COL_SOL.NOME_ESTUDANTE]   = estudante.nome;
  linha[COL_SOL.MATRICULA]        = matriculaEstagio;   // matrícula do curso deste estágio
  linha[COL_SOL.CURSO]            = cursoEstagio;        // curso deste estágio
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
  linha[COL_SOL.OBJETIVOS]        = objetivos;
  linha[COL_SOL.FORMANDO]         = formando;
  linha[COL_SOL.TURNO]              = turno;
  linha[COL_SOL.SEMESTRE_SOL]       = semestreAtual;
  linha[COL_SOL.EMAIL_INST_ESTAGIO] = emailInstEstagio;
  linha[COL_SOL.NOME_RESP]          = nomeResp;
  linha[COL_SOL.CPF_RESP]           = cpfResp;
  linha[COL_SOL.TEL_RESP]           = telResp;
  linha[COL_SOL.NEE]                = estudante.nee || 'Não';
  linha[COL_SOL.LINK_DOC_MAT]       = docMat;
  linha[COL_SOL.LINK_DOC_ID]      = docId;
  linha[COL_SOL.LINK_DOC_BOL]     = docBol;
  linha[COL_SOL.STATUS]           = 'Pendente';
  linha[COL_SOL.OBS_SETOR]        = '';
  linha[COL_SOL.MOTIVO_REPROVACAO]= '';
  linha[COL_SOL.DRIVE_URL]        = '';

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
 * Verifica se o ID de estágio existe na planilha e pertence ao estudante.
 * Aceita qualquer e-mail do estudante (principal ou vínculo) via resolverEmailPrimario_.
 * Lança erro se não encontrado ou se não pertencer ao estudante.
 */
function verificarIdEstagio_(idEstagio, emailEstudante) {
  // Resolve o e-mail principal mesmo que o estudante tenha feito login com e-mail de vínculo
  var emailPrimario = resolverEmailPrimario_(emailEstudante);
  var emailToken    = emailEstudante.toLowerCase().trim();

  var ss    = SpreadsheetApp.openById(CFG_SOL.SS_ID);
  var sheet = ss.getSheetByName(CFG_SOL.ABA_SOL) || ss.getSheets()[0];
  var dados = sheet.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    var linha = dados[i];
    if (String(linha[COL_SOL.ID_ESTAGIO] || '').trim() !== idEstagio) continue;
    var emailNaSol = String(linha[COL_SOL.EMAIL_ESTUDANTE] || '').toLowerCase().trim();
    if (emailNaSol !== emailPrimario && emailNaSol !== emailToken) {
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

// ---------------------------------------------------------------------------
// GET — Listar estágios do estudante logado
// ---------------------------------------------------------------------------

/**
 * Retorna todos os estágios do estudante autenticado.
 * Rota: GET ?action=listarMeusEstagios&authToken=...
 *
 * Resposta: array de objetos com os dados resumidos do estágio.
 */
function listarMeusEstagios_(e) {
  try {
    var token     = e.parameter && e.parameter.authToken;
    var tokenInfo = validarTokenEstudante_(token);
    // Resolve e-mail principal (o estudante pode ter feito login com e-mail de vínculo)
    var email = resolverEmailPrimario_(tokenInfo.email.toLowerCase());

    var ss    = SpreadsheetApp.openById(CFG_SOL.SS_ID);
    var sheet = ss.getSheetByName(CFG_SOL.ABA_SOL);
    if (!sheet) return jsonOk_([]);

    var dados = sheet.getDataRange().getValues();
    var lista = [];

    for (var i = 1; i < dados.length; i++) {
      var r = dados[i];
      if (String(r[COL_SOL.EMAIL_ESTUDANTE] || '').trim().toLowerCase() !== email) continue;

      lista.push({
        id:               String(r[COL_SOL.ID_ESTAGIO]        || ''),
        status:           String(r[COL_SOL.STATUS]             || 'Pendente'),
        tipoEstagio:      String(r[COL_SOL.TIPO_ESTAGIO]       || ''),
        empresa:          String(r[COL_SOL.NOME_EMPRESA]       || ''),
        curso:            String(r[COL_SOL.CURSO]              || ''),
        dataInicio:       formatarData_(r[COL_SOL.DATA_INICIO]),
        dataTermino:      formatarData_(r[COL_SOL.DATA_TERMINO]),
        driveUrl:         String(r[COL_SOL.DRIVE_URL]          || ''),
        motivoReprovacao: String(r[COL_SOL.MOTIVO_REPROVACAO]  || ''),
        obsSetor:         String(r[COL_SOL.OBS_SETOR]          || ''),
      });
    }

    // Mais recente primeiro (por ID decrescente)
    lista.sort(function (a, b) { return b.id.localeCompare(a.id); });

    return jsonOk_(lista);

  } catch (err) {
    if (err instanceof ErroAutenticacao) return jsonError_(err.message, 'AUTH_ERROR');
    logErro_('listarMeusEstagios_', err);
    return jsonError_('Erro ao carregar seus estágios.', 'INTERNAL');
  }
}

// ---------------------------------------------------------------------------
// POST — Enviar documentos assinados pelo estudante
// ---------------------------------------------------------------------------

/**
 * Recebe os PDFs assinados pelo estudante (TCE + Solicitação de Ingresso)
 * em base64, salva na pasta do Drive do estágio e muda o status para
 * "Docs Enviados".
 *
 * Body: {
 *   idEstagio : string,
 *   authToken : string,
 *   arquivos  : {
 *     tce          : { nome: string, base64: string },  // obrigatório
 *     solicitacao  : { nome: string, base64: string },  // opcional p/ alguns tipos
 *   }
 * }
 */
function enviarDocumentosAssinados_(body) {
  var tokenInfo = validarTokenEstudante_(body.authToken);

  if (!checkRateLimit_('enviarDocumentosAssinados')) {
    return jsonError_('Muitas requisições. Aguarde um momento.', 'RATE_LIMIT');
  }

  var idEstagio = sanitizar_(body.idEstagio, 20).toUpperCase().trim();
  if (!idEstagio.match(/^RG\d{2}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)) {
    return jsonError_('ID do estágio inválido.', 'VALIDATION');
  }

  var arquivos = body.arquivos || {};
  var arqTce   = arquivos.tce;
  if (!arqTce || !arqTce.base64 || !arqTce.nome) {
    return jsonError_('O arquivo do TCE é obrigatório.', 'VALIDATION');
  }
  // Valida tamanho do base64 (~10 MB → ~13,6 M chars em base64)
  if (arqTce.base64.length > 14000000) {
    return jsonError_('Arquivo do TCE muito grande (máx. 10 MB).', 'VALIDATION');
  }
  if (arquivos.solicitacao && arquivos.solicitacao.base64 &&
      arquivos.solicitacao.base64.length > 14000000) {
    return jsonError_('Arquivo da Solicitação muito grande (máx. 10 MB).', 'VALIDATION');
  }

  // Localiza o registro na planilha
  var ss    = SpreadsheetApp.openById(CFG_SOL.SS_ID);
  var sheet = ss.getSheetByName(CFG_SOL.ABA_SOL);
  if (!sheet) return jsonError_('Planilha não encontrada.', 'INTERNAL');

  var dados  = sheet.getDataRange().getValues();
  var linhaIdx = -1;
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][COL_SOL.ID_ESTAGIO] || '').trim() === idEstagio &&
        String(dados[i][COL_SOL.EMAIL_ESTUDANTE] || '').trim().toLowerCase() === tokenInfo.email.toLowerCase()) {
      linhaIdx = i;
      break;
    }
  }
  if (linhaIdx === -1) {
    return jsonError_('Estágio não encontrado ou não pertence à sua conta.', 'NOT_FOUND');
  }

  var statusAtual = String(dados[linhaIdx][COL_SOL.STATUS] || '');
  if (statusAtual !== 'Aguardando Documentos') {
    return jsonError_(
      'Este estágio não está aguardando documentos (status atual: ' + statusAtual + ').',
      'INVALID_STATE'
    );
  }

  // Recupera URL da pasta do Drive
  var driveUrl = String(dados[linhaIdx][COL_SOL.DRIVE_URL] || '');
  var folder;
  try {
    var folderId = driveUrl.match(/[-\w]{25,}/);
    if (!folderId) throw new Error('URL inválida');
    folder = DriveApp.getFolderById(folderId[0]);
  } catch (e) {
    return jsonError_('Não foi possível acessar a pasta do Drive: ' + e.message, 'DRIVE_ERROR');
  }

  // Salva TCE
  try {
    var nomeTce  = sanitizarNomeArquivo_(arqTce.nome) || ('TCE_Assinado_' + idEstagio + '.pdf');
    var blobTce  = Utilities.newBlob(Utilities.base64Decode(arqTce.base64), 'application/pdf', nomeTce);
    var arqExistenteTce = folder.getFilesByName(nomeTce);
    while (arqExistenteTce.hasNext()) { arqExistenteTce.next().setTrashed(true); }
    folder.createFile(blobTce);
  } catch (e) {
    logErro_('enviarDocumentosAssinados_.saveTce', e);
    return jsonError_('Erro ao salvar TCE no Drive: ' + e.message, 'DRIVE_ERROR');
  }

  // Salva Solicitação de Ingresso (se enviada)
  if (arquivos.solicitacao && arquivos.solicitacao.base64) {
    try {
      var nomeSol  = sanitizarNomeArquivo_(arquivos.solicitacao.nome) || ('Solicitacao_Assinada_' + idEstagio + '.pdf');
      var blobSol  = Utilities.newBlob(Utilities.base64Decode(arquivos.solicitacao.base64), 'application/pdf', nomeSol);
      var arqExistenteSol = folder.getFilesByName(nomeSol);
      while (arqExistenteSol.hasNext()) { arqExistenteSol.next().setTrashed(true); }
      folder.createFile(blobSol);
    } catch (e) {
      logErro_('enviarDocumentosAssinados_.saveSol', e);
      // Não aborta — TCE já foi salvo; apenas registra
    }
  }

  // Atualiza planilha: status → "Docs Enviados", timestamp
  var rowNum = linhaIdx + 1;
  sheet.getRange(rowNum, COL_SOL.STATUS          + 1).setValue('Docs Enviados');
  sheet.getRange(rowNum, COL_SOL.DATA_DOC_ENVIADO+ 1).setValue(new Date());

  // Notifica o setor
  try {
    var nomeEstudante = String(dados[linhaIdx][COL_SOL.NOME_ESTUDANTE] || tokenInfo.email);
    enviarEmailDocsEnviados_({
      idEstagio:     idEstagio,
      nomeEstudante: nomeEstudante,
      emailEstudante:tokenInfo.email,
    });
  } catch (e) { logErro_('enviarDocumentosAssinados_.mail', e); }

  return jsonOk_({ mensagem: 'Documentos enviados com sucesso! O setor irá verificar e encaminhará ao Diretor Geral.' });
}

// ---------------------------------------------------------------------------
// POST — Enviar documento assinado pelo Diretor Geral
// ---------------------------------------------------------------------------

/**
 * Recebe o PDF assinado pelo DG em base64, salva na pasta do Drive do
 * estágio e muda o status para "Aguardando Validação Final".
 *
 * Body: {
 *   idEstagio : string,
 *   authToken : string,
 *   arquivo   : { nome: string, base64: string }
 * }
 */
function enviarDocumentoDG_(body) {
  // DG usa e-mail @riogrande.ifrs.edu.br (servidor)
  var tokenInfo;
  try {
    tokenInfo = validarTokenServidor_(body.authToken);
  } catch (e) {
    return jsonError_(e.message, 'AUTH_ERROR');
  }

  if (!checkRateLimit_('enviarDocumentoDG')) {
    return jsonError_('Muitas requisições. Aguarde um momento.', 'RATE_LIMIT');
  }

  var idEstagio = sanitizar_(body.idEstagio, 20).toUpperCase().trim();
  if (!idEstagio.match(/^RG\d{2}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)) {
    return jsonError_('ID do estágio inválido.', 'VALIDATION');
  }

  var arquivo = body.arquivo;
  if (!arquivo || !arquivo.base64 || !arquivo.nome) {
    return jsonError_('Arquivo PDF é obrigatório.', 'VALIDATION');
  }
  if (arquivo.base64.length > 14000000) {
    return jsonError_('Arquivo muito grande (máx. 10 MB).', 'VALIDATION');
  }

  // Localiza o registro
  var ss    = SpreadsheetApp.openById(CFG_SOL.SS_ID);
  var sheet = ss.getSheetByName(CFG_SOL.ABA_SOL);
  if (!sheet) return jsonError_('Planilha não encontrada.', 'INTERNAL');

  var dados    = sheet.getDataRange().getValues();
  var linhaIdx = -1;
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][COL_SOL.ID_ESTAGIO] || '').trim() === idEstagio) {
      linhaIdx = i;
      break;
    }
  }
  if (linhaIdx === -1) {
    return jsonError_('Estágio não encontrado: ' + idEstagio, 'NOT_FOUND');
  }

  var statusAtual = String(dados[linhaIdx][COL_SOL.STATUS] || '');
  if (statusAtual !== 'Aguardando DG') {
    return jsonError_(
      'Este estágio não está aguardando assinatura do DG (status atual: ' + statusAtual + ').',
      'INVALID_STATE'
    );
  }

  // Acessa a pasta do Drive
  var driveUrl = String(dados[linhaIdx][COL_SOL.DRIVE_URL] || '');
  var folder;
  try {
    var folderId = driveUrl.match(/[-\w]{25,}/);
    if (!folderId) throw new Error('URL da pasta inválida');
    folder = DriveApp.getFolderById(folderId[0]);
  } catch (e) {
    return jsonError_('Não foi possível acessar a pasta do Drive: ' + e.message, 'DRIVE_ERROR');
  }

  // Salva o PDF assinado pelo DG
  try {
    var nomeArq   = sanitizarNomeArquivo_(arquivo.nome) || ('TCE_Assinado_DG_' + idEstagio + '.pdf');
    var blob      = Utilities.newBlob(Utilities.base64Decode(arquivo.base64), 'application/pdf', nomeArq);
    var existentes = folder.getFilesByName(nomeArq);
    while (existentes.hasNext()) { existentes.next().setTrashed(true); }
    folder.createFile(blob);
  } catch (e) {
    logErro_('enviarDocumentoDG_.savePdf', e);
    return jsonError_('Erro ao salvar arquivo no Drive: ' + e.message, 'DRIVE_ERROR');
  }

  // Atualiza status → "Aguardando Validação Final"
  var rowNum = linhaIdx + 1;
  sheet.getRange(rowNum, COL_SOL.STATUS + 1).setValue('Aguardando Validação Final');

  // Notifica o setor
  try {
    var nomeEstudante = String(dados[linhaIdx][COL_SOL.NOME_ESTUDANTE] || '');
    enviarEmailDocDGRecebido_({
      idEstagio:      idEstagio,
      nomeEstudante:  nomeEstudante,
      nomeRemetente:  tokenInfo.name || tokenInfo.email,
    });
  } catch (e) { logErro_('enviarDocumentoDG_.mail', e); }

  return jsonOk_({ mensagem: 'Documento enviado com sucesso! O setor irá verificar e ativar o estágio.' });
}

// ---------------------------------------------------------------------------
// Helpers locais
// ---------------------------------------------------------------------------

/**
 * Sanitiza nome de arquivo: remove caracteres inválidos para Drive/SO.
 */
function sanitizarNomeArquivo_(nome) {
  if (!nome || typeof nome !== 'string') return '';
  return nome.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 200);
}

/**
 * Envia e-mail ao setor quando o estudante envia os documentos assinados.
 */
function enviarEmailDocsEnviados_(dados) {
  var adminEmails = ['estagios@riogrande.ifrs.edu.br'];
  var assunto     = '[SGE] Documentos enviados — ' + dados.idEstagio;
  var corpo       = 'O estudante ' + dados.nomeEstudante + ' (' + dados.emailEstudante + ') ' +
                    'enviou os documentos assinados do estágio ' + dados.idEstagio + '.\n\n' +
                    'Acesse o painel administrativo para verificar e encaminhar ao Diretor Geral.';
  MailApp.sendEmail({ to: adminEmails.join(','), subject: assunto, body: corpo });
}

/**
 * Envia e-mail ao setor quando o DG envia o documento assinado.
 */
function enviarEmailDocDGRecebido_(dados) {
  var adminEmails = ['estagios@riogrande.ifrs.edu.br'];
  var assunto     = '[SGE] Documento DG recebido — ' + dados.idEstagio;
  var corpo       = 'O Diretor Geral ' + dados.nomeRemetente + ' enviou o documento assinado ' +
                    'do estágio ' + dados.idEstagio + ' (' + dados.nomeEstudante + ').\n\n' +
                    'Acesse o painel administrativo para realizar a validação final e ativar o estágio.';
  MailApp.sendEmail({ to: adminEmails.join(','), subject: assunto, body: corpo });
}
