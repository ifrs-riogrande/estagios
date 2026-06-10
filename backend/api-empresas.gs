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
// Mapeamento de colunas da aba "Empresas" (base 0)
// Estrutura real da planilha (após inserção da coluna Bairro após Endereço):
//   A=Timestamp, B=E-mail Form., C=Tipo, D=Razão Social, E=Nome Fantasia,
//   F=CNPJ, G=Ramo, H=Endereço, I=Bairro, J=Município, K=UF, L=CEP,
//   M=Telefone, N=E-mail, O=Site, P=Nome Representante, Q=Cargo Representante,
//   R=E-mail Representante, S=CPF Representante, T=Status
var COL_EMP = {
  TIMESTAMP:    0, EMAIL_FORM:  1, TIPO:       2, RAZAO_SOCIAL: 3,
  NOME_FANTASIA:4, CNPJ:        5, RAMO:       6, ENDERECO:     7,
  BAIRRO:       8, MUNICIPIO:   9, UF:        10, CEP:          11,
  TEL_EMPRESA: 12, EMAIL_EMPRESA:13, SITE:    14,
  NOME_REP:    15, CARGO_REP:  16, EMAIL_REP: 17, CPF_REP:      18,
  STATUS:      19, CODIGO_ACESSO: 20, DRIVE_DOCS: 21, OBSERVACOES: 22,
  EMAIL_ESTUDANTE_REF: 23,
  POSSUI_CONVENIO: 24, DRIVE_CONVENIO: 25,
  DRIVE_CDN_EMPRESA: 26, DRIVE_CDN_SIGNATARIO: 27,
};

// Colunas da planilha de supervisores (base 0)
var COL_SUP = {
  TIMESTAMP: 0, EMAIL_FORM: 1, TIPO: 2, EMPRESA: 3,
  SETOR: 4, ENDERECO_SETOR: 5, EMAIL_SETOR_SUP: 6, TEL_SETOR: 7,
  NOME: 8, CPF: 9, CARGO: 10, TEL_SUP: 11,
  EMAIL_SUP: 12, NIVEL_FORMACAO: 13, AREA_FORMACAO: 14,
  INSTITUICAO: 15, TEMPO_EXP: 16, DESC_EXP: 17, DECLARACAO: 18,
  STATUS: 19, VALIDADO_POR: 20, DATA_VALIDACAO: 21,
  OBSERVACOES: 22, DATA_ULT_ATZ: 23, CODIGO_ACESSO: 24,
  EMAIL_ESTUDANTE_REF: 25,
};

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
  var bairro      = sanitizar_(dados.bairro);
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
  var declaracao      = sanitizar_(dados.declaracao);
  var emailEstRef     = sanitizar_(dados.emailEstudanteRef || '', 150).toLowerCase();
  var possuiConvenio  = sanitizar_(dados.possuiConvenio || '');
  if (possuiConvenio !== 'Sim' && possuiConvenio !== 'Não') possuiConvenio = '';

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

  // Linha alinhada com COL_EMP (colunas A–X da aba Empresas)
  var novaLinha = [
    timestamp,                      // 0  A — Timestamp
    emailRep,                       // 1  B — E-mail Form.
    tipo,                           // 2  C — Tipo
    razaoSocial,                    // 3  D — Razão Social
    sanitizar_(dados.nomeFantasia), // 4  E — Nome Fantasia
    cnpj,                           // 5  F — CNPJ
    ramo,                           // 6  G — Ramo
    endereco,                       // 7  H — Endereço
    bairro,                         // 8  I — Bairro
    municipio,                      // 9  J — Município
    uf,                             // 10 K — UF
    cep,                            // 11 L — CEP
    telEmpresa,                     // 12 M — Telefone
    emailEmp,                       // 13 N — E-mail
    site,                           // 14 O — Site
    nomeRep,                        // 15 P — Nome Representante
    cargoRep,                       // 16 Q — Cargo Representante
    emailRep,                       // 17 R — E-mail Representante
    cpfRep,                         // 18 S — CPF Representante
    'Pendente',                     // 19 T — Status
    '',                             // 20 U — Código Acesso
    '',                             // 21 V — Drive Docs
    '',                             // 22 W — Observações
    emailEstRef,                    // 23 X — E-mail Estudante Ref.
    possuiConvenio,                 // 24 Y — Possui Convênio
    '',                             // 25 Z — Drive Convênio
    '',                             // 26 AA — Drive CDN Empresa
    '',                             // 27 AB — Drive CDN Signatário
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
        {col: COL_EMP.ENDERECO,       val: endereco      },
        {col: COL_EMP.BAIRRO,         val: bairro        },
        {col: COL_EMP.MUNICIPIO,      val: municipio     },
        {col: COL_EMP.UF,             val: uf            },
        {col: COL_EMP.CEP,            val: cep           },
        {col: COL_EMP.TEL_EMPRESA,    val: telEmpresa    },
        {col: COL_EMP.EMAIL_EMPRESA,  val: emailEmp      },
        {col: COL_EMP.SITE,           val: site          },
        {col: COL_EMP.NOME_REP,       val: nomeRep       },
        {col: COL_EMP.CARGO_REP,      val: cargoRep      },
        {col: COL_EMP.EMAIL_REP,       val: emailRep       },
        {col: COL_EMP.POSSUI_CONVENIO, val: possuiConvenio },
      ];
      campos.forEach(function(c) {
        aba.getRange(linhaExistente, c.col + 1).setValue(c.val);
      });
      // Atualiza emailEstRef somente se vier na requisição (preserva o existente caso o supervisor atualize por conta própria)
      if (emailEstRef) {
        aba.getRange(linhaExistente, COL_EMP.EMAIL_ESTUDANTE_REF + 1).setValue(emailEstRef);
      }
      aba.getRange(linhaExistente, COL_EMP.STATUS + 1).setValue('Pendente');
      var notaConvenio = possuiConvenio ? 'Possui Convênio com IFRS: ' + possuiConvenio : '';
      notificarSetor_(razaoSocial, cnpj, emailRep, 'Atualização de cadastro', notaConvenio);
      enviarConfirmacao_(emailEmp, emailRep, nomeRep, razaoSocial, 'atualizacao');
      return { mensagem: 'Atualização recebida. Seus dados serão verificados em até 1 dia útil.' };
    }
  }

  // Verifica duplicata para novo cadastro
  if (tipo === 'Novo cadastro') {
    var dupLinha = buscarEmpresaPorCNPJ_(aba, cnpjNorm, -1);
    if (dupLinha > 0) {
      novaLinha[COL_EMP.STATUS] = 'Pendente de correção';
    }
  }

  aba.appendRow(novaLinha);

  // Formatação visual da nova linha
  var ultimaLinha = aba.getLastRow();
  var cor = novaLinha[COL_EMP.STATUS] === 'Pendente de correção' ? '#FFCDD2' : '#FFF9C4';
  aba.getRange(ultimaLinha, 1, 1, aba.getLastColumn()).setBackground(cor);

  // Notificações
  var _notaConvenio = possuiConvenio ? 'Possui Convênio com IFRS: ' + possuiConvenio : '';
  notificarSetor_(razaoSocial, cnpj, emailRep, tipo, _notaConvenio);
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
  var emailEstRef   = sanitizar_(dados.emailEstudanteRef || '', 150).toLowerCase();

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
    '',              // 24 — CODIGO_ACESSO (preenchido na aprovação)
    emailEstRef,     // 25 — EMAIL_ESTUDANTE_REF
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
    // Atualiza emailEstRef somente se vier na requisição (preserva o existente caso o supervisor atualize por conta própria)
    if (emailEstRef) {
      aba.getRange(linhaExistente, COL_SUP.EMAIL_ESTUDANTE_REF + 1).setValue(emailEstRef);
    }
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
    validarUrl_(sanitizar_(dados.comoCandidatar)),
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
//  GET: obterCadastroEmpresa
//  Busca empresa por CNPJ (PJ) ou CPF (PL / Produtor Rural)
//  Sem autenticação — segurança via validação humana (status Pendente)
// ─────────────────────────────────────────
function obterCadastroEmpresa_(cnpjCpf, codigo) {
  var doc = String(cnpjCpf || '').replace(/\D/g, '');
  if (!doc) throw new Error('Documento inválido.');

  var ss  = SpreadsheetApp.openById(CFG.ID_EMPRESAS);
  var aba = ss.getSheetByName(CFG.ABA_EMPRESAS);
  if (!aba) throw new Error('Planilha não configurada.');

  var dados = aba.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    var status  = String(dados[i][COL_EMP.STATUS] || '').trim();
    if (status.indexOf('Processada') > -1) continue;
    var docLinha = String(dados[i][COL_EMP.CNPJ] || '').replace(/\D/g, '').trim();
    if (docLinha !== doc) continue;

    // Soft-deleted — empresa vê mensagem amigável
    if (status === 'Excluída') {
      throw new Error('Este cadastro foi removido pelo setor de estágios. Entre em contato: ' + CFG.EMAIL_SETOR);
    }

    // Backward compat: registros antigos tinham TIPO = "Novo cadastro"
    var tipo = String(dados[i][COL_EMP.TIPO] || '').trim();
    if (tipo !== 'Pessoa Jurídica' && tipo !== 'Profissional Liberal' && tipo !== 'Produtor Rural') {
      tipo = 'Pessoa Jurídica';
    }

    // Empresa encontrada — sem código: retorna apenas dados públicos
    // (usado pelo formulário de solicitação para confirmar existência)
    if (!codigo) {
      return {
        existe:      true,
        razaoSocial: String(dados[i][COL_EMP.RAZAO_SOCIAL] || '').trim(),
        status:      status,
        tipo:        tipo,
      };
    }

    // Com código: valida antes de expor dados sensíveis
    var codigoSalvo     = String(dados[i][COL_EMP.CODIGO_ACESSO] || '').trim();
    var codigoInformado = String(codigo).trim().toUpperCase();
    if (!codigoSalvo || codigoInformado !== codigoSalvo) {
      throw new Error('Código de acesso inválido. Verifique o e-mail enviado pelo setor.');
    }

    // Código correto — retorna dados completos
    return {
      tipo:           tipo,
      razaoSocial:    String(dados[i][COL_EMP.RAZAO_SOCIAL]  || '').trim(),
      nomeFantasia:   String(dados[i][COL_EMP.NOME_FANTASIA]  || '').trim(),
      cnpj:           String(dados[i][COL_EMP.CNPJ]           || '').trim(),
      ramo:           String(dados[i][COL_EMP.RAMO]           || '').trim(),
      endereco:       String(dados[i][COL_EMP.ENDERECO]       || '').trim(),
      bairro:         String(dados[i][COL_EMP.BAIRRO]         || '').trim(),
      municipio:      String(dados[i][COL_EMP.MUNICIPIO]      || '').trim(),
      uf:             String(dados[i][COL_EMP.UF]             || '').trim(),
      cep:            String(dados[i][COL_EMP.CEP]            || '').trim(),
      telEmpresa:     String(dados[i][COL_EMP.TEL_EMPRESA]    || '').trim(),
      emailEmpresa:   String(dados[i][COL_EMP.EMAIL_EMPRESA]  || '').trim(),
      site:           String(dados[i][COL_EMP.SITE]           || '').trim(),
      nomeRep:        String(dados[i][COL_EMP.NOME_REP]       || '').trim(),
      cargoRep:       String(dados[i][COL_EMP.CARGO_REP]      || '').trim(),
      emailRep:       String(dados[i][COL_EMP.EMAIL_REP]      || '').trim(),
      cpfRep:         String(dados[i][COL_EMP.CPF_REP]        || '').trim(),
      status:         status,
      obs:            String(dados[i][COL_EMP.OBSERVACOES]    || '').trim(),
    };
  }
  throw new Error('Cadastro não encontrado para este documento.');
}

// ─────────────────────────────────────────
//  POST: salvarMeuCadastroEmpresa
//  Cria novo ou atualiza concedente (CNPJ ou CPF como identificador)
//  Sem autenticação — segurança via status Pendente + validação humana
// ─────────────────────────────────────────
function salvarMeuCadastroEmpresa_(body) {
  var tipo          = sanitizar_(body.tipo);
  var cnpjCpf       = sanitizar_(body.cnpj).replace(/\D/g, '');
  var razaoSocial   = sanitizar_(body.razaoSocial);
  var nomeFantasia  = sanitizar_(body.nomeFantasia);
  var ramo          = sanitizar_(body.ramo);
  var endereco      = sanitizar_(body.endereco);
  var bairro        = sanitizar_(body.bairro);
  var municipio     = sanitizar_(body.municipio);
  var uf            = sanitizar_(body.uf);
  var cep           = sanitizar_(body.cep);
  var telEmpresa    = sanitizar_(body.telEmpresa);
  var emailEmp      = sanitizar_(body.emailEmpresa).toLowerCase();
  var site          = validarUrl_(sanitizar_(body.site));
  var registroProf  = sanitizar_(body.registroProf);
  var blocoProdutor = sanitizar_(body.blocoProdutor);

  // Validação do tipo de concedente
  var tiposValidos = ['Pessoa Jurídica', 'Profissional Liberal', 'Produtor Rural'];
  if (tiposValidos.indexOf(tipo) === -1) throw new Error('Tipo de concedente inválido.');

  var isPJ = tipo === 'Pessoa Jurídica';
  var isPL = tipo === 'Profissional Liberal';

  if (!razaoSocial) throw new Error((isPJ ? 'Razão social' : 'Nome') + ' é obrigatório.');
  if (!ramo)        throw new Error((isPL ? 'Profissão' : (isPJ ? 'Ramo de atividade' : 'Atividade rural')) + ' é obrigatório.');
  if (!validarEmail_(emailEmp)) throw new Error('E-mail de contato inválido.');

  if (isPJ) {
    if (!validarCNPJ_(cnpjCpf)) throw new Error('CNPJ inválido.');
    if (cnpjCpf === '10581068000153') throw new Error('Estágios no IFRS têm um processo específico. Entre em contato com o setor.');
  } else {
    if (!validarCPF_(cnpjCpf)) throw new Error('CPF inválido.');
  }

  // Representante legal
  var nomeRep, cargoRep, emailRep, cpfRep;
  if (isPJ) {
    nomeRep  = sanitizar_(body.nomeRep);
    cargoRep = sanitizar_(body.cargoRep);
    emailRep = sanitizar_(body.emailRep).toLowerCase();
    cpfRep   = sanitizar_(body.cpfRep).replace(/\D/g, '');
    if (!nomeRep)                    throw new Error('Nome do representante é obrigatório.');
    if (!cargoRep)                   throw new Error('Cargo do representante é obrigatório.');
    if (!validarEmail_(emailRep))    throw new Error('E-mail do representante inválido.');
    if (!validarCPF_(cpfRep))        throw new Error('CPF do representante inválido.');
  } else {
    // Para PL e Produtor Rural, o próprio é o representante
    nomeRep  = razaoSocial;
    cargoRep = tipo;
    emailRep = emailEmp;
    cpfRep   = cnpjCpf;
  }

  var ss  = SpreadsheetApp.openById(CFG.ID_EMPRESAS);
  var aba = ss.getSheetByName(CFG.ABA_EMPRESAS);
  if (!aba) throw new Error('Planilha não configurada.');

  var linhaExistente = buscarEmpresaPorCNPJ_(aba, cnpjCpf, -1);
  var timestamp      = new Date();

  if (linhaExistente > 0) {
    var campos = [
      { col: COL_EMP.TIPO,           val: tipo          },
      { col: COL_EMP.RAZAO_SOCIAL,   val: razaoSocial   },
      { col: COL_EMP.NOME_FANTASIA,  val: nomeFantasia  },
      { col: COL_EMP.RAMO,           val: ramo          },
      { col: COL_EMP.ENDERECO,       val: endereco      },
      { col: COL_EMP.BAIRRO,         val: bairro        },
      { col: COL_EMP.MUNICIPIO,      val: municipio     },
      { col: COL_EMP.UF,             val: uf            },
      { col: COL_EMP.CEP,            val: cep           },
      { col: COL_EMP.TEL_EMPRESA,    val: telEmpresa    },
      { col: COL_EMP.EMAIL_EMPRESA,  val: emailEmp      },
      { col: COL_EMP.SITE,           val: site          },
      { col: COL_EMP.NOME_REP,       val: nomeRep       },
      { col: COL_EMP.CARGO_REP,      val: cargoRep      },
      { col: COL_EMP.EMAIL_REP,      val: emailRep      },
    ];
    campos.forEach(function(c) {
      aba.getRange(linhaExistente, c.col + 1).setValue(c.val);
    });
    aba.getRange(linhaExistente, COL_EMP.STATUS + 1).setValue('Pendente');
    notificarSetor_(razaoSocial, cnpjCpf, emailRep, 'Atualização de cadastro');
    return { mensagem: 'Dados atualizados. Aguarde validação do setor (prazo: 1 dia útil).', acao: 'atualizado' };
  }

  // Novo cadastro — gera código de acesso imediatamente (EMP-XXXXXX)
  var codigoAcesso = 'EMP-' + Utilities.getUuid().replace(/-/g,'').slice(0,8).toUpperCase();

  var novaLinha = new Array(23).fill('');
  novaLinha[COL_EMP.TIMESTAMP]      = timestamp;
  novaLinha[COL_EMP.EMAIL_FORM]     = emailRep;
  novaLinha[COL_EMP.TIPO]           = tipo;
  novaLinha[COL_EMP.RAZAO_SOCIAL]   = razaoSocial;
  novaLinha[COL_EMP.NOME_FANTASIA]  = nomeFantasia;
  novaLinha[COL_EMP.CNPJ]           = cnpjCpf;
  novaLinha[COL_EMP.RAMO]           = ramo;
  novaLinha[COL_EMP.ENDERECO]       = endereco;
  novaLinha[COL_EMP.BAIRRO]         = bairro;
  novaLinha[COL_EMP.MUNICIPIO]      = municipio;
  novaLinha[COL_EMP.UF]             = uf;
  novaLinha[COL_EMP.CEP]            = cep;
  novaLinha[COL_EMP.TEL_EMPRESA]    = telEmpresa;
  novaLinha[COL_EMP.EMAIL_EMPRESA]  = emailEmp;
  novaLinha[COL_EMP.SITE]           = site;
  novaLinha[COL_EMP.NOME_REP]       = nomeRep;
  novaLinha[COL_EMP.CARGO_REP]      = cargoRep;
  novaLinha[COL_EMP.EMAIL_REP]      = emailRep;
  novaLinha[COL_EMP.CPF_REP]        = cpfRep;
  novaLinha[COL_EMP.STATUS]         = 'Pendente';
  novaLinha[COL_EMP.CODIGO_ACESSO]  = codigoAcesso;

  aba.appendRow(novaLinha);
  aba.getRange(aba.getLastRow(), 1, 1, aba.getLastColumn()).setBackground('#FFF9C4');

  notificarSetor_(razaoSocial, cnpjCpf, emailRep, 'Novo cadastro');
  enviarConfirmacaoComCodigo_(emailEmp, emailRep, nomeRep, razaoSocial, codigoAcesso);

  return { mensagem: 'Cadastro enviado! Seu código de acesso foi enviado por e-mail.', acao: 'cadastrado' };
}

// ─────────────────────────────────────────
//  GET: obterCadastroSupervisor
//  Busca supervisor pelo CPF (sem autenticação)
// ─────────────────────────────────────────
function obterCadastroSupervisor_(cpf, codigo) {
  var doc = String(cpf || '').replace(/\D/g, '');
  if (!doc) throw new Error('CPF inválido.');

  var ss  = SpreadsheetApp.openById(CFG.ID_SUPERVISORES);
  var aba = ss.getSheetByName(CFG.ABA_SUP_RESPOSTAS);
  if (!aba) throw new Error('Planilha não configurada.');

  var dados = aba.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    var status = String(dados[i][COL_SUP.STATUS] || '').trim();
    if (status.indexOf('Processada') > -1) continue;
    var cpfLinha = String(dados[i][COL_SUP.CPF] || '').replace(/\D/g, '').trim();
    if (cpfLinha !== doc) continue;

    // Excluído — removido pelo setor
    if (status === 'Excluído') {
      throw new Error('Este cadastro foi removido pelo setor de estágios. Entre em contato: ' + CFG.EMAIL_SETOR);
    }

    // Pendente — verifica se já tem código (gerado no cadastro)
    if (status === 'Pendente') {
      var codigoPend = String(dados[i][COL_SUP.CODIGO_ACESSO] || '').trim();
      if (!codigoPend) {
        // Cadastro antigo sem código — mostra painel de espera
        return {
          pendente: true,
          status:   'Pendente',
          nome:     String(dados[i][COL_SUP.NOME] || '').trim(),
        };
      }
      // Tem código → trata igual a Validado/Recusado/Inativo
    }

    // Validado / Inativo / Recusado / Pendente (com código) — requer código de acesso
    var codigoSalvo = String(dados[i][COL_SUP.CODIGO_ACESSO] || '').trim().toUpperCase();
    var codigoInfo  = String(codigo || '').trim().toUpperCase();

    if (!codigoInfo) {
      // Sem código na requisição → frontend deve mostrar campo de código
      return { codigoNecessario: true, status: status };
    }
    if (!codigoSalvo || codigoInfo !== codigoSalvo) {
      throw new Error('Código de acesso inválido. Verifique o e-mail enviado pelo setor.');
    }

    // Código correto — retorna dados completos
    var empStr = String(dados[i][COL_SUP.EMPRESA] || '');
    var partes = empStr.split('—');

    return {
      empresa:          partes[0] ? partes[0].trim() : '',
      empresaNome:      partes[1] ? partes[1].trim() : empStr.trim(),
      setor:            String(dados[i][COL_SUP.SETOR]          || '').trim(),
      enderecoSetor:    String(dados[i][COL_SUP.ENDERECO_SETOR] || '').trim(),
      emailSetor:       String(dados[i][COL_SUP.EMAIL_SETOR_SUP]|| '').trim(),
      telSetor:         String(dados[i][COL_SUP.TEL_SETOR]      || '').trim(),
      nome:             String(dados[i][COL_SUP.NOME]           || '').trim(),
      cpf:              String(dados[i][COL_SUP.CPF]            || '').trim(),
      cargo:            String(dados[i][COL_SUP.CARGO]          || '').trim(),
      telSupervisor:    String(dados[i][COL_SUP.TEL_SUP]        || '').trim(),
      emailSupervisor:  String(dados[i][COL_SUP.EMAIL_SUP]      || '').trim(),
      nivelFormacao:    String(dados[i][COL_SUP.NIVEL_FORMACAO] || '').trim(),
      areaFormacao:     String(dados[i][COL_SUP.AREA_FORMACAO]  || '').trim(),
      instituicao:      String(dados[i][COL_SUP.INSTITUICAO]    || '').trim(),
      tempoExperiencia: String(dados[i][COL_SUP.TEMPO_EXP]      || '').trim(),
      descExperiencia:  String(dados[i][COL_SUP.DESC_EXP]       || '').trim(),
      status:           status,
      obs:              String(dados[i][COL_SUP.OBSERVACOES]     || '').trim(),
    };
  }
  throw new Error('Supervisor não encontrado para este CPF.');
}

// ─────────────────────────────────────────
//  POST: salvarMeuCadastroSupervisor
//  Cria novo ou atualiza supervisor existente (CPF como identificador)
//  Sem autenticação — segurança via status Pendente + validação humana
// ─────────────────────────────────────────
function salvarMeuCadastroSupervisor_(body) {

  var empresa       = sanitizar_(body.empresa);
  var empresaNome   = sanitizar_(body.empresaNome);
  var setor         = sanitizar_(body.setor);
  var telSetor      = sanitizar_(body.telSetor);
  var emailSetorSup = sanitizar_(body.emailSetor).toLowerCase();
  var endSetor      = sanitizar_(body.enderecoSetor);
  var nome          = sanitizar_(body.nome);
  var cpf           = sanitizar_(body.cpf);
  var cargo         = sanitizar_(body.cargo);
  var telSup        = sanitizar_(body.telSupervisor);
  var emailSup      = sanitizar_(body.emailSupervisor).toLowerCase();
  var nivelForm     = sanitizar_(body.nivelFormacao);
  var areaForm      = sanitizar_(body.areaFormacao);
  var instituicao   = sanitizar_(body.instituicao);
  var tempoExp      = sanitizar_(body.tempoExperiencia);
  var descExp       = sanitizar_(body.descExperiencia);

  if (!nome)                   throw new Error('Nome é obrigatório.');
  if (!validarCPF_(cpf))       throw new Error('CPF inválido.');
  if (!validarEmail_(emailSup)) throw new Error('E-mail do supervisor inválido.');
  if (!empresa)                throw new Error('Empresa é obrigatória.');
  if (!setor)                  throw new Error('Setor é obrigatório.');
  if (!nivelForm)              throw new Error('Nível de formação é obrigatório.');
  if (!areaForm)               throw new Error('Área de formação é obrigatória.');
  if (!tempoExp)               throw new Error('Tempo de experiência é obrigatório.');
  if (!descExp || descExp.length < 50) throw new Error('Descrição da experiência muito curta.');

  var ss  = SpreadsheetApp.openById(CFG.ID_SUPERVISORES);
  var aba = ss.getSheetByName(CFG.ABA_SUP_RESPOSTAS);
  if (!aba) throw new Error('Planilha não configurada.');

  var timestamp      = new Date();
  var cpfNorm        = normalizarCPF_(cpf);
  var linhaExistente = buscarSupervisorPorCPF_(aba, cpfNorm, -1);

  if (linhaExistente > 0) {
    // Se o supervisor já foi validado anteriormente, exige o código de acesso para confirmar identidade
    var rowAtual    = aba.getRange(linhaExistente, 1, 1, 25).getValues()[0];
    var statusAtual = String(rowAtual[COL_SUP.STATUS] || '').trim();
    if (statusAtual !== 'Pendente') {
      var codigoSalvo  = String(rowAtual[COL_SUP.CODIGO_ACESSO] || '').trim().toUpperCase();
      var codigoEnviad = String(body.codigoAcesso || '').trim().toUpperCase();
      if (!codigoEnviad || codigoEnviad !== codigoSalvo) {
        throw new Error('Código de acesso inválido. Autentique-se novamente para editar seus dados.');
      }
    }

    var campos = [
      { col: COL_SUP.EMPRESA,         val: empresa + ' — ' + empresaNome },
      { col: COL_SUP.SETOR,           val: setor         },
      { col: COL_SUP.TEL_SETOR,       val: telSetor      },
      { col: COL_SUP.EMAIL_SETOR_SUP, val: emailSetorSup },
      { col: COL_SUP.ENDERECO_SETOR,  val: endSetor      },
      { col: COL_SUP.CARGO,           val: cargo         },
      { col: COL_SUP.TEL_SUP,         val: telSup        },
      { col: COL_SUP.EMAIL_SUP,       val: emailSup      },
      { col: COL_SUP.NIVEL_FORMACAO,  val: nivelForm     },
      { col: COL_SUP.AREA_FORMACAO,   val: areaForm      },
      { col: COL_SUP.INSTITUICAO,     val: instituicao   },
      { col: COL_SUP.TEMPO_EXP,       val: tempoExp      },
      { col: COL_SUP.DESC_EXP,        val: descExp       },
      { col: COL_SUP.DATA_ULT_ATZ,    val: timestamp     },
      { col: COL_SUP.OBSERVACOES,     val: ''            },  // limpa obs de recusa anterior
    ];
    campos.forEach(function(c) {
      aba.getRange(linhaExistente, c.col + 1).setValue(c.val);
    });
    aba.getRange(linhaExistente, COL_SUP.STATUS + 1).setValue('Pendente');
    GmailApp.sendEmail(CFG.EMAIL_SETOR,
      '[ATUALIZAÇÃO SUPERVISOR] ' + nome,
      'Atualização de supervisor via portal web.\nNome: ' + nome + '\nEmpresa: ' + empresaNome,
      { name: 'Sistema de Estágios IFRS' }
    );
    return { mensagem: 'Dados atualizados. Aguarde validação do setor (prazo: 1 dia útil).', acao: 'atualizado' };
  }

  // Novo cadastro
  var codigoAcesso = 'SUP-' + Utilities.getUuid().replace(/-/g,'').slice(0,8).toUpperCase();
  var novaLinha = new Array(25).fill('');
  novaLinha[COL_SUP.TIMESTAMP]      = timestamp;
  novaLinha[COL_SUP.EMAIL_FORM]     = emailSup;
  novaLinha[COL_SUP.TIPO]           = 'Novo cadastro';
  novaLinha[COL_SUP.EMPRESA]        = empresa + ' — ' + empresaNome;
  novaLinha[COL_SUP.SETOR]          = setor;
  novaLinha[COL_SUP.ENDERECO_SETOR] = endSetor;
  novaLinha[COL_SUP.EMAIL_SETOR_SUP]= emailSetorSup;
  novaLinha[COL_SUP.TEL_SETOR]      = telSetor;
  novaLinha[COL_SUP.NOME]           = nome;
  novaLinha[COL_SUP.CPF]            = cpf;
  novaLinha[COL_SUP.CARGO]          = cargo;
  novaLinha[COL_SUP.TEL_SUP]        = telSup;
  novaLinha[COL_SUP.EMAIL_SUP]      = emailSup;
  novaLinha[COL_SUP.NIVEL_FORMACAO] = nivelForm;
  novaLinha[COL_SUP.AREA_FORMACAO]  = areaForm;
  novaLinha[COL_SUP.INSTITUICAO]    = instituicao;
  novaLinha[COL_SUP.TEMPO_EXP]      = tempoExp;
  novaLinha[COL_SUP.DESC_EXP]       = descExp;
  novaLinha[COL_SUP.DECLARACAO]     = 'Sim — via portal web';
  novaLinha[COL_SUP.STATUS]         = 'Pendente';
  novaLinha[COL_SUP.DATA_ULT_ATZ]   = timestamp;
  novaLinha[COL_SUP.CODIGO_ACESSO]  = codigoAcesso;

  aba.appendRow(novaLinha);
  aba.getRange(aba.getLastRow(), 1, 1, aba.getLastColumn()).setBackground('#FFF9C4');

  GmailApp.sendEmail(CFG.EMAIL_SETOR,
    '[NOVO SUPERVISOR] ' + nome + ' — ' + empresaNome,
    'Novo supervisor cadastrado via portal.\nNome: ' + nome + '\nCPF: ' + cpf +
    '\nEmpresa: ' + empresaNome + '\nSetor: ' + setor + '\nE-mail: ' + emailSup,
    { name: 'Sistema de Estágios IFRS' }
  );
  GmailApp.sendEmail(emailSup,
    '[IFRS Estágios] Cadastro recebido — seu código de acesso',
    'Olá, ' + nome + ',\n\n' +
    'Seu cadastro como supervisor de estágio foi recebido e está aguardando validação.\n\n' +
    '━━━━━━━━━━━━━━━━━━━━\n' +
    'SEU CÓDIGO DE ACESSO: ' + codigoAcesso + '\n' +
    '━━━━━━━━━━━━━━━━━━━━\n\n' +
    'Guarde este código. Você precisará dele para acessar seu perfil no portal:\n' +
    'https://ifrs-riogrande.github.io/estagios/empresas/perfil-supervisor.html\n\n' +
    'Prazo de análise: até 1 dia útil.\n\n' +
    'Dúvidas: ' + CFG.EMAIL_SETOR + '\n\nAtenciosamente,\n' + CFG.NOME_SETOR,
    { name: CFG.NOME_SETOR, replyTo: CFG.EMAIL_SETOR }
  );

  return { mensagem: 'Cadastro enviado! Seu código de acesso foi enviado por e-mail.', acao: 'cadastrado' };
}

// ─────────────────────────────────────────
//  AUXILIAR — Verifica token Google OAuth
//  Retorna o e-mail do usuário autenticado
// ─────────────────────────────────────────
function verificarTokenGoogle_(token) {
  if (!token) throw new Error('Não autenticado. Faça login novamente.');
  try {
    var resp = UrlFetchApp.fetch(
      'https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=' + encodeURIComponent(token),
      { muteHttpExceptions: true }
    );
    var info = JSON.parse(resp.getContentText());
    if (info.error || !info.email) throw new Error('Token inválido ou expirado.');
    return info.email.toLowerCase().trim();
  } catch (e) {
    throw new Error('Falha na verificação do token: ' + e.message);
  }
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

function notificarSetor_(razaoSocial, cnpj, emailRep, tipo, notaExtra) {
  GmailApp.sendEmail(
    CFG.EMAIL_SETOR,
    '[CADASTRO EMPRESA] ' + tipo + ' — ' + razaoSocial,
    'Nova atividade via formulário web.\n\nTipo: ' + tipo +
    '\nEmpresa: ' + razaoSocial + '\nCNPJ: ' + cnpj + '\nE-mail rep.: ' + emailRep +
    (notaExtra ? '\n' + notaExtra : ''),
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
    '\n\nApós validação, você receberá uma confirmação.\nPrazo: até 1 dia útil.' +
    '\n\nDúvidas: ' + CFG.EMAIL_SETOR + '\n\nAtenciosamente,\n' + CFG.NOME_SETOR;
  var opts = { name: CFG.NOME_SETOR, replyTo: CFG.EMAIL_SETOR };
  try { if (emailEmp) GmailApp.sendEmail(emailEmp, assunto, corpo, opts); } catch(e) {}
  try { if (emailRep && emailRep !== emailEmp) GmailApp.sendEmail(emailRep, assunto, corpo, opts); } catch(e) {}
}

function enviarConfirmacaoComCodigo_(emailEmp, emailRep, nomeRep, razaoSocial, codigo) {
  var assunto = '[IFRS Estágios] Cadastro recebido — ' + razaoSocial;
  var corpo = [
    'Olá' + (nomeRep ? ', ' + nomeRep : '') + ',',
    '',
    'O cadastro de "' + razaoSocial + '" foi recebido com sucesso!',
    '',
    'Seu cadastro está em análise pelo setor de estágios (prazo: até 1 dia útil).',
    'Enquanto aguarda, você já pode acessar o portal com o código abaixo:',
    '',
    '  Código de acesso: ' + codigo,
    '',
    'Guarde este código — ele será necessário para visualizar e editar seus dados.',
    '',
    'Acesse o portal em: https://ifrs-riogrande.github.io/estagios/empresas/perfil-empresa.html',
    '',
    'Dúvidas: ' + CFG.EMAIL_SETOR,
    '',
    'Atenciosamente,',
    CFG.NOME_SETOR,
  ].join('\n');
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
//  POST: enviarDocumentosEmpresa
//  Cria pasta no Drive e salva documentos enviados como base64.
//  Chamado após o cadastro ser submetido.
// ─────────────────────────────────────────

function enviarDocumentosEmpresa_(body) {
  var cnpj        = sanitizar_(body.cnpj).replace(/\D/g, '');
  var razaoSocial = sanitizar_(body.razaoSocial) || 'Empresa';
  var documentos  = body.documentos;

  if (!cnpj) throw new Error('CNPJ/CPF obrigatório.');
  if (!Array.isArray(documentos) || documentos.length === 0) {
    throw new Error('Nenhum documento fornecido.');
  }
  if (documentos.length > 10) throw new Error('Máximo de 10 documentos por envio.');

  // Cria / localiza a pasta da empresa no Drive
  var pasta = obterPastaEmpresa_(cnpj, razaoSocial);
  var links = [];

  // Mapa: tipo do documento → coluna da planilha para salvar URL específica
  var colPorTipo = {
    'convenio':      COL_EMP.DRIVE_CONVENIO,        // 25
    'cdnEmpresa':    COL_EMP.DRIVE_CDN_EMPRESA,      // 26
    'cdnSignatario': COL_EMP.DRIVE_CDN_SIGNATARIO,   // 27
  };

  documentos.forEach(function(doc) {
    var tipo     = sanitizar_(doc.tipo  || 'Documento');
    var nome     = sanitizar_(doc.nome  || 'arquivo');
    var conteudo = String(doc.conteudo  || '');
    var mime     = sanitizar_(doc.mimeType || 'application/octet-stream');

    if (!conteudo) return; // arquivo vazio — ignora

    // Tamanho máx: base64 de 10 MB ≈ 13,4 MB de string
    if (conteudo.length > 14000000) {
      throw new Error('Arquivo "' + nome + '" excede o limite de 10 MB.');
    }

    try {
      var bytes   = Utilities.base64Decode(conteudo);
      var nomeArq = tipo + ' — ' + nome;
      var blob    = Utilities.newBlob(bytes, mime, nomeArq);
      var file    = pasta.createFile(blob);
      // DOMAIN_WITH_LINK: documentos de empresa restritos ao domínio institucional (LGPD)
      file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
      links.push({ tipo: tipo, nome: nome, url: file.getUrl() });
    } catch (e) {
      throw new Error('Erro ao salvar "' + nome + '": ' + e.message);
    }
  });

  // Registra URL da pasta e URLs dos documentos específicos na planilha
  try {
    var ss2  = SpreadsheetApp.openById(CFG.ID_EMPRESAS);
    var aba2 = ss2.getSheetByName(CFG.ABA_EMPRESAS);
    if (aba2) {
      var dadosPlanilha = aba2.getDataRange().getValues();
      for (var i = 1; i < dadosPlanilha.length; i++) {
        if (String(dadosPlanilha[i][COL_EMP.CNPJ] || '').replace(/\D/g, '') === cnpj) {
          var linhaNum = i + 1;
          aba2.getRange(linhaNum, COL_EMP.DRIVE_DOCS + 1).setValue(pasta.getUrl());
          // Salva URLs específicas por tipo (convenio, cdnEmpresa, cdnSignatario)
          links.forEach(function(lnk) {
            var col = colPorTipo[lnk.tipo];
            if (col !== undefined) {
              aba2.getRange(linhaNum, col + 1).setValue(lnk.url);
            }
          });
          break;
        }
      }
    }
  } catch (e2) { /* não bloqueia caso a coluna ainda não exista */ }

  return {
    mensagem:  links.length + ' documento(s) salvo(s) no Drive.',
    pastaUrl:  pasta.getUrl(),
    arquivos:  links,
  };
}

// Cria ou localiza a pasta da empresa dentro de Cadastros / Empresas /
function obterPastaEmpresa_(cnpj, razaoSocial) {
  // Usa a pasta raiz de cadastros definida em CFG_DRIVE
  var raiz      = DriveApp.getFolderById(CFG_DRIVE.CADASTROS_ID);
  var empFolder = obterOuCriarPasta_(raiz, 'Empresas');

  // Subpasta da empresa: "{CNPJ} — {Razão Social}" (máx 50 chars, sem chars inválidos)
  var safe      = razaoSocial.substring(0, 45).replace(/[\/\\:*?"<>|]/g, '_');
  var nomePasta = cnpj + ' — ' + safe;
  return obterOuCriarPasta_(empFolder, nomePasta);
}

// ─────────────────────────────────────────
//  AUXILIARES — RESPOSTAS JSON
// ─────────────────────────────────────────

function jsonOk_(data) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, data: data }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────
//  GET: listarEmpresasPrecheck
//  Todas as empresas cadastradas (exceto Excluída/Processada)
//  com status — usado no pré-check em cascata da solicitação
// ─────────────────────────────────────────
function listarEmpresasPrecheck_() {
  var ss  = SpreadsheetApp.openById(CFG.ID_EMPRESAS);
  var aba = ss.getSheetByName(CFG.ABA_EMPRESAS);
  if (!aba) return jsonOk_([]);

  var dados = aba.getDataRange().getValues();
  var lista = [];
  var vistas = {}; // evita duplicatas de CNPJ (mantém a mais recente com status relevante)

  for (var i = 1; i < dados.length; i++) {
    var status = String(dados[i][COL_EMP.STATUS] || '').trim();
    if (status.indexOf('Processada') > -1) continue;
    if (status === 'Excluída' || status === 'Inativa') continue;

    var cnpj        = String(dados[i][COL_EMP.CNPJ]        || '').trim();
    var razaoSocial = String(dados[i][COL_EMP.RAZAO_SOCIAL] || '').trim();
    if (!cnpj || !razaoSocial) continue;

    var cnpjNorm = cnpj.replace(/\D/g, '');
    // Se já vimos esse CNPJ e a entrada anterior era 'Validada', mantém
    if (vistas[cnpjNorm] && vistas[cnpjNorm] === 'Validada') continue;
    vistas[cnpjNorm] = status;

    // Substitui entrada anterior se existir
    var idx = lista.findIndex(function(e) { return e.cnpj.replace(/\D/g,'') === cnpjNorm; });
    var item = { cnpj: cnpj, razaoSocial: razaoSocial, status: status };
    if (idx > -1) lista[idx] = item;
    else lista.push(item);
  }

  lista.sort(function(a, b) { return a.razaoSocial.localeCompare(b.razaoSocial, 'pt-BR'); });
  return jsonOk_(lista);
}

// ─────────────────────────────────────────
//  GET: listarSupervisoresPrecheck
//  Todos os supervisores de uma empresa (por CNPJ) com status
//  Não expõe CPF — usado apenas para visualização no pré-check
// ─────────────────────────────────────────
function listarSupervisoresPrecheck_(cnpjBusca) {
  if (!cnpjBusca) return jsonOk_([]);

  var cnpjNorm = String(cnpjBusca).replace(/\D/g, '');
  var ss  = SpreadsheetApp.openById(CFG.ID_SUPERVISORES);
  var aba = ss.getSheetByName(CFG.ABA_SUP_RESPOSTAS);
  if (!aba) return jsonOk_([]);

  var dados = aba.getDataRange().getValues();
  var lista = [];

  for (var i = 1; i < dados.length; i++) {
    var status = String(dados[i][COL_SUP.STATUS] || '').trim();
    if (status === 'Recusado' || status === 'Inativo' || status === 'Excluído') continue;

    var empLinha = String(dados[i][COL_SUP.EMPRESA] || '');
    var cnpjLinha = empLinha.split('—')[0].replace(/\D/g, '').trim();
    if (cnpjLinha !== cnpjNorm) continue;

    lista.push({
      nome:  String(dados[i][COL_SUP.NOME]  || '').trim(),
      cargo: String(dados[i][COL_SUP.CARGO] || '').trim(),
      status: status,
    });
  }

  lista.sort(function(a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
  return jsonOk_(lista);
}

// ─────────────────────────────────────────
//  GET: verificarStatusConcedente
//  Verifica o status de empresa (por CNPJ) e supervisor (por CPF)
//  Usado pelo pré-check da solicitação de estágio
// ─────────────────────────────────────────
function verificarStatusConcedente_(e) {
  var cnpj = sanitizar_((e.parameter && e.parameter.cnpj) || '', 30);
  var cpf  = sanitizar_((e.parameter && e.parameter.cpf)  || '', 20);

  var cnpjNorm = cnpj.replace(/\D/g, '');
  var cpfNorm  = cpf.replace(/\D/g, '');

  var resultado = {
    empresa:    { encontrada: false, status: '', razaoSocial: '' },
    supervisor: { encontrado: false, status: '', nome: '', cnpjEmpresaVinculada: '' },
  };

  // Verifica empresa
  if (cnpjNorm) {
    var ssEmp = SpreadsheetApp.openById(CFG.ID_EMPRESAS);
    var abaEmp = ssEmp.getSheetByName(CFG.ABA_EMPRESAS);
    if (abaEmp) {
      var dadosEmp = abaEmp.getDataRange().getValues();
      for (var i = 1; i < dadosEmp.length; i++) {
        var docLinha = String(dadosEmp[i][COL_EMP.CNPJ] || '').replace(/\D/g, '');
        if (docLinha !== cnpjNorm) continue;
        var statusEmp = String(dadosEmp[i][COL_EMP.STATUS] || '').trim();
        if (statusEmp.indexOf('Processada') > -1) continue;
        resultado.empresa.encontrada  = true;
        resultado.empresa.status      = statusEmp;
        resultado.empresa.razaoSocial = String(dadosEmp[i][COL_EMP.RAZAO_SOCIAL] || '').trim();
        break;
      }
    }
  }

  // Verifica supervisor
  if (cpfNorm) {
    var ssSup = SpreadsheetApp.openById(CFG.ID_SUPERVISORES);
    var abaSup = ssSup.getSheetByName(CFG.ABA_SUP_RESPOSTAS);
    if (abaSup) {
      var dadosSup = abaSup.getDataRange().getValues();
      for (var j = 1; j < dadosSup.length; j++) {
        var cpfLinha = String(dadosSup[j][COL_SUP.CPF] || '').replace(/\D/g, '');
        if (cpfLinha !== cpfNorm) continue;
        var statusSup  = String(dadosSup[j][COL_SUP.STATUS]  || '').trim();
        var empresaStr = String(dadosSup[j][COL_SUP.EMPRESA] || '');
        var cnpjVinc   = empresaStr.split('—')[0].replace(/\D/g, '').trim();
        resultado.supervisor.encontrado           = true;
        resultado.supervisor.status               = statusSup;
        resultado.supervisor.nome                 = String(dadosSup[j][COL_SUP.NOME] || '').trim();
        resultado.supervisor.cnpjEmpresaVinculada = cnpjVinc;
        break;
      }
    }
  }

  return jsonOk_(resultado);
}

// ── Admin: Gestão de Oportunidades ───────────────────────────────────────────

/**
 * Lista todas as oportunidades para o admin (todos os status).
 * Retorna rowNum como oppId para operações de atualização.
 */
function listarOportunidadesAdmin_(authToken) {
  try { validarTokenAdmin_(authToken); } catch (e) {
    return jsonError_('Não autorizado: ' + e.message, 'AUTH_ERROR');
  }
  try {
    var ss    = SpreadsheetApp.openById(CFG_OPP.SS_ID || CFG.ID_OPORTUNIDADES || CFG.ID_EMPRESAS);
    var sheet = ss.getSheetByName(CFG.ABA_OPP);
    if (!sheet) return jsonOk_([]);
    var dados = sheet.getDataRange().getValues();
    var lista = [];
    for (var i = 1; i < dados.length; i++) {
      var row = dados[i];
      if (!row[COL_OPP.TIMESTAMP] && !row[COL_OPP.TITULO]) continue;
      var prazoVal = row[COL_OPP.PRAZO];
      var prazoISO = '';
      if (prazoVal) {
        var dp = prazoVal instanceof Date ? prazoVal : new Date(prazoVal);
        if (!isNaN(dp.getTime())) prazoISO = dp.toISOString().split('T')[0];
      }
      lista.push({
        oppId:          i + 1, // rowNum base-1 para getRange
        timestamp:      String(row[COL_OPP.TIMESTAMP] || ''),
        nomeEmpresa:    String(row[COL_OPP.NOME_EMPRESA]    || ''),
        responsavel:    String(row[COL_OPP.RESPONSAVEL]     || ''),
        emailContato:   String(row[COL_OPP.EMAIL_CONTATO]   || ''),
        tipoVaga:       String(row[COL_OPP.TIPO_VAGA]       || ''),
        numVagas:       String(row[COL_OPP.NUM_VAGAS]       || ''),
        titulo:         String(row[COL_OPP.TITULO]          || ''),
        area:           String(row[COL_OPP.AREA]            || ''),
        cidade:         String(row[COL_OPP.CIDADE]          || ''),
        modalidade:     String(row[COL_OPP.MODALIDADE]      || ''),
        cargaHoraria:   String(row[COL_OPP.CARGA_HOR]       || ''),
        remuneracao:    String(row[COL_OPP.REMUNERACAO]     || ''),
        prazo:          prazoISO,
        status:         String(row[COL_OPP.STATUS]          || 'Pendente'),
      });
    }
    lista.reverse();
    return jsonOk_(lista);
  } catch (e) {
    logErro_('listarOportunidadesAdmin_', e);
    return jsonError_('Erro ao listar oportunidades.', 'INTERNAL');
  }
}

/**
 * Atualiza o status de uma oportunidade pelo número da linha.
 */
function _atualizarStatusOportunidade_(oppId, novoStatus, authToken, obs) {
  try { validarTokenAdmin_(authToken); } catch (e) {
    return jsonError_('Não autorizado: ' + e.message, 'AUTH_ERROR');
  }
  if (!oppId) return jsonError_('oppId obrigatório.', 'MISSING_PARAM');
  try {
    var ss    = SpreadsheetApp.openById(CFG_OPP.SS_ID || CFG.ID_OPORTUNIDADES || CFG.ID_EMPRESAS);
    var sheet = ss.getSheetByName(CFG.ABA_OPP);
    if (!sheet) return jsonError_('Aba Oportunidades não encontrada.', 'NOT_FOUND');
    var rowNum = parseInt(oppId, 10);
    if (isNaN(rowNum) || rowNum < 2) return jsonError_('oppId inválido.', 'INVALID_PARAM');
    sheet.getRange(rowNum, COL_OPP.STATUS + 1).setValue(novoStatus);
    if (obs) sheet.getRange(rowNum, 25).setValue(String(obs)); // coluna Observações
    return jsonOk_({ oppId: oppId, status: novoStatus });
  } catch (e) {
    logErro_('_atualizarStatusOportunidade_', e);
    return jsonError_('Erro ao atualizar status.', 'INTERNAL');
  }
}

function aprovarOportunidade_(oppId, authToken) {
  return _atualizarStatusOportunidade_(oppId, 'Aprovada', authToken);
}

function reprovarOportunidade_(oppId, authToken, motivo) {
  return _atualizarStatusOportunidade_(oppId, 'Reprovada', authToken, motivo || '');
}

function encerrarOportunidade_(oppId, authToken) {
  return _atualizarStatusOportunidade_(oppId, 'Encerrada', authToken);
}

/**
 * Gera e envia magic link para empresa cadastrar oportunidade.
 */
function enviarMagicLinkOportunidade_(email, authToken) {
  try { validarTokenAdmin_(authToken); } catch (e) {
    return jsonError_('Não autorizado: ' + e.message, 'AUTH_ERROR');
  }
  if (!email || !validarEmail_(email)) return jsonError_('E-mail inválido.', 'INVALID_PARAM');
  try {
    var token = Utilities.getUuid();
    PropertiesService.getScriptProperties().setProperty('opp_token_' + token, email.toLowerCase().trim());
    var url   = BASE_URL + '/empresas/oportunidades.html?token=' + token;
    var html  = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;color:#374151;max-width:600px;margin:0 auto;padding:32px">'
      + '<h2 style="color:#1d4ed8">Cadastro de Oportunidade — IFRS Campus Rio Grande</h2>'
      + '<p>Você foi convidado(a) a cadastrar uma vaga de estágio ou emprego no Portal de Oportunidades do IFRS Campus Rio Grande.</p>'
      + '<p>Clique no botão abaixo para acessar o formulário:</p>'
      + '<a href="' + url + '" style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0">Cadastrar Oportunidade</a>'
      + '<p style="font-size:12px;color:#6b7280;margin-top:24px">Ou copie o link: ' + url + '</p>'
      + '<p style="font-size:12px;color:#6b7280">Este link é de uso único. Em caso de dúvidas, entre em contato: <a href="mailto:estagios@riogrande.ifrs.edu.br">estagios@riogrande.ifrs.edu.br</a></p>'
      + '</body></html>';
    GmailApp.sendEmail(email, '[IFRS] Link para cadastro de oportunidade de estágio', '', {
      htmlBody: html,
      name: 'Central de Estágios IFRS Campus Rio Grande',
    });
    return jsonOk_({ enviado: true, email: email });
  } catch (e) {
    logErro_('enviarMagicLinkOportunidade_', e);
    return jsonError_('Erro ao enviar magic link: ' + e.message, 'INTERNAL');
  }
}

/**
 * Valida token de magic link de oportunidade (GET público).
 */
function validarTokenOportunidade_(token) {
  if (!token) return jsonError_('Token obrigatório.', 'MISSING_PARAM');
  var email = PropertiesService.getScriptProperties().getProperty('opp_token_' + token);
  if (!email) return jsonError_('Token inválido ou expirado.', 'AUTH_ERROR');
  return jsonOk_({ valido: true, email: email });
}

/**
 * Admin cadastra oportunidade diretamente (status Aprovada automaticamente).
 */
function cadastrarOportunidadeAdmin_(dados, authToken) {
  try { validarTokenAdmin_(authToken); } catch (e) {
    return jsonError_('Não autorizado: ' + e.message, 'AUTH_ERROR');
  }
  // Reutiliza função existente mas força status Aprovada
  dados.declaracao = 'Sim';
  dados._adminDirect = true;
  try {
    var result = cadastrarOportunidade_(dados);
    // Aprova automaticamente: a última linha inserida
    var ss    = SpreadsheetApp.openById(CFG_OPP.SS_ID || CFG.ID_OPORTUNIDADES || CFG.ID_EMPRESAS);
    var sheet = ss.getSheetByName(CFG.ABA_OPP);
    if (sheet) {
      var lastRow = sheet.getLastRow();
      sheet.getRange(lastRow, COL_OPP.STATUS + 1).setValue('Aprovada');
    }
    return jsonOk_({ mensagem: 'Oportunidade cadastrada e aprovada com sucesso.' });
  } catch (e) {
    logErro_('cadastrarOportunidadeAdmin_', e);
    return jsonError_('Erro ao cadastrar: ' + e.message, 'INTERNAL');
  }
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
