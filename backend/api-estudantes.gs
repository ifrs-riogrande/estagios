/**
 * api-estudantes.gs — Web App: Cadastro de Estudantes
 * SGE — Sistema de Gestão de Estágios · IFRS Campus Rio Grande
 *
 * Rotas POST:
 *   cadastrarEstudante   — Registra novo estudante
 *   gerarCodigoAcesso    — Gera código temporário para acesso ao formulário de solicitação
 *
 * Planilha de Estudantes ID: 10ykZIYr_jpskxfAAl_wDW6e2MwaSTeIxO_a-9lwK1hY
 */

'use strict';

var CFG_EST = {
  SS_ID: '10ykZIYr_jpskxfAAl_wDW6e2MwaSTeIxO_a-9lwK1hY',
};

/**
 * Mapa de colunas da planilha de Estudantes (base 0).
 * Compatível com o Google Form original.
 */
var COL_EST = {
  TIMESTAMP:       0,
  NOME:            1,
  EMAIL_INST:      2,
  EMAIL_PESSOAL:   3,
  MATRICULA:       4,
  CURSO:           5,
  TURNO:           6,
  SEMESTRE:        7,
  CPF:             8,
  DATA_NASC:       9,
  TELEFONE:        10,
  ENDERECO:        11,
  MAIOR_IDADE:     12,
  NOME_RESP:       13,
  CPF_RESP:        14,
  TEL_RESP:        15,
  EMAIL_RESP:      16,
  DOC_RESP:        17,   // link/nome arquivo
  STATUS:          18,   // 'Cadastrado' | 'Inativo'
  COD_ACESSO:      19,   // código gerado para solicitação
  COD_EXPIRA:      20,   // timestamp de expiração
};

// ---------------------------------------------------------------------------
// Roteamento
// ---------------------------------------------------------------------------

function doGet(e) {
  // Não há rotas GET públicas para estudantes
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
      case 'cadastrarEstudante':  return cadastrarEstudante_(dados);
      case 'gerarCodigoAcesso':  return gerarCodigoAcesso_(dados);
      default:
        return jsonError_('Ação não reconhecida.', 'UNKNOWN_ACTION');
    }
  } catch (err) {
    logErro_('api-estudantes.doPost[' + (dados && dados.action) + ']', err);
    if (err instanceof ErroAutenticacao) return jsonError_(err.message, 'AUTH_ERROR');
    return jsonError_('Erro interno ao processar a requisição.', 'INTERNAL');
  }
}

// ---------------------------------------------------------------------------
// POST — Cadastrar estudante
// ---------------------------------------------------------------------------

function cadastrarEstudante_(dados) {
  // Autenticação — apenas estudantes IFRS
  var tokenInfo = validarTokenEstudante_(dados.authToken);

  if (!checkRateLimit_('cadastrarEstudante')) {
    return jsonError_('Muitas requisições. Aguarde um momento.', 'RATE_LIMIT');
  }

  // Sanitização
  var nome         = sanitizar_(dados.nomeCompleto, 200);
  var emailInst    = sanitizar_(tokenInfo.email, 100).toLowerCase();
  var emailPes     = sanitizar_(dados.emailPessoal, 100).toLowerCase();
  var matricula    = sanitizar_(dados.matricula, 20).replace(/\D/g, '');
  var curso        = sanitizar_(dados.curso, 100);
  var turno        = sanitizar_(dados.turno, 30);
  var semestre     = sanitizar_(dados.semestre, 10);
  var cpf          = sanitizar_(dados.cpf, 14).replace(/\D/g, '');
  var dataNasc     = sanitizar_(dados.dataNascimento, 10);
  var telefone     = sanitizar_(dados.telefone, 30);
  var endereco     = sanitizar_(dados.endereco, 300);
  var maiorIdade   = sanitizar_(dados.maiorIdade, 3);
  var nomeResp     = sanitizar_(dados.nomeResponsavel, 200);
  var cpfResp      = sanitizar_(dados.cpfResponsavel, 14).replace(/\D/g, '');
  var telResp      = sanitizar_(dados.telResponsavel, 30);
  var emailResp    = sanitizar_(dados.emailResponsavel, 100).toLowerCase();
  var docResp      = sanitizar_(dados.docResponsavel, 300);

  // Validações obrigatórias
  if (!nome)       return jsonError_('Nome completo é obrigatório.', 'VALIDATION');
  if (!matricula)  return jsonError_('Matrícula é obrigatória.', 'VALIDATION');
  if (!curso)      return jsonError_('Curso é obrigatório.', 'VALIDATION');
  if (!validarCPF_(cpf)) return jsonError_('CPF inválido.', 'VALIDATION');
  if (!dataNasc)   return jsonError_('Data de nascimento é obrigatória.', 'VALIDATION');
  if (!telefone)   return jsonError_('Telefone é obrigatório.', 'VALIDATION');
  if (emailPes && !validarEmail_(emailPes)) return jsonError_('E-mail pessoal inválido.', 'VALIDATION');

  // Menor de idade — responsável obrigatório
  if (maiorIdade === 'Não') {
    if (!nomeResp) return jsonError_('Nome do responsável legal é obrigatório para menores.', 'VALIDATION');
    if (cpfResp && !validarCPF_(cpfResp)) return jsonError_('CPF do responsável inválido.', 'VALIDATION');
  }

  var sheet = abrirAba_(CFG_EST.SS_ID);

  // Verifica duplicidade por CPF ou matrícula
  var idxCPF = buscarNaColuna_(sheet, COL_EST.CPF, cpf);
  if (idxCPF !== -1) {
    return jsonError_('Já existe um estudante cadastrado com este CPF.', 'DUPLICATE');
  }
  var idxMat = buscarNaColuna_(sheet, COL_EST.MATRICULA, matricula);
  if (idxMat !== -1) {
    return jsonError_('Já existe um estudante cadastrado com esta matrícula.', 'DUPLICATE');
  }

  var now  = new Date();
  var linha = [];
  linha[COL_EST.TIMESTAMP]     = now;
  linha[COL_EST.NOME]          = nome;
  linha[COL_EST.EMAIL_INST]    = emailInst;
  linha[COL_EST.EMAIL_PESSOAL] = emailPes;
  linha[COL_EST.MATRICULA]     = matricula;
  linha[COL_EST.CURSO]         = curso;
  linha[COL_EST.TURNO]         = turno;
  linha[COL_EST.SEMESTRE]      = semestre;
  linha[COL_EST.CPF]           = cpf;
  linha[COL_EST.DATA_NASC]     = dataNasc;
  linha[COL_EST.TELEFONE]      = telefone;
  linha[COL_EST.ENDERECO]      = endereco;
  linha[COL_EST.MAIOR_IDADE]   = maiorIdade;
  linha[COL_EST.NOME_RESP]     = nomeResp;
  linha[COL_EST.CPF_RESP]      = cpfResp;
  linha[COL_EST.TEL_RESP]      = telResp;
  linha[COL_EST.EMAIL_RESP]    = emailResp;
  linha[COL_EST.DOC_RESP]      = docResp;
  linha[COL_EST.STATUS]        = 'Cadastrado';
  linha[COL_EST.COD_ACESSO]    = '';
  linha[COL_EST.COD_EXPIRA]    = '';

  sheet.appendRow(linha);

  return jsonOk_({ mensagem: 'Cadastro realizado com sucesso!' });
}

// ---------------------------------------------------------------------------
// POST — Gerar código de acesso para solicitação de estágio
// ---------------------------------------------------------------------------

/**
 * Gera um código numérico de 6 dígitos válido por 30 minutos.
 * O estudante usa este código no formulário de solicitação para
 * identificar sua matrícula/curso sem expor dados sensíveis.
 */
function gerarCodigoAcesso_(dados) {
  var tokenInfo = validarTokenEstudante_(dados.authToken);

  if (!checkRateLimit_('gerarCodigoAcesso', 5)) {
    return jsonError_('Limite de geração de códigos atingido. Tente em alguns minutos.', 'RATE_LIMIT');
  }

  var sheet = abrirAba_(CFG_EST.SS_ID);
  var dadosPlan = sheet.getDataRange().getValues();

  // Localiza o estudante pelo e-mail
  var linhaIdx = -1;
  for (var i = 1; i < dadosPlan.length; i++) {
    if (String(dadosPlan[i][COL_EST.EMAIL_INST] || '').toLowerCase().trim() === tokenInfo.email) {
      linhaIdx = i;
      break;
    }
  }

  if (linhaIdx === -1) {
    return jsonError_('Estudante não encontrado. Realize o cadastro primeiro.', 'NOT_FOUND');
  }

  // Gera código e expira em 30 minutos
  var codigo   = String(Math.floor(100000 + Math.random() * 900000));
  var expira   = new Date(Date.now() + 30 * 60 * 1000);
  var rowSheet = linhaIdx + 1; // base-1

  sheet.getRange(rowSheet, COL_EST.COD_ACESSO + 1).setValue(codigo);
  sheet.getRange(rowSheet, COL_EST.COD_EXPIRA + 1).setValue(expira);

  // Retorna dados do estudante junto com o código (usados no formulário de solicitação)
  var est = dadosPlan[linhaIdx];
  return jsonOk_({
    codigo:    codigo,
    expira:    expira.toISOString(),
    estudante: {
      nome:      String(est[COL_EST.NOME]      || ''),
      matricula: String(est[COL_EST.MATRICULA]  || ''),
      curso:     String(est[COL_EST.CURSO]      || ''),
      cpf:       String(est[COL_EST.CPF]        || ''),
      telefone:  String(est[COL_EST.TELEFONE]   || ''),
    },
  });
}

// ---------------------------------------------------------------------------
// Função auxiliar: validar código de acesso (chamada por api-solicitacao.gs)
// ---------------------------------------------------------------------------

/**
 * Valida um código de acesso e retorna os dados do estudante.
 * @param {string} emailEstudante
 * @param {string} codigo
 * @returns {{ nome, matricula, curso, cpf, telefone, emailPessoal }}
 */
function validarCodigoAcesso_(emailEstudante, codigo) {
  var sheet = abrirAba_(CFG_EST.SS_ID);
  var dados = sheet.getDataRange().getValues();
  var agora = new Date();

  for (var i = 1; i < dados.length; i++) {
    var linha = dados[i];
    if (String(linha[COL_EST.EMAIL_INST] || '').toLowerCase().trim() !== emailEstudante.toLowerCase().trim()) continue;

    var codPlan = String(linha[COL_EST.COD_ACESSO] || '').trim();
    if (codPlan !== String(codigo || '').trim()) {
      throw new Error('Código de acesso inválido.');
    }

    var expira = linha[COL_EST.COD_EXPIRA];
    if (!expira) throw new Error('Código de acesso expirado ou não gerado.');
    var dtExpira = expira instanceof Date ? expira : new Date(expira);
    if (dtExpira < agora) throw new Error('Código de acesso expirado. Gere um novo.');

    // Invalida o código após uso
    var rowSheet = i + 1;
    sheet.getRange(rowSheet, COL_EST.COD_ACESSO + 1).setValue('');
    sheet.getRange(rowSheet, COL_EST.COD_EXPIRA + 1).setValue('');

    return {
      nome:         String(linha[COL_EST.NOME]         || ''),
      matricula:    String(linha[COL_EST.MATRICULA]     || ''),
      curso:        String(linha[COL_EST.CURSO]         || ''),
      cpf:          String(linha[COL_EST.CPF]           || ''),
      telefone:     String(linha[COL_EST.TELEFONE]      || ''),
      emailPessoal: String(linha[COL_EST.EMAIL_PESSOAL] || ''),
      emailInst:    String(linha[COL_EST.EMAIL_INST]    || ''),
      dataNasc:     String(linha[COL_EST.DATA_NASC]     || ''),
      endereco:     String(linha[COL_EST.ENDERECO]      || ''),
    };
  }

  throw new Error('Estudante não encontrado para o e-mail informado.');
}
