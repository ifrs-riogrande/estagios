/**
 * api-servidores.gs — Web App: Servidores / Orientadores
 * SGE — Sistema de Gestão de Estágios · IFRS Campus Rio Grande
 *
 * Rotas GET:  ?action=listarOrientadores[&curso=<nome>]
 * Rotas POST: { action: 'cadastrarOrientador', ...dados }
 *
 * Planilha de Orientadores ID: 1lmwm-9_UYqqP2dWRhZdaBmSD5Qb8h8KZk6x6FJVSHJE
 */

'use strict';

var CFG_SRV = {
  SS_ID:         '1zVyseifVC6xeMpNjqwYd6jCq9HTJ2NS8BlN1dtM4s7Y',  // planilha consolidada SGE
  ABA:           'Orientadores',
  ABA_COORD:     'Coordenadores',
};

/**
 * Mapa de colunas da planilha de Orientadores (base 0).
 * Mantém compatibilidade com a estrutura do Form original.
 */
var COL_ORI = {
  TIMESTAMP:    0,
  TIPO_VINCULO: 1,
  INI_CONTRATO: 2,
  FIM_CONTRATO: 3,
  NOME:         4,
  CPF:          5,
  SIAPE:        6,
  TEL:          7,
  EMAIL:        8,
  TITULACAO:    9,
  AREA:         10,
  CURSOS:       11,  // vírgula-separado
  STATUS:       12,  // 'Ativo' | 'Inativo' | 'Pendente' | 'Rejeitado' | 'Excluído'
  OBS_REJEICAO: 13, // Observação preenchida ao rejeitar cadastro pendente
};

// ---------------------------------------------------------------------------
// Roteamento
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GET — Listar orientadores (opcionalmente filtrados por curso)
// ---------------------------------------------------------------------------

function listarOrientadores_(curso) {
  var sheet = abrirAba_(CFG_SRV.SS_ID, CFG_SRV.ABA);
  var dados = sheet.getDataRange().getValues();
  var lista = [];
  var hoje  = new Date();
  hoje.setHours(0, 0, 0, 0);

  for (var i = 1; i < dados.length; i++) {
    var linha  = dados[i];
    var status = String(linha[COL_ORI.STATUS] || '').trim();
    if (status === 'Inativo') continue;

    // Para substitutos com contrato vencido, não exibir
    var vinculo = String(linha[COL_ORI.TIPO_VINCULO] || '');
    if (vinculo === 'Substituto') {
      var fimContrato = linha[COL_ORI.FIM_CONTRATO];
      if (fimContrato) {
        var dtFim = fimContrato instanceof Date ? fimContrato : new Date(fimContrato);
        if (!isNaN(dtFim.getTime()) && dtFim < hoje) continue; // contrato vencido
      }
    }

    var cursosOrientador = String(linha[COL_ORI.CURSOS] || '');

    // Filtra por curso se informado
    if (curso && !cursosOrientador.toLowerCase().includes(curso.toLowerCase())) continue;

    lista.push({
      nome:      String(linha[COL_ORI.NOME]  || ''),
      email:     String(linha[COL_ORI.EMAIL] || ''),
      siape:     String(linha[COL_ORI.SIAPE] || ''),
      titulacao: String(linha[COL_ORI.TITULACAO] || ''),
      cursos:    cursosOrientador,
      vinculo:   vinculo,
    });
  }

  // Ordenação alfabética
  lista.sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });

  return jsonOk_(lista);
}

// ---------------------------------------------------------------------------
// POST — Cadastrar orientador
// ---------------------------------------------------------------------------

function cadastrarOrientador_(dados) {
  // Autenticação — apenas servidores podem se cadastrar como orientadores
  var tokenInfo = validarTokenServidor_(dados.authToken);

  if (!checkRateLimit_('cadastrarOrientador')) {
    return jsonError_('Muitas requisições. Aguarde um momento.', 'RATE_LIMIT');
  }

  // Sanitização e validações
  var vinculo = sanitizar_(dados.tipoVinculo, 20);
  var nome    = sanitizar_(dados.nomeOrientador, 200);
  var cpf     = sanitizar_(dados.cpfOrientador, 14).replace(/\D/g, '');
  var siape   = sanitizar_(dados.siape, 7).replace(/\D/g, '');
  var tel     = sanitizar_(dados.telOrientador, 30);
  var email   = sanitizar_(dados.emailInst, 100).toLowerCase();
  var titulac = sanitizar_(dados.titulacao, 50);
  var area    = sanitizar_(dados.areaFormacao, 200);
  var cursos  = sanitizar_(dados.cursos, 500);
  var iniCont = sanitizar_(dados.inicioContrato, 10);
  var fimCont = sanitizar_(dados.fimContrato, 10);

  if (!vinculo) return jsonError_('Tipo de vínculo é obrigatório.', 'VALIDATION');
  if (!nome)    return jsonError_('Nome é obrigatório.', 'VALIDATION');
  if (!validarCPF_(cpf)) return jsonError_('CPF inválido.', 'VALIDATION');
  if (!siape || siape.length < 6) return jsonError_('SIAPE inválido.', 'VALIDATION');
  if (!tel)     return jsonError_('Telefone é obrigatório.', 'VALIDATION');
  if (!validarEmail_(email)) return jsonError_('E-mail institucional inválido.', 'VALIDATION');
  if (!titulac) return jsonError_('Titulação é obrigatória.', 'VALIDATION');
  if (!area)    return jsonError_('Área de formação é obrigatória.', 'VALIDATION');
  if (!cursos)  return jsonError_('Selecione ao menos um curso para orientar.', 'VALIDATION');

  if (vinculo === 'Substituto') {
    if (!iniCont) return jsonError_('Início do contrato é obrigatório para substitutos.', 'VALIDATION');
    if (!fimCont) return jsonError_('Término do contrato é obrigatório para substitutos.', 'VALIDATION');
    if (fimCont < iniCont) return jsonError_('Término não pode ser anterior ao início.', 'VALIDATION');
  }

  // Verifica duplicidade por CPF
  var sheet = abrirAba_(CFG_SRV.SS_ID, CFG_SRV.ABA);
  var idx   = buscarNaColuna_(sheet, COL_ORI.CPF, cpf);
  if (idx !== -1) {
    // Atualiza cadastro existente em vez de duplicar — volta para Pendente
    var rowIdx = idx + 1; // base-1 para sheet
    sheet.getRange(rowIdx, COL_ORI.TIPO_VINCULO + 1).setValue(vinculo);
    sheet.getRange(rowIdx, COL_ORI.TEL + 1).setValue(tel);
    sheet.getRange(rowIdx, COL_ORI.TITULACAO + 1).setValue(titulac);
    sheet.getRange(rowIdx, COL_ORI.AREA + 1).setValue(area);
    sheet.getRange(rowIdx, COL_ORI.CURSOS + 1).setValue(cursos);
    sheet.getRange(rowIdx, COL_ORI.STATUS + 1).setValue('Pendente');
    if (vinculo === 'Substituto') {
      sheet.getRange(rowIdx, COL_ORI.INI_CONTRATO + 1).setValue(iniCont);
      sheet.getRange(rowIdx, COL_ORI.FIM_CONTRATO + 1).setValue(fimCont);
    }
    try { enviarEmailAtualizacaoServidor_({ nome: nome, email: email, tipo: 'orientador' }); } catch (e) { logErro_('cadastrarOrientador_.mailAtualiza', e); }
    return jsonOk_({ mensagem: 'Cadastro atualizado. Aguardando aprovação do setor.', pendente: true });
  }

  // Nova linha — inicia como Pendente, aguarda aprovação do admin
  var now  = new Date();
  var linha = [];
  linha[COL_ORI.TIMESTAMP]    = now;
  linha[COL_ORI.TIPO_VINCULO] = vinculo;
  linha[COL_ORI.INI_CONTRATO] = iniCont;
  linha[COL_ORI.FIM_CONTRATO] = fimCont;
  linha[COL_ORI.NOME]         = nome;
  linha[COL_ORI.CPF]          = cpf;
  linha[COL_ORI.SIAPE]        = siape;
  linha[COL_ORI.TEL]          = tel;
  linha[COL_ORI.EMAIL]        = email;
  linha[COL_ORI.TITULACAO]    = titulac;
  linha[COL_ORI.AREA]         = area;
  linha[COL_ORI.CURSOS]       = cursos;
  linha[COL_ORI.STATUS]       = 'Pendente';

  sheet.appendRow(linha);

  // Notificação ao setor
  try { enviarEmailNovoOrientador_(dados); } catch (e) { logErro_('cadastrarOrientador_.mail', e); }

  return jsonOk_({ mensagem: 'Cadastro recebido! Aguardando aprovação do setor.', pendente: true });
}

// ---------------------------------------------------------------------------
// GET — Obter meu cadastro de orientador (autenticado por Google)
// ---------------------------------------------------------------------------

function obterMeuCadastroOrientador_(e) {
  var authToken = e.parameter && e.parameter.authToken;
  var tokenInfo = validarTokenServidor_(authToken);
  var email = tokenInfo.email.toLowerCase();

  var sheet = abrirAba_(CFG_SRV.SS_ID, CFG_SRV.ABA);
  var idx   = buscarNaColuna_(sheet, COL_ORI.EMAIL, email);
  if (idx === -1) return jsonError_('Orientador não encontrado para este e-mail.', 'NOT_FOUND');

  var dados = sheet.getDataRange().getValues();
  var linha = dados[idx];

  return jsonOk_({
    tipoVinculo: String(linha[COL_ORI.TIPO_VINCULO] || ''),
    iniContrato: normalizarDataISO_(linha[COL_ORI.INI_CONTRATO]),
    fimContrato: normalizarDataISO_(linha[COL_ORI.FIM_CONTRATO]),
    nome:        String(linha[COL_ORI.NOME]      || ''),
    cpf:         String(linha[COL_ORI.CPF]       || ''),
    siape:       String(linha[COL_ORI.SIAPE]     || ''),
    tel:         String(linha[COL_ORI.TEL]       || ''),
    email:       String(linha[COL_ORI.EMAIL]     || ''),
    titulacao:   String(linha[COL_ORI.TITULACAO] || ''),
    area:        String(linha[COL_ORI.AREA]      || ''),
    cursos:      String(linha[COL_ORI.CURSOS]    || ''),
    status:      String(linha[COL_ORI.STATUS]    || ''),
  });
}

// ---------------------------------------------------------------------------
// POST — Atualizar meu cadastro de orientador (autenticado por Google)
// ---------------------------------------------------------------------------

function atualizarMeuCadastroOrientador_(dados) {
  var tokenInfo = validarTokenServidor_(dados.authToken);
  var email = tokenInfo.email.toLowerCase();

  if (!checkRateLimit_('atualizarMeuCadastroOrientador')) {
    return jsonError_('Muitas requisições. Aguarde um momento.', 'RATE_LIMIT');
  }

  var tel     = sanitizar_(dados.tel,      30);
  var titulac = sanitizar_(dados.titulacao, 50);
  var area    = sanitizar_(dados.area,     200);
  var cursos  = sanitizar_(dados.cursos,   500);

  if (!tel)     return jsonError_('Telefone é obrigatório.', 'VALIDATION');
  if (!titulac) return jsonError_('Titulação é obrigatória.', 'VALIDATION');
  if (!area)    return jsonError_('Área de formação é obrigatória.', 'VALIDATION');
  if (!cursos)  return jsonError_('Selecione ao menos um curso.', 'VALIDATION');

  var sheet = abrirAba_(CFG_SRV.SS_ID, CFG_SRV.ABA);
  var idx   = buscarNaColuna_(sheet, COL_ORI.EMAIL, email);
  if (idx === -1) return jsonError_('Orientador não encontrado para este e-mail.', 'NOT_FOUND');

  var rowIdx = idx + 1; // base-1 para sheet
  sheet.getRange(rowIdx, COL_ORI.TEL      + 1).setValue(tel);
  sheet.getRange(rowIdx, COL_ORI.TITULACAO + 1).setValue(titulac);
  sheet.getRange(rowIdx, COL_ORI.AREA     + 1).setValue(area);
  sheet.getRange(rowIdx, COL_ORI.CURSOS   + 1).setValue(cursos);
  sheet.getRange(rowIdx, COL_ORI.STATUS   + 1).setValue('Pendente');

  var nomeSalvo = String(sheet.getDataRange().getValues()[idx][COL_ORI.NOME] || '');
  try { enviarEmailAtualizacaoServidor_({ nome: nomeSalvo, email: email, tipo: 'orientador' }); } catch (e) { logErro_('atualizarMeuCadastroOrientador_.mail', e); }

  return jsonOk_({ mensagem: 'Dados atualizados. Aguardando aprovação do setor.', pendente: true });
}

// ---------------------------------------------------------------------------
// Coordenadores — mapa de colunas (aba Coordenadores, base 0)
// Cabeçalho: CPF | Matrícula SIAPE | Nome | E-mail | Telefone | Titulação | Curso | Timestamp | Status
// ---------------------------------------------------------------------------

var COL_COORD = {
  CPF:       0,
  SIAPE:     1,
  NOME:      2,
  EMAIL:     3,
  TEL:       4,
  TITULACAO: 5,
  CURSO:     6,
  TIMESTAMP: 7,
  STATUS:    8,
  PORTARIA:  9,
};

// ---------------------------------------------------------------------------
// GET — Obter meu cadastro de coordenador (autenticado por Google)
// ---------------------------------------------------------------------------

function obterMeuCadastroCoordenador_(e) {
  var authToken = e.parameter && e.parameter.authToken;
  var tokenInfo = validarTokenServidor_(authToken);
  var email = tokenInfo.email.toLowerCase();

  var ss    = SpreadsheetApp.openById(CFG_SRV.SS_ID);
  var sheet = ss.getSheetByName(CFG_SRV.ABA_COORD);
  if (!sheet) return jsonError_('Coordenador não encontrado para este e-mail.', 'NOT_FOUND');

  var dados = sheet.getDataRange().getValues();
  // Retorna o registro mais recente (ou o Ativo) para este e-mail
  var encontrado = null;
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][COL_COORD.EMAIL] || '').toLowerCase() === email) {
      if (!encontrado || String(dados[i][COL_COORD.STATUS] || '') === 'Ativo') {
        encontrado = dados[i];
      }
    }
  }
  if (!encontrado) return jsonError_('Coordenador não encontrado para este e-mail.', 'NOT_FOUND');

  return jsonOk_({
    nome:      String(encontrado[COL_COORD.NOME]      || ''),
    cpf:       String(encontrado[COL_COORD.CPF]       || ''),
    siape:     String(encontrado[COL_COORD.SIAPE]     || ''),
    email:     String(encontrado[COL_COORD.EMAIL]     || ''),
    tel:       String(encontrado[COL_COORD.TEL]       || ''),
    titulacao: String(encontrado[COL_COORD.TITULACAO] || ''),
    curso:     String(encontrado[COL_COORD.CURSO]     || ''),
    status:    String(encontrado[COL_COORD.STATUS]    || ''),
    portaria:  String(encontrado[COL_COORD.PORTARIA]  || ''),
  });
}

// ---------------------------------------------------------------------------
// POST — Cadastrar coordenador (auto-cadastro do servidor — status Pendente)
// ---------------------------------------------------------------------------

function cadastrarCoordenador_(dados) {
  var tokenInfo = validarTokenServidor_(dados.authToken);
  var email = tokenInfo.email.toLowerCase();

  if (!checkRateLimit_('cadastrarCoordenador')) {
    return jsonError_('Muitas requisições. Aguarde um momento.', 'RATE_LIMIT');
  }

  var nome     = sanitizar_(dados.nome,     200);
  var cpf      = sanitizar_(dados.cpf,       14).replace(/\D/g, '');
  var siape    = sanitizar_(dados.siape,     10).replace(/\D/g, '');
  var tel      = sanitizar_(dados.telefone,  30);
  var curso    = sanitizar_(dados.curso,    500); // pode ser múltiplos cursos separados por vírgula
  var portaria = sanitizar_(dados.portaria, 200);

  if (!nome)                      return jsonError_('Nome é obrigatório.', 'VALIDATION');
  if (!validarCPF_(cpf))          return jsonError_('CPF inválido.', 'VALIDATION');
  if (!siape || siape.length < 6) return jsonError_('SIAPE inválido.', 'VALIDATION');
  if (!curso)                     return jsonError_('Selecione ao menos um curso.', 'VALIDATION');

  var ss    = SpreadsheetApp.openById(CFG_SRV.SS_ID);
  var sheet = obterOuCriarAbaCoord_(ss);
  var dadosPlanilha = sheet.getDataRange().getValues();

  // Verifica se já existe registro para este email → atualiza
  for (var i = 1; i < dadosPlanilha.length; i++) {
    if (String(dadosPlanilha[i][COL_COORD.EMAIL] || '').toLowerCase() === email) {
      var rowIdx = i + 1;
      sheet.getRange(rowIdx, COL_COORD.CPF      + 1).setValue(cpf);
      sheet.getRange(rowIdx, COL_COORD.SIAPE    + 1).setValue(siape);
      sheet.getRange(rowIdx, COL_COORD.NOME     + 1).setValue(nome);
      sheet.getRange(rowIdx, COL_COORD.TEL      + 1).setValue(tel);
      sheet.getRange(rowIdx, COL_COORD.CURSO    + 1).setValue(curso);
      sheet.getRange(rowIdx, COL_COORD.PORTARIA + 1).setValue(portaria);
      sheet.getRange(rowIdx, COL_COORD.TIMESTAMP+ 1).setValue(new Date());
      sheet.getRange(rowIdx, COL_COORD.STATUS   + 1).setValue('Pendente');
      try { enviarEmailAtualizacaoServidor_({ nome: nome, email: email, tipo: 'coordenador', curso: curso }); } catch (e) { logErro_('cadastrarCoordenador_.mailAtualiza', e); }
      return jsonOk_({ mensagem: 'Cadastro atualizado. Aguardando aprovação do setor.', pendente: true });
    }
  }

  // Nova linha — status Pendente
  var novaLinha = new Array(10);
  novaLinha[COL_COORD.CPF]       = cpf;
  novaLinha[COL_COORD.SIAPE]     = siape;
  novaLinha[COL_COORD.NOME]      = nome;
  novaLinha[COL_COORD.EMAIL]     = email;
  novaLinha[COL_COORD.TEL]       = tel;
  novaLinha[COL_COORD.TITULACAO] = '';
  novaLinha[COL_COORD.CURSO]     = curso;
  novaLinha[COL_COORD.TIMESTAMP] = new Date();
  novaLinha[COL_COORD.STATUS]    = 'Pendente';
  novaLinha[COL_COORD.PORTARIA]  = portaria;
  sheet.appendRow(novaLinha);

  try { enviarEmailNovoCoordenador_({ nome: nome, email: email, curso: curso, siape: siape }); } catch (e) { logErro_('cadastrarCoordenador_.mail', e); }
  return jsonOk_({ mensagem: 'Cadastro recebido! Aguardando aprovação do setor.', pendente: true });
}

// ---------------------------------------------------------------------------
// POST — Atualizar meu cadastro de coordenador (autenticado por Google)
// ---------------------------------------------------------------------------

function atualizarMeuCadastroCoordenador_(dados) {
  var tokenInfo = validarTokenServidor_(dados.authToken);
  var email = tokenInfo.email.toLowerCase();

  if (!checkRateLimit_('atualizarMeuCadastroCoordenador')) {
    return jsonError_('Muitas requisições. Aguarde um momento.', 'RATE_LIMIT');
  }

  var tel      = sanitizar_(dados.tel,      30);
  var cursos   = sanitizar_(dados.cursos,  500);
  var portaria = sanitizar_(dados.portaria, 200);

  if (!cursos) return jsonError_('Selecione ao menos um curso.', 'VALIDATION');

  var ss    = SpreadsheetApp.openById(CFG_SRV.SS_ID);
  var sheet = ss.getSheetByName(CFG_SRV.ABA_COORD);
  if (!sheet) return jsonError_('Coordenador não encontrado.', 'NOT_FOUND');
  var dadosPlanilha = sheet.getDataRange().getValues();

  // Atualiza o registro mais recente deste e-mail
  var rowIdx = -1, nomeSalvo = '', cursoSalvo = '';
  for (var i = 1; i < dadosPlanilha.length; i++) {
    if (String(dadosPlanilha[i][COL_COORD.EMAIL] || '').toLowerCase() === email) {
      rowIdx     = i + 1;
      nomeSalvo  = String(dadosPlanilha[i][COL_COORD.NOME]  || '');
      cursoSalvo = String(dadosPlanilha[i][COL_COORD.CURSO] || '');
    }
  }
  if (rowIdx === -1) return jsonError_('Coordenador não encontrado.', 'NOT_FOUND');

  sheet.getRange(rowIdx, COL_COORD.TEL      + 1).setValue(tel);
  sheet.getRange(rowIdx, COL_COORD.CURSO    + 1).setValue(cursos);
  sheet.getRange(rowIdx, COL_COORD.PORTARIA + 1).setValue(portaria);
  sheet.getRange(rowIdx, COL_COORD.STATUS   + 1).setValue('Pendente');

  try { enviarEmailAtualizacaoServidor_({ nome: nomeSalvo, email: email, tipo: 'coordenador', curso: cursoSalvo }); } catch (e) { logErro_('atualizarMeuCadastroCoordenador_.mail', e); }
  return jsonOk_({ mensagem: 'Dados atualizados. Aguardando aprovação do setor.', pendente: true });
}

// ---------------------------------------------------------------------------
// Helper — obtém ou cria aba Coordenadores com cabeçalho padrão
// ---------------------------------------------------------------------------

function obterOuCriarAbaCoord_(ss) {
  var sheet = ss.getSheetByName(CFG_SRV.ABA_COORD);
  if (!sheet) {
    sheet = ss.insertSheet(CFG_SRV.ABA_COORD);
    var cab = ['CPF','Matrícula SIAPE','Nome','E-mail','Telefone','Titulação','Curso','Timestamp','Status','Portaria'];
    sheet.getRange(1, 1, 1, cab.length).setValues([cab]);
    sheet.getRange(1, 1, 1, cab.length).setFontWeight('bold');
  }
  return sheet;
}

// ---------------------------------------------------------------------------
// Meus Orientandos — lista estágios onde o orientador autenticado é responsável
// ---------------------------------------------------------------------------

function listarMeusOrientandos_(e) {
  var authToken = e.parameter && e.parameter.authToken;
  var tokenInfo = validarTokenServidor_(authToken);
  var email = tokenInfo.email.toLowerCase().trim();

  var ss    = SpreadsheetApp.openById(CFG_SRV.SS_ID);
  var sheet = ss.getSheetByName('Solicitações');
  if (!sheet) return jsonOk_([]);

  var dados = sheet.getDataRange().getValues();
  var lista = [];

  for (var i = 1; i < dados.length; i++) {
    var linha = dados[i];
    var emailOri = String(linha[COL_SOL.EMAIL_ORIENTADOR] || '').toLowerCase().trim();
    if (emailOri !== email) continue;

    lista.push({
      id:                  String(linha[COL_SOL.ID_ESTAGIO]      || ''),
      nomeEstudante:       String(linha[COL_SOL.NOME_ESTUDANTE]  || ''),
      matricula:           String(linha[COL_SOL.MATRICULA]       || ''),
      curso:               String(linha[COL_SOL.CURSO]           || ''),
      tipoEstagio:         String(linha[COL_SOL.TIPO_ESTAGIO]    || ''),
      empresa:             String(linha[COL_SOL.NOME_EMPRESA]    || ''),
      nomeSupervisor:      String(linha[COL_SOL.NOME_SUPERVISOR] || ''),
      dataInicio:          normalizarDataISO_(linha[COL_SOL.DATA_INICIO]),
      dataTermino:         normalizarDataISO_(linha[COL_SOL.DATA_TERMINO]),
      cargaHorariaSemanal: String(linha[COL_SOL.CARGA_HOR]       || ''),
      status:              String(linha[COL_SOL.STATUS]          || ''),
      obsSetor:            String(linha[COL_SOL.OBS_SETOR]       || ''),
      driveUrl:            String(linha[COL_SOL.DRIVE_URL]       || ''),
    });
  }

  // Mais recentes primeiro
  lista.reverse();
  return jsonOk_(lista);
}

// ---------------------------------------------------------------------------
// Estágios do Curso — lista estágios pelo curso que o coordenador gerencia
// ---------------------------------------------------------------------------

function listarEstagiosCoordenador_(e) {
  var authToken = e.parameter && e.parameter.authToken;
  var tokenInfo = validarTokenServidor_(authToken);
  var email = tokenInfo.email.toLowerCase().trim();

  var ss = SpreadsheetApp.openById(CFG_SRV.SS_ID);

  // Localiza o curso do coordenador pela coluna E-mail (índice 3) na aba Coordenadores
  var sheetCoord = obterOuCriarAbaCoord_(ss);
  var dadosCoord = sheetCoord.getDataRange().getValues();
  var curso = '';
  for (var i = 1; i < dadosCoord.length; i++) {
    var emailCoord = String(dadosCoord[i][COL_COORD.EMAIL] || '').toLowerCase().trim();
    if (emailCoord === email) {
      curso = String(dadosCoord[i][COL_COORD.CURSO] || '').trim();
      break;
    }
  }

  if (!curso) {
    return jsonError_('Coordenador não encontrado ou sem curso vinculado.', 'NOT_FOUND');
  }

  // Filtra Solicitações pelo nome do curso
  var sheetSol = ss.getSheetByName('Solicitações');
  if (!sheetSol) return jsonOk_({ curso: curso, estagios: [] });

  var dados = sheetSol.getDataRange().getValues();
  var lista = [];

  for (var j = 1; j < dados.length; j++) {
    var linha = dados[j];
    var cursoBanco = String(linha[COL_SOL.CURSO] || '').trim();
    if (cursoBanco !== curso) continue;

    lista.push({
      id:                  String(linha[COL_SOL.ID_ESTAGIO]      || ''),
      nomeEstudante:       String(linha[COL_SOL.NOME_ESTUDANTE]  || ''),
      matricula:           String(linha[COL_SOL.MATRICULA]       || ''),
      curso:               String(linha[COL_SOL.CURSO]           || ''),
      tipoEstagio:         String(linha[COL_SOL.TIPO_ESTAGIO]    || ''),
      empresa:             String(linha[COL_SOL.NOME_EMPRESA]    || ''),
      nomeOrientador:      String(linha[COL_SOL.NOME_ORIENTADOR] || ''),
      nomeSupervisor:      String(linha[COL_SOL.NOME_SUPERVISOR] || ''),
      dataInicio:          normalizarDataISO_(linha[COL_SOL.DATA_INICIO]),
      dataTermino:         normalizarDataISO_(linha[COL_SOL.DATA_TERMINO]),
      cargaHorariaSemanal: String(linha[COL_SOL.CARGA_HOR]       || ''),
      status:              String(linha[COL_SOL.STATUS]          || ''),
      obsSetor:            String(linha[COL_SOL.OBS_SETOR]       || ''),
      driveUrl:            String(linha[COL_SOL.DRIVE_URL]       || ''),
    });
  }

  lista.reverse();
  return jsonOk_({ curso: curso, estagios: lista });
}

// ---------------------------------------------------------------------------
// Helper — localiza orientador por e-mail (retorna { rowIndex, data } ou null)
// ---------------------------------------------------------------------------

function verificarOrientadorPorEmail_(email) {
  var sheet = abrirAba_(CFG_SRV.SS_ID, CFG_SRV.ABA);
  var dados = sheet.getDataRange().getValues();
  var emailNorm = String(email || '').toLowerCase().trim();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][COL_ORI.EMAIL] || '').toLowerCase().trim() === emailNorm) {
      return { rowIndex: i, data: dados[i] };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helper — cria entrada provisional 'Convidado' (chamada por solicitarEstagio_)
// ---------------------------------------------------------------------------

function criarOrientadorConvidado_(email, nome) {
  var sheet = abrirAba_(CFG_SRV.SS_ID, CFG_SRV.ABA);
  // Se já existe qualquer entrada (mesmo 'Convidado'), não duplica
  var dados = sheet.getDataRange().getValues();
  var emailNorm = String(email || '').toLowerCase().trim();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][COL_ORI.EMAIL] || '').toLowerCase().trim() === emailNorm) return;
  }
  var linha = new Array(14);
  linha[COL_ORI.TIMESTAMP] = new Date();
  linha[COL_ORI.NOME]      = sanitizar_(nome || '', 200);
  linha[COL_ORI.EMAIL]     = emailNorm;
  linha[COL_ORI.STATUS]    = 'Convidado';
  sheet.appendRow(linha);
}

// ---------------------------------------------------------------------------
// GET — Verifica status do cadastro do orientador pelo e-mail (sem auth)
// Usado pelo frontend do checklist para saber se precisa exibir o formulário
// ---------------------------------------------------------------------------

function verificarCadastroOrientador_(e) {
  var email = sanitizar_((e.parameter && e.parameter.email) || '', 100).toLowerCase();
  if (!validarEmail_(email)) return jsonError_('E-mail inválido.', 'VALIDATION');

  var ori = verificarOrientadorPorEmail_(email);
  if (!ori) return jsonOk_({ cadastrado: false, status: '' });

  var status = String(ori.data[COL_ORI.STATUS] || '').trim();
  var cadastrado = (status === 'Ativo' || status === 'Pendente');
  return jsonOk_({ cadastrado: cadastrado, status: status });
}

// ---------------------------------------------------------------------------
// POST — Professor convidado completa cadastro mínimo + fica pronto para checklist
// Body: { authToken, token, nome, cpf, tipoVinculo, siape, tel, titulacao, area,
//         cursos, inicioContrato?, fimContrato? }
// ---------------------------------------------------------------------------

function registrarOrientadorConvidado_(body) {
  // 1. Autentica o servidor com Google OAuth
  var tokenInfo = validarTokenServidor_(body.authToken);
  var email = tokenInfo.email.toLowerCase();

  if (!checkRateLimit_('registrarOrientadorConvidado', 5)) {
    return jsonError_('Muitas requisições. Aguarde um momento.', 'RATE_LIMIT');
  }

  // 2. Token do checklist é obrigatório — vincula o cadastro à solicitação correta
  var ckToken = String(body.token || '').trim();
  if (!ckToken) return jsonError_('Token de convite não informado.', 'VALIDATION');

  // 3. Valida que o token corresponde a uma solicitação com este e-mail como orientador
  var ss       = SpreadsheetApp.openById(CFG_SOL.SS_ID);
  var sheetSol = ss.getSheetByName(CFG_SOL.ABA_SOL);
  if (!sheetSol) return jsonError_('Planilha de solicitações não encontrada.', 'INTERNAL');
  var dadosSol = sheetSol.getDataRange().getValues();
  var solicitacao = null;
  for (var i = 1; i < dadosSol.length; i++) {
    if (String(dadosSol[i][COL_SOL.TOKEN_ACEITE_ORI] || '').trim() === ckToken) {
      solicitacao = dadosSol[i];
      break;
    }
  }
  if (!solicitacao) return jsonError_('Token inválido ou não encontrado.', 'NOT_FOUND');

  var emailSolicitado = String(solicitacao[COL_SOL.EMAIL_ORIENTADOR] || '').toLowerCase().trim();
  if (emailSolicitado !== email) {
    return jsonError_(
      'O e-mail institucional autenticado (' + email + ') não corresponde ao orientador desta solicitação (' + emailSolicitado + ').',
      'AUTH_ERROR'
    );
  }

  // 4. Sanitiza e valida campos do cadastro
  var nome    = sanitizar_(body.nome,     200);
  var cpf     = sanitizar_(body.cpf,       14).replace(/\D/g, '');
  var vinculo = sanitizar_(body.tipoVinculo, 20);
  var siape   = sanitizar_(body.siape,      7).replace(/\D/g, '');
  var tel     = sanitizar_(body.tel,       30);
  var titulac = sanitizar_(body.titulacao, 50);
  var area    = sanitizar_(body.area,     200);
  var cursos  = sanitizar_(body.cursos,   500);
  var iniCont = sanitizar_(body.inicioContrato || '', 10);
  var fimCont = sanitizar_(body.fimContrato    || '', 10);

  if (!nome)                      return jsonError_('Nome é obrigatório.', 'VALIDATION');
  if (!validarCPF_(cpf))          return jsonError_('CPF inválido.', 'VALIDATION');
  if (!vinculo)                   return jsonError_('Tipo de vínculo é obrigatório.', 'VALIDATION');
  if (!siape || siape.length < 6) return jsonError_('SIAPE inválido (mínimo 6 dígitos).', 'VALIDATION');
  if (!tel)                       return jsonError_('Telefone é obrigatório.', 'VALIDATION');
  if (!titulac)                   return jsonError_('Titulação é obrigatória.', 'VALIDATION');
  if (!area)                      return jsonError_('Área de formação é obrigatória.', 'VALIDATION');
  if (!cursos)                    return jsonError_('Selecione ao menos um curso para orientar.', 'VALIDATION');
  if (vinculo === 'Substituto') {
    if (!iniCont) return jsonError_('Início do contrato é obrigatório para substitutos.', 'VALIDATION');
    if (!fimCont) return jsonError_('Término do contrato é obrigatório para substitutos.', 'VALIDATION');
    if (fimCont < iniCont) return jsonError_('Término do contrato não pode ser anterior ao início.', 'VALIDATION');
  }

  // 5. Localiza (ou cria) a linha na aba Orientadores
  var sheetOri  = abrirAba_(CFG_SRV.SS_ID, CFG_SRV.ABA);
  var dadosOri  = sheetOri.getDataRange().getValues();
  var oriRowIdx = -1;

  // Verifica duplicidade de CPF em outra linha (diferente do próprio e-mail)
  for (var j = 1; j < dadosOri.length; j++) {
    var cpfLinha   = String(dadosOri[j][COL_ORI.CPF]   || '').replace(/\D/g, '');
    var emailLinha = String(dadosOri[j][COL_ORI.EMAIL]  || '').toLowerCase().trim();
    if (cpfLinha === cpf && emailLinha !== email) {
      return jsonError_('CPF já cadastrado para outro orientador.', 'CONFLICT');
    }
    if (emailLinha === email) {
      oriRowIdx = j + 1; // base-1
    }
  }

  if (oriRowIdx === -1) {
    // Cria nova linha (não havia entrada nem como 'Convidado')
    var novaLinha = new Array(14);
    novaLinha[COL_ORI.TIMESTAMP]    = new Date();
    novaLinha[COL_ORI.TIPO_VINCULO] = vinculo;
    novaLinha[COL_ORI.INI_CONTRATO] = iniCont;
    novaLinha[COL_ORI.FIM_CONTRATO] = fimCont;
    novaLinha[COL_ORI.NOME]         = nome;
    novaLinha[COL_ORI.CPF]          = cpf;
    novaLinha[COL_ORI.SIAPE]        = siape;
    novaLinha[COL_ORI.TEL]          = tel;
    novaLinha[COL_ORI.EMAIL]        = email;
    novaLinha[COL_ORI.TITULACAO]    = titulac;
    novaLinha[COL_ORI.AREA]         = area;
    novaLinha[COL_ORI.CURSOS]       = cursos;
    novaLinha[COL_ORI.STATUS]       = 'Pendente';
    sheetOri.appendRow(novaLinha);
  } else {
    // Atualiza linha existente ('Convidado' → 'Pendente')
    sheetOri.getRange(oriRowIdx, COL_ORI.TIPO_VINCULO + 1).setValue(vinculo);
    sheetOri.getRange(oriRowIdx, COL_ORI.INI_CONTRATO + 1).setValue(iniCont);
    sheetOri.getRange(oriRowIdx, COL_ORI.FIM_CONTRATO + 1).setValue(fimCont);
    sheetOri.getRange(oriRowIdx, COL_ORI.NOME         + 1).setValue(nome);
    sheetOri.getRange(oriRowIdx, COL_ORI.CPF          + 1).setValue(cpf);
    sheetOri.getRange(oriRowIdx, COL_ORI.SIAPE        + 1).setValue(siape);
    sheetOri.getRange(oriRowIdx, COL_ORI.TEL          + 1).setValue(tel);
    sheetOri.getRange(oriRowIdx, COL_ORI.TITULACAO    + 1).setValue(titulac);
    sheetOri.getRange(oriRowIdx, COL_ORI.AREA         + 1).setValue(area);
    sheetOri.getRange(oriRowIdx, COL_ORI.CURSOS       + 1).setValue(cursos);
    sheetOri.getRange(oriRowIdx, COL_ORI.STATUS       + 1).setValue('Pendente');
  }

  // 6. Notifica o setor
  try {
    enviarEmailNovoOrientador_({
      nomeOrientador: nome,
      cpfOrientador:  cpf,
      siape:          siape,
      emailInst:      email,
      tipoVinculo:    vinculo,
      titulacao:      titulac,
      cursos:         cursos,
    });
  } catch (eM) { logErro_('registrarOrientadorConvidado_.mail', eM); }

  return jsonOk_({
    cadastrado: true,
    mensagem:   'Cadastro registrado com sucesso! Agora você pode revisar o checklist da solicitação.',
  });
}
