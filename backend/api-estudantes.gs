/**
 * api-estudantes.gs — Operações de estudantes
 * SGE — Sistema de Gestão de Estágios · IFRS Campus Rio Grande
 *
 * Rotas POST (via Code.gs):
 *   cadastrarEstudante   — Registra novo estudante (status: Aguardando Validação)
 *   obterMeuCadastro     — Retorna dados cadastrais (requer login + código permanente)
 *
 * Rotas POST — Admin (via Code.gs → doPostAdmin):
 *   validarCadastroAdmin — Valida cadastro, gera código permanente e envia e-mail
 *   reenviarCodigoAdmin  — Reenvia e-mail com código existente
 *
 * Planilha consolidada SGE:
 *   ID: 1zVyseifVC6xeMpNjqwYd6jCq9HTJ2NS8BlN1dtM4s7Y
 */

'use strict';

var CFG_EST = {
  SS_ID: '1zVyseifVC6xeMpNjqwYd6jCq9HTJ2NS8BlN1dtM4s7Y',
  ABA:   'Estudantes',
  URL_SISTEMA: 'https://ifrs-riogrande.github.io/estagios/estudantes/',
};

/**
 * Mapa de colunas da planilha de Estudantes (base 0).
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
  DOC_RESP:        17,
  STATUS:          18,   // 'Aguardando Validação' | 'Ativo' | 'Inativo'
  COD_ACESSO:      19,   // código permanente SGE-XXXX-XXXX-XXXX (gerado pelo setor)
  COD_EXPIRA:      20,   // não utilizado (mantido para compatibilidade de coluna)
  MODALIDADE:      21,
  BAIRRO:          22,
  CEP:             23,
  CIDADE:          24,
  UF:              25,
};

// ---------------------------------------------------------------------------
// Roteamento legado (mantido para compatibilidade; roteamento real é Code.gs)
// ---------------------------------------------------------------------------

function doGet(e) {
  return jsonError_('Método não suportado diretamente.', 'METHOD_NOT_ALLOWED');
}

function doPost(e) {
  return jsonError_('Método não suportado diretamente.', 'METHOD_NOT_ALLOWED');
}

// ---------------------------------------------------------------------------
// POST — Cadastrar estudante
// ---------------------------------------------------------------------------

function cadastrarEstudante_(dados) {
  var tokenInfo = validarTokenEstudante_(dados.authToken);

  if (!checkRateLimit_('cadastrarEstudante')) {
    return jsonError_('Muitas requisições. Aguarde um momento.', 'RATE_LIMIT');
  }

  // Sanitização
  var nome       = sanitizar_(dados.nome || dados.nomeCompleto, 200);
  var emailInst  = sanitizar_(tokenInfo.email, 100).toLowerCase();
  var emailPes   = sanitizar_(dados.emailPessoal, 100).toLowerCase();
  var matricula  = sanitizar_(dados.matricula, 20).replace(/\D/g, '');
  var curso      = sanitizar_(dados.curso, 100);
  var turno      = sanitizar_(dados.turno, 30);
  var semestre   = sanitizar_(dados.semestre, 10);
  var modalidade = sanitizar_(dados.modalidade, 50);
  var cpf        = sanitizar_(dados.cpf, 14).replace(/\D/g, '');
  var dataNasc   = sanitizar_(dados.dataNascimento, 10);
  var telefone   = sanitizar_(dados.telefone, 30);
  var endereco   = sanitizar_(dados.endereco, 300);
  var bairro     = sanitizar_(dados.bairro, 100);
  var cep        = sanitizar_(dados.cep, 9);
  var cidade     = sanitizar_(dados.cidade, 100);
  var uf         = sanitizar_(dados.uf, 2);
  var maiorIdade = sanitizar_(dados.maiorIdade, 3);
  var nomeResp   = sanitizar_(dados.nomeResponsavel, 200);
  var cpfResp    = sanitizar_(dados.cpfResponsavel, 14).replace(/\D/g, '');
  var telResp    = sanitizar_(dados.telResponsavel, 30);
  var emailResp  = sanitizar_(dados.emailResponsavel, 100).toLowerCase();
  var docResp    = sanitizar_(dados.docResponsavel, 300);

  // Validações obrigatórias
  if (!nome)       return jsonError_('Nome completo é obrigatório.', 'VALIDATION');
  if (!matricula)  return jsonError_('Matrícula é obrigatória.', 'VALIDATION');
  if (!curso)      return jsonError_('Curso é obrigatório.', 'VALIDATION');
  if (!turno)      return jsonError_('Turno é obrigatório.', 'VALIDATION');
  if (!modalidade) return jsonError_('Modalidade é obrigatória.', 'VALIDATION');
  if (!semestre)   return jsonError_('Período/Semestre é obrigatório.', 'VALIDATION');
  if (!validarCPF_(cpf)) return jsonError_('CPF inválido.', 'VALIDATION');
  if (!dataNasc)   return jsonError_('Data de nascimento é obrigatória.', 'VALIDATION');
  if (!telefone)   return jsonError_('Telefone é obrigatório.', 'VALIDATION');
  if (emailPes && !validarEmail_(emailPes)) return jsonError_('E-mail pessoal inválido.', 'VALIDATION');

  // Menor de idade — responsável obrigatório
  if (maiorIdade === 'Não') {
    if (!nomeResp) return jsonError_('Nome do responsável legal é obrigatório para menores.', 'VALIDATION');
    if (cpfResp && !validarCPF_(cpfResp)) return jsonError_('CPF do responsável inválido.', 'VALIDATION');
  }

  var sheet = abrirAba_(CFG_EST.SS_ID, CFG_EST.ABA);

  // Verifica duplicidade por CPF ou matrícula
  if (buscarNaColuna_(sheet, COL_EST.CPF, cpf) !== -1) {
    return jsonError_('Já existe um estudante cadastrado com este CPF.', 'DUPLICATE');
  }
  if (buscarNaColuna_(sheet, COL_EST.MATRICULA, matricula) !== -1) {
    return jsonError_('Já existe um estudante cadastrado com esta matrícula.', 'DUPLICATE');
  }

  var now   = new Date();
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
  linha[COL_EST.BAIRRO]        = bairro;
  linha[COL_EST.CEP]           = cep;
  linha[COL_EST.CIDADE]        = cidade;
  linha[COL_EST.UF]            = uf;
  linha[COL_EST.MAIOR_IDADE]   = maiorIdade;
  linha[COL_EST.NOME_RESP]     = nomeResp;
  linha[COL_EST.CPF_RESP]      = cpfResp;
  linha[COL_EST.TEL_RESP]      = telResp;
  linha[COL_EST.EMAIL_RESP]    = emailResp;
  linha[COL_EST.DOC_RESP]      = docResp;
  linha[COL_EST.MODALIDADE]    = modalidade;
  linha[COL_EST.STATUS]        = 'Aguardando Validação';  // setor valida antes de liberar
  linha[COL_EST.COD_ACESSO]    = '';
  linha[COL_EST.COD_EXPIRA]    = '';

  sheet.appendRow(linha);

  // Notifica o setor sobre novo cadastro pendente
  try {
    MailApp.sendEmail({
      to:      'estagios@riogrande.ifrs.edu.br',
      subject: '[SGE IFRS] Novo cadastro aguardando validação — ' + nome,
      body: [
        'Um novo estudante realizou cadastro no SGE e aguarda validação.',
        '',
        'Nome: '       + nome,
        'Matrícula: '  + matricula,
        'Curso: '      + curso,
        'E-mail: '     + emailInst,
        '',
        'Acesse o painel administrativo para validar o cadastro e enviar o código de acesso.',
        '',
        'Setor de Estágios — IFRS Campus Rio Grande',
      ].join('\n'),
    });
  } catch (e) { /* notificação não bloqueia o cadastro */ }

  return jsonOk_({ mensagem: 'Cadastro realizado com sucesso! Aguarde a validação do setor para receber seu código de acesso por e-mail.' });
}

// ---------------------------------------------------------------------------
// POST Admin — Validar cadastro e enviar código permanente
// ---------------------------------------------------------------------------

/**
 * Chamado pelo admin. Gera código permanente SGE-XXXX-XXXX-XXXX,
 * salva na planilha, muda status para 'Ativo' e envia e-mail ao aluno.
 */
function validarCadastroAdmin_(body) {
  var emailBusca = sanitizar_(body.emailEstudante || '', 100).toLowerCase().trim();
  if (!emailBusca) return jsonError_('E-mail do estudante é obrigatório.', 'VALIDATION');

  var sheet = abrirAba_(CFG_EST.SS_ID, CFG_EST.ABA);
  var dados = sheet.getDataRange().getValues();

  var linhaIdx = -1;
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][COL_EST.EMAIL_INST] || '').toLowerCase().trim() === emailBusca) {
      linhaIdx = i;
      break;
    }
  }

  if (linhaIdx === -1) {
    return jsonError_('Estudante não encontrado para o e-mail informado.', 'NOT_FOUND');
  }

  var statusAtual = String(dados[linhaIdx][COL_EST.STATUS] || '').trim();
  if (statusAtual === 'Ativo') {
    return jsonError_('Este cadastro já foi validado anteriormente.', 'ALREADY_VALIDATED');
  }

  // Gera código permanente
  var codigo   = gerarCodigoPermanente_();
  var rowSheet = linhaIdx + 1;

  sheet.getRange(rowSheet, COL_EST.COD_ACESSO + 1).setValue(codigo);
  sheet.getRange(rowSheet, COL_EST.COD_EXPIRA + 1).setValue('');  // não usa expiração
  sheet.getRange(rowSheet, COL_EST.STATUS + 1).setValue('Ativo');

  var nome = String(dados[linhaIdx][COL_EST.NOME] || 'Estudante');

  // Envia e-mail ao aluno com o código
  enviarEmailCodigoAcesso_(emailBusca, nome, codigo);

  return jsonOk_({ mensagem: 'Cadastro validado. Código de acesso enviado para ' + emailBusca + '.' });
}

// ---------------------------------------------------------------------------
// POST Admin — Reenviar código existente
// ---------------------------------------------------------------------------

/**
 * Reenvia o e-mail com o código de acesso já gerado.
 * Usado quando o aluno perde o código.
 */
function reenviarCodigoAdmin_(body) {
  var emailBusca = sanitizar_(body.emailEstudante || '', 100).toLowerCase().trim();
  if (!emailBusca) return jsonError_('E-mail do estudante é obrigatório.', 'VALIDATION');

  var sheet = abrirAba_(CFG_EST.SS_ID, CFG_EST.ABA);
  var dados = sheet.getDataRange().getValues();

  var linhaIdx = -1;
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][COL_EST.EMAIL_INST] || '').toLowerCase().trim() === emailBusca) {
      linhaIdx = i;
      break;
    }
  }

  if (linhaIdx === -1) {
    return jsonError_('Estudante não encontrado para o e-mail informado.', 'NOT_FOUND');
  }

  var codigo = String(dados[linhaIdx][COL_EST.COD_ACESSO] || '').trim();
  if (!codigo) {
    return jsonError_('Este estudante ainda não possui código de acesso. Use "Validar Cadastro" primeiro.', 'NO_CODE');
  }

  var nome = String(dados[linhaIdx][COL_EST.NOME] || 'Estudante');
  enviarEmailCodigoAcesso_(emailBusca, nome, codigo);

  return jsonOk_({ mensagem: 'Código de acesso reenviado para ' + emailBusca + '.' });
}

// ---------------------------------------------------------------------------
// GET — Obter dados do próprio cadastro (aluno logado + código)
// ---------------------------------------------------------------------------

/**
 * Retorna os dados cadastrais do estudante autenticado.
 * Requer: authToken (Google) + codigoAcesso permanente.
 */
function obterMeuCadastro_(e) {
  var params = e.parameter || {};
  var tokenInfo;
  try {
    tokenInfo = validarTokenEstudante_(params.authToken);
  } catch (err) {
    return jsonError_(err.message, 'AUTH_ERROR');
  }

  var codigo = sanitizar_(params.codigoAcesso || '', 20).trim().toUpperCase();
  if (!codigo) return jsonError_('Código de acesso é obrigatório.', 'VALIDATION');

  try {
    var est = buscarEstudantePorEmailECodigo_(tokenInfo.email, codigo);
    return jsonOk_(est);
  } catch (err) {
    return jsonError_(err.message, 'AUTH_ERROR');
  }
}

// ---------------------------------------------------------------------------
// Função auxiliar: validar código de acesso (chamada por api-solicitacao.gs)
// ---------------------------------------------------------------------------

/**
 * Valida código permanente e retorna dados do estudante.
 * Não invalida o código após uso (permanente).
 *
 * @param {string} emailEstudante
 * @param {string} codigo
 * @returns {{ nome, matricula, curso, cpf, telefone, emailPessoal, emailInst, dataNasc, endereco }}
 */
function validarCodigoAcesso_(emailEstudante, codigo) {
  return buscarEstudantePorEmailECodigo_(emailEstudante, codigo);
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * Localiza estudante por e-mail + código, valida status Ativo.
 */
function buscarEstudantePorEmailECodigo_(emailEstudante, codigo) {
  var sheet = abrirAba_(CFG_EST.SS_ID, CFG_EST.ABA);
  var dados = sheet.getDataRange().getValues();
  var emailNorm = String(emailEstudante || '').toLowerCase().trim();
  var codigoNorm = String(codigo || '').trim().toUpperCase();

  for (var i = 1; i < dados.length; i++) {
    var linha = dados[i];
    if (String(linha[COL_EST.EMAIL_INST] || '').toLowerCase().trim() !== emailNorm) continue;

    // Estudante encontrado pelo e-mail
    var statusEst = String(linha[COL_EST.STATUS] || '').trim();
    if (statusEst !== 'Ativo') {
      throw new Error('Cadastro ainda não validado pelo setor. Aguarde o e-mail com seu código de acesso.');
    }

    var codPlan = String(linha[COL_EST.COD_ACESSO] || '').trim().toUpperCase();
    if (!codPlan) {
      throw new Error('Nenhum código de acesso registrado. Entre em contato com o setor.');
    }
    if (codPlan !== codigoNorm) {
      throw new Error('Código de acesso inválido.');
    }

    return {
      nome:         String(linha[COL_EST.NOME]         || ''),
      matricula:    String(linha[COL_EST.MATRICULA]     || ''),
      curso:        String(linha[COL_EST.CURSO]         || ''),
      turno:        String(linha[COL_EST.TURNO]         || ''),
      semestre:     String(linha[COL_EST.SEMESTRE]      || ''),
      modalidade:   String(linha[COL_EST.MODALIDADE]    || ''),
      cpf:          String(linha[COL_EST.CPF]           || ''),
      dataNasc:     String(linha[COL_EST.DATA_NASC]     || ''),
      telefone:     String(linha[COL_EST.TELEFONE]      || ''),
      emailInst:    String(linha[COL_EST.EMAIL_INST]    || ''),
      emailPessoal: String(linha[COL_EST.EMAIL_PESSOAL] || ''),
      endereco:     String(linha[COL_EST.ENDERECO]      || ''),
      bairro:       String(linha[COL_EST.BAIRRO]        || ''),
      cep:          String(linha[COL_EST.CEP]           || ''),
      cidade:       String(linha[COL_EST.CIDADE]        || ''),
      uf:           String(linha[COL_EST.UF]            || ''),
      maiorIdade:   String(linha[COL_EST.MAIOR_IDADE]   || ''),
      nomeResp:     String(linha[COL_EST.NOME_RESP]     || ''),
      status:       statusEst,
    };
  }

  throw new Error('Estudante não encontrado para o e-mail informado.');
}

/**
 * Gera código permanente no formato SGE-XXXX-XXXX-XXXX.
 * Ex.: SGE-A3BX-9K2F-7QWR
 */
function gerarCodigoPermanente_() {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  function bloco4() {
    var s = '';
    for (var i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }
  return 'SGE-' + bloco4() + '-' + bloco4() + '-' + bloco4();
}

/**
 * Envia e-mail ao estudante com o código de acesso permanente.
 */
function enviarEmailCodigoAcesso_(emailDest, nome, codigo) {
  MailApp.sendEmail({
    to:      emailDest,
    subject: '[SGE IFRS] Cadastro validado — seu código de acesso',
    body: [
      'Prezado(a) ' + nome + ',',
      '',
      'Seu cadastro no Sistema de Gestão de Estágios (SGE) do IFRS Campus Rio Grande foi validado pelo setor de estágios.',
      '',
      'Seu código de acesso permanente é:',
      '',
      '  ' + codigo,
      '',
      'Guarde este código com segurança. Você precisará dele para:',
      '  • Solicitar estágio',
      '  • Acessar e visualizar seus dados cadastrais',
      '',
      'Este código é pessoal e intransferível.',
      'Em caso de perda, entre em contato com o setor de estágios.',
      '',
      'Acesse o sistema: ' + CFG_EST.URL_SISTEMA,
      '',
      'Setor de Estágios — IFRS Campus Rio Grande',
      'estagios@riogrande.ifrs.edu.br',
    ].join('\n'),
  });
}
