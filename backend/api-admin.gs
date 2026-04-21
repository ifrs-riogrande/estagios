/**
 * api-admin.gs — Web App: Operações administrativas do Setor de Estágios
 * SGE — Sistema de Gestão de Estágios · IFRS Campus Rio Grande
 *
 * Todas as rotas exigem validação de e-mail Admin (lista restrita).
 * Rotas GET  via ?action=X&authToken=Y
 * Rotas POST via body JSON { action, authToken, ...dados }
 *
 * ─── GET ──────────────────────────────────────────────────────────
 *   listarSolicitacoesAdmin   → array de solicitações
 *   listarDocumentosAdmin     → { docsEnviados, aguardandoDG, validacaoFinal }
 *   listarAlunosAdmin         → array de alunos com histórico
 *   listarEmpresasAdmin       → array de empresas
 *   listarOrientadoresAdmin   → array de orientadores
 *   listarAdendosAdmin        → array de adendos
 *   listarAgentesAdmin        → array de agentes
 *
 * ─── POST ─────────────────────────────────────────────────────────
 *   aprovarSolicitacao        → { idEstagio }
 *   reprovarSolicitacao       → { idEstagio, motivoReprovacao }
 *   marcarEmAnalise           → { idEstagio }
 *   validarDocumentos         → { idEstagio }          (setor → DG)
 *   reprovarDocumentos        → { idEstagio, motivoReprovacao }
 *   reprovarDocumentosDG      → { idEstagio, motivoReprovacao }
 *   validarDocumentosDG       → { idEstagio }          (ativa estágio)
 *   validarEmpresa            → { cnpj }
 *   inativarEmpresa           → { cnpj }
 *   inativarOrientador        → { email }
 *   reativarOrientador        → { email }
 *   aprovarAdendo             → { idAdendo, idEstagio }
 *   reprovarAdendo            → { idAdendo, idEstagio, motivoReprovacao }
 *   inativarAgente            → { cnpj }
 *   reativarAgente            → { cnpj }
 *   cadastrarCoordenador      → dados do coordenador
 *
 * Planilha única (todas as abas):
 *   ID: definido em CFG_ADMIN.SS_ID (mesmo de api-solicitacao.gs)
 */

'use strict';

var CFG_ADMIN = {
  // ⚠️ Substitua pelo ID da sua planilha consolidada
  SS_ID: '1zVyseifVC6xeMpNjqwYd6jCq9HTJ2NS8BlN1dtM4s7Y',

  // Abas
  ABA_SOL:         'Solicitações',
  ABA_ESTUDANTES:  'Estudantes',
  ABA_EMPRESAS:    'Empresas',
  ABA_ORIENTADORES:'Orientadores',
  ABA_COORDENADORES:'Coordenadores',
  ABA_ADENDOS:     'Adendos',
  ABA_AGENTES:     'Agentes',
  ABA_PARC:        'Relatórios Parciais',
  ABA_FINAL:       'Relatórios Finais',

  // IDs dos templates Google Docs (mail merge)
  DOC_TCE_OBRIG:    '1vlxgBDyPtOzFqWX_Ie1GToi3UOYXrJ_E',
  DOC_TCE_NAO:      '1bDP7eXRexrkctiJyZcs2T1dKHp_mww75',
  DOC_SOLICITACAO:  '1IaH3Gh-uDu2Ossk_W3i7Co_UgNwSkXMq',

  // E-mails Admin autorizados
  ADMIN_EMAILS: [
    'estagios@riogrande.ifrs.edu.br',
    'dex@riogrande.ifrs.edu.br',
    'den@riogrande.ifrs.edu.br',
  ],

  // Pasta raiz no Drive
  DRIVE_ROOT_NAME: 'Estágios SGE',
};

// Índices de coluna — aba Solicitações (0-based)
// ⚠️ Deve estar 100% sincronizado com COL_SOL em api-solicitacao.gs
var COL = {
  TIMESTAMP:        0,
  ID_ESTAGIO:       1,
  EMAIL_ESTUDANTE:  2,
  NOME_ESTUDANTE:   3,
  MATRICULA:        4,
  CURSO:            5,
  CPF_ESTUDANTE:    6,
  DATA_NASC:        7,
  TELEFONE:         8,
  TIPO_ESTAGIO:     9,
  NOME_EMPRESA:     10,
  CNPJ_EMPRESA:     11,
  NOME_SUPERVISOR:  12,
  EMAIL_SUPERVISOR: 13,
  NOME_AGENTE:      14,
  NOME_ORIENTADOR:  15,
  EMAIL_ORIENTADOR: 16,
  DATA_INICIO:      17,
  DATA_TERMINO:     18,
  CARGA_HORARIA:    19,
  HORARIO:          20,
  REMUNERACAO:      21,
  VALOR_BOLSA:      22,
  VALOR_TRANSPORTE: 23,
  PLANO_ATIVIDADES: 24,
  LINK_DOC_MAT:     25,
  LINK_DOC_ID:      26,
  LINK_DOC_BOL:     27,
  STATUS:           28,
  OBSERVACAO_SETOR: 29,
  MOTIVO_REPROVACAO:30,
  DRIVE_URL:        31,
  DATA_APROVACAO:   32,
  DATA_DOC_ENVIADO: 33,
  DATA_ATIVACAO:    34,
  OBJETIVOS:        35,
  FORMANDO:         36,
  TURNO:             37,   // turno do estudante no curso (salvo na solicitação)
  SEMESTRE_SOL:      38,   // período/semestre atual (salvo na solicitação)
  EMAIL_INST_ESTAGIO:39,   // e-mail institucional do vínculo usado neste estágio
};

// ─────────────────────────────────────────────────────────────────
// Roteamento
// ─────────────────────────────────────────────────────────────────

function doGetAdmin(e) {
  try {
    var token = e.parameter && e.parameter.authToken;
    validarTokenAdmin_(token);
    var action = e.parameter.action || '';

    switch (action) {
      case 'listarSolicitacoesAdmin':  return listarSolicitacoesAdmin_();
      case 'listarDocumentosAdmin':    return listarDocumentosAdmin_();
      case 'listarAlunosAdmin':        return listarAlunosAdmin_();
      case 'listarEmpresasAdmin':      return listarEmpresasAdmin_();
      case 'listarOrientadoresAdmin':  return listarOrientadoresAdmin_();
      case 'listarAdendosAdmin':       return listarAdendosAdmin_();
      case 'listarAgentesAdmin':       return listarAgentesAdmin_();
      default: return jsonError_('Ação GET não reconhecida: ' + action, 'UNKNOWN_ACTION');
    }
  } catch (err) {
    if (err instanceof ErroAutenticacao) return jsonError_(err.message, 'AUTH_ERROR');
    logErro_('api-admin.doGetAdmin', err);
    return jsonError_('Erro interno.', 'INTERNAL');
  }
}

function doPostAdmin(e) {
  try {
    var body   = JSON.parse(e.postData.contents);
    var token  = body.authToken;
    validarTokenAdmin_(token);
    var action = body.action || '';

    switch (action) {
      case 'aprovarSolicitacao':   return aprovarSolicitacao_(body);
      case 'reprovarSolicitacao':  return reprovarSolicitacao_(body);
      case 'marcarEmAnalise':      return mudarStatus_(body.idEstagio, 'Em análise', '', '');
      case 'validarDocumentos':    return validarDocumentos_(body);
      case 'reprovarDocumentos':   return reprovarDocumentos_(body);
      case 'reprovarDocumentosDG': return reprovarDocumentosDG_(body);
      case 'validarDocumentosDG':  return validarDocumentosDG_(body);
      case 'validarEmpresa':       return alterarStatusEmpresa_(body.cnpj, 'Validada');
      case 'inativarEmpresa':      return alterarStatusEmpresa_(body.cnpj, 'Inativa');
      case 'inativarOrientador':   return alterarStatusOrientador_(body.email, 'Inativo');
      case 'reativarOrientador':   return alterarStatusOrientador_(body.email, 'Ativo');
      case 'aprovarAdendo':        return processarAdendo_(body, 'Aprovado');
      case 'reprovarAdendo':       return processarAdendo_(body, 'Reprovado');
      case 'inativarAgente':         return alterarStatusAgente_(body.cnpj, 'Inativo');
      case 'reativarAgente':         return alterarStatusAgente_(body.cnpj, 'Ativo');
      case 'cadastrarCoordenador':   return cadastrarCoordenador_(body);
      // Estudantes — validação de cadastro e reenvio de código
      case 'validarCadastroAdmin':   return validarCadastroAdmin_(body);
      case 'reenviarCodigoAdmin':    return reenviarCodigoAdmin_(body);
      default: return jsonError_('Ação POST não reconhecida: ' + action, 'UNKNOWN_ACTION');
    }
  } catch (err) {
    if (err instanceof ErroAutenticacao) return jsonError_(err.message, 'AUTH_ERROR');
    logErro_('api-admin.doPostAdmin', err);
    return jsonError_('Erro interno: ' + err.message, 'INTERNAL');
  }
}

// ─────────────────────────────────────────────────────────────────
// Validação Admin
// ─────────────────────────────────────────────────────────────────

function validarTokenAdmin_(token) {
  var info = AUTH.validarToken(token);
  var email = (info.email || '').toLowerCase().trim();
  var admins = CFG_ADMIN.ADMIN_EMAILS.map(function(e) { return e.toLowerCase(); });
  if (admins.indexOf(email) === -1) {
    throw new ErroAutenticacao('E-mail ' + email + ' não tem permissão de Admin.');
  }
  return info;
}

// ─────────────────────────────────────────────────────────────────
// GET — Listagens
// ─────────────────────────────────────────────────────────────────

function listarSolicitacoesAdmin_() {
  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sheet = ss.getSheetByName(CFG_ADMIN.ABA_SOL);
  if (!sheet) return jsonOk_([]);
  var dados = sheet.getDataRange().getValues();
  var lista = [];
  for (var i = 1; i < dados.length; i++) {
    var r = dados[i];
    if (!r[COL.ID_ESTAGIO]) continue;
    lista.push({
      id:               String(r[COL.ID_ESTAGIO]).trim(),
      emailEstudante:   String(r[COL.EMAIL_ESTUDANTE] || ''),
      nomeEstudante:    String(r[COL.NOME_ESTUDANTE] || ''),
      matricula:        String(r[COL.MATRICULA] || ''),
      cpfEstudante:     String(r[COL.CPF_ESTUDANTE] || ''),
      curso:            String(r[COL.CURSO] || ''),
      semestre:         '',  // campo no cadastro do estudante, não na solicitação
      tipoEstagio:      String(r[COL.TIPO_ESTAGIO] || ''),
      empresa:          String(r[COL.NOME_EMPRESA] || ''),
      cnpjEmpresa:      String(r[COL.CNPJ_EMPRESA] || ''),
      nomeSupervisor:   String(r[COL.NOME_SUPERVISOR] || ''),
      emailSupervisor:  String(r[COL.EMAIL_SUPERVISOR] || ''),
      nomeOrientador:   String(r[COL.NOME_ORIENTADOR] || ''),
      emailOrientador:  String(r[COL.EMAIL_ORIENTADOR] || ''),
      dataInicio:       formatarData_(r[COL.DATA_INICIO]),
      dataTermino:      formatarData_(r[COL.DATA_TERMINO]),
      cargaHorariaSemanal: String(r[COL.CARGA_HORARIA] || ''),
      planoAtividades:  String(r[COL.PLANO_ATIVIDADES] || ''),
      status:           String(r[COL.STATUS] || ''),
      observacaoSetor:  String(r[COL.OBSERVACAO_SETOR] || ''),
      motivoReprovacao: String(r[COL.MOTIVO_REPROVACAO] || ''),
      driveUrl:         String(r[COL.DRIVE_URL] || ''),
      dataSolicitacao:  formatarData_(r[COL.TIMESTAMP]),
    });
  }
  lista.reverse(); // mais recentes primeiro
  return jsonOk_(lista);
}

function listarDocumentosAdmin_() {
  var lista = listarSolicitacoesAdmin_();
  // lista já é um ContentService — precisa ler o JSON
  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sheet = ss.getSheetByName(CFG_ADMIN.ABA_SOL);
  if (!sheet) return jsonOk_({ docsEnviados: [], aguardandoDG: [], validacaoFinal: [] });
  var dados = sheet.getDataRange().getValues();

  var docsEnviados = [], aguardandoDG = [], validacaoFinal = [];

  for (var i = 1; i < dados.length; i++) {
    var r = dados[i];
    var status = String(r[COL.STATUS] || '').trim();
    var obj = {
      id:            String(r[COL.ID_ESTAGIO] || '').trim(),
      nomeEstudante: String(r[COL.NOME_ESTUDANTE] || ''),
      emailEstudante:String(r[COL.EMAIL_ESTUDANTE] || ''),
      curso:         String(r[COL.CURSO] || ''),
      empresa:       String(r[COL.NOME_EMPRESA] || ''),
      tipoEstagio:   String(r[COL.TIPO_ESTAGIO] || ''),
      status:        status,
      driveUrl:      String(r[COL.DRIVE_URL] || ''),
      dataEnvio:     '',
      arquivos:      [],
    };
    if (!obj.id) continue;

    if (status === 'Docs Enviados') {
      obj.dataEnvio = formatarData_(r[COL.DATA_DOC_ENVIADO]);
      docsEnviados.push(obj);
    } else if (status === 'Aguardando DG') {
      aguardandoDG.push(obj);
    } else if (status === 'Aguardando Validação Final') {
      validacaoFinal.push(obj);
    }
  }

  return jsonOk_({ docsEnviados: docsEnviados, aguardandoDG: aguardandoDG, validacaoFinal: validacaoFinal });
}

function listarAlunosAdmin_() {
  // Índices de coluna da aba Estudantes (base 0) — sincronizados com COL_EST em api-estudantes.gs
  // 0:TIMESTAMP 1:NOME 2:EMAIL_INST 3:EMAIL_PESSOAL 4:MATRICULA 5:CURSO
  // 6:TURNO 7:SEMESTRE 8:CPF 9:DATA_NASC 10:TELEFONE 11:ENDERECO
  // 12:MAIOR_IDADE 13:NOME_RESP 14:CPF_RESP 15:TEL_RESP 16:EMAIL_RESP 17:DOC_RESP
  // 18:STATUS 19:COD_ACESSO 20:COD_EXPIRA 21:MODALIDADE 22:BAIRRO 23:CEP 24:CIDADE 25:UF

  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sheet = ss.getSheetByName(CFG_ADMIN.ABA_ESTUDANTES);
  if (!sheet) return jsonOk_([]);
  var dados = sheet.getDataRange().getValues();

  // Lê solicitações para contar estágios por estudante
  var sheetSol = ss.getSheetByName(CFG_ADMIN.ABA_SOL);
  var estagiosPorEmail = {};
  if (sheetSol) {
    var dadosSol = sheetSol.getDataRange().getValues();
    for (var j = 1; j < dadosSol.length; j++) {
      var emailSol = String(dadosSol[j][COL.EMAIL_ESTUDANTE] || '').toLowerCase();
      if (!emailSol) continue;
      if (!estagiosPorEmail[emailSol]) estagiosPorEmail[emailSol] = [];
      estagiosPorEmail[emailSol].push({
        id:      String(dadosSol[j][COL.ID_ESTAGIO]   || ''),
        empresa: String(dadosSol[j][COL.NOME_EMPRESA] || ''),
        status:  String(dadosSol[j][COL.STATUS]       || ''),
      });
    }
  }

  var lista = [];
  for (var i = 1; i < dados.length; i++) {
    var r = dados[i];
    if (!r[4]) continue;  // matrícula vazia (col 4)
    var emailEst = String(r[2] || '').toLowerCase();  // EMAIL_INST (col 2)
    var ests = estagiosPorEmail[emailEst] || [];
    lista.push({
      nome:                 String(r[1]  || ''),  // NOME
      cpf:                  String(r[8]  || ''),  // CPF
      matricula:            String(r[4]  || ''),  // MATRICULA
      email:                emailEst,
      emailPessoal:         String(r[3]  || ''),  // EMAIL_PESSOAL
      curso:                String(r[5]  || ''),  // CURSO
      turno:                String(r[6]  || ''),  // TURNO
      semestre:             String(r[7]  || ''),  // SEMESTRE
      modalidade:           String(r[21] || ''),  // MODALIDADE
      dataNascimento:       formatarData_(r[9]),  // DATA_NASC
      telefone:             String(r[10] || ''),  // TELEFONE
      endereco:             String(r[11] || ''),  // ENDERECO
      bairro:               String(r[22] || ''),  // BAIRRO
      cep:                  String(r[23] || ''),  // CEP
      cidade:               String(r[24] || ''),  // CIDADE
      uf:                   String(r[25] || ''),  // UF
      maiorIdade:           String(r[12] || ''),  // MAIOR_IDADE
      nomeResponsavelLegal: String(r[13] || ''),  // NOME_RESP
      cpfResponsavelLegal:  String(r[14] || ''),  // CPF_RESP
      telResponsavelLegal:  String(r[15] || ''),  // TEL_RESP
      status:               String(r[18] || 'Aguardando Validação'),  // STATUS
      estagios:             ests,
      totalEstagios:        ests.length,
    });
  }
  return jsonOk_(lista);
}

function listarEmpresasAdmin_() {
  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sheet = ss.getSheetByName(CFG_ADMIN.ABA_EMPRESAS);
  if (!sheet) return jsonOk_([]);
  var dados = sheet.getDataRange().getValues();

  // Conta estágios ativos por empresa
  var sheetSol = ss.getSheetByName(CFG_ADMIN.ABA_SOL);
  var ativosPorEmpresa = {};
  if (sheetSol) {
    var dadosSol2 = sheetSol.getDataRange().getValues();
    for (var j = 1; j < dadosSol2.length; j++) {
      if (String(dadosSol2[j][COL.STATUS] || '') === 'Em execução') {
        var cnpj = String(dadosSol2[j][COL.CNPJ_EMPRESA] || '').replace(/\D/g,'');
        ativosPorEmpresa[cnpj] = (ativosPorEmpresa[cnpj] || 0) + 1;
      }
    }
  }

  var lista = [];
  for (var i = 1; i < dados.length; i++) {
    var r = dados[i];
    if (!r[0]) continue;
    var cnpjNorm = String(r[0] || '').replace(/\D/g,'');
    lista.push({
      cnpj:               String(r[0] || ''),
      razaoSocial:        String(r[1] || ''),
      nomeFantasia:       String(r[2] || ''),
      tipoEmpresa:        String(r[3] || ''),
      municipio:          String(r[4] || ''),
      uf:                 String(r[5] || ''),
      endereco:           String(r[6] || ''),
      nomeRepresentante:  String(r[7] || ''),
      cargoRepresentante: String(r[8] || ''),
      email:              String(r[9] || ''),
      telefone:           String(r[10] || ''),
      status:             String(r[11] || 'Pendente'),
      estagiosAtivos:     ativosPorEmpresa[cnpjNorm] || 0,
    });
  }
  return jsonOk_(lista);
}

function listarOrientadoresAdmin_() {
  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sheet = ss.getSheetByName(CFG_ADMIN.ABA_ORIENTADORES);
  if (!sheet) return jsonOk_([]);
  var dados = sheet.getDataRange().getValues();

  // Conta estágios ativos por orientador
  var sheetSol = ss.getSheetByName(CFG_ADMIN.ABA_SOL);
  var ativosPorOri = {};
  if (sheetSol) {
    var dadosSol3 = sheetSol.getDataRange().getValues();
    for (var j = 1; j < dadosSol3.length; j++) {
      if (String(dadosSol3[j][COL.STATUS] || '') === 'Em execução') {
        var eOri = String(dadosSol3[j][COL.EMAIL_ORIENTADOR] || '').toLowerCase();
        ativosPorOri[eOri] = (ativosPorOri[eOri] || 0) + 1;
      }
    }
  }

  var lista = [];
  for (var i = 1; i < dados.length; i++) {
    var r = dados[i];
    if (!r[3]) continue; // sem e-mail
    var emailOri = String(r[3] || '').toLowerCase();
    lista.push({
      nome:        String(r[0] || ''),
      siape:       String(r[1] || ''),
      titulacao:   String(r[2] || ''),
      email:       emailOri,
      tipoVinculo: String(r[4] || ''),
      fimContrato: formatarData_(r[5]),
      cursos:      String(r[6] || '').split(',').map(function(c){ return c.trim(); }).filter(Boolean),
      status:      String(r[7] || 'Ativo'),
      estagiosAtivos: ativosPorOri[emailOri] || 0,
    });
  }
  return jsonOk_(lista);
}

function listarAdendosAdmin_() {
  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sheet = ss.getSheetByName(CFG_ADMIN.ABA_ADENDOS);
  if (!sheet) return jsonOk_([]);
  var dados = sheet.getDataRange().getValues();
  var lista = [];
  for (var i = 1; i < dados.length; i++) {
    var r = dados[i];
    if (!r[0]) continue;
    lista.push({
      id:              i,   // linha como ID
      idEstagio:       String(r[1] || '').trim(),
      nomeEstudante:   String(r[2] || ''),
      emailEstudante:  String(r[3] || ''),
      tipoAlteracao:   String(r[4] || ''),
      descricao:       String(r[5] || ''),
      valorAnterior:   String(r[6] || ''),
      valorNovo:       String(r[7] || ''),
      status:          String(r[9] || 'Pendente'),
      dataSolicitacao: formatarData_(r[0]),
    });
  }
  lista.reverse();
  return jsonOk_(lista);
}

function listarAgentesAdmin_() {
  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sheet = ss.getSheetByName(CFG_ADMIN.ABA_AGENTES);
  if (!sheet) return jsonOk_([]);
  var dados = sheet.getDataRange().getValues();
  var lista = [];
  for (var i = 1; i < dados.length; i++) {
    var r = dados[i];
    if (!r[0]) continue;
    lista.push({
      cnpj:            String(r[0] || ''),
      nomeAgente:      String(r[1] || ''),
      nomeResponsavel: String(r[2] || ''),
      cargoResponsavel:String(r[3] || ''),
      email:           String(r[4] || ''),
      telefone:        String(r[5] || ''),
      endereco:        String(r[6] || ''),
      status:          String(r[7] || 'Ativo'),
      totalEstagios:   0,
    });
  }
  return jsonOk_(lista);
}

// ─────────────────────────────────────────────────────────────────
// POST — Ações sobre Solicitações
// ─────────────────────────────────────────────────────────────────

function aprovarSolicitacao_(body) {
  var id  = String(body.idEstagio || '').trim();
  var row = encontrarLinhaSolicitacao_(id);
  if (!row) return jsonError_('Solicitação não encontrada: ' + id, 'NOT_FOUND');

  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sheet = ss.getSheetByName(CFG_ADMIN.ABA_SOL);
  var dados = sheet.getDataRange().getValues();
  var r     = dados[row - 1];

  // Muda status
  sheet.getRange(row, COL.STATUS + 1).setValue('Aguardando Documentos');
  sheet.getRange(row, COL.DATA_APROVACAO + 1).setValue(new Date());

  // Gera documentos via mala direta
  var vars  = montarVariaveis_(r);
  var drive = criarPastaEstagioNova_(vars);
  sheet.getRange(row, COL.DRIVE_URL + 1).setValue(drive.url);

  gerarDocumentosTCE_(vars, drive.folderId, String(r[COL.TIPO_ESTAGIO] || ''));

  // Compartilha pasta com estudante, orientador, supervisor
  compartilharPasta_(drive.folderId, [
    String(r[COL.EMAIL_ESTUDANTE]  || ''),
    String(r[COL.EMAIL_ORIENTADOR] || ''),
    String(r[COL.EMAIL_SUPERVISOR] || ''),
  ]);

  // Envia e-mail ao estudante
  enviarEmailAprovacao_(r, drive.url);

  return jsonOk_({ status: 'Aguardando Documentos', driveUrl: drive.url });
}

function reprovarSolicitacao_(body) {
  var id     = String(body.idEstagio || '').trim();
  var motivo = String(body.motivoReprovacao || '').trim();
  var row    = encontrarLinhaSolicitacao_(id);
  if (!row) return jsonError_('Solicitação não encontrada.', 'NOT_FOUND');

  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sheet = ss.getSheetByName(CFG_ADMIN.ABA_SOL);
  var dados = sheet.getDataRange().getValues();
  var r     = dados[row - 1];

  sheet.getRange(row, COL.STATUS + 1).setValue('Reprovado');
  sheet.getRange(row, COL.MOTIVO_REPROVACAO + 1).setValue(motivo);

  // E-mail ao estudante
  enviarEmailReprovacao_(
    String(r[COL.EMAIL_ESTUDANTE] || ''),
    String(r[COL.NOME_ESTUDANTE] || ''),
    id, motivo
  );

  return jsonOk_({ status: 'Reprovado' });
}

function mudarStatus_(id, novoStatus, campoExtra, valorExtra) {
  var row = encontrarLinhaSolicitacao_(id);
  if (!row) return jsonError_('Solicitação não encontrada.', 'NOT_FOUND');
  var sheet = SpreadsheetApp.openById(CFG_ADMIN.SS_ID).getSheetByName(CFG_ADMIN.ABA_SOL);
  sheet.getRange(row, COL.STATUS + 1).setValue(novoStatus);
  if (campoExtra) sheet.getRange(row, campoExtra + 1).setValue(valorExtra);
  return jsonOk_({ status: novoStatus });
}

function validarDocumentos_(body) {
  var id  = String(body.idEstagio || '').trim();
  var row = encontrarLinhaSolicitacao_(id);
  if (!row) return jsonError_('Solicitação não encontrada.', 'NOT_FOUND');

  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sheet = ss.getSheetByName(CFG_ADMIN.ABA_SOL);
  var dados = sheet.getDataRange().getValues();
  var r     = dados[row - 1];

  sheet.getRange(row, COL.STATUS + 1).setValue('Aguardando DG');

  // Notifica Diretor Geral
  var emailDG = obterEmailDiretorGeral_();
  if (emailDG) {
    MailApp.sendEmail({
      to: emailDG,
      subject: '[SGE IFRS] Documentos aguardando sua assinatura — ' + id,
      body: [
        'Prezado(a) Diretor(a),',
        '',
        'Os documentos do estágio ' + id + ' foram validados pelo setor e aguardam sua assinatura digital.',
        '',
        'Estudante: ' + String(r[COL.NOME_ESTUDANTE] || ''),
        'Empresa: '   + String(r[COL.NOME_EMPRESA]   || ''),
        'Tipo: '      + String(r[COL.TIPO_ESTAGIO]   || ''),
        '',
        'Acesse o SGE para fazer o download, assine pelo assinador.iti.br e envie de volta pelo sistema.',
        '',
        'Setor de Estágios — IFRS Campus Rio Grande',
      ].join('\n'),
    });
  }

  return jsonOk_({ status: 'Aguardando DG' });
}

function reprovarDocumentos_(body) {
  var id     = String(body.idEstagio || '').trim();
  var motivo = String(body.motivoReprovacao || '').trim();
  var row    = encontrarLinhaSolicitacao_(id);
  if (!row) return jsonError_('Solicitação não encontrada.', 'NOT_FOUND');

  var sheet = SpreadsheetApp.openById(CFG_ADMIN.SS_ID).getSheetByName(CFG_ADMIN.ABA_SOL);
  var dados = sheet.getDataRange().getValues();
  var r     = dados[row - 1];

  sheet.getRange(row, COL.STATUS + 1).setValue('Aguardando Documentos');
  sheet.getRange(row, COL.OBSERVACAO_SETOR + 1).setValue(motivo);

  MailApp.sendEmail({
    to:      String(r[COL.EMAIL_ESTUDANTE] || ''),
    subject: '[SGE IFRS] Documentos devolvidos para correção — ' + id,
    body:    'Seu envio de documentos foi devolvido pelo setor de estágios.\n\nMotivo: ' + motivo + '\n\nPor favor, corrija e reenvie pelo sistema.',
  });

  return jsonOk_({ status: 'Aguardando Documentos' });
}

function reprovarDocumentosDG_(body) {
  var id     = String(body.idEstagio || '').trim();
  var motivo = String(body.motivoReprovacao || '').trim();
  var row    = encontrarLinhaSolicitacao_(id);
  if (!row) return jsonError_('Solicitação não encontrada.', 'NOT_FOUND');

  var sheet = SpreadsheetApp.openById(CFG_ADMIN.SS_ID).getSheetByName(CFG_ADMIN.ABA_SOL);
  sheet.getRange(row, COL.STATUS + 1).setValue('Aguardando DG');
  sheet.getRange(row, COL.OBSERVACAO_SETOR + 1).setValue(motivo);

  var emailDG = obterEmailDiretorGeral_();
  if (emailDG) {
    MailApp.sendEmail({
      to: emailDG,
      subject: '[SGE IFRS] Documentos devolvidos para correção — ' + id,
      body:    'Os documentos do estágio ' + id + ' foram devolvidos.\n\nMotivo: ' + motivo + '\n\nPor favor, reenvie pelo sistema.',
    });
  }

  return jsonOk_({ status: 'Aguardando DG' });
}

function validarDocumentosDG_(body) {
  var id  = String(body.idEstagio || '').trim();
  var row = encontrarLinhaSolicitacao_(id);
  if (!row) return jsonError_('Solicitação não encontrada.', 'NOT_FOUND');

  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sheet = ss.getSheetByName(CFG_ADMIN.ABA_SOL);
  var dados = sheet.getDataRange().getValues();
  var r     = dados[row - 1];

  sheet.getRange(row, COL.STATUS + 1).setValue('Em execução');
  sheet.getRange(row, COL.DATA_ATIVACAO + 1).setValue(new Date());

  // E-mail para TODOS os envolvidos
  var destinatarios = [
    String(r[COL.EMAIL_ESTUDANTE]  || ''),
    String(r[COL.EMAIL_ORIENTADOR] || ''),
    String(r[COL.EMAIL_SUPERVISOR] || ''),
  ].filter(function(e) { return e; });

  var assunto = '[SGE IFRS] Estágio autorizado — ' + id;
  var corpo = [
    'Prezado(a),',
    '',
    'O estágio ' + id + ' foi devidamente assinado e está autorizado a iniciar.',
    '',
    'Estudante: '    + String(r[COL.NOME_ESTUDANTE] || ''),
    'Empresa: '      + String(r[COL.NOME_EMPRESA]   || ''),
    'Orientador: '   + String(r[COL.NOME_ORIENTADOR]|| ''),
    'Supervisor: '   + String(r[COL.NOME_SUPERVISOR] || ''),
    'Tipo: '         + String(r[COL.TIPO_ESTAGIO]   || ''),
    'Início: '       + formatarData_(r[COL.DATA_INICIO]),
    'Término: '      + formatarData_(r[COL.DATA_TERMINO]),
    '',
    'Os documentos assinados estão disponíveis na pasta do Drive compartilhada.',
    '',
    'Setor de Estágios — IFRS Campus Rio Grande',
    'estagios@riogrande.ifrs.edu.br',
  ].join('\n');

  destinatarios.forEach(function(dest) {
    try { MailApp.sendEmail({ to: dest, subject: assunto, body: corpo }); } catch(e) {}
  });

  return jsonOk_({ status: 'Em execução' });
}

// ─────────────────────────────────────────────────────────────────
// POST — Empresas / Orientadores / Adendos / Agentes
// ─────────────────────────────────────────────────────────────────

function alterarStatusEmpresa_(cnpj, novoStatus) {
  var cnpjLimpo = String(cnpj || '').replace(/\D/g,'');
  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sheet = ss.getSheetByName(CFG_ADMIN.ABA_EMPRESAS);
  if (!sheet) return jsonError_('Aba de empresas não encontrada.', 'NOT_FOUND');
  var dados = sheet.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][0] || '').replace(/\D/g,'') === cnpjLimpo) {
      sheet.getRange(i + 1, 12).setValue(novoStatus); // col 11 = index 11 (0-based)
      return jsonOk_({ status: novoStatus });
    }
  }
  return jsonError_('Empresa não encontrada.', 'NOT_FOUND');
}

function alterarStatusOrientador_(email, novoStatus) {
  var emailLower = String(email || '').toLowerCase().trim();
  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sheet = ss.getSheetByName(CFG_ADMIN.ABA_ORIENTADORES);
  if (!sheet) return jsonError_('Aba de orientadores não encontrada.', 'NOT_FOUND');
  var dados = sheet.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][3] || '').toLowerCase().trim() === emailLower) {
      sheet.getRange(i + 1, 8).setValue(novoStatus); // col index 7 = status
      return jsonOk_({ status: novoStatus });
    }
  }
  return jsonError_('Orientador não encontrado.', 'NOT_FOUND');
}

function processarAdendo_(body, decisao) {
  var idAdendo  = body.idAdendo;
  var idEstagio = String(body.idEstagio || '').trim();
  var motivo    = String(body.motivoReprovacao || '').trim();
  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sheet = ss.getSheetByName(CFG_ADMIN.ABA_ADENDOS);
  if (!sheet) return jsonError_('Aba de adendos não encontrada.', 'NOT_FOUND');
  var dados = sheet.getDataRange().getValues();

  // Procura por idEstagio
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][1] || '').trim() === idEstagio && String(dados[i][9] || '').trim() === 'Pendente') {
      sheet.getRange(i + 1, 10).setValue(decisao); // col 9 = status
      if (motivo) sheet.getRange(i + 1, 11).setValue(motivo);

      var emailEst = String(dados[i][3] || '');
      var nomeEst  = String(dados[i][2] || '');
      if (emailEst) {
        MailApp.sendEmail({
          to:      emailEst,
          subject: '[SGE IFRS] Adendo ao TCE ' + (decisao === 'Aprovado' ? 'aprovado' : 'reprovado') + ' — ' + idEstagio,
          body:    'Prezado(a) ' + nomeEst + ',\n\n' +
                   'Seu pedido de adendo ao TCE do estágio ' + idEstagio + ' foi ' + decisao.toLowerCase() + '.' +
                   (motivo ? '\n\nMotivo: ' + motivo : '') +
                   '\n\nSetor de Estágios — IFRS Campus Rio Grande',
        });
      }
      return jsonOk_({ status: decisao });
    }
  }
  return jsonError_('Adendo pendente não encontrado para ' + idEstagio, 'NOT_FOUND');
}

function alterarStatusAgente_(cnpj, novoStatus) {
  var cnpjLimpo = String(cnpj || '').replace(/\D/g,'');
  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sheet = ss.getSheetByName(CFG_ADMIN.ABA_AGENTES);
  if (!sheet) return jsonError_('Aba de agentes não encontrada.', 'NOT_FOUND');
  var dados = sheet.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][0] || '').replace(/\D/g,'') === cnpjLimpo) {
      sheet.getRange(i + 1, 8).setValue(novoStatus);
      return jsonOk_({ status: novoStatus });
    }
  }
  return jsonError_('Agente não encontrado.', 'NOT_FOUND');
}

function cadastrarCoordenador_(body) {
  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sheet = obterOuCriarAba_(ss, CFG_ADMIN.ABA_COORDENADORES,
    ['CPF','Matrícula SIAPE','Nome','E-mail','Telefone','Titulação','Curso','Timestamp','Status']);

  var emailLower = String(body.email || '').toLowerCase().trim();
  // Verifica se já existe
  var dados = sheet.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][3] || '').toLowerCase().trim() === emailLower &&
        String(dados[i][6] || '').trim() === String(body.curso || '').trim()) {
      // Atualiza
      sheet.getRange(i + 1, 1, 1, 9).setValues([[
        body.cpf || '', body.siape || '', body.nome || '', emailLower,
        body.telefone || '', body.titulacao || '', body.curso || '',
        new Date(), 'Ativo',
      ]]);
      return jsonOk_({ atualizado: true });
    }
  }
  sheet.appendRow([
    body.cpf || '', body.siape || '', body.nome || '', emailLower,
    body.telefone || '', body.titulacao || '', body.curso || '',
    new Date(), 'Ativo',
  ]);
  return jsonOk_({ cadastrado: true });
}

// ─────────────────────────────────────────────────────────────────
// Mala Direta — geração de documentos
// ─────────────────────────────────────────────────────────────────

function gerarDocumentosTCE_(vars, folderId, tipoEstagio) {
  var folder = DriveApp.getFolderById(folderId);
  var templateId = tipoEstagio === 'Obrigatório' ? CFG_ADMIN.DOC_TCE_OBRIG : CFG_ADMIN.DOC_TCE_NAO;

  try {
    // Copia o template
    var copia = DriveApp.getFileById(templateId).makeCopy(
      'TCE — ' + vars['{{NOME_ESTUDANTE}}'] + ' — ' + vars['{{ID_ESTAGIO}}'],
      folder
    );
    // Substitui variáveis
    var doc = DocumentApp.openById(copia.getId());
    var body = doc.getBody();
    for (var key in vars) { body.replaceText(key, vars[key] || ''); }
    doc.saveAndClose();

    // Exporta como PDF
    var pdfBlob = DriveApp.getFileById(copia.getId()).getAs('application/pdf');
    pdfBlob.setName('TCE_' + vars['{{ID_ESTAGIO}}'] + '.pdf');
    folder.createFile(pdfBlob);

    // Remove cópia do .gdoc (opcional: manter para edição)
    // copia.setTrashed(true);
  } catch(e) {
    logErro_('gerarDocumentosTCE_', e);
  }

  // Gera também a Solicitação de Ingresso
  try {
    var copiaSOL = DriveApp.getFileById(CFG_ADMIN.DOC_SOLICITACAO).makeCopy(
      'Solicitação de Ingresso — ' + vars['{{ID_ESTAGIO}}'],
      folder
    );
    var docSOL  = DocumentApp.openById(copiaSOL.getId());
    var bodySOL = docSOL.getBody();
    for (var k in vars) { bodySOL.replaceText(k, vars[k] || ''); }
    docSOL.saveAndClose();

    var pdfSOL = DriveApp.getFileById(copiaSOL.getId()).getAs('application/pdf');
    pdfSOL.setName('Solicitacao_Ingresso_' + vars['{{ID_ESTAGIO}}'] + '.pdf');
    folder.createFile(pdfSOL);
  } catch(e) {
    logErro_('gerarDocumentosTCE_ (solicitacao)', e);
  }
}

function montarVariaveis_(r) {
  var hoje = new Date();
  var vars = {};

  // ── Dados diretos da aba Solicitações ──────────────────────────────
  vars['{{ID_ESTAGIO}}']            = String(r[COL.ID_ESTAGIO]        || '');
  vars['{{NOME_ESTUDANTE}}']        = String(r[COL.NOME_ESTUDANTE]    || '');
  // Usa e-mail institucional do vínculo deste estágio; cai para o e-mail principal se ausente
  vars['{{EMAIL_ESTUDANTE}}']       = String(r[COL.EMAIL_INST_ESTAGIO] || r[COL.EMAIL_ESTUDANTE] || '');
  vars['{{CPF_ESTUDANTE}}']         = String(r[COL.CPF_ESTUDANTE]     || '');
  vars['{{MATRICULA}}']             = String(r[COL.MATRICULA]         || '');
  vars['{{CURSO}}']                 = String(r[COL.CURSO]             || '');
  vars['{{TIPO_ESTAGIO}}']          = String(r[COL.TIPO_ESTAGIO]      || '');
  vars['{{NOME_EMPRESA}}']          = String(r[COL.NOME_EMPRESA]      || '');
  vars['{{CNPJ_EMPRESA}}']          = String(r[COL.CNPJ_EMPRESA]      || '');
  vars['{{NOME_SUPERVISOR}}']       = String(r[COL.NOME_SUPERVISOR]   || '');
  vars['{{EMAIL_SUPERVISOR}}']      = String(r[COL.EMAIL_SUPERVISOR]  || '');
  vars['{{NOME_AGENTE}}']           = String(r[COL.NOME_AGENTE]       || '');
  vars['{{NOME_ORIENTADOR}}']       = String(r[COL.NOME_ORIENTADOR]   || '');
  vars['{{EMAIL_ORIENTADOR}}']      = String(r[COL.EMAIL_ORIENTADOR]  || '');
  vars['{{DATA_INICIO}}']           = formatarData_(r[COL.DATA_INICIO]);
  vars['{{DATA_TERMINO}}']          = formatarData_(r[COL.DATA_TERMINO]);
  vars['{{CARGA_HORARIA_SEMANAL}}'] = String(r[COL.CARGA_HORARIA]     || '');
  vars['{{HORARIO}}']               = String(r[COL.HORARIO]           || '');
  vars['{{REMUNERADO}}']            = String(r[COL.REMUNERACAO]       || '');
  vars['{{VALOR_BOLSA}}']           = String(r[COL.VALOR_BOLSA]       || '');
  vars['{{VALOR_TRANSPORTE}}']      = String(r[COL.VALOR_TRANSPORTE]  || '');
  vars['{{PLANO_ATIVIDADES}}']      = String(r[COL.PLANO_ATIVIDADES]  || '');
  vars['{{OBJETIVOS}}']             = String(r[COL.OBJETIVOS]          || '');
  vars['{{FORMANDO}}']              = String(r[COL.FORMANDO]           || '');
  vars['{{TURNO}}']                 = String(r[COL.TURNO]              || '');  // da solicitação
  vars['{{SEMESTRE}}']              = String(r[COL.SEMESTRE_SOL]       || '');  // da solicitação
  vars['{{DATA_GERACAO}}']          = Utilities.formatDate(hoje, 'America/Sao_Paulo', 'dd/MM/yyyy');
  vars['{{ANO_VIGENTE}}']           = String(hoje.getFullYear());

  // ── Aba Empresas ────────────────────────────────────────────────────
  // COL_EMP: TIMESTAMP=0, EMAIL_FORM=1, TIPO=2, RAZAO_SOCIAL=3,
  //   NOME_FANTASIA=4, CNPJ=5, RAMO=6, ENDERECO=7, MUNICIPIO=8,
  //   UF=9, CEP=10, TEL_EMPRESA=11, EMAIL_EMPRESA=12, SITE=13,
  //   NOME_REP=14, CARGO_REP=15, EMAIL_REP=16, CPF_REP=17
  try {
    var ssEmp    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID).getSheetByName(CFG_ADMIN.ABA_EMPRESAS);
    if (ssEmp) {
      var dadosEmp  = ssEmp.getDataRange().getValues();
      var cnpjBusca = String(r[COL.CNPJ_EMPRESA] || '').replace(/\D/g,'');
      for (var i = 1; i < dadosEmp.length; i++) {
        if (String(dadosEmp[i][5]||'').replace(/\D/g,'') === cnpjBusca) {
          vars['{{RAZAO_SOCIAL_EMPRESA}}']        = String(dadosEmp[i][3]  || '');
          vars['{{NOME_FANTASIA_EMPRESA}}']        = String(dadosEmp[i][4]  || '');
          vars['{{RAMO_EMPRESA}}']                 = String(dadosEmp[i][6]  || '');
          vars['{{ENDERECO_EMPRESA}}']             = String(dadosEmp[i][7]  || '');
          vars['{{MUNICIPIO_EMPRESA}}']            = String(dadosEmp[i][8]  || '');
          vars['{{UF_EMPRESA}}']                   = String(dadosEmp[i][9]  || '');
          vars['{{CEP_EMPRESA}}']                  = String(dadosEmp[i][10] || '');
          vars['{{TELEFONE_EMPRESA}}']             = String(dadosEmp[i][11] || '');
          vars['{{EMAIL_EMPRESA}}']                = String(dadosEmp[i][12] || '');
          vars['{{NOME_REPRESENTANTE_EMPRESA}}']   = String(dadosEmp[i][14] || '');
          vars['{{CARGO_REPRESENTANTE_EMPRESA}}']  = String(dadosEmp[i][15] || '');
          vars['{{EMAIL_REPRESENTANTE_EMPRESA}}']  = String(dadosEmp[i][16] || '');
          break;
        }
      }
    }
  } catch(e) { logErro_('montarVariaveis_.empresa', e); }

  // ── Aba Supervisores ─────────────────────────────────────────────────
  // COL_SUP: NOME=8, TEL_SUP=11, EMAIL_SUP=12, NIVEL_FORMACAO=13, AREA_FORMACAO=14, SETOR=4
  try {
    var shSup  = SpreadsheetApp.openById(CFG_ADMIN.SS_ID).getSheetByName('Supervisores');
    if (shSup) {
      var dadosSup = shSup.getDataRange().getValues();
      var emailSup = String(r[COL.EMAIL_SUPERVISOR]||'').toLowerCase();
      for (var s = 1; s < dadosSup.length; s++) {
        if (String(dadosSup[s][12]||'').toLowerCase() === emailSup) {
          vars['{{SETOR_SUPERVISOR}}']         = String(dadosSup[s][4]  || '');
          vars['{{TELEFONE_SUPERVISOR}}']      = String(dadosSup[s][11] || '');
          vars['{{FORMACAO_SUPERVISOR}}']      = String(dadosSup[s][13] || '');
          vars['{{AREA_FORMACAO_SUPERVISOR}}'] = String(dadosSup[s][14] || '');
          break;
        }
      }
    }
  } catch(e) { logErro_('montarVariaveis_.supervisor', e); }

  // ── Aba Estudantes ───────────────────────────────────────────────────
  // COL_EST: TIMESTAMP=0, NOME=1, EMAIL_INST=2, EMAIL_PESSOAL=3,
  //   MATRICULA=4, CURSO=5, TURNO=6, SEMESTRE=7, CPF=8, DATA_NASC=9,
  //   TELEFONE=10, ENDERECO=11, MAIOR_IDADE=12, NOME_RESP=13,
  //   CPF_RESP=14, TEL_RESP=15, EMAIL_RESP=16
  try {
    var shEst  = SpreadsheetApp.openById(CFG_ADMIN.SS_ID).getSheetByName(CFG_ADMIN.ABA_ESTUDANTES);
    if (shEst) {
      var dadosEst = shEst.getDataRange().getValues();
      var emailEst = String(r[COL.EMAIL_ESTUDANTE]||'').toLowerCase();
      for (var j = 1; j < dadosEst.length; j++) {
        if (String(dadosEst[j][2]||'').toLowerCase() === emailEst) {   // EMAIL_INST
          vars['{{EMAIL_PESSOAL}}']          = String(dadosEst[j][3]  || '');
          vars['{{MODALIDADE}}']             = String(dadosEst[j][21] || '');  // Integrado/Subsequente/Superior
          // TURNO e SEMESTRE são lidos da solicitação (cols 37/38), não do cadastro
          vars['{{DATA_NASCIMENTO}}']        = formatarData_(dadosEst[j][9]);
          vars['{{TELEFONE_ESTUDANTE}}']     = String(dadosEst[j][10] || '');
          vars['{{ENDERECO_ESTUDANTE}}']     = String(dadosEst[j][11] || '');
          vars['{{BAIRRO_ESTUDANTE}}']       = String(dadosEst[j][22] || '');
          vars['{{CEP_ESTUDANTE}}']          = String(dadosEst[j][23] || '');
          vars['{{CIDADE_ESTUDANTE}}']       = String(dadosEst[j][24] || '');
          vars['{{UF_ESTUDANTE}}']           = String(dadosEst[j][25] || '');
          vars['{{NOME_RESPONSAVEL_LEGAL}}'] = String(dadosEst[j][13] || '');
          vars['{{CPF_RESPONSAVEL_LEGAL}}']  = String(dadosEst[j][14] || '');
          vars['{{TEL_RESPONSAVEL_LEGAL}}']  = String(dadosEst[j][15] || '');
          vars['{{EMAIL_RESPONSAVEL_LEGAL}}']= String(dadosEst[j][16] || '');
          break;
        }
      }
    }
  } catch(e) { logErro_('montarVariaveis_.estudante', e); }

  // ── Aba Orientadores ─────────────────────────────────────────────────
  // COL_ORI: TIPO_VINCULO=1, NOME=4, SIAPE=6, EMAIL=8, TITULACAO=9
  try {
    var shOri  = SpreadsheetApp.openById(CFG_ADMIN.SS_ID).getSheetByName(CFG_ADMIN.ABA_ORIENTADORES);
    if (shOri) {
      var dadosOri = shOri.getDataRange().getValues();
      var emailOri = String(r[COL.EMAIL_ORIENTADOR]||'').toLowerCase();
      for (var k = 1; k < dadosOri.length; k++) {
        if (String(dadosOri[k][8]||'').toLowerCase() === emailOri) {   // EMAIL
          vars['{{SIAPE_ORIENTADOR}}']      = String(dadosOri[k][6] || '');
          vars['{{TITULACAO_ORIENTADOR}}']  = String(dadosOri[k][9] || '');
          break;
        }
      }
    }
  } catch(e) { logErro_('montarVariaveis_.orientador', e); }

  // ── Aba Coordenadores ────────────────────────────────────────────────
  // Cabeçalho: CPF=0, SIAPE=1, Nome=2, E-mail=3, Telefone=4, Titulação=5, Curso=6, Timestamp=7, Status=8
  try {
    var shCoo  = SpreadsheetApp.openById(CFG_ADMIN.SS_ID).getSheetByName(CFG_ADMIN.ABA_COORDENADORES);
    if (shCoo) {
      var dadosCoo = shCoo.getDataRange().getValues();
      var cursoEst = String(r[COL.CURSO]||'').trim();
      for (var l = 1; l < dadosCoo.length; l++) {
        if (String(dadosCoo[l][6]||'').trim() === cursoEst && String(dadosCoo[l][8]||'') === 'Ativo') {
          vars['{{NOME_COORDENADOR}}']  = String(dadosCoo[l][2] || '');
          vars['{{SIAPE_COORDENADOR}}'] = String(dadosCoo[l][1] || '');
          vars['{{EMAIL_COORDENADOR}}'] = String(dadosCoo[l][3] || '');
          break;
        }
      }
    }
  } catch(e) { logErro_('montarVariaveis_.coordenador', e); }

  // ── Diretor Geral ────────────────────────────────────────────────────
  try {
    var dgInfo = obterDadosDiretorGeral_();
    if (dgInfo) {
      vars['{{NOME_DIRETOR_GERAL}}']  = dgInfo.nome  || '';
      vars['{{SIAPE_DIRETOR_GERAL}}'] = dgInfo.siape || '';
    }
  } catch(e) {}

  return vars;
}

// ─────────────────────────────────────────────────────────────────
// Drive — pasta por CPF/Matrícula/ID
// ─────────────────────────────────────────────────────────────────

function criarPastaEstagioNova_(vars) {
  var raiz    = obterOuCriarPasta_(null, CFG_ADMIN.DRIVE_ROOT_NAME);
  var cpf     = (vars['{{CPF_ESTUDANTE}}'] || 'SEM_CPF').replace(/\D/g,'');
  var matr    = vars['{{MATRICULA}}']  || 'SEM_MATRICULA';
  var id      = vars['{{ID_ESTAGIO}}']  || 'SEM_ID';
  var nome    = vars['{{NOME_ESTUDANTE}}'] || '';

  var pastaCPF  = obterOuCriarPasta_(raiz, cpf);
  var pastaMatr = obterOuCriarPasta_(pastaCPF, matr);
  var pastaID   = obterOuCriarPasta_(pastaMatr, id + (nome ? ' — ' + nome : ''));

  return { folderId: pastaID.getId(), url: pastaID.getUrl() };
}

function obterOuCriarPasta_(pai, nome) {
  var iter = pai
    ? pai.getFoldersByName(nome)
    : DriveApp.getFoldersByName(nome);
  if (iter.hasNext()) return iter.next();
  return pai ? pai.createFolder(nome) : DriveApp.createFolder(nome);
}

function compartilharPasta_(folderId, emails) {
  var folder = DriveApp.getFolderById(folderId);
  emails.forEach(function(email) {
    if (!email) return;
    try { folder.addViewer(email); } catch(e) {}
  });
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function encontrarLinhaSolicitacao_(id) {
  var sheet = SpreadsheetApp.openById(CFG_ADMIN.SS_ID).getSheetByName(CFG_ADMIN.ABA_SOL);
  if (!sheet) return null;
  var dados = sheet.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][COL.ID_ESTAGIO] || '').trim() === id) return i + 1;
  }
  return null;
}

function obterEmailDiretorGeral_() {
  try {
    var shDG = SpreadsheetApp.openById(CFG_ADMIN.SS_ID).getSheetByName('Diretor Geral');
    if (!shDG) return null;
    var dados = shDG.getDataRange().getValues();
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][4]||'') === 'Ativo') return String(dados[i][3]||'') || null;
    }
    return null;
  } catch(e) { return null; }
}

function obterDadosDiretorGeral_() {
  try {
    var shDG = SpreadsheetApp.openById(CFG_ADMIN.SS_ID).getSheetByName('Diretor Geral');
    if (!shDG) return null;
    var dados = shDG.getDataRange().getValues();
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][4]||'') === 'Ativo') {
        return { nome: String(dados[i][0]||''), siape: String(dados[i][1]||''), email: String(dados[i][3]||'') };
      }
    }
    return null;
  } catch(e) { return null; }
}

function enviarEmailAprovacao_(r, driveUrl) {
  var email = String(r[COL.EMAIL_ESTUDANTE] || '');
  var nome  = String(r[COL.NOME_ESTUDANTE]  || '');
  var id    = String(r[COL.ID_ESTAGIO]      || '');
  if (!email) return;
  MailApp.sendEmail({
    to:      email,
    subject: '[SGE IFRS] Solicitação aprovada — ' + id,
    body: [
      'Prezado(a) ' + nome + ',',
      '',
      'Sua solicitação de estágio (' + id + ') foi aprovada pelo setor de estágios.',
      '',
      'Os documentos (TCE e Solicitação de Ingresso) foram gerados e estão disponíveis na sua pasta no Drive:',
      driveUrl,
      '',
      'Próximos passos:',
      '1. Acesse a pasta acima e faça o download dos documentos.',
      '2. Obtenha as assinaturas necessárias (empresa, supervisor, você e orientador).',
      '3. Acesse o sistema e envie os documentos assinados pela página "Acompanhamento".',
      '',
      'Não inclua a assinatura do Diretor Geral — ela será obtida pelo setor após sua entrega.',
      '',
      'Setor de Estágios — IFRS Campus Rio Grande',
      'estagios@riogrande.ifrs.edu.br',
    ].join('\n'),
  });
}

function enviarEmailReprovacao_(email, nome, id, motivo) {
  if (!email) return;
  MailApp.sendEmail({
    to:      email,
    subject: '[SGE IFRS] Solicitação não aprovada — ' + id,
    body: 'Prezado(a) ' + nome + ',\n\n' +
          'Sua solicitação de estágio (' + id + ') não foi aprovada pelo setor.\n\n' +
          'Motivo: ' + motivo + '\n\n' +
          'Em caso de dúvidas, entre em contato: estagios@riogrande.ifrs.edu.br\n\n' +
          'Setor de Estágios — IFRS Campus Rio Grande',
  });
}

function formatarData_(val) {
  if (!val) return '';
  try {
    var d = val instanceof Date ? val : new Date(val);
    if (isNaN(d.getTime())) return String(val);
    return Utilities.formatDate(d, 'America/Sao_Paulo', 'dd/MM/yyyy');
  } catch(e) { return String(val); }
}

function obterOuCriarAba_(ss, nome, cabecalho) {
  var sheet = ss.getSheetByName(nome);
  if (!sheet) {
    sheet = ss.insertSheet(nome);
    if (cabecalho && cabecalho.length) {
      sheet.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);
      sheet.getRange(1, 1, 1, cabecalho.length).setFontWeight('bold');
    }
  }
  return sheet;
}
