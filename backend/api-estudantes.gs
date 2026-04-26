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
  MATRICULA:       4,   // matrícula do primeiro curso (compatibilidade)
  CURSO:           5,   // nome do primeiro curso (compatibilidade)
  TURNO:           6,   // não preenchido no cadastro (fica na solicitação)
  SEMESTRE:        7,   // não preenchido no cadastro (fica na solicitação)
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
  MODALIDADE:      21,   // modalidade do primeiro curso (compatibilidade)
  BAIRRO:          22,
  CEP:             23,
  CIDADE:          24,
  UF:              25,
  CURSOS_JSON:     26,   // JSON array [{emailInst, curso, matricula}] — todos os cursos do aluno
  NEE:             27,   // Portador de Necessidades Específicas: "Sim" ou "Não"
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

  // Sanitização de dados pessoais
  var nome       = sanitizar_(dados.nome || dados.nomeCompleto, 200);
  var emailInst  = sanitizar_(tokenInfo.email, 100).toLowerCase();
  var emailPes   = sanitizar_(dados.emailPessoal, 100).toLowerCase();
  var cpf        = sanitizar_(dados.cpf, 14).replace(/\D/g, '');
  var dataNasc   = sanitizar_(dados.dataNascimento, 10);
  var telefone   = sanitizar_(dados.telefone, 30);
  var endereco   = sanitizar_(dados.endereco, 300);
  var bairro     = sanitizar_(dados.bairro, 100);
  var cep        = sanitizar_(dados.cep, 9);
  var cidade     = sanitizar_(dados.cidade, 100);
  var uf         = sanitizar_(dados.uf, 2);
  var dnStr = sanitizar_(dados.dataNascimento, 10);
  var nee        = sanitizar_(dados.nee, 5).indexOf('Sim') === 0 ? 'Sim' : 'Não';
  var maiorIdade = 'Sim';
  if (dnStr) {
    var dn = new Date(dnStr + 'T00:00:00');
    var hoje2 = new Date();
    var age = hoje2.getFullYear() - dn.getFullYear();
    var m2 = hoje2.getMonth() - dn.getMonth();
    if (m2 < 0 || (m2 === 0 && hoje2.getDate() < dn.getDate())) age--;
    if (age < 18) maiorIdade = 'Não';
  }
  // ── Cursos (array [{emailInst, curso, matricula}]) ───────────────────────
  var cursos = [];
  var cursosInput = dados.cursos;
  if (cursosInput && typeof cursosInput === 'object') {
    // Garante que é um array iterável mesmo se GAS serializar de forma diferente
    var cursosArr = Array.isArray(cursosInput) ? cursosInput : Object.values(cursosInput);
    for (var ci = 0; ci < cursosArr.length && cursos.length < 6; ci++) {
      var item = cursosArr[ci];
      if (!item) continue;
      var nomeCurso    = String(item.curso     || '').trim().slice(0, 100);
      var numMatricula = String(item.matricula || '').replace(/\D/g, '').slice(0, 20);
      var emailCurso   = sanitizar_(String(item.emailInst || emailInst), 100).toLowerCase();
      if (!nomeCurso || !numMatricula) continue;
      // Valida domínio do e-mail institucional do curso
      if (!/@aluno\.riogrande\.ifrs\.edu\.br$/i.test(emailCurso)) {
        return jsonError_(
          'E-mail institucional inválido para o curso "' + nomeCurso +
          '". Use o domínio @aluno.riogrande.ifrs.edu.br.', 'VALIDATION');
      }
      cursos.push({ emailInst: emailCurso, curso: nomeCurso, matricula: numMatricula });
    }
  }
  if (cursos.length === 0) {
    return jsonError_('Nenhum curso válido informado. Verifique curso, matrícula e e-mail institucional.', 'VALIDATION');
  }

  // Primeiro curso para compatibilidade com colunas legadas
  var cursoPrincipal     = cursos[0].curso;
  var matriculaPrincipal = cursos[0].matricula;
  var modalidade = String(dados.modalidade || '').trim().slice(0, 50);
  if (!modalidade) {
    if (cursoPrincipal.indexOf('Integrado')   !== -1) modalidade = 'Integrado';
    else if (cursoPrincipal.indexOf('Subsequente') !== -1) modalidade = 'Subsequente';
    else modalidade = 'Superior';
  }

  // Validações obrigatórias
  if (!nome)       return jsonError_('Nome completo é obrigatório.', 'VALIDATION');
  if (!validarCPF_(cpf)) return jsonError_('CPF inválido.', 'VALIDATION');
  if (!dataNasc)   return jsonError_('Data de nascimento é obrigatória.', 'VALIDATION');
  if (!telefone)   return jsonError_('Telefone é obrigatório.', 'VALIDATION');
  if (emailPes && !validarEmail_(emailPes)) return jsonError_('E-mail pessoal inválido.', 'VALIDATION');

  var sheet = abrirAba_(CFG_EST.SS_ID, CFG_EST.ABA);

  // Verifica duplicidade por CPF (matrícula não é verificada pois pode ter várias)
  if (buscarNaColuna_(sheet, COL_EST.CPF, cpf) !== -1) {
    return jsonError_('Já existe um estudante cadastrado com este CPF.', 'DUPLICATE');
  }

  var now   = new Date();
  var linha = [];
  linha[COL_EST.TIMESTAMP]     = now;
  linha[COL_EST.NOME]          = nome;
  linha[COL_EST.EMAIL_INST]    = emailInst;
  linha[COL_EST.EMAIL_PESSOAL] = emailPes;
  linha[COL_EST.MATRICULA]     = matriculaPrincipal;  // primeiro curso (compat.)
  linha[COL_EST.CURSO]         = cursoPrincipal;       // primeiro curso (compat.)
  linha[COL_EST.TURNO]         = '';                   // preenchido na solicitação
  linha[COL_EST.SEMESTRE]      = '';                   // preenchido na solicitação
  linha[COL_EST.CPF]           = cpf;
  linha[COL_EST.DATA_NASC]     = dataNasc;
  linha[COL_EST.TELEFONE]      = telefone;
  linha[COL_EST.ENDERECO]      = endereco;
  linha[COL_EST.BAIRRO]        = bairro;
  linha[COL_EST.CEP]           = cep;
  linha[COL_EST.CIDADE]        = cidade;
  linha[COL_EST.UF]            = uf;
  linha[COL_EST.MAIOR_IDADE]   = maiorIdade;
  linha[COL_EST.NEE]           = nee;
  linha[COL_EST.MODALIDADE]    = modalidade;
  linha[COL_EST.STATUS]        = 'Aguardando Validação';
  linha[COL_EST.COD_ACESSO]    = '';
  linha[COL_EST.COD_EXPIRA]    = '';
  linha[COL_EST.CURSOS_JSON]   = JSON.stringify(cursos);

  sheet.appendRow(linha);

  // Notifica o setor sobre novo cadastro pendente
  try {
    var cursosTexto = cursos.map(function(c) { return c.curso + ' (mat. ' + c.matricula + ', ' + c.emailInst + ')'; }).join('\n              ');
    MailApp.sendEmail({
      to:      'estagios@riogrande.ifrs.edu.br',
      subject: '[SGE IFRS] Novo cadastro aguardando validação — ' + nome,
      body: [
        'Um novo estudante realizou cadastro no SGE e aguarda validação.',
        '',
        'Nome: '    + nome,
        'E-mail: '  + emailInst,
        'Cursos: '  + cursosTexto,
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
// GET — Verificar se o e-mail logado já possui cadastro (página Perfil)
// ---------------------------------------------------------------------------

/**
 * Retorna { cadastrado: bool, status: string|null } para o e-mail do token.
 * Requer autenticação de estudante.
 * Usado pela página perfil.html para decidir entre exibir o formulário de
 * cadastro (novo aluno) ou o painel de consulta (aluno já registrado).
 */
function verificarEstudante_(e) {
  var params = e.parameter || {};
  var tokenInfo;
  try {
    tokenInfo = validarTokenEstudante_(params.authToken);
  } catch (err) {
    return jsonError_(err.message, 'AUTH_ERROR');
  }

  var email = (tokenInfo.email || '').toLowerCase().trim();
  if (!email) return jsonOk_({ cadastrado: false, status: null });

  var sheet = abrirAba_(CFG_EST.SS_ID, CFG_EST.ABA);
  var dados  = sheet.getDataRange().getValues();

  // 1ª passagem: e-mail principal
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][COL_EST.EMAIL_INST] || '').toLowerCase().trim() === email) {
      return jsonOk_({ cadastrado: true, status: String(dados[i][COL_EST.STATUS] || '').trim() });
    }
  }

  // 2ª passagem: qualquer emailInst dentro de CURSOS_JSON
  for (var j = 1; j < dados.length; j++) {
    var cj = String(dados[j][COL_EST.CURSOS_JSON] || '').trim();
    if (!cj) continue;
    try {
      var arr = JSON.parse(cj);
      for (var k = 0; k < arr.length; k++) {
        if (String(arr[k].emailInst || '').toLowerCase().trim() === email) {
          return jsonOk_({ cadastrado: true, status: String(dados[j][COL_EST.STATUS] || '').trim() });
        }
      }
    } catch (_) {}
  }

  return jsonOk_({ cadastrado: false, status: null });
}

// ---------------------------------------------------------------------------
// GET — Verificar se CPF já está cadastrado (tempo real no formulário)
// ---------------------------------------------------------------------------

/**
 * Retorna { existe: true/false } para um CPF (apenas dígitos).
 * Requer autenticação de estudante para evitar enumeração pública.
 */
function verificarCpf_(e) {
  var params = e.parameter || {};
  try { validarTokenEstudante_(params.authToken); } catch (err) {
    return jsonError_(err.message, 'AUTH_ERROR');
  }
  var cpf = sanitizar_(params.cpf || '', 14).replace(/\D/g, '');
  if (!cpf || cpf.length !== 11) return jsonOk_({ existe: false });
  var sheet = abrirAba_(CFG_EST.SS_ID, CFG_EST.ABA);
  var existe = buscarNaColuna_(sheet, COL_EST.CPF, cpf) !== -1;
  return jsonOk_({ existe: existe });
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
 * Localiza estudante por e-mail (principal ou de qualquer vínculo) + código.
 * Valida status Ativo e retorna dados completos.
 */
function buscarEstudantePorEmailECodigo_(emailEstudante, codigo) {
  var sheet = abrirAba_(CFG_EST.SS_ID, CFG_EST.ABA);
  var dados = sheet.getDataRange().getValues();
  var emailNorm  = String(emailEstudante || '').toLowerCase().trim();
  var codigoNorm = String(codigo || '').trim().toUpperCase();

  var linhaEncontrada = null;

  // 1ª passagem: busca pelo e-mail principal (COL_EST.EMAIL_INST)
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][COL_EST.EMAIL_INST] || '').toLowerCase().trim() === emailNorm) {
      linhaEncontrada = dados[i];
      break;
    }
  }

  // 2ª passagem: busca em qualquer emailInst dentro de CURSOS_JSON
  if (!linhaEncontrada) {
    for (var j = 1; j < dados.length; j++) {
      var cjBusca = String(dados[j][COL_EST.CURSOS_JSON] || '').trim();
      if (!cjBusca) continue;
      try {
        var arrBusca = JSON.parse(cjBusca);
        for (var ci = 0; ci < arrBusca.length; ci++) {
          if (String(arrBusca[ci].emailInst || '').toLowerCase().trim() === emailNorm) {
            linhaEncontrada = dados[j];
            break;
          }
        }
        if (linhaEncontrada) break;
      } catch (_) {}
    }
  }

  if (!linhaEncontrada) {
    throw new Error('Estudante não encontrado para o e-mail informado.');
  }

  var linha = linhaEncontrada;

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

  // Recupera array de cursos; compatibilidade com registros antigos sem emailInst
  var cursosJsonFinal = String(linha[COL_EST.CURSOS_JSON] || '').trim();
  var cursosArrFinal  = [];
  try {
    if (cursosJsonFinal) cursosArrFinal = JSON.parse(cursosJsonFinal);
  } catch (_) {}
  if (!cursosArrFinal.length) {
    var c0 = String(linha[COL_EST.CURSO]     || '');
    var m0 = String(linha[COL_EST.MATRICULA] || '');
    var e0 = String(linha[COL_EST.EMAIL_INST] || '');
    if (c0) cursosArrFinal = [{ emailInst: e0, curso: c0, matricula: m0 }];
  }

  return {
    nome:         String(linha[COL_EST.NOME]         || ''),
    matricula:    String(linha[COL_EST.MATRICULA]     || ''),
    curso:        String(linha[COL_EST.CURSO]         || ''),
    modalidade:   String(linha[COL_EST.MODALIDADE]    || ''),
    cpf:          String(linha[COL_EST.CPF]           || ''),
    dataNasc:     normalizarDataISO_(linha[COL_EST.DATA_NASC]),
    telefone:     String(linha[COL_EST.TELEFONE]      || ''),
    emailInst:    String(linha[COL_EST.EMAIL_INST]    || ''),
    emailPessoal: String(linha[COL_EST.EMAIL_PESSOAL] || ''),
    endereco:     String(linha[COL_EST.ENDERECO]      || ''),
    bairro:       String(linha[COL_EST.BAIRRO]        || ''),
    cep:          String(linha[COL_EST.CEP]           || ''),
    cidade:       String(linha[COL_EST.CIDADE]        || ''),
    uf:           String(linha[COL_EST.UF]            || ''),
    maiorIdade:   String(linha[COL_EST.MAIOR_IDADE]   || ''),
    nee:          String(linha[COL_EST.NEE]           || 'Não'),
    cursos:       cursosArrFinal,   // array [{emailInst, curso, matricula}]
    status:       statusEst,
  };
}

/**
 * Dado qualquer e-mail institucional (principal ou de vínculo), retorna
 * o e-mail principal (COL_EST.EMAIL_INST) do estudante correspondente.
 * Se não encontrado, devolve o próprio e-mail recebido.
 * Usado por api-solicitacao.gs para resolver identidade em verificações de ID.
 */
function resolverEmailPrimario_(emailQualquer) {
  var sheet = abrirAba_(CFG_EST.SS_ID, CFG_EST.ABA);
  var dados = sheet.getDataRange().getValues();
  var norm = String(emailQualquer || '').toLowerCase().trim();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][COL_EST.EMAIL_INST] || '').toLowerCase().trim() === norm) {
      return norm;  // já é o principal
    }
    var cj = String(dados[i][COL_EST.CURSOS_JSON] || '').trim();
    if (!cj) continue;
    try {
      var arr = JSON.parse(cj);
      for (var ci = 0; ci < arr.length; ci++) {
        if (String(arr[ci].emailInst || '').toLowerCase().trim() === norm) {
          return String(dados[i][COL_EST.EMAIL_INST] || '').toLowerCase().trim();
        }
      }
    } catch (_) {}
  }
  return norm;  // não encontrado — retorna como está
}

// ---------------------------------------------------------------------------
// POST — Atualizar dados do próprio cadastro
// ---------------------------------------------------------------------------

/**
 * Permite ao estudante autenticado atualizar contato, endereço e vínculos.
 * Campos imutáveis pelo próprio estudante: nome, CPF, data de nascimento.
 */
function atualizarMeuCadastro_(dados) {
  var tokenInfo = validarTokenEstudante_(dados.authToken);

  if (!checkRateLimit_('atualizarMeuCadastro')) {
    return jsonError_('Muitas requisições. Aguarde um momento.', 'RATE_LIMIT');
  }

  var codigo = sanitizar_(dados.codigoAcesso || '', 20).trim().toUpperCase();
  if (!codigo) return jsonError_('Código de acesso é obrigatório.', 'VALIDATION');

  // Campos atualizáveis
  var emailPes = sanitizar_(dados.emailPessoal || '', 100).toLowerCase();
  var telefone = sanitizar_(dados.telefone     || '', 30);
  var neeUpd   = dados.nee !== undefined ? (sanitizar_(dados.nee, 5).indexOf('Sim') === 0 ? 'Sim' : 'Não') : null;
  var endereco = sanitizar_(dados.endereco     || '', 300);
  var bairro   = sanitizar_(dados.bairro       || '', 100);
  var cep      = sanitizar_(dados.cep          || '', 9);
  var cidade   = sanitizar_(dados.cidade       || '', 100);
  var uf       = sanitizar_(dados.uf           || '', 2);
  if (!telefone) return jsonError_('Telefone é obrigatório.', 'VALIDATION');
  if (!endereco) return jsonError_('Endereço é obrigatório.', 'VALIDATION');
  if (!cep)      return jsonError_('CEP é obrigatório.', 'VALIDATION');
  if (!bairro)   return jsonError_('Bairro é obrigatório.', 'VALIDATION');
  if (!cidade)   return jsonError_('Cidade é obrigatória.', 'VALIDATION');
  if (emailPes && !validarEmail_(emailPes)) return jsonError_('E-mail pessoal inválido.', 'VALIDATION');

  // Vínculos acadêmicos (obrigatório ao menos 1)
  var cursos = [];
  var cursosInput = dados.cursos;
  if (cursosInput && typeof cursosInput === 'object') {
    var cursosArr = Array.isArray(cursosInput) ? cursosInput : Object.values(cursosInput);
    for (var ci = 0; ci < cursosArr.length && cursos.length < 6; ci++) {
      var item = cursosArr[ci];
      if (!item) continue;
      var nomeCurso    = String(item.curso     || '').trim().slice(0, 100);
      var numMatricula = String(item.matricula || '').replace(/\D/g, '').slice(0, 20);
      var emailCurso   = sanitizar_(String(item.emailInst || ''), 100).toLowerCase();
      if (!nomeCurso || !numMatricula) continue;
      if (!/@aluno\.riogrande\.ifrs\.edu\.br$/i.test(emailCurso)) {
        return jsonError_('E-mail institucional inválido para "' + nomeCurso + '".', 'VALIDATION');
      }
      cursos.push({ emailInst: emailCurso, curso: nomeCurso, matricula: numMatricula });
    }
  }
  if (cursos.length === 0) {
    return jsonError_('Ao menos um vínculo acadêmico é obrigatório.', 'VALIDATION');
  }

  // Localiza a linha do estudante (aceita e-mail principal ou e-mail de vínculo)
  var sheet = abrirAba_(CFG_EST.SS_ID, CFG_EST.ABA);
  var todosOsDados = sheet.getDataRange().getValues();
  var emailNorm  = String(tokenInfo.email || '').toLowerCase().trim();
  var codigoNorm = codigo;
  var rowIdx = -1;

  for (var i = 1; i < todosOsDados.length; i++) {
    var linha = todosOsDados[i];
    var emailMatch = String(linha[COL_EST.EMAIL_INST] || '').toLowerCase().trim() === emailNorm;

    if (!emailMatch) {
      var cjAtualizar = String(linha[COL_EST.CURSOS_JSON] || '').trim();
      if (cjAtualizar) {
        try {
          var arrAtualizar = JSON.parse(cjAtualizar);
          for (var ci2 = 0; ci2 < arrAtualizar.length; ci2++) {
            if (String(arrAtualizar[ci2].emailInst || '').toLowerCase().trim() === emailNorm) {
              emailMatch = true; break;
            }
          }
        } catch (_) {}
      }
    }
    if (!emailMatch) continue;

    var statusLinha = String(linha[COL_EST.STATUS] || '').trim();
    if (statusLinha !== 'Ativo') {
      return jsonError_('Cadastro não está ativo.', 'AUTH_ERROR');
    }
    var codPlan = String(linha[COL_EST.COD_ACESSO] || '').trim().toUpperCase();
    if (codPlan !== codigoNorm) {
      return jsonError_('Código de acesso inválido.', 'AUTH_ERROR');
    }
    rowIdx = i;
    break;
  }

  if (rowIdx === -1) return jsonError_('Estudante não encontrado.', 'NOT_FOUND');

  var rowNum = rowIdx + 1;
  sheet.getRange(rowNum, COL_EST.EMAIL_PESSOAL + 1).setValue(emailPes);
  sheet.getRange(rowNum, COL_EST.TELEFONE      + 1).setValue(telefone);
  sheet.getRange(rowNum, COL_EST.ENDERECO      + 1).setValue(endereco);
  sheet.getRange(rowNum, COL_EST.BAIRRO        + 1).setValue(bairro);
  sheet.getRange(rowNum, COL_EST.CEP           + 1).setValue(cep);
  sheet.getRange(rowNum, COL_EST.CIDADE        + 1).setValue(cidade);
  sheet.getRange(rowNum, COL_EST.UF            + 1).setValue(uf);
  sheet.getRange(rowNum, COL_EST.CURSOS_JSON   + 1).setValue(JSON.stringify(cursos));
  if (neeUpd !== null) sheet.getRange(rowNum, COL_EST.NEE + 1).setValue(neeUpd);
  // Mantém colunas legadas sincronizadas com o primeiro vínculo
  sheet.getRange(rowNum, COL_EST.CURSO         + 1).setValue(cursos[0].curso);
  sheet.getRange(rowNum, COL_EST.MATRICULA     + 1).setValue(cursos[0].matricula);

  return jsonOk_({ mensagem: 'Dados atualizados com sucesso!' });
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
