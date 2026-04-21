/**
 * Code.gs — Roteador principal do Web App SGE
 * SGE — Sistema de Gestão de Estágios · IFRS Campus Rio Grande
 *
 * Um único deployment URL atende todas as chamadas.
 * O parâmetro ?action= (GET) ou body.action (POST) determina o módulo.
 *
 * Módulos:
 *   api-empresas.gs         → empresas, supervisores, oportunidades
 *   api-estudantes.gs       → cadastro e consulta de estudantes
 *   api-servidores.gs       → orientadores e coordenadores
 *   api-solicitacao.gs      → solicitações de estágio e documentos do estudante
 *   api-admin.gs            → operações administrativas (restrito)
 *   api-dashboard.gs        → dashboard do setor (restrito)
 *   api-agentes.gs          → agentes de integração
 *   api-oportunidades.gs    → portal de oportunidades
 *
 * Para adicionar um módulo:
 *   1. Crie o arquivo api-xxx.gs com doGetXxx(e) e doPostXxx(e).
 *   2. Mapeie as actions no switch abaixo.
 */

'use strict';

// ── Mapeamento action → módulo (GET) ─────────────────────────────
var GET_ROUTES = {
  // Empresas
  'listarEmpresas':          doGetEmpresas,
  'listarSupervisores':      doGetEmpresas,
  'listarOportunidades':     doGetOportunidades,

  // Estudantes
  'listarMeusEstagios':      doGetEstudantes,
  'verificarEstudante':      doGetEstudantes,
  'obterMeuCadastro':        doGetEstudantes,

  // Servidores / Orientadores
  'listarOrientadores':      doGetServidores,
  'listarCoordenadores':     doGetServidores,

  // Agentes
  'listarAgentes':           doGetAgentes,

  // Solicitações (estudante)
  'verificarIdEstagio':      doGetSolicitacao,

  // Admin
  'listarSolicitacoesAdmin': doGetAdmin,
  'listarDocumentosAdmin':   doGetAdmin,
  'listarAlunosAdmin':       doGetAdmin,
  'listarEmpresasAdmin':     doGetAdmin,
  'listarOrientadoresAdmin': doGetAdmin,
  'listarAdendosAdmin':      doGetAdmin,
  'listarAgentesAdmin':      doGetAdmin,

  // Dashboard
  'dashboard':               doGetDash,
};

// ── Mapeamento action → módulo (POST) ────────────────────────────
var POST_ROUTES = {
  // Empresas
  'cadastrarEmpresa':          doPostEmpresas,
  'cadastrarSupervisor':       doPostEmpresas,

  // Estudantes
  'cadastrarEstudante':        doPostEstudantes,

  // Estudantes — Admin
  'validarCadastroAdmin':      doPostAdmin,
  'reenviarCodigoAdmin':       doPostAdmin,

  // Servidores
  'cadastrarOrientador':       doPostServidores,
  'cadastrarCoordenador':      doPostAdmin,

  // Solicitações (estudante + DG)
  'solicitarEstagio':          doPostSolicitacao,
  'enviarRelatorioParcial':    doPostSolicitacao,
  'enviarRelatorioFinal':      doPostSolicitacao,
  'enviarAdendo':              doPostSolicitacao,
  'enviarDocumentosAssinados': doPostSolicitacao,
  'enviarDocumentoDG':         doPostSolicitacao,

  // Agentes (público)
  'cadastrarAgente':           doPostAgentes,

  // Oportunidades
  'cadastrarOportunidade':     doPostOportunidades,

  // Admin
  'aprovarSolicitacao':        doPostAdmin,
  'reprovarSolicitacao':       doPostAdmin,
  'marcarEmAnalise':           doPostAdmin,
  'validarDocumentos':         doPostAdmin,
  'reprovarDocumentos':        doPostAdmin,
  'reprovarDocumentosDG':      doPostAdmin,
  'validarDocumentosDG':       doPostAdmin,
  'validarEmpresa':            doPostAdmin,
  'inativarEmpresa':           doPostAdmin,
  'inativarOrientador':        doPostAdmin,
  'reativarOrientador':        doPostAdmin,
  'aprovarAdendo':             doPostAdmin,
  'reprovarAdendo':            doPostAdmin,
  'inativarAgente':            doPostAdmin,
  'reativarAgente':            doPostAdmin,
};

// ── Ponto de entrada GET ──────────────────────────────────────────
function doGet(e) {
  try {
    var action = (e.parameter && e.parameter.action) || '';
    var handler = GET_ROUTES[action];
    if (!handler) return jsonError_('Ação GET desconhecida: ' + action, 'UNKNOWN_ACTION');
    return handler(e);
  } catch (err) {
    logErro_('Code.doGet', err);
    return jsonError_('Erro interno no roteador.', 'INTERNAL');
  }
}

// ── Ponto de entrada POST ─────────────────────────────────────────
function doPost(e) {
  try {
    var body   = JSON.parse(e.postData.contents);
    var action = body.action || '';
    var handler = POST_ROUTES[action];
    if (!handler) return jsonError_('Ação POST desconhecida: ' + action, 'UNKNOWN_ACTION');
    // Recria o "event" com o body já parseado para compatibilidade com os módulos
    e._body = body;
    return handler(e);
  } catch (err) {
    logErro_('Code.doPost', err);
    return jsonError_('Erro interno no roteador.', 'INTERNAL');
  }
}

// ── Stubs dos módulos (cada módulo define suas funções) ───────────
// Os módulos api-*.gs expõem as funções abaixo:
//   doGetEmpresas(e), doPostEmpresas(e)
//   doGetEstudantes(e), doPostEstudantes(e)
//   doGetServidores(e), doPostServidores(e)
//   doGetSolicitacao(e), doPostSolicitacao(e)
//   doGetAdmin(e), doPostAdmin(e)
//   doGetDash(e)
//   doGetAgentes(e), doPostAgentes(e)
//   doGetOportunidades(e), doPostOportunidades(e)
//
// Se um módulo ainda não implementar sua função, use o stub abaixo
// para evitar erros em runtime:

function doGetEstudantes(e) {
  var action = e.parameter && e.parameter.action;
  if (action === 'listarMeusEstagios') return listarMeusEstagios_(e);
  if (action === 'verificarEstudante') return verificarEstudante_(e);
  if (action === 'obterMeuCadastro')   return obterMeuCadastro_(e);
  return jsonError_('Ação não implementada: ' + action, 'NOT_IMPLEMENTED');
}

function doPostEstudantes(e) {
  return cadastrarEstudante_(JSON.parse(e.postData ? e.postData.contents : '{}'));
}

function doGetServidores(e) {
  var action = e.parameter && e.parameter.action;
  if (action === 'listarOrientadores')  return listarOrientadores_(e);
  if (action === 'listarCoordenadores') return listarCoordenadores_(e);
  return jsonError_('Ação não implementada: ' + action, 'NOT_IMPLEMENTED');
}

function doPostServidores(e) {
  var body = JSON.parse(e.postData ? e.postData.contents : '{}');
  return cadastrarOrientador_(body);
}

function doGetSolicitacao(e) {
  return verificarIdEstagio_(e);
}

function doPostSolicitacao(e) {
  var body = e._body || JSON.parse(e.postData ? e.postData.contents : '{}');
  var action = body.action || '';
  switch (action) {
    case 'solicitarEstagio':          return solicitarEstagio_(body);
    case 'enviarRelatorioParcial':    return enviarRelatorioParcial_(body);
    case 'enviarRelatorioFinal':      return enviarRelatorioFinal_(body);
    case 'enviarAdendo':              return enviarAdendo_(body);
    case 'enviarDocumentosAssinados': return enviarDocumentosAssinados_(body);
    case 'enviarDocumentoDG':         return enviarDocumentoDG_(body);
    default: return jsonError_('Ação não implementada: ' + action, 'NOT_IMPLEMENTED');
  }
}

function doGetDash(e) {
  return gerarDashboard_();
}

function doGetAgentes(e) {
  return listarAgentes_(e);
}

function doPostAgentes(e) {
  var body = JSON.parse(e.postData ? e.postData.contents : '{}');
  return cadastrarAgente_(body);
}

function doGetOportunidades(e) {
  return listarOportunidades_(e);
}

function doPostOportunidades(e) {
  var body = JSON.parse(e.postData ? e.postData.contents : '{}');
  return cadastrarOportunidade_(body);
}

function doGetEmpresas(e) {
  var action = e.parameter && e.parameter.action;
  if (action === 'listarEmpresas')     return listarEmpresasPublicas_(e);
  if (action === 'listarSupervisores') return listarSupervisores_(e);
  return jsonError_('Ação não implementada: ' + action, 'NOT_IMPLEMENTED');
}

function doPostEmpresas(e) {
  var body = JSON.parse(e.postData ? e.postData.contents : '{}');
  var action = body.action || '';
  if (action === 'cadastrarEmpresa')    return cadastrarEmpresa_(body);
  if (action === 'cadastrarSupervisor') return cadastrarSupervisor_(body);
  return jsonError_('Ação não implementada: ' + action, 'NOT_IMPLEMENTED');
}
