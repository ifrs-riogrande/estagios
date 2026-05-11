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
  NOME_RESP:         40,   // Nome do responsável legal (menores de 18 anos)
  CPF_RESP:          41,   // CPF do responsável legal
  TEL_RESP:          42,   // Telefone do responsável legal
  NEE:               43,   // Portador de Necessidades Específicas — copiado do cadastro
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
      case 'listarSupervisoresAdmin':  return listarSupervisoresAdmin_();
      case 'listarCoordenadoresAdmin': return listarCoordenadoresAdmin_();
      case 'listarCadastrosPendentes': return listarCadastrosPendentes_();
      case 'listarAdendosAdmin':       return listarAdendosAdmin_();
      case 'listarAgentesAdmin':       return listarAgentesAdmin_();
      case 'listarTodosCursos':        return listarTodosCursos_();
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
      case 'recusarEmpresa':       return recusarEmpresa_(body);
      case 'editarEmpresaAdmin':   return editarEmpresaAdmin_(body);
      case 'excluirEmpresa':       return excluirEmpresa_(body);
      case 'inativarOrientador':   return alterarStatusOrientador_(body.email, 'Inativo');
      case 'reativarOrientador':   return alterarStatusOrientador_(body.email, 'Ativo');
      case 'validarSupervisor':     return alterarStatusSupervisor_(body.cpf, 'Validado');
      case 'inativarSupervisor':    return alterarStatusSupervisor_(body.cpf, 'Inativo');
      case 'reativarSupervisor':    return alterarStatusSupervisor_(body.cpf, 'Validado');
      case 'recusarSupervisor':     return recusarSupervisor_(body);
      case 'editarSupervisorAdmin': return editarSupervisorAdmin_(body);
      case 'excluirSupervisor':     return excluirSupervisor_(body);
      case 'aprovarAdendo':        return processarAdendo_(body, 'Aprovado');
      case 'reprovarAdendo':       return processarAdendo_(body, 'Reprovado');
      case 'inativarAgente':            return alterarStatusAgente_(body.cnpj, 'Inativo');
      case 'reativarAgente':            return alterarStatusAgente_(body.cnpj, 'Ativo');
      case 'aprovarCadastroServidor':   return aprovarCadastroServidor_(body);
      case 'inativarCoordenador':       return alterarStatusCoordenador_(body.email, 'Inativo');
      case 'reativarCoordenador':       return alterarStatusCoordenador_(body.email, 'Ativo');
      // Estudantes — validação de cadastro e reenvio de código
      case 'validarCadastroAdmin':   return validarCadastroAdmin_(body);
      case 'reenviarCodigoAdmin':    return reenviarCodigoAdmin_(body);
      // Configurações
      case 'salvarConfigCursos':     return salvarConfigCursos_(body);
      case 'salvarCurso':            return salvarCurso_(body);
      case 'deletarCurso':           return deletarCurso_(body);
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

  // Colunas da aba Empresas — alinhado com COL_EMP em api-empresas.gs
  // A=0:Timestamp, B=1:EmailForm, C=2:Tipo, D=3:RazaoSocial, E=4:NomeFantasia,
  // F=5:CNPJ, G=6:Ramo, H=7:Endereco, I=8:Bairro, J=9:Municipio,
  // K=10:UF, L=11:CEP, M=12:Tel, N=13:Email, O=14:Site,
  // P=15:NomeRep, Q=16:CargoRep, R=17:EmailRep, S=18:CpfRep, T=19:Status
  var lista = [];
  for (var i = 1; i < dados.length; i++) {
    var r = dados[i];
    if (!r[3] && !r[5]) continue; // linha vazia
    var cnpjNorm = String(r[5] || '').replace(/\D/g,'');
    lista.push({
      cnpj:               String(r[5]  || ''),
      razaoSocial:        String(r[3]  || ''),
      nomeFantasia:       String(r[4]  || ''),
      tipoEmpresa:        String(r[2]  || ''),
      ramo:               String(r[6]  || ''),
      endereco:           String(r[7]  || ''),
      bairro:             String(r[8]  || ''),
      municipio:          String(r[9]  || ''),
      uf:                 String(r[10] || ''),
      cep:                String(r[11] || ''),
      telefone:           String(r[12] || ''),
      email:              String(r[13] || ''),
      site:               String(r[14] || ''),
      nomeRepresentante:  String(r[15] || ''),
      cargoRepresentante: String(r[16] || ''),
      emailRep:           String(r[17] || ''),
      cpfRep:             String(r[18] || ''),
      status:             String(r[19] || 'Pendente'),
      estagiosAtivos:     ativosPorEmpresa[cnpjNorm] || 0,
      driveDocs:          String(r[21] || ''),
      obs:                String(r[22] || ''),
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
    if (!r[COL_ORI.EMAIL]) continue; // sem e-mail
    var emailOri = String(r[COL_ORI.EMAIL] || '').toLowerCase();
    lista.push({
      nome:        String(r[COL_ORI.NOME]         || ''),
      siape:       String(r[COL_ORI.SIAPE]        || ''),
      titulacao:   String(r[COL_ORI.TITULACAO]    || ''),
      email:       emailOri,
      tipoVinculo: String(r[COL_ORI.TIPO_VINCULO] || ''),
      fimContrato: formatarData_(r[COL_ORI.FIM_CONTRATO]),
      cursos:      String(r[COL_ORI.CURSOS] || '').split(',').map(function(c){ return c.trim(); }).filter(Boolean),
      status:      String(r[COL_ORI.STATUS] || 'Ativo'),
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
    if (String(dados[i][5] || '').replace(/\D/g,'') !== cnpjLimpo) continue;

    sheet.getRange(i + 1, 20).setValue(novoStatus); // STATUS = col T

    if (novoStatus === 'Validada') {
      // Reusa código existente ou gera novo (para empresas cadastradas antes desta atualização)
      var codigoExistente = String(dados[i][20] || '').trim(); // CODIGO_ACESSO = col U
      var codigo = codigoExistente || ('EMP-' + Math.random().toString(36).substr(2, 6).toUpperCase());
      if (!codigoExistente) {
        sheet.getRange(i + 1, 21).setValue(codigo);
      }

      var razaoSocial = String(dados[i][3]  || '').trim();
      var nomeRep     = String(dados[i][15] || '').trim();
      var emailRep    = String(dados[i][17] || '').trim();
      var emailEmp    = String(dados[i][13] || '').trim();

      var assunto = '[IFRS Estágios] Cadastro validado — ' + razaoSocial;
      var corpo = [
        'Olá' + (nomeRep ? ', ' + nomeRep : '') + ',',
        '',
        'O cadastro de "' + razaoSocial + '" foi validado pelo setor de estágios.',
        '',
        'Para acessar ou editar seus dados no portal, utilize:',
        '  Código de acesso: ' + codigo,
        '',
        'Guarde este código em local seguro.',
        '',
        'Acesse: https://ifrs-riogrande.github.io/estagios/empresas/perfil-empresa.html',
        '',
        'Dúvidas: estagios@riogrande.ifrs.edu.br',
        '',
        'Atenciosamente,',
        'Central de Estágios — IFRS Campus Rio Grande',
      ].join('\n');

      try { if (emailRep) MailApp.sendEmail({ to: emailRep, subject: assunto, body: corpo }); } catch(e2) {}
      try { if (emailEmp && emailEmp !== emailRep) MailApp.sendEmail({ to: emailEmp, subject: assunto, body: corpo }); } catch(e2) {}
      return jsonOk_({ status: novoStatus, codigo: codigo });
    }

    return jsonOk_({ status: novoStatus });
  }
  return jsonError_('Empresa não encontrada.', 'NOT_FOUND');
}

// ── Recusar empresa (com obs) ─────────────────────────────────────────────
function recusarEmpresa_(body) {
  var cnpjLimpo = String(body.cnpj || '').replace(/\D/g,'');
  var obs       = String(body.obs  || '').trim().substring(0, 500);
  if (!cnpjLimpo) return jsonError_('CNPJ obrigatório.', 'VALIDATION');

  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sheet = ss.getSheetByName(CFG_ADMIN.ABA_EMPRESAS);
  if (!sheet) return jsonError_('Aba de empresas não encontrada.', 'NOT_FOUND');
  var dados = sheet.getDataRange().getValues();

  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][5] || '').replace(/\D/g,'') !== cnpjLimpo) continue;

    sheet.getRange(i + 1, 20).setValue('Recusada'); // STATUS col T
    sheet.getRange(i + 1, 23).setValue(obs);         // OBSERVACOES col W

    var razaoSocial = String(dados[i][3]  || '').trim();
    var nomeRep     = String(dados[i][15] || '').trim();
    var emailRep    = String(dados[i][17] || '').trim();
    var emailEmp    = String(dados[i][13] || '').trim();

    var assunto = '[IFRS Estágios] Cadastro não aprovado — ' + razaoSocial;
    var corpo = [
      'Olá' + (nomeRep ? ', ' + nomeRep : '') + ',',
      '',
      'O cadastro de "' + razaoSocial + '" não foi aprovado pelo setor de estágios.',
      obs ? '\nMotivo: ' + obs : '',
      '',
      'Você pode corrigir os dados e resubmeter pelo portal:',
      'https://ifrs-riogrande.github.io/estagios/empresas/perfil-empresa.html',
      '',
      'Dúvidas: estagios@riogrande.ifrs.edu.br',
      '',
      'Atenciosamente,',
      'Central de Estágios — IFRS Campus Rio Grande',
    ].join('\n');

    try { if (emailRep) MailApp.sendEmail({ to: emailRep, subject: assunto, body: corpo }); } catch(e2) {}
    try { if (emailEmp && emailEmp !== emailRep) MailApp.sendEmail({ to: emailEmp, subject: assunto, body: corpo }); } catch(e2) {}

    return jsonOk_({ status: 'Recusada' });
  }
  return jsonError_('Empresa não encontrada.', 'NOT_FOUND');
}

// ── Editar empresa (admin) ────────────────────────────────────────────────
function editarEmpresaAdmin_(body) {
  var cnpjLimpo = String(body.cnpj || '').replace(/\D/g,'');
  if (!cnpjLimpo) return jsonError_('CNPJ obrigatório.', 'VALIDATION');

  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sheet = ss.getSheetByName(CFG_ADMIN.ABA_EMPRESAS);
  if (!sheet) return jsonError_('Aba de empresas não encontrada.', 'NOT_FOUND');
  var dados = sheet.getDataRange().getValues();

  var san = function(v) { return String(v || '').replace(/<[^>]*>/g,'').trim().substring(0,500); };

  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][5] || '').replace(/\D/g,'') !== cnpjLimpo) continue;

    var campos = [
      { col: 4,  val: san(body.razaoSocial)   }, // D — Razão Social
      { col: 5,  val: san(body.nomeFantasia)  }, // E — Nome Fantasia
      { col: 7,  val: san(body.ramo)          }, // G — Ramo
      { col: 8,  val: san(body.endereco)      }, // H — Endereço
      { col: 9,  val: san(body.bairro)        }, // I — Bairro
      { col: 10, val: san(body.municipio)     }, // J — Município
      { col: 11, val: san(body.uf)            }, // K — UF
      { col: 12, val: san(body.cep)           }, // L — CEP
      { col: 13, val: san(body.telefone)      }, // M — Telefone
      { col: 14, val: san(body.email).toLowerCase() }, // N — E-mail
      { col: 15, val: san(body.site)          }, // O — Site
      { col: 16, val: san(body.nomeRep)       }, // P — Nome Rep
      { col: 17, val: san(body.cargoRep)      }, // Q — Cargo Rep
      { col: 18, val: san(body.emailRep).toLowerCase() }, // R — E-mail Rep
    ];
    campos.forEach(function(c) {
      if (c.val !== undefined && c.val !== null) {
        sheet.getRange(i + 1, c.col + 1).setValue(c.val);
      }
    });
    return jsonOk_({ mensagem: 'Dados atualizados.' });
  }
  return jsonError_('Empresa não encontrada.', 'NOT_FOUND');
}

// ── Excluir empresa (soft delete) ─────────────────────────────────────────
function excluirEmpresa_(body) {
  var cnpjLimpo = String(body.cnpj || '').replace(/\D/g,'');
  if (!cnpjLimpo) return jsonError_('CNPJ obrigatório.', 'VALIDATION');

  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sheet = ss.getSheetByName(CFG_ADMIN.ABA_EMPRESAS);
  if (!sheet) return jsonError_('Aba de empresas não encontrada.', 'NOT_FOUND');
  var dados = sheet.getDataRange().getValues();

  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][5] || '').replace(/\D/g,'') !== cnpjLimpo) continue;
    sheet.getRange(i + 1, 20).setValue('Excluída'); // STATUS col T
    sheet.getRange(i + 1, 1, 1, sheet.getLastColumn()).setBackground('#f3f4f6'); // visual muted
    return jsonOk_({ status: 'Excluída' });
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
    if (String(dados[i][COL_ORI.EMAIL] || '').toLowerCase().trim() === emailLower) {
      sheet.getRange(i + 1, COL_ORI.STATUS + 1).setValue(novoStatus);
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
  vars['{{NEE}}']                   = String(r[COL.NEE]                || 'Não');
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

// ─────────────────────────────────────────────────────────────────
// GET — Listar coordenadores (admin)
// ─────────────────────────────────────────────────────────────────

function listarCoordenadoresAdmin_() {
  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sheet = ss.getSheetByName(CFG_ADMIN.ABA_COORDENADORES);
  if (!sheet) return jsonOk_([]);
  var dados = sheet.getDataRange().getValues();
  var lista = [];
  for (var i = 1; i < dados.length; i++) {
    var r = dados[i];
    if (!r[3]) continue; // sem e-mail
    lista.push({
      cpf:       String(r[0] || ''),
      siape:     String(r[1] || ''),
      nome:      String(r[2] || ''),
      email:     String(r[3] || ''),
      tel:       String(r[4] || ''),
      titulacao: String(r[5] || ''),
      curso:     String(r[6] || ''),
      timestamp: formatarData_(r[7]),
      status:    String(r[8] || 'Pendente'),
    });
  }
  lista.reverse(); // mais recentes primeiro
  return jsonOk_(lista);
}

// ─────────────────────────────────────────────────────────────────
// GET — Listar cadastros pendentes (orientadores + coordenadores)
// ─────────────────────────────────────────────────────────────────

function listarCadastrosPendentes_() {
  var ss = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var resultado = { orientadores: [], coordenadores: [] };

  // Orientadores pendentes
  var shOri = ss.getSheetByName(CFG_ADMIN.ABA_ORIENTADORES);
  if (shOri) {
    var dadosOri = shOri.getDataRange().getValues();
    for (var i = 1; i < dadosOri.length; i++) {
      if (String(dadosOri[i][COL_ORI.STATUS] || '').trim() === 'Pendente') {
        resultado.orientadores.push({
          nome:        String(dadosOri[i][COL_ORI.NOME]         || ''),
          email:       String(dadosOri[i][COL_ORI.EMAIL]        || ''),
          siape:       String(dadosOri[i][COL_ORI.SIAPE]        || ''),
          tipoVinculo: String(dadosOri[i][COL_ORI.TIPO_VINCULO] || ''),
          titulacao:   String(dadosOri[i][COL_ORI.TITULACAO]    || ''),
          area:        String(dadosOri[i][COL_ORI.AREA]         || ''),
          cursos:      String(dadosOri[i][COL_ORI.CURSOS]       || ''),
          tipo:        'orientador',
        });
      }
    }
  }

  // Coordenadores pendentes
  var shCoord = ss.getSheetByName(CFG_ADMIN.ABA_COORDENADORES);
  if (shCoord) {
    var dadosCoord = shCoord.getDataRange().getValues();
    for (var j = 1; j < dadosCoord.length; j++) {
      if (String(dadosCoord[j][8] || '').trim() !== 'Pendente') continue;
      var cursoCoord = String(dadosCoord[j][6] || '');
      // Verifica se há coordenador Ativo para o mesmo curso
      var coordAtualNome = null;
      var coordAtualEmail = null;
      for (var k = 1; k < dadosCoord.length; k++) {
        if (k !== j && String(dadosCoord[k][6] || '') === cursoCoord && String(dadosCoord[k][8] || '') === 'Ativo') {
          coordAtualNome  = String(dadosCoord[k][2] || '');
          coordAtualEmail = String(dadosCoord[k][3] || '');
          break;
        }
      }
      resultado.coordenadores.push({
        nome:           String(dadosCoord[j][2] || ''),
        email:          String(dadosCoord[j][3] || ''),
        siape:          String(dadosCoord[j][1] || ''),
        titulacao:      String(dadosCoord[j][5] || ''),
        curso:          cursoCoord,
        tipo:           'coordenador',
        coordAtualNome:  coordAtualNome,
        coordAtualEmail: coordAtualEmail,
      });
    }
  }

  return jsonOk_(resultado);
}

// ─────────────────────────────────────────────────────────────────
// POST — Aprovar / reprovar cadastro de servidor (orientador ou coordenador)
// ─────────────────────────────────────────────────────────────────

function aprovarCadastroServidor_(body) {
  var tipo       = String(body.tipo       || '');
  var email      = String(body.email      || '').toLowerCase().trim();
  var novoStatus = String(body.novoStatus || 'Ativo');
  var ss = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);

  if (tipo === 'orientador') {
    var sheet = ss.getSheetByName(CFG_ADMIN.ABA_ORIENTADORES);
    if (!sheet) return jsonError_('Aba de orientadores não encontrada.', 'NOT_FOUND');
    var dados = sheet.getDataRange().getValues();
    var found = false;
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][COL_ORI.EMAIL] || '').toLowerCase() === email &&
          String(dados[i][COL_ORI.STATUS] || '') === 'Pendente') {
        sheet.getRange(i + 1, COL_ORI.STATUS + 1).setValue(novoStatus);
        found = true;
        break;
      }
    }
    if (!found) return jsonError_('Orientador pendente não encontrado.', 'NOT_FOUND');
    return jsonOk_({ status: novoStatus });
  }

  if (tipo === 'coordenador') {
    var shCoord = ss.getSheetByName(CFG_ADMIN.ABA_COORDENADORES);
    if (!shCoord) return jsonError_('Aba de coordenadores não encontrada.', 'NOT_FOUND');
    var dadosCoord = shCoord.getDataRange().getValues();
    var pendIdx = -1;
    var cursoAlvo = '';
    for (var i = 1; i < dadosCoord.length; i++) {
      if (String(dadosCoord[i][3] || '').toLowerCase() === email &&
          String(dadosCoord[i][8] || '') === 'Pendente') {
        pendIdx   = i;
        cursoAlvo = String(dadosCoord[i][6] || '');
        break;
      }
    }
    if (pendIdx === -1) return jsonError_('Coordenador pendente não encontrado.', 'NOT_FOUND');
    shCoord.getRange(pendIdx + 1, 9).setValue(novoStatus);

    // Se aprovando (Ativo) e solicitado inativar o anterior do mesmo curso
    if (novoStatus === 'Ativo' && body.inativarAnterior && cursoAlvo) {
      for (var j = 1; j < dadosCoord.length; j++) {
        if (j !== pendIdx &&
            String(dadosCoord[j][6] || '') === cursoAlvo &&
            String(dadosCoord[j][3] || '').toLowerCase() !== email &&
            String(dadosCoord[j][8] || '') === 'Ativo') {
          shCoord.getRange(j + 1, 9).setValue('Inativo');
        }
      }
    }
    return jsonOk_({ status: novoStatus });
  }

  return jsonError_('Tipo inválido: ' + tipo, 'VALIDATION');
}

// ─────────────────────────────────────────────────────────────────
// POST — Inativar / reativar coordenador (por e-mail)
// ─────────────────────────────────────────────────────────────────

function alterarStatusCoordenador_(email, novoStatus) {
  var emailLower = String(email || '').toLowerCase().trim();
  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sheet = ss.getSheetByName(CFG_ADMIN.ABA_COORDENADORES);
  if (!sheet) return jsonError_('Aba de coordenadores não encontrada.', 'NOT_FOUND');
  var dados = sheet.getDataRange().getValues();
  var found = false;
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][3] || '').toLowerCase().trim() === emailLower) {
      sheet.getRange(i + 1, 9).setValue(novoStatus);
      found = true;
    }
  }
  if (!found) return jsonError_('Coordenador não encontrado.', 'NOT_FOUND');
  return jsonOk_({ status: novoStatus });
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

// ---------------------------------------------------------------------------
// CURSOS — lista mestre (PropertiesService key: 'cursos_lista')
// ---------------------------------------------------------------------------

var CURSOS_SEED_ = [
  { grupo: 'Técnico Integrado',    nome: 'Técnico Integrado em Automação Industrial' },
  { grupo: 'Técnico Integrado',    nome: 'Técnico Integrado em Eletrotécnica' },
  { grupo: 'Técnico Integrado',    nome: 'Técnico Integrado em Geoprocessamento' },
  { grupo: 'Técnico Integrado',    nome: 'Técnico Integrado em Informática para Internet' },
  { grupo: 'Técnico Integrado',    nome: 'Técnico Integrado em Mecânica' },
  { grupo: 'Técnico Integrado',    nome: 'Técnico Integrado em Refrigeração e Climatização' },
  { grupo: 'Técnico Subsequente',  nome: 'Técnico Subsequente em Automação Industrial' },
  { grupo: 'Técnico Subsequente',  nome: 'Técnico Subsequente em Eletrotécnica' },
  { grupo: 'Técnico Subsequente',  nome: 'Técnico Subsequente em Enfermagem' },
  { grupo: 'Técnico Subsequente',  nome: 'Técnico Subsequente em Fabricação Mecânica' },
  { grupo: 'Técnico Subsequente',  nome: 'Técnico Subsequente em Geoprocessamento' },
  { grupo: 'Técnico Subsequente',  nome: 'Técnico Subsequente em Refrigeração e Climatização' },
  { grupo: 'Tecnologia',           nome: 'Tecnologia em Análise e Desenvolvimento de Sistemas' },
  { grupo: 'Tecnologia',           nome: 'Tecnologia em Construção de Edifícios' },
  { grupo: 'Bacharelado',          nome: 'Bacharelado em Engenharia Mecânica' },
  { grupo: 'Bacharelado',          nome: 'Bacharelado em Arquitetura e Urbanismo' },
];

/**
 * Função pública para rodar manualmente no editor GAS.
 * Inicializa (ou reinspeciona) a lista mestre de cursos no PropertiesService.
 */
function inicializarCursos() {
  var cursos = obterListaCursos_();
  Logger.log('✅ Lista de cursos inicializada com ' + cursos.length + ' cursos:');
  cursos.forEach(function(c) {
    Logger.log('  [' + c.status + '] ' + c.grupo + ' — ' + c.nome);
  });
}

/**
 * Obtém (ou inicializa) a lista de cursos do PropertiesService.
 * @returns {Array} Array de {id, nome, grupo, status}
 */
/**
 * Ordena um array de cursos: por grupo (A-Z) e, dentro do grupo, por nome (A-Z).
 * Retorna o mesmo array (ordenado in-place) para encadeamento.
 */
function ordenarCursos_(cursos) {
  cursos.sort(function(a, b) {
    var gA = (a.grupo || '').toLowerCase();
    var gB = (b.grupo || '').toLowerCase();
    if (gA < gB) return -1;
    if (gA > gB) return  1;
    var nA = (a.nome || '').toLowerCase();
    var nB = (b.nome || '').toLowerCase();
    if (nA < nB) return -1;
    if (nA > nB) return  1;
    return 0;
  });
  return cursos;
}

function obterListaCursos_() {
  var raw = PropertiesService.getScriptProperties().getProperty('cursos_lista');
  if (raw) {
    try {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed.cursos)) return ordenarCursos_(parsed.cursos);
    } catch (e) { /* fall through to seed */ }
  }
  // Seed automático a partir da lista original
  var cursos = CURSOS_SEED_.map(function(c, i) {
    return {
      id:     'curso_' + String(i + 1).padStart(3, '0'),
      nome:   c.nome,
      grupo:  c.grupo,
      status: 'Ativo',
    };
  });
  ordenarCursos_(cursos);
  PropertiesService.getScriptProperties().setProperty('cursos_lista', JSON.stringify({ cursos: cursos }));
  return cursos;
}

/**
 * GET público — retorna apenas cursos Ativos [{id, nome, grupo}].
 * Usado por todos os selects do sistema.
 */
function listarCursos_() {
  try {
    var todos = obterListaCursos_();
    var ativos = todos.filter(function(c) { return c.status === 'Ativo'; })
                      .map(function(c)    { return { id: c.id, nome: c.nome, grupo: c.grupo }; });
    return jsonOk_(ativos);
  } catch (e) {
    return jsonError_('Erro ao listar cursos.', 'INTERNAL');
  }
}

/**
 * GET admin — retorna todos os cursos [{id, nome, grupo, status}].
 */
function listarTodosCursos_() {
  try {
    return jsonOk_(obterListaCursos_());
  } catch (e) {
    return jsonError_('Erro ao listar cursos.', 'INTERNAL');
  }
}

/**
 * POST admin — adiciona ou atualiza um curso.
 * body.id:     null/undefined → adicionar; existente → atualizar
 * body.nome:   string (obrigatório)
 * body.grupo:  string (obrigatório)
 * body.status: 'Ativo' | 'Inativo' (só para atualização)
 */
function salvarCurso_(body) {
  if (!checkRateLimit_('salvarCurso', 30)) {
    return jsonError_('Muitas requisições. Aguarde um momento.', 'RATE_LIMIT');
  }
  var nome  = (body.nome  || '').trim();
  var grupo = (body.grupo || '').trim();
  if (!nome || !grupo) return jsonError_('Nome e grupo são obrigatórios.', 'VALIDATION');

  var cursos = obterListaCursos_();

  if (!body.id) {
    // Verifica duplicata (mesmo nome, case-insensitive)
    var existe = cursos.some(function(c) { return c.nome.toLowerCase() === nome.toLowerCase(); });
    if (existe) return jsonError_('Já existe um curso com esse nome.', 'DUPLICATE');
    var novo = {
      id:     'curso_' + Utilities.getUuid().replace(/-/g, '').substring(0, 8),
      nome:   nome,
      grupo:  grupo,
      status: 'Ativo',
    };
    cursos.push(novo);
  } else {
    var idx = -1;
    for (var i = 0; i < cursos.length; i++) {
      if (cursos[i].id === body.id) { idx = i; break; }
    }
    if (idx === -1) return jsonError_('Curso não encontrado.', 'NOT_FOUND');
    cursos[idx].nome   = nome;
    cursos[idx].grupo  = grupo;
    cursos[idx].status = (body.status === 'Inativo') ? 'Inativo' : 'Ativo';
  }

  ordenarCursos_(cursos);
  PropertiesService.getScriptProperties().setProperty('cursos_lista', JSON.stringify({ cursos: cursos }));
  return jsonOk_({ mensagem: 'Curso salvo com sucesso!', cursos: cursos });
}

/**
 * POST admin — exclui permanentemente um curso pelo id.
 */
function deletarCurso_(body) {
  if (!checkRateLimit_('deletarCurso', 20)) {
    return jsonError_('Muitas requisições. Aguarde um momento.', 'RATE_LIMIT');
  }
  var id = (body.id || '').trim();
  if (!id) return jsonError_('ID do curso não informado.', 'VALIDATION');

  var cursos = obterListaCursos_();
  var idx = -1;
  for (var i = 0; i < cursos.length; i++) {
    if (cursos[i].id === id) { idx = i; break; }
  }
  if (idx === -1) return jsonError_('Curso não encontrado.', 'NOT_FOUND');

  cursos.splice(idx, 1);
  ordenarCursos_(cursos);
  PropertiesService.getScriptProperties().setProperty('cursos_lista', JSON.stringify({ cursos: cursos }));
  return jsonOk_({ mensagem: 'Curso excluído com sucesso!', cursos: cursos });
}

// ---------------------------------------------------------------------------
// GET — Configuração de cursos habilitados por modalidade (público, sem auth)
// ---------------------------------------------------------------------------

/**
 * Retorna { obrigatorio: [...] | null, naoObrigatorio: [...] | null }
 * null = sem restrição configurada (todos os cursos habilitados).
 */
function obterConfigCursos_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty('config_cursos');
    if (!raw) return jsonOk_({ obrigatorio: null, naoObrigatorio: null });
    return jsonOk_(JSON.parse(raw));
  } catch (e) {
    return jsonOk_({ obrigatorio: null, naoObrigatorio: null }); // fail-open
  }
}

// ---------------------------------------------------------------------------
// POST — Salvar configuração de cursos habilitados (admin)
// ---------------------------------------------------------------------------

function salvarConfigCursos_(body) {
  if (!checkRateLimit_('salvarConfigCursos', 10)) {
    return jsonError_('Muitas requisições. Aguarde um momento.', 'RATE_LIMIT');
  }
  var config = {
    obrigatorio:    Array.isArray(body.obrigatorio)    ? body.obrigatorio    : [],
    naoObrigatorio: Array.isArray(body.naoObrigatorio) ? body.naoObrigatorio : [],
  };
  PropertiesService.getScriptProperties().setProperty('config_cursos', JSON.stringify(config));
  return jsonOk_({ mensagem: 'Configuração salva com sucesso!' });
}

// ─────────────────────────────────────────────────────────────────
// GET — Listar supervisores (admin)
// COL_SUP: TIMESTAMP=0, EMAIL_FORM=1, TIPO=2, EMPRESA=3,
//          SETOR=4, ENDERECO_SETOR=5, EMAIL_SETOR_SUP=6, TEL_SETOR=7,
//          NOME=8, CPF=9, CARGO=10, TEL_SUP=11,
//          EMAIL_SUP=12, NIVEL_FORMACAO=13, AREA_FORMACAO=14,
//          INSTITUICAO=15, TEMPO_EXP=16, DESC_EXP=17, DECLARACAO=18,
//          STATUS=19, VALIDADO_POR=20, DATA_VALIDACAO=21,
//          OBSERVACOES=22, DATA_ULT_ATZ=23
// ─────────────────────────────────────────────────────────────────

function listarSupervisoresAdmin_() {
  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sheet = ss.getSheetByName('Supervisores');
  if (!sheet) return jsonOk_([]);
  var dados = sheet.getDataRange().getValues();

  // Conta estágios ativos por supervisor (CPF)
  var sheetSol = ss.getSheetByName(CFG_ADMIN.ABA_SOL);
  var ativosPorCpf = {};
  if (sheetSol) {
    var dadosSol = sheetSol.getDataRange().getValues();
    for (var j = 1; j < dadosSol.length; j++) {
      if (String(dadosSol[j][COL.STATUS] || '') === 'Em execução') {
        // COL.CNPJ_EMPRESA=11; supervisor não tem coluna própria nas solicitações —
        // usamos o e-mail do supervisor (COL.EMAIL_SUPERVISOR=13) como chave
        var emailSup = String(dadosSol[j][13] || '').toLowerCase().trim();
        if (emailSup) ativosPorCpf[emailSup] = (ativosPorCpf[emailSup] || 0) + 1;
      }
    }
  }

  var lista = [];
  for (var i = 1; i < dados.length; i++) {
    var r = dados[i];
    if (!r[8] && !r[9]) continue; // linha vazia (sem nome nem CPF)
    var empStr  = String(r[3] || '');
    var partes  = empStr.split('—');
    var emailSup = String(r[12] || '').toLowerCase().trim();
    lista.push({
      nome:             String(r[8]  || '').trim(),
      cpf:              String(r[9]  || '').trim(),
      cargo:            String(r[10] || '').trim(),
      telefone:         String(r[11] || '').trim(),
      email:            emailSup,
      empresa:          partes[1] ? partes[1].trim() : empStr.trim(),
      empresaCnpj:      partes[0] ? partes[0].trim() : '',
      setor:            String(r[4]  || '').trim(),
      enderecoSetor:    String(r[5]  || '').trim(),
      emailSetor:       String(r[6]  || '').trim(),
      telSetor:         String(r[7]  || '').trim(),
      nivelFormacao:    String(r[13] || '').trim(),
      areaFormacao:     String(r[14] || '').trim(),
      instituicao:      String(r[15] || '').trim(),
      tempoExperiencia: String(r[16] || '').trim(),
      status:           String(r[19] || 'Pendente').trim(),
      validadoPor:      String(r[20] || '').trim(),
      dataValidacao:    String(r[21] || '').trim(),
      observacoes:      String(r[22] || '').trim(),
      estagiosAtivos:   ativosPorCpf[emailSup] || 0,
      linhaPlanilha:    i + 1,
    });
  }
  lista.sort(function(a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
  return jsonOk_(lista);
}

// ─────────────────────────────────────────────────────────────────
// POST — Validar / inativar / reativar supervisor (por CPF)
// ─────────────────────────────────────────────────────────────────

function alterarStatusSupervisor_(cpf, novoStatus) {
  var cpfNorm = String(cpf || '').replace(/\D/g, '').trim();
  if (!cpfNorm) return jsonError_('CPF não informado.', 'VALIDATION');

  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sheet = ss.getSheetByName('Supervisores');
  if (!sheet) return jsonError_('Aba de supervisores não encontrada.', 'NOT_FOUND');

  var dados = sheet.getDataRange().getValues();
  var found = false;
  for (var i = 1; i < dados.length; i++) {
    var cpfLinha = String(dados[i][9] || '').replace(/\D/g, '').trim(); // COL_SUP.CPF=9
    if (cpfLinha !== cpfNorm) continue;
    // Atualiza status (col 20 = índice 19 + 1)
    sheet.getRange(i + 1, 20).setValue(novoStatus);
    if (novoStatus === 'Validado') {
      var admin = Session.getActiveUser().getEmail() || 'admin';
      sheet.getRange(i + 1, 21).setValue(admin);                         // VALIDADO_POR
      sheet.getRange(i + 1, 22).setValue(Utilities.formatDate(
        new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy'));          // DATA_VALIDACAO

      // Gera código de acesso — mantém o existente se já houver (ex.: revalidação)
      var codigoExist = String(sheet.getRange(i + 1, 25).getValue() || '').trim();
      var codigoAcesso = codigoExist;
      if (!codigoAcesso) {
        codigoAcesso = 'S' + Math.random().toString(36).substr(2, 6).toUpperCase();
        sheet.getRange(i + 1, 25).setValue(codigoAcesso);                // CODIGO_ACESSO
      }

      // Notifica o supervisor por e-mail com o código de acesso
      var nome     = String(dados[i][8]  || '').trim();
      var emailSup = String(dados[i][12] || '').trim();
      if (emailSup) {
        try {
          GmailApp.sendEmail(emailSup,
            '[IFRS Estágios] Cadastro de supervisor validado — seu código de acesso',
            'Olá, ' + (nome || 'Supervisor') + ',\n\n' +
            'Seu cadastro como supervisor de estágio foi validado pelo setor de estágios do IFRS Campus Rio Grande.\n\n' +
            '━━━━━━━━━━━━━━━━━━━━\n' +
            'SEU CÓDIGO DE ACESSO: ' + codigoAcesso + '\n' +
            '━━━━━━━━━━━━━━━━━━━━\n\n' +
            'Guarde este código com segurança. Você precisará dele para acessar e editar\n' +
            'seu perfil no portal de estágios.\n\n' +
            'Acesse seu perfil em:\n' +
            'https://ifrs-riogrande.github.io/estagios/empresas/perfil-supervisor.html\n\n' +
            'A partir de agora você pode ser selecionado em solicitações de estágio.\n\n' +
            'Dúvidas: estagios@riogrande.ifrs.edu.br\n\nAtenciosamente,\nSetor de Estágios — IFRS Campus Rio Grande',
            { name: 'Setor de Estágios IFRS', replyTo: 'estagios@riogrande.ifrs.edu.br' }
          );
        } catch(mailErr) { logErro_('alterarStatusSupervisor_.email', mailErr); }
      }
    }
    found = true;
    break;
  }
  if (!found) return jsonError_('Supervisor não encontrado.', 'NOT_FOUND');
  return jsonOk_({ status: novoStatus });
}

// ─────────────────────────────────────────────────────────────────
// POST — Recusar supervisor (registra obs + notifica por e-mail)
// ─────────────────────────────────────────────────────────────────
function recusarSupervisor_(body) {
  var cpfNorm = String(body.cpf || '').replace(/\D/g, '').trim();
  var obs     = String(body.obs || '').trim();
  if (!cpfNorm) return jsonError_('CPF não informado.', 'VALIDATION');
  if (!obs)     return jsonError_('Observações são obrigatórias ao recusar.', 'VALIDATION');

  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sheet = ss.getSheetByName('Supervisores');
  if (!sheet) return jsonError_('Aba de supervisores não encontrada.', 'NOT_FOUND');

  var dados = sheet.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    var cpfLinha = String(dados[i][9] || '').replace(/\D/g, '').trim(); // CPF=9
    if (cpfLinha !== cpfNorm) continue;

    sheet.getRange(i + 1, 20).setValue('Recusado');  // STATUS=19 → col 20
    sheet.getRange(i + 1, 23).setValue(obs);         // OBSERVACOES=22 → col 23
    sheet.getRange(i + 1, 1, 1, sheet.getLastColumn()).setBackground('#fce4ec');

    var nome     = String(dados[i][8]  || '').trim();
    var emailSup = String(dados[i][12] || '').trim();
    if (emailSup) {
      try {
        GmailApp.sendEmail(emailSup,
          '[IFRS Estágios] Cadastro de supervisor não aprovado',
          'Olá, ' + (nome || 'Supervisor') + ',\n\n' +
          'Seu cadastro como supervisor de estágio não foi aprovado pelo setor de estágios.\n\n' +
          'Motivo / Observações:\n' + obs + '\n\n' +
          'Você pode corrigir os dados e reenviar pelo portal:\n' +
          'https://ifrs-riogrande.github.io/estagios/empresas/perfil-supervisor.html\n\n' +
          'Dúvidas: estagios@riogrande.ifrs.edu.br\n\nAtenciosamente,\nSetor de Estágios — IFRS Campus Rio Grande',
          { name: 'Setor de Estágios IFRS', replyTo: 'estagios@riogrande.ifrs.edu.br' }
        );
      } catch(mailErr) { logErro_('recusarSupervisor_.email', mailErr); }
    }
    return jsonOk_({ status: 'Recusado' });
  }
  return jsonError_('Supervisor não encontrado.', 'NOT_FOUND');
}

// ─────────────────────────────────────────────────────────────────
// POST — Editar dados do supervisor pelo admin
// ─────────────────────────────────────────────────────────────────
function editarSupervisorAdmin_(body) {
  var cpfNorm = String(body.cpf || '').replace(/\D/g, '').trim();
  if (!cpfNorm) return jsonError_('CPF não informado.', 'VALIDATION');

  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sheet = ss.getSheetByName('Supervisores');
  if (!sheet) return jsonError_('Aba de supervisores não encontrada.', 'NOT_FOUND');

  var dados = sheet.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    var cpfLinha = String(dados[i][9] || '').replace(/\D/g, '').trim();
    if (cpfLinha !== cpfNorm) continue;

    var san = function(v) { return String(v === undefined ? '' : v).trim(); };
    // base-0 map: SETOR=4, ENDERECO_SETOR=5, EMAIL_SETOR_SUP=6, TEL_SETOR=7,
    //             NOME=8, CARGO=10, TEL_SUP=11, EMAIL_SUP=12,
    //             NIVEL_FORMACAO=13, AREA_FORMACAO=14, INSTITUICAO=15, TEMPO_EXP=16, DESC_EXP=17
    var campos = [
      [5,  san(body.setor)],
      [6,  san(body.enderecoSetor)],
      [7,  san(body.emailSetor)],
      [8,  san(body.telSetor)],
      [9,  san(body.nome)],
      [11, san(body.cargo)],
      [12, san(body.telSupervisor)],
      [13, san(body.emailSupervisor)],
      [14, san(body.nivelFormacao)],
      [15, san(body.areaFormacao)],
      [16, san(body.instituicao)],
      [17, san(body.tempoExperiencia)],
      [18, san(body.descExperiencia)],
    ];
    campos.forEach(function(c) {
      if (c[1] !== '') sheet.getRange(i + 1, c[0]).setValue(c[1]);
    });
    return jsonOk_({ ok: true });
  }
  return jsonError_('Supervisor não encontrado.', 'NOT_FOUND');
}

// ─────────────────────────────────────────────────────────────────
// POST — Soft-delete supervisor (status = 'Excluído')
// ─────────────────────────────────────────────────────────────────
function excluirSupervisor_(body) {
  var cpfNorm = String(body.cpf || '').replace(/\D/g, '').trim();
  if (!cpfNorm) return jsonError_('CPF não informado.', 'VALIDATION');

  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sheet = ss.getSheetByName('Supervisores');
  if (!sheet) return jsonError_('Aba de supervisores não encontrada.', 'NOT_FOUND');

  var dados = sheet.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    var cpfLinha = String(dados[i][9] || '').replace(/\D/g, '').trim();
    if (cpfLinha !== cpfNorm) continue;
    sheet.getRange(i + 1, 20).setValue('Excluído');
    sheet.getRange(i + 1, 1, 1, sheet.getLastColumn())
      .setBackground('#e0e0e0').setFontColor('#9e9e9e');
    return jsonOk_({ status: 'Excluído' });
  }
  return jsonError_('Supervisor não encontrado.', 'NOT_FOUND');
}
