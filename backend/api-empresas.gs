// ============================================================
//  IFRS CAMPUS RIO GRANDE — CENTRAL DE ESTÁGIOS
//  backend/api-empresas.gs
//  Web App GAS — endpoints do módulo Empresas
//
//  DEPLOY:
//  1. Abra script.google.com
//  2. Crie um novo projeto standalone (ou vincule à planilha)
//  3. Cole todos os arquivos .gs desta pasta
//  4. Implantar → Novo implante → Tipo: Aplicativo da Web
//     Executar como: Minha conta (conta institucional IFRS)
//     Quem tem acesso: Qualquer pessoa
//  5. Copie a URL do implante e cole em assets/js/api.js → API_CONFIG.BASE_URL
//
//  ENDPOINTS (action):
//  GET  listarEmpresas           → empresas com status "Validada"
//  GET  listarSupervisores       → supervisores filtrados por empresa (CNPJ)
//  POST cadastrarEmpresa         → novo cadastro ou atualização
//  POST cadastrarSupervisor      → novo cadastro ou atualização
//  POST cadastrarOportunidade    → cadastro de vaga
// ============================================================

// ─────────────────────────────────────────
//  CONFIGURAÇÕES CENTRAIS
//  Altere aqui — nunca exponha no frontend
// ─────────────────────────────────────────
var CFG = {
  EMAIL_SETOR: 'estagios@riogrande.ifrs.edu.br',
  NOME_SETOR:  'Central de Estágios — IFRS Campus Rio Grande',

  // Planilha consolidada SGE (todas as abas)
  ID_EMPRESAS:     '1zVyseifVC6xeMpNjqwYd6jCq9HTJ2NS8BlN1dtM4s7Y',
  ID_SUPERVISORES: '1zVyseifVC6xeMpNjqwYd6jCq9HTJ2NS8BlN1dtM4s7Y',
  ID_OPORTUNIDADES:'1zVyseifVC6xeMpNjqwYd6jCq9HTJ2NS8BlN1dtM4s7Y',

  ABA_EMPRESAS:     'Empresas',
  ABA_SUP_RESPOSTAS:'Supervisores',
  ABA_OPP:          'Oportunidades',
  ABA_LOG:          'Log de Alterações',

  // Rate limiting: máx requisições por IP por minuto
  RATE_LIMIT: 10,
};

// Colunas da planilha de empresas (base 0 — mesmo mapeamento do script legado)
var COL_EMP = {
  TIMESTAMP: 0, EMAIL_FORM: 1, TIPO: 2, RAZAO_SOCIAL: 3,
  NOME_FANTASIA: 4, CNPJ: 5, RAMO: 6, ENDERECO: 7,
  MUNICIPIO: 8, UF: 9, CEP: 10, TEL_EMPRESA: 11,
  EMAIL_EMPRESA: 12, SITE: 13, NOME_REP: 14, CARGO_REP: 15,
  EMAIL_REP: 16, CPF_REP: 17, DECLARACAO: 18,
  // Controle interno
  STATUS: 19, VALIDADO_POR: 20, DATA_VALIDACAO: 21,
  OBSERVACOES: 22, DATA_ULT_ATZ: 23,
};

// Colunas da planilha de supervisores (base 0)
var COL_SUP = {
  TIMESTAMP: 0, EMAIL_FORM: 1, TIPO: 2, EMPRESA: 3,
  SETOR: 4, ENDERECO_SETOR: 5, EMAIL_SETOR_SUP: 6, TEL_SETOR: 7,
  NOME: 8, CPF: 9, CARGO: 10, TEL_SUP: 11,
  EMAIL_SUP: 12, NIVEL_FORMACAO: 13, AREA_FORMACAO: 14,
  INSTITUICAO: 15, TEMPO_EXP: 16, DESC_EXP: 17, DECLARACAO: 18,
  STATUS: 19, VALIDADO_POR: 20, DATA_VALIDACAO: 21,
  OBSERVACOES: 22, DATA_ULT_ATZ: 23,
};

// ─────────────────────────────────────────
//  ROTEADOR PRINCIPAL
// ─────────────────────────────────────────

function doGet(e) {
  try {
    var action = e.parameter.action || '';
    var result;

    switch (action) {
      case 'listarEmpresas':
        result = listarEmpresas_();
        break;
      case 'listarSupervisores':
        result = listarSupervisores_(e.parameter.empresa || '');
        break;
      default:
        return jsonError_('Ação GET não reconhecida: ' + action, 400);
    }

    return jsonOk_(result);

  } catch (err) {
    logErro_('doGet', err);
    return jsonError_('Erro interno no servidor. Tente novamente.', 500);
  }
}

function doPost(e) {
  try {
    // Parse do body JSON
    var body = {};
    if (e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }

    var action = body.action || '';
    var result;

    // Rate limiting simples por propriedade de script
    if (!checkRateLimit_(action)) {
      return jsonError_('Muitas requisições. Aguarde um momento e tente novamente.', 429);
    }

    switch (action) {
      case 'cadastrarEmpresa':
        result = cadastrarEmpresa_(body);
        break;
      case 'cadastrarSupervisor':
        result = cadastrarSupervisor_(body);
        break;
      case 'cadastrarOportunidade':
        result = cadastrarOportunidade_(body);
        break;
      default:
        return jsonError_('Ação POST não reconhecida: ' + action, 400);
    }

    return jsonOk_(result);

  } catch (err) {
    logErro_('doPost', err);
    return jsonError_('Erro interno no servidor. Tente novamente.', 500);
  }
}

// ─────────────────────────────────────────
//  GET: listarEmpresas
//  Retorna apenas { cnpj, razaoSocial } de empresas validadas
//  Dados mínimos — nunca expõe CPF, e-mail rep., etc.
// ─────────────────────────────────────────
function listarEmpresas_() {
  var ss  = SpreadsheetApp.openById(CFG.ID_EMPRESAS);
  var aba = ss.getSheetByName(CFG.ABA_EMPRESAS) ||
            ss.getSheetByName('Respostas ao formulário 1');

  if (!aba) throw new Error('Aba de empresas não encontrada.');

  var dados = aba.getDataRange().getValues();
  var lista = [];

  for (var i = 1; i < dados.length; i++) {
    var status = String(dados[i][COL_EMP.STATUS] || '').trim();
    var tipo   = String(dados[i][COL_EMP.TIPO]   || '').trim();

    // Ignora linhas processadas (cópias de atualização) e não validadas
    if (status !== 'Validada') continue;
    if (tipo.indexOf('Processada') > -1) continue;

    var cnpj        = String(dados[i][COL_EMP.CNPJ]        || '').trim();
    var razaoSocial = String(dados[i][COL_EMP.RAZAO_SOCIAL] || '').trim();

    if (!cnpj || !razaoSocial) continue;

    lista.push({ cnpj: cnpj, razaoSocial: razaoSocial });
  }

  // Ordena alfabeticamente pela razão social
  lista.sort(function(a, b) { return a.razaoSocial.localeCompare(b.razaoSocial, 'pt-BR'); });
  return lista;
}

// ─────────────────────────────────────────
//  GET: listarSupervisores
//  Retorna supervisores validados de uma empresa (por CNPJ)
//  Expõe: nome, cargo, e-mail (necessário para o TCE)
// ─────────────────────────────────────────
function listarSupervisores_(cnpjBusca) {
  if (!cnpjBusca) return [];

  var cnpjNorm = normalizarCNPJ_(cnpjBusca);
  var ss  = SpreadsheetApp.openById(CFG.ID_SUPERVISORES);
  var aba = ss.getSheetByName(CFG.ABA_SUP_RESPOSTAS);

  if (!aba) return [];

  var dados = aba.getDataRange().getValues();
  var lista = [];

  for (var i = 1; i < dados.length; i++) {
    var status = String(dados[i][COL_SUP.STATUS] || '').trim();
    if (status !== 'Validado') continue;
    if (status.indexOf('Processada') > -1) continue;

    // O campo empresa é armazenado como "CNPJ — Razão Social"
    var empLinha = String(dados[i][COL_SUP.EMPRESA] || '');
    var cnpjLinha = normalizarCNPJ_(empLinha.split('—')[0] || empLinha);

    if (cnpjLinha !== cnpjNorm) continue;

    lista.push({
      cpf:    String(dados[i][COL_SUP.CPF]   || '').trim(),
      nome:   String(dados[i][COL_SUP.NOME]  || '').trim(),
      cargo:  String(dados[i][COL_SUP.CARGO] || '').trim(),
      email:  String(dados[i][COL_SUP.EMAIL_SUP] || '').trim(),
      setor:  String(dados[i][COL_SUP.SETOR] || '').trim(),
    });
  }

  lista.sort(function(a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
  return lista;
}

// ─────────────────────────────────────────
//  POST: cadastrarEmpresa
// ─────────────────────────────────────────
function cadastrarEmpresa_(dados) {
  // Validação e sanitização no backend
  var tipo        = sanitizar_(dados.tipo);
  var razaoSocial = sanitizar_(dados.razaoSocial);
  var cnpj        = sanitizar_(dados.cnpj);
  var ramo        = sanitizar_(dados.ramo);
  var endereco    = sanitizar_(dados.endereco);
  var municipio   = sanitizar_(dados.municipio);
  var uf          = sanitizar_(dados.uf);
  var cep         = sanitizar_(dados.cep);
  var telEmpresa  = sanitizar_(dados.telEmpresa);
  var emailEmp    = sanitizar_(dados.emailEmpresa).toLowerCase();
  var site        = sanitizar_(dados.site);
  var nomeRep     = sanitizar_(dados.nomeRep);
  var cargoRep    = sanitizar_(dados.cargoRep);
  var emailRep    = sanitizar_(dados.emailRep).toLowerCase();
  var cpfRep      = sanitizar_(dados.cpfRep);
  var declaracao  = sanitizar_(dados.declaracao);

  // Validações críticas (o frontend já valida, mas nunca confie só nele)
  if (!razaoSocial) throw new Error('Razão social é obrigatória.');
  if (!validarCNPJ_(cnpj))   throw new Error('CNPJ inválido.');
  if (!validarEmail_(emailEmp)) throw new Error('E-mail da empresa inválido.');
  if (!validarEmail_(emailRep)) throw new Error('E-mail do representante inválido.');
  if (!validarCPF_(cpfRep))  throw new Error('CPF do representante inválido.');
  if (declaracao !== 'Sim')  throw new Error('Declaração de veracidade é obrigatória.');
  if (!tipo || (tipo !== 'Novo cadastro' && tipo !== 'Atualização de cadastro existente')) {
    throw new Error('Tipo de preenchimento inválido.');
  }

  // Bloqueia CNPJ do próprio IFRS para empresas externas
  // (estágios internos têm fluxo diferente)
  var cnpjNorm = normalizarCNPJ_(cnpj);
  if (cnpjNorm === '10581068000153') {
    throw new Error('Estágios no IFRS têm um processo específico. Entre em contato com o setor de estágios.');
  }

  var ss  = SpreadsheetApp.openById(CFG.ID_EMPRESAS);
  var aba = ss.getSheetByName(CFG.ABA_EMPRESAS) ||
            ss.getSheetByName('Respostas ao formulário 1');

  if (!aba) throw new Error('Planilha de empresas não configurada.');

  var timestamp = new Date();

  // Monta a linha no mesmo formato do Google Forms original
  // para compatibilidade total com os scripts legados
  var novaLinha = [
    timestamp,                // 0 — Carimbo
    emailRep,                 // 1 — E-mail (usamos o do rep. como identificador)
    tipo,                     // 2 — Tipo
    razaoSocial,              // 3 — Razão Social
    sanitizar_(dados.nomeFantasia), // 4 — Nome Fantasia
    cnpj,                     // 5 — CNPJ
    ramo,                     // 6 — Ramo
    endereco,                 // 7 — Endereço
    municipio,                // 8 — Município
    uf,                       // 9 — UF
    cep,                      // 10 — CEP
    telEmpresa,               // 11 — Tel empresa
    emailEmp,                 // 12 — E-mail empresa
    site,                     // 13 — Site
    nomeRep,                  // 14 — Nome Rep.
    cargoRep,                 // 15 — Cargo Rep.
    emailRep,                 // 16 — E-mail Rep.
    cpfRep,                   // 17 — CPF Rep.
    'Sim — via formulário web', // 18 — Declaração
    'Pendente',               // 19 — Status
    '',                       // 20 — Validado por
    '',                       // 21 — Data validação
    '',                       // 22 — Observações
    timestamp,                // 23 — Data últ. atualização
  ];

  // Para atualização: verifica se empresa existe e marca linha antiga
  if (tipo === 'Atualização de cadastro existente') {
    var linhaExistente = buscarEmpresaPorCNPJ_(aba, cnpjNorm, -1);
    if (linhaExistente > 0) {
      // Atualiza diretamente a linha existente em vez de criar nova
      var campos = [
        {col: COL_EMP.RAZAO_SOCIAL, val: razaoSocial},
        {col: COL_EMP.NOME_FANTASIA, val: sanitizar_(dados.nomeFantasia)},
        {col: COL_EMP.RAMO, val: ramo},
        {col: COL_EMP.ENDERECO, val: endereco},
        {col: COL_EMP.MUNICIPIO, val: municipio},
        {col: COL_EMP.UF, val: uf},
        {col: COL_EMP.CEP, val: cep},
        {col: COL_EMP.TEL_EMPRESA, val: telEmpresa},
        {col: COL_EMP.EMAIL_EMPRESA, val: emailEmp},
        {col: COL_EMP.SITE, val: site},
        {col: COL_EMP.NOME_REP, val: nomeRep},
        {col: COL_EMP.CARGO_REP, val: cargoRep},
        {col: COL_EMP.EMAIL_REP, val: emailRep},
        {col: COL_EMP.DATA_ULT_ATZ, val: timestamp},
      ];
      campos.forEach(function(c) {
        aba.getRange(linhaExistente, c.col + 1).setValue(c.val);
      });
      aba.getRange(linhaExistente, COL_EMP.STATUS + 1).setValue('Pendente');
      registrarLog_(ss, cnpj, razaoSocial, 'Atualização via web', 'Dados atualizados', emailRep);
      notificarSetor_(razaoSocial, cnpj, emailRep, 'Atualização de cadastro');
      enviarConfirmacao_(emailEmp, emailRep, nomeRep, razaoSocial, 'atualizacao');
      return { mensagem: 'Atualização recebida. Seus dados serão verificados em até 1 dia útil.' };
    }
    // CNPJ não encontrado — registra mesmo assim para análise
    novaLinha[COL_EMP.OBSERVACOES] = 'ATENÇÃO: solicitação de atualização sem cadastro prévio encontrado.';
  }

  // Verifica duplicata para novo cadastro
  if (tipo === 'Novo cadastro') {
    var dupLinha = buscarEmpresaPorCNPJ_(aba, cnpjNorm, -1);
    if (dupLinha > 0) {
      novaLinha[COL_EMP.STATUS]      = 'Pendente de correção';
      novaLinha[COL_EMP.OBSERVACOES] = 'POSSÍVEL DUPLICATA — CNPJ já consta na linha ' + dupLinha;
    }
  }

  aba.appendRow(novaLinha);

  // Formatação visual da nova linha
  var ultimaLinha = aba.getLastRow();
  var cor = novaLinha[COL_EMP.STATUS] === 'Pendente de correção' ? '#FFCDD2' : '#FFF9C4';
  aba.getRange(ultimaLinha, 1, 1, aba.getLastColumn()).setBackground(cor);

  // Notificações
  notificarSetor_(razaoSocial, cnpj, emailRep, tipo);
  if (novaLinha[COL_EMP.STATUS] !== 'Pendente de correção') {
    enviarConfirmacao_(emailEmp, emailRep, nomeRep, razaoSocial, 'novo');
  }

  return { mensagem: 'Cadastro recebido com sucesso! Você receberá uma confirmação por e-mail em até 1 dia útil.' };
}

// ─────────────────────────────────────────
//  POST: cadastrarSupervisor
// ─────────────────────────────────────────
function cadastrarSupervisor_(dados) {
  var tipo          = sanitizar_(dados.tipo);
  var empresa       = sanitizar_(dados.empresa);      // CNPJ da empresa
  var empresaNome   = sanitizar_(dados.empresaNome);
  var setor         = sanitizar_(dados.setor);
  var telSetor      = sanitizar_(dados.telSetor);
  var emailSetorSup = sanitizar_(dados.emailSetor).toLowerCase();
  var endSetor      = sanitizar_(dados.enderecoSetor);
  var nome          = sanitizar_(dados.nome);
  var cpf           = sanitizar_(dados.cpf);
  var cargo         = sanitizar_(dados.cargo);
  var telSup        = sanitizar_(dados.telSupervisor);
  var emailSup      = sanitizar_(dados.emailSupervisor).toLowerCase();
  var nivelForm     = sanitizar_(dados.nivelFormacao);
  var areaForm      = sanitizar_(dados.areaFormacao);
  var instituicao   = sanitizar_(dados.instituicao);
  var tempoExp      = sanitizar_(dados.tempoExperiencia);
  var descExp       = sanitizar_(dados.descExperiencia);
  var declaracao    = sanitizar_(dados.declaracao);

  if (!nome)     throw new Error('Nome do supervisor é obrigatório.');
  if (!validarCPF_(cpf)) throw new Error('CPF do supervisor inválido.');
  if (!validarEmail_(emailSup)) throw new Error('E-mail do supervisor inválido.');
  if (!empresa)  throw new Error('Empresa é obrigatória.');
  if (!setor)    throw new Error('Setor é obrigatório.');
  if (!nivelForm) throw new Error('Nível de formação é obrigatório.');
  if (!areaForm)  throw new Error('Área de formação é obrigatória.');
  if (!tempoExp)  throw new Error('Tempo de experiência é obrigatório.');
  if (!descExp || descExp.length < 50) throw new Error('Descrição da experiência muito curta.');
  if (declaracao !== 'Sim') throw new Error('Declaração de veracidade é obrigatória.');

  var ss  = SpreadsheetApp.openById(CFG.ID_SUPERVISORES);
  var aba = ss.getSheetByName(CFG.ABA_SUP_RESPOSTAS);
  if (!aba) throw new Error('Planilha de supervisores não configurada.');

  var timestamp = new Date();
  var cpfNorm = normalizarCPF_(cpf);

  var novaLinha = [
    timestamp,
    emailSup,
    tipo,
    empresa + ' — ' + empresaNome,  // Campo empresa como no forms legado
    setor,
    endSetor,
    emailSetorSup,
    telSetor,
    nome,
    cpf,
    cargo,
    telSup,
    emailSup,
    nivelForm,
    areaForm,
    instituicao,
    tempoExp,
    descExp,
    'Sim — via formulário web',
    'Pendente',
    '', '', '',
    timestamp,
  ];

  // Verifica duplicata de CPF
  var linhaExistente = buscarSupervisorPorCPF_(aba, cpfNorm, -1);

  if (tipo === 'Atualização de cadastro existente' && linhaExistente > 0) {
    var campos = [
      {col: COL_SUP.EMPRESA, val: empresa + ' — ' + empresaNome},
      {col: COL_SUP.SETOR, val: setor},
      {col: COL_SUP.TEL_SETOR, val: telSetor},
      {col: COL_SUP.EMAIL_SETOR_SUP, val: emailSetorSup},
      {col: COL_SUP.CARGO, val: cargo},
      {col: COL_SUP.TEL_SUP, val: telSup},
      {col: COL_SUP.EMAIL_SUP, val: emailSup},
      {col: COL_SUP.NIVEL_FORMACAO, val: nivelForm},
      {col: COL_SUP.AREA_FORMACAO, val: areaForm},
      {col: COL_SUP.INSTITUICAO, val: instituicao},
      {col: COL_SUP.TEMPO_EXP, val: tempoExp},
      {col: COL_SUP.DESC_EXP, val: descExp},
      {col: COL_SUP.DATA_ULT_ATZ, val: timestamp},
    ];
    campos.forEach(function(c) {
      aba.getRange(linhaExistente, c.col + 1).setValue(c.val);
    });
    aba.getRange(linhaExistente, COL_SUP.STATUS + 1).setValue('Pendente');
    GmailApp.sendEmail(CFG.EMAIL_SETOR,
      '[ATUALIZAÇÃO SUPERVISOR] ' + nome,
      'Atualização de supervisor via formulário web.\nNome: ' + nome + '\nEmpresa: ' + empresaNome,
      {name: 'Sistema de Estágios IFRS'}
    );
    GmailApp.sendEmail(emailSup,
      '[IFRS Estágios] Atualização cadastral recebida — ' + nome,
      'Olá, ' + nome + ',\n\nSua atualização cadastral foi recebida.\nEm breve será verificada pelo setor.\n\nDúvidas: ' + CFG.EMAIL_SETOR + '\n\nAtenciosamente,\n' + CFG.NOME_SETOR,
      {name: CFG.NOME_SETOR, replyTo: CFG.EMAIL_SETOR}
    );
    return { mensagem: 'Atualização recebida com sucesso!' };
  }

  if (tipo === 'Novo cadastro' && linhaExistente > 0) {
    novaLinha[COL_SUP.OBSERVACOES] = 'ATENÇÃO: CPF já consta na linha ' + linhaExistente + '. Verificar duplicata.';
  }

  aba.appendRow(novaLinha);
  aba.getRange(aba.getLastRow(), 1, 1, aba.getLastColumn()).setBackground('#FFF9C4');

  GmailApp.sendEmail(CFG.EMAIL_SETOR,
    '[NOVO SUPERVISOR] ' + nome + ' — ' + empresaNome,
    'Novo supervisor cadastrado via formulário web.\n\nNome: ' + nome + '\nCPF: ' + cpf +
    '\nEmpresa: ' + empresaNome + '\nSetor: ' + setor + '\nE-mail: ' + emailSup +
    '\nFormação: ' + nivelForm + ' em ' + areaForm,
    {name: 'Sistema de Estágios IFRS'}
  );
  GmailApp.sendEmail(emailSup,
    '[IFRS Estágios] Cadastro recebido — ' + nome,
    'Olá, ' + nome + ',\n\nSeu cadastro como supervisor de estágio foi recebido.\nApós validação (prazo: 1 dia útil), você receberá uma confirmação.\n\nDúvidas: ' + CFG.EMAIL_SETOR + '\n\nAtenciosamente,\n' + CFG.NOME_SETOR,
    {name: CFG.NOME_SETOR, replyTo: CFG.EMAIL_SETOR}
  );

  return { mensagem: 'Cadastro recebido! Você receberá uma confirmação por e-mail em até 1 dia útil.' };
}

// ─────────────────────────────────────────
//  POST: cadastrarOportunidade
// ─────────────────────────────────────────
function cadastrarOportunidade_(dados) {
  var nomeEmpresa  = sanitizar_(dados.nomeEmpresa);
  var responsavel  = sanitizar_(dados.responsavelVaga);
  var emailContato = sanitizar_(dados.emailContato).toLowerCase();
  var telContato   = sanitizar_(dados.telContato);
  var tipoVaga     = sanitizar_(dados.tipoVaga);
  var tituloVaga   = sanitizar_(dados.tituloVaga);
  var areaCurso    = sanitizar_(dados.areaCurso);
  var atividades   = sanitizar_(dados.atividades);
  var requisitos   = sanitizar_(dados.requisitos);
  var cidadeVaga   = sanitizar_(dados.cidadeVaga);
  var modalidade   = sanitizar_(dados.modalidade);
  var cargaHoraria = sanitizar_(dados.cargaHoraria);
  var remuneracao  = sanitizar_(dados.remuneracao);
  var declaracao   = sanitizar_(dados.declaracao);

  if (!nomeEmpresa)  throw new Error('Nome da empresa é obrigatório.');
  if (!validarEmail_(emailContato)) throw new Error('E-mail de contato inválido.');
  if (!tipoVaga)     throw new Error('Tipo de vaga é obrigatório.');
  if (!tituloVaga)   throw new Error('Título da vaga é obrigatório.');
  if (!atividades)   throw new Error('Atividades são obrigatórias.');
  if (!requisitos)   throw new Error('Requisitos são obrigatórios.');
  if (!modalidade)   throw new Error('Modalidade é obrigatória.');
  if (!cargaHoraria) throw new Error('Carga horária é obrigatória.');
  if (!remuneracao)  throw new Error('Remuneração é obrigatória.');
  if (declaracao !== 'Sim') throw new Error('Declaração é obrigatória.');

  // Usa a planilha de oportunidades ou a planilha de empresas como fallback
  var planilhaId = CFG.ID_OPORTUNIDADES || CFG.ID_EMPRESAS;
  var ss = SpreadsheetApp.openById(planilhaId);
  var aba = ss.getSheetByName(CFG.ABA_OPP);

  if (!aba) {
    // Cria a aba se não existir
    aba = ss.insertSheet(CFG.ABA_OPP);
    var cabecalho = [
      'Timestamp', 'Nome Empresa', 'Responsável', 'E-mail Contato', 'Telefone',
      'Tipo Vaga', 'Título', 'Área/Curso', 'Nº Vagas', 'Atividades', 'Requisitos',
      'Info Complementar', 'Cidade', 'Modalidade', 'Carga Horária', 'Remuneração',
      'Benefícios', 'Como Candidatar', 'Contato Candidatura', 'Prazo', 'Instagram',
      'LinkedIn', 'Declaração', 'Status', 'Observações', 'Data Publicação',
    ];
    aba.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho])
      .setBackground('#1A3A6B').setFontColor('#FFFFFF').setFontWeight('bold');
    aba.setFrozenRows(1);
  }

  var timestamp = new Date();
  aba.appendRow([
    timestamp,
    nomeEmpresa,
    responsavel,
    emailContato,
    telContato,
    tipoVaga,
    tituloVaga,
    areaCurso,
    sanitizar_(dados.numVagas) || '1',
    atividades,
    requisitos,
    sanitizar_(dados.infoComplementar),
    cidadeVaga,
    modalidade,
    cargaHoraria,
    remuneracao,
    sanitizar_(dados.beneficios),
    sanitizar_(dados.comoCandidatar),
    sanitizar_(dados.contatoCandidatura),
    sanitizar_(dados.prazoCandidatura),
    sanitizar_(dados.instagram),
    sanitizar_(dados.linkedin),
    'Sim — via formulário web',
    'Pendente',    // Status — setor analisa antes de publicar
    '',
    '',
  ]);

  // Notifica o setor
  GmailApp.sendEmail(
    CFG.EMAIL_SETOR,
    '[NOVA OPORTUNIDADE] ' + tituloVaga + ' — ' + nomeEmpresa,
    '📋 NOVA OPORTUNIDADE CADASTRADA\n\n' +
    'Empresa:        ' + nomeEmpresa + '\n' +
    'Responsável:    ' + responsavel + '\n' +
    'E-mail:         ' + emailContato + '\n' +
    'Telefone:       ' + telContato + '\n\n' +
    '📌 VAGA\n' +
    'Tipo:           ' + tipoVaga + '\n' +
    'Título:         ' + tituloVaga + '\n' +
    'Área/Curso:     ' + areaCurso + '\n' +
    'Cidade:         ' + cidadeVaga + ' | ' + modalidade + '\n' +
    'Carga horária:  ' + cargaHoraria + '\n' +
    'Remuneração:    ' + remuneracao + '\n\n' +
    '⚡ AÇÃO NECESSÁRIA: Analisar e alterar status para "Aprovada" para publicar no portal.\n',
    { name: 'Sistema de Estágios IFRS' }
  );

  return { mensagem: 'Oportunidade enviada com sucesso! Será analisada antes da divulgação.' };
}

// ─────────────────────────────────────────
//  AUXILIARES — VALIDAÇÃO
// ─────────────────────────────────────────

function validarCNPJ_(cnpj) {
  var d = cnpj.replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  var t = d.length - 2, n = d.substring(0, t), c = d.substring(t);
  var s = 0, p = t - 7;
  for (var i = t; i >= 1; i--) { s += parseInt(n.charAt(t - i)) * p--; if (p < 2) p = 9; }
  var r = s % 11 < 2 ? 0 : 11 - (s % 11);
  if (r !== parseInt(c.charAt(0))) return false;
  t++; n = d.substring(0, t); s = 0; p = t - 7;
  for (var j = t; j >= 1; j--) { s += parseInt(n.charAt(t - j)) * p--; if (p < 2) p = 9; }
  r = s % 11 < 2 ? 0 : 11 - (s % 11);
  return r === parseInt(c.charAt(1));
}

function validarCPF_(cpf) {
  var d = cpf.replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  var s = 0;
  for (var i = 0; i < 9; i++) s += parseInt(d[i]) * (10 - i);
  var r = (s * 10) % 11; if (r === 10 || r === 11) r = 0;
  if (r !== parseInt(d[9])) return false;
  s = 0;
  for (var j = 0; j < 10; j++) s += parseInt(d[j]) * (11 - j);
  r = (s * 10) % 11; if (r === 10 || r === 11) r = 0;
  return r === parseInt(d[10]);
}

function validarEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function normalizarCNPJ_(cnpj) {
  return String(cnpj || '').replace(/[.\-\/]/g, '').trim();
}

function normalizarCPF_(cpf) {
  return String(cpf || '').replace(/[.\-]/g, '').trim();
}

// Remove tags HTML e limita comprimento para prevenir injeção
function sanitizar_(val) {
  if (val === null || val === undefined) return '';
  return String(val).replace(/<[^>]*>/g, '').trim().substring(0, 2000);
}

// ─────────────────────────────────────────
//  AUXILIARES — BUSCA NAS PLANILHAS
// ─────────────────────────────────────────

function buscarEmpresaPorCNPJ_(aba, cnpjNorm, linhaAtual) {
  var dados = aba.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    var ln = i + 1;
    if (ln === linhaAtual) continue;
    var status = String(dados[i][COL_EMP.STATUS] || '');
    if (status.indexOf('Processada') > -1) continue;
    if (normalizarCNPJ_(dados[i][COL_EMP.CNPJ]) === cnpjNorm && cnpjNorm) return ln;
  }
  return 0;
}

function buscarSupervisorPorCPF_(aba, cpfNorm, linhaAtual) {
  var dados = aba.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    var ln = i + 1;
    if (ln === linhaAtual) continue;
    var status = String(dados[i][COL_SUP.STATUS] || '');
    if (status.indexOf('Processada') > -1) continue;
    if (normalizarCPF_(dados[i][COL_SUP.CPF]) === cpfNorm && cpfNorm) return ln;
  }
  return 0;
}

// ─────────────────────────────────────────
//  AUXILIARES — NOTIFICAÇÕES
// ─────────────────────────────────────────

function notificarSetor_(razaoSocial, cnpj, emailRep, tipo) {
  GmailApp.sendEmail(
    CFG.EMAIL_SETOR,
    '[CADASTRO EMPRESA] ' + tipo + ' — ' + razaoSocial,
    'Nova atividade via formulário web.\n\nTipo: ' + tipo +
    '\nEmpresa: ' + razaoSocial + '\nCNPJ: ' + cnpj + '\nE-mail rep.: ' + emailRep,
    { name: 'Sistema de Estágios IFRS' }
  );
}

function enviarConfirmacao_(emailEmp, emailRep, nomeRep, razaoSocial, tipo) {
  var assunto = tipo === 'novo'
    ? '[IFRS Estágios] Cadastro recebido — ' + razaoSocial
    : '[IFRS Estágios] Atualização recebida — ' + razaoSocial;
  var corpo = 'Olá' + (nomeRep ? ', ' + nomeRep : '') + ',\n\n' +
    (tipo === 'novo'
      ? 'O cadastro da empresa ' + razaoSocial + ' foi recebido com sucesso.'
      : 'A solicitação de atualização da empresa ' + razaoSocial + ' foi recebida.') +
    '\n\nAps validação, você receberá uma confirmação.\nPrazo: até 1 dia útil.' +
    '\n\nDúvidas: ' + CFG.EMAIL_SETOR + '\n\nAtenciosamente,\n' + CFG.NOME_SETOR;
  var opts = { name: CFG.NOME_SETOR, replyTo: CFG.EMAIL_SETOR };
  try { if (emailEmp) GmailApp.sendEmail(emailEmp, assunto, corpo, opts); } catch(e) {}
  try { if (emailRep && emailRep !== emailEmp) GmailApp.sendEmail(emailRep, assunto, corpo, opts); } catch(e) {}
}

function registrarLog_(ss, cnpj, razaoSocial, tipo, campo, por) {
  var abaLog = ss.getSheetByName(CFG.ABA_LOG);
  if (!abaLog) return;
  abaLog.appendRow([new Date(), cnpj, razaoSocial, tipo, campo, '', '', por]);
}

// ─────────────────────────────────────────
//  AUXILIARES — RATE LIMITING SIMPLES
//  Conta requisições via PropertiesService
//  (não é à prova de bala, mas reduz spam básico)
// ─────────────────────────────────────────

function checkRateLimit_(action) {
  try {
    var props = PropertiesService.getScriptProperties();
    var key = 'rl_' + action + '_' + Math.floor(Date.now() / 60000); // por minuto
    var count = parseInt(props.getProperty(key) || '0', 10);
    if (count >= CFG.RATE_LIMIT) return false;
    props.setProperty(key, String(count + 1));
    return true;
  } catch (e) {
    return true; // Em caso de erro no rate limit, deixa passar
  }
}

// ─────────────────────────────────────────
//  AUXILIARES — RESPOSTAS JSON
// ─────────────────────────────────────────

function jsonOk_(data) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, data: data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonError_(msg, code) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, error: msg, code: code || 500 }))
    .setMimeType(ContentService.MimeType.JSON);
}

function logErro_(contexto, err) {
  Logger.log('[ERRO ' + contexto + '] ' + err.toString());
  try {
    GmailApp.sendEmail(
      CFG.EMAIL_SETOR,
      '[ERRO GAS] ' + contexto + ' — ' + err.message,
      'Erro no Web App.\n\nContexto: ' + contexto + '\nErro: ' + err.toString() +
      '\nStack: ' + (err.stack || 'N/A'),
      { name: 'Sistema de Estágios IFRS' }
    );
  } catch(e) {}
}
