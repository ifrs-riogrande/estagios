/**
 * Code.gs â€” Roteador principal do Web App SGE
 * SGE â€” Sistema de GestÃ£o de EstÃ¡gios Â· IFRS Campus Rio Grande
 *
 * Um Ãºnico deployment URL atende todas as chamadas.
 * O parÃ¢metro ?action= (GET) ou body.action (POST) determina o mÃ³dulo.
 *
 * MÃ³dulos:
 *   api-empresas.gs         â†’ empresas, supervisores, oportunidades
 *   api-estudantes.gs       â†’ cadastro e consulta de estudantes
 *   api-servidores.gs       â†’ orientadores e coordenadores
 *   api-solicitacao.gs      â†’ solicitaÃ§Ãµes de estÃ¡gio e documentos do estudante
 *   api-admin.gs            â†’ operaÃ§Ãµes administrativas (restrito)
 *   api-dashboard.gs        â†’ dashboard do setor (restrito)
 *   api-agentes.gs          â†’ agentes de integraÃ§Ã£o
 *   api-oportunidades.gs    â†’ portal de oportunidades
 *
 * Para adicionar um mÃ³dulo:
 *   1. Crie o arquivo api-xxx.gs com doGetXxx(e) e doPostXxx(e).
 *   2. Mapeie as actions no switch abaixo.
 */

'use strict';

// â”€â”€ Mapeamento action â†’ mÃ³dulo (GET) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
var GET_ROUTES = {
  // Empresas
  'listarEmpresas':               doGetEmpresas,
  'listarSupervisores':           doGetEmpresas,
  'obterCadastroEmpresa':         doGetEmpresas,
  'obterCadastroSupervisor':      doGetEmpresas,
  'verificarStatusConcedente':    doGetEmpresas,
  'listarEmpresasPrecheck':       doGetEmpresas,
  'listarSupervisoresPrecheck':   doGetEmpresas,
  'listarOportunidades':          doGetOportunidades,

  // Estudantes
  'listarMeusEstagios':      doGetEstudantes,
  'verificarEstudante':      doGetEstudantes,
  'obterMeuCadastro':        doGetEstudantes,
  'verificarCpf':            doGetEstudantes,

  // Servidores / Orientadores / Coordenadores
  'listarOrientadores':              doGetServidores,
  'listarCoordenadores':             doGetServidores,
  'obterMeuCadastroOrientador':      doGetServidores,
  'obterMeuCadastroCoordenador':     doGetServidores,
  'listarMeusOrientandos':           doGetServidores,
  'listarMeusSupervisionados':       doGetServidores,
  'listarEstagiosCoordenador':       doGetServidores,
  'verificarCadastroOrientador':     doGetServidores,

  // Agentes
  'listarAgentes':           doGetAgentes,

  // Solicitações (estudante + admin)
  'verificarIdEstagio':         doGetSolicitacao,
  'verificarAceiteOrientador':  doGetSolicitacao,
  'listarHistoricoEstagio':     doGetSolicitacao,
  'listarDocumentosAvulsos':    doGetSolicitacao,

  // Admin
  'listarSolicitacoesAdmin':  doGetAdmin,
  'listarDocumentosAdmin':    doGetAdmin,
  'listarAlunosAdmin':        doGetAdmin,
  'listarEmpresasAdmin':      doGetAdmin,
  'listarOrientadoresAdmin':  doGetAdmin,
  'listarSupervisoresAdmin':  doGetAdmin,
  'listarCoordenadoresAdmin': doGetAdmin,
  'listarCadastrosPendentes': doGetAdmin,
  'listarAlertasAdmin':       doGetAdmin,
  'listarAdendosAdmin':       doGetAdmin,
  'listarAgentesAdmin':       doGetAdmin,
  'listarOportunidadesAdmin': doGetAdmin,

  // Dashboard
  'dashboard':               doGetDash,

  // ConfiguraÃ§Ãµes (pÃºblico â€" sem auth)
  'obterConfigCursos':       doGetPublicConfig,
  'listarCursos':            doGetPublicConfig,
  'contarEstagiosAtivos':    doGetPublicConfig,
  'validarTokenOportunidade':doGetPublicConfig,

  // Cursos + TCE config — admin
  'listarTodosCursos':            doGetAdmin,
  'obterDiretorGeral':            doGetAdmin,
  'obterDiretoriaDEN':            doGetAdmin,
  'obterDiretoriaDEX':            doGetAdmin,
  'obterDiretoriaNAPNE':          doGetAdmin,
  'obterDiretoriaRegistro':       doGetAdmin,
  'obterConfigTCE':               doGetAdmin,
  'obterConfigNotificacoes':      doGetAdmin,
  'obterTemplates':               doGetAdmin,

  // NAPNE
  'verificarAcessoNapne':      doGetNapne,
  'listarEstagiosNapne':       doGetNapne,
  'obterFichaNapne':           doGetNapne,

  // Registro Acadêmico
  'verificarAcessoRegistro':   doGetRegistro,
  'listarEstagiosRegistro':    doGetRegistro,
  'obterFichaNapneAdmin':      doGetAdmin,
  'obterFichaNapneOrientador': doGetServidores,

  // Checklist
  'obterChecklist':          doGetChecklist,
  'obterPrazos':             doGetChecklist,
  'validarChecklist':        doGetChecklist,  // público — sem auth

  // Assinaturas TCE
  'obterFluxoAssinaturas':        doGetAssinaturas,
  'obterFluxoAssinaturasAdmin':   doGetAssinaturas,
  'listarFluxosPendentesEtapa':   doGetAssinaturas,
  'baixarPdfAssinatura':          doGetAssinaturas,

  // Assinaturas Adendo
  'obterFluxoAdendo':             doGetAdendo,
  'obterFluxoAdendoAdmin':        doGetAdendo,
  'baixarPdfAdendo':              doGetAdendo,

  // Avaliações
  'obterFluxoAvaliacao':          doGetAvaliacoes,
  'baixarPdfAvaliacao':           doGetAvaliacoes,
  'listarAvaliacoesEstagio':      doGetAvaliacoes,

  // Parecer Final
  'obterParecerFinal':            doGetParecer,
  'listarPareceresPendentes':     doGetParecer,

  // Notificações in-app
  'listarNotificacoes':           doGetNotificacoes,

  // Convênios
  'listarEmpresasComConvenio':    doGetConvenios,
  'listarConvenios':              doGetConvenios,
  'obterFluxoConvenio':           doGetConvenios,
  'baixarPdfConvenio':            doGetConvenios,

  // Declarações
  'listarDeclaracoesServidor':    doGetDeclaracoes,
  'listarDeclaracoesAdmin':       doGetDeclaracoes,
  'validarDeclaracao':            doGetDeclaracoes,  // público — sem auth

};

// â”€â”€ Mapeamento action â†’ mÃ³dulo (POST) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
var POST_ROUTES = {
  // Empresas
  'cadastrarEmpresa':            doPostEmpresas,
  'cadastrarSupervisor':         doPostEmpresas,
  'salvarMeuCadastroEmpresa':    doPostEmpresas,
  'salvarMeuCadastroSupervisor': doPostEmpresas,
  'enviarDocumentosEmpresa':     doPostEmpresas,

  // Estudantes
  'cadastrarEstudante':        doPostEstudantes,
  'atualizarMeuCadastro':      doPostEstudantes,

  // Estudantes â€” Admin
  'validarCadastroAdmin':      doPostAdmin,

  // Servidores
  'cadastrarOrientador':               doPostServidores,
  'atualizarMeuCadastroOrientador':    doPostServidores,
  'cadastrarCoordenador':              doPostServidores,
  'atualizarMeuCadastroCoordenador':   doPostServidores,
  'registrarOrientadorConvidado':      doPostServidores,

  // SolicitaÃ§Ãµes (estudante + DG)
  'solicitarEstagio':          doPostSolicitacao,
  'enviarRelatorioParcial':    doPostSolicitacao,
  'enviarRelatorioFinal':      doPostSolicitacao,
  'enviarAdendo':              doPostSolicitacao,
  'enviarDocumentosAssinados': doPostSolicitacao,
  'enviarDocumentoDG':         doPostSolicitacao,
  'responderAceiteOrientador': doPostSolicitacao,
  'trocarOrientador':          doPostSolicitacao,
  'uploadDocumentoEstagio':      doPostSolicitacao,
  'marcarDocumentoRevisado':     doPostSolicitacao,
  'enviarDocumentoPorEmail':     doPostSolicitacao,

  // Agentes (pÃºblico)
  'cadastrarAgente':           doPostAgentes,

  // Oportunidades
  'cadastrarOportunidade':     doPostOportunidades,

  // ConfiguraÃ§Ãµes (admin)
  'salvarConfigCursos':        doPostAdmin,
  'salvarConfigTCE':           doPostAdmin,
  'salvarConfigNotificacoes':  doPostAdmin,
  'salvarTemplate':            doPostAdmin,
  'restaurarTemplateDefault':  doPostAdmin,
  'testarTemplate':            doPostAdmin,
  'salvarDiretorGeral':        doPostAdmin,
  'salvarDiretoriaDEN':        doPostAdmin,
  'salvarDiretoriaDEX':        doPostAdmin,
  'salvarDiretoriaNAPNE':      doPostAdmin,
  'salvarDiretoriaRegistro':   doPostAdmin,
  'salvarCurso':               doPostAdmin,
  'deletarCurso':              doPostAdmin,

  // NAPNE
  'salvarFichaNapne':          doPostNapne,

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
  'recusarEmpresa':            doPostAdmin,
  'editarEmpresaAdmin':        doPostAdmin,
  'excluirEmpresa':            doPostAdmin,
  'cadastrarEmpresaAdmin':     doPostAdmin,
  'inativarOrientador':        doPostAdmin,
  'reativarOrientador':        doPostAdmin,
  'validarSupervisor':         doPostAdmin,
  'inativarSupervisor':        doPostAdmin,
  'reativarSupervisor':        doPostAdmin,
  'recusarSupervisor':         doPostAdmin,
  'editarSupervisorAdmin':     doPostAdmin,
  'excluirSupervisor':         doPostAdmin,
  'cadastrarSupervisorAdmin':  doPostAdmin,
  'aprovarAdendo':             doPostAdmin,
  'reprovarAdendo':            doPostAdmin,
  'inativarAgente':            doPostAdmin,
  'reativarAgente':            doPostAdmin,
  'editarAgente':              doPostAdmin,
  'excluirAgente':             doPostAdmin,
  'inativarCoordenador':       doPostAdmin,
  'reativarCoordenador':       doPostAdmin,
  'aprovarCadastroServidor':   doPostAdmin,
  'editarOrientadorAdmin':     doPostAdmin,
  'excluirOrientador':         doPostAdmin,
  'editarCoordenadorAdmin':    doPostAdmin,
  'excluirCoordenador':        doPostAdmin,
  'enviarMagicLinkEmpresa':    doPostAdmin,
  'enviarMagicLinkSupervisor': doPostAdmin,
  'aprovarOportunidade':       doPostAdmin,
  'reprovarOportunidade':      doPostAdmin,
  'encerrarOportunidade':      doPostAdmin,
  'enviarMagicLinkOportunidade': doPostAdmin,
  'cadastrarOportunidadeAdmin':  doPostAdmin,

  // Checklist
  'salvarRespostaAdmin':             doPostChecklist,
  'salvarRespostaAtor':              doPostChecklist,
  'salvarPrazos':                    doPostChecklist,
  'reenviarNotificacaoChecklist':    doPostChecklist,
  'regenerarPdfChecklist':           doPostChecklist,

  // Assinaturas TCE
  'concluirEtapa':                    doPostAssinaturas,
  'rejeitarEtapa':                    doPostAssinaturas,
  'uploadPdfAssinado':                doPostAssinaturas,
  'reenviarNotificacaoAssinatura':    doPostAssinaturas,
  'regenerarTCEInicial':              doPostAssinaturas,

  // Assinaturas Adendo
  'uploadPdfAdendoAssinado':          doPostAdendo,
  'concluirEtapaAdendo':              doPostAdendo,
  'rejeitarEtapaAdendo':              doPostAdendo,
  'reenviarNotificacaoAdendo':        doPostAdendo,

  // Parecer Final
  'iniciarParecerFinal':              doPostParecer,
  'salvarParecerCoordenador':         doPostParecer,
  'salvarParecerDiretoria':           doPostParecer,
  'aprovarParecerAdmin':              doPostParecer,
  'reprovarParecerAdmin':             doPostParecer,
  'regenerarPdfParecer':              doPostParecer,
  'concluirEstagio':                  doPostParecer,

  // Avaliações
  'iniciarAvaliacao':                 doPostAvaliacoes,
  'salvarRespostaAvaliacao':          doPostAvaliacoes,
  'assinarAvaliacao':                 doPostAvaliacoes,
  'aprovarAvaliacao':                 doPostAvaliacoes,
  'regenerarPdfAvaliacao':            doPostAvaliacoes,
  'reenviarNotificacaoAvaliacao':     doPostAvaliacoes,

  // Notificações in-app
  'marcarNotificacaoLida':            doPostNotificacoes,
  'marcarTodasNotificacoesLidas':     doPostNotificacoes,

  // Convênios
  'gerarConvenio':                    doPostConvenios,
  'uploadPdfConvenioAssinado':        doPostConvenios,
  'concluirEtapaConvenio':            doPostConvenios,
  'rejeitarEtapaConvenio':            doPostConvenios,
  'reenviarNotificacaoConvenio':      doPostConvenios,

  // Declarações
  'solicitarDeclaracao':              doPostDeclaracoes,
  'gerarDeclaracaoAdmin':             doPostDeclaracoes,
};

// â”€â”€ Ponto de entrada GET â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function doGet(e) {
  try {
    var action = (e.parameter && e.parameter.action) || '';
    var handler = GET_ROUTES[action];
    if (!handler) return jsonError_('AÃ§Ã£o GET desconhecida: ' + action, 'UNKNOWN_ACTION');
    return handler(e);
  } catch (err) {
    logErro_('Code.doGet', err);
    return jsonError_('Erro interno no roteador.', 'INTERNAL');
  }
}

// â”€â”€ Ponto de entrada POST â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function doPost(e) {
  try {
    var body   = JSON.parse(e.postData.contents);
    var action = body.action || '';
    var handler = POST_ROUTES[action];
    if (!handler) return jsonError_('AÃ§Ã£o POST desconhecida: ' + action, 'UNKNOWN_ACTION');
    // Recria o "event" com o body jÃ¡ parseado para compatibilidade com os mÃ³dulos
    e._body = body;
    return handler(e);
  } catch (err) {
    // Erros de autenticação são esperados — retorna mensagem diretamente (sem logar como erro interno)
    if (err && (err.code === 'AUTH_ERROR' || err.name === 'ErroAutenticacao')) {
      return jsonError_(err.message, 'AUTH_ERROR');
    }
    logErro_('Code.doPost', err);
    return jsonError_('Erro interno no roteador.', 'INTERNAL');
  }
}

// â”€â”€ Stubs dos mÃ³dulos (cada mÃ³dulo define suas funÃ§Ãµes) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Os mÃ³dulos api-*.gs expÃµem as funÃ§Ãµes abaixo:
//   doGetEmpresas(e), doPostEmpresas(e)
//   doGetEstudantes(e), doPostEstudantes(e)
//   doGetServidores(e), doPostServidores(e)
//   doGetSolicitacao(e), doPostSolicitacao(e)
//   doGetAdmin(e), doPostAdmin(e)
//   doGetDash(e)
//   doGetAgentes(e), doPostAgentes(e)
//   doGetOportunidades(e), doPostOportunidades(e)
//   doGetAvaliacoes(e), doPostAvaliacoes(e)  ← api-avaliacoes.gs
//
// Se um mÃ³dulo ainda nÃ£o implementar sua funÃ§Ã£o, use o stub abaixo
// para evitar erros em runtime:

function doGetEstudantes(e) {
  var action = e.parameter && e.parameter.action;
  if (action === 'listarMeusEstagios') return listarMeusEstagios_(e);
  if (action === 'verificarEstudante') return verificarEstudante_(e);
  if (action === 'obterMeuCadastro')   return obterMeuCadastro_(e);
  if (action === 'verificarCpf')       return verificarCpf_(e);
  return jsonError_('AÃ§Ã£o nÃ£o implementada: ' + action, 'NOT_IMPLEMENTED');
}

function doPostEstudantes(e) {
  var body = e._body || JSON.parse(e.postData ? e.postData.contents : '{}');
  if (body.action === 'atualizarMeuCadastro') return atualizarMeuCadastro_(body);
  return cadastrarEstudante_(body);
}

function doGetServidores(e) {
  var action = e.parameter && e.parameter.action;
  if (action === 'listarOrientadores') {
    var curso = (e.parameter && e.parameter.curso) ? decodeURIComponent(e.parameter.curso) : '';
    return listarOrientadores_(curso);
  }
  if (action === 'listarCoordenadores')          return listarCoordenadores_(e);
  if (action === 'obterMeuCadastroOrientador')   return obterMeuCadastroOrientador_(e);
  if (action === 'obterMeuCadastroCoordenador')  return obterMeuCadastroCoordenador_(e);
  if (action === 'listarMeusOrientandos')        return listarMeusOrientandos_(e);
  if (action === 'listarEstagiosCoordenador')    return listarEstagiosCoordenador_(e);
  if (action === 'verificarCadastroOrientador')  return verificarCadastroOrientador_(e);
  if (action === 'obterFichaNapneOrientador')    return obterFichaNapneOrientador_(e);
  if (action === 'listarMeusSupervisionados')    return listarMeusSupervisionados_(e);
  return jsonError_('Ação não implementada: ' + action, 'NOT_IMPLEMENTED');
}

function doPostServidores(e) {
  var body = e._body || JSON.parse(e.postData ? e.postData.contents : '{}');
  var action = body.action || '';
  if (action === 'cadastrarOrientador')             return cadastrarOrientador_(body);
  if (action === 'atualizarMeuCadastroOrientador')  return atualizarMeuCadastroOrientador_(body);
  if (action === 'cadastrarCoordenador')            return cadastrarCoordenador_(body);
  if (action === 'atualizarMeuCadastroCoordenador') return atualizarMeuCadastroCoordenador_(body);
  if (action === 'registrarOrientadorConvidado')    return registrarOrientadorConvidado_(body);
  return jsonError_('AÃ§Ã£o nÃ£o implementada: ' + action, 'NOT_IMPLEMENTED');
}

function doGetSolicitacao(e) {
  var action = (e.parameter && e.parameter.action) || '';
  if (action === 'verificarIdEstagio')         return getVerificarIdEstagio_(e);
  if (action === 'verificarAceiteOrientador')  return verificarAceiteOrientador_(e);
  if (action === 'listarHistoricoEstagio')      return listarHistoricoEstagio_(e);
  if (action === 'listarDocumentosAvulsos')     return listarDocumentosAvulsos_(e);
  return jsonError_('Ação GET não reconhecida em solicitacao: ' + action, 'NOT_IMPLEMENTED');
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
    case 'enviarDocumentoDG':          return enviarDocumentoDG_(body);
    case 'responderAceiteOrientador':  return responderAceiteOrientador_(body);
    case 'trocarOrientador':           return trocarOrientador_(body);
    case 'uploadDocumentoEstagio':       return uploadDocumentoEstagio_(body);
    case 'marcarDocumentoRevisado':      return marcarDocumentoRevisado_(body);
    case 'enviarDocumentoPorEmail':      return enviarDocumentoPorEmail_(body);
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
  var body = e._body || JSON.parse(e.postData ? e.postData.contents : '{}');
  try {
    return jsonOk_(cadastrarOportunidade_(body));
  } catch (err) {
    return jsonError_(err.message, 'BAD_REQUEST');
  }
}

function doGetEmpresas(e) {
  var action = (e.parameter && e.parameter.action) || '';
  try {
    switch (action) {
      case 'listarEmpresas':          return jsonOk_(listarEmpresas_());
      case 'listarSupervisores':      return jsonOk_(listarSupervisores_(e.parameter.empresa || ''));
      case 'obterCadastroEmpresa':    return jsonOk_(obterCadastroEmpresa_(e.parameter.cnpjCpf || '', e.parameter.codigo || ''));
      case 'obterCadastroSupervisor':   return jsonOk_(obterCadastroSupervisor_(e.parameter.cpf || '', e.parameter.codigo || ''));
      case 'verificarStatusConcedente':  return verificarStatusConcedente_(e);
      case 'listarEmpresasPrecheck':     return listarEmpresasPrecheck_();
      case 'listarSupervisoresPrecheck': return listarSupervisoresPrecheck_(e.parameter.cnpj || '');
      default: return jsonError_('Ação GET não reconhecida em empresas: ' + action, 'NOT_IMPLEMENTED');
    }
  } catch (err) {
    return jsonError_(err.message, 'NOT_FOUND');
  }
}

function doPostEmpresas(e) {
  var body = e._body || JSON.parse(e.postData ? e.postData.contents : '{}');
  var action = body.action || '';
  try {
    var result;
    switch (action) {
      case 'cadastrarEmpresa':            result = cadastrarEmpresa_(body);            break;
      case 'cadastrarSupervisor':         result = cadastrarSupervisor_(body);         break;
      case 'salvarMeuCadastroEmpresa':    result = salvarMeuCadastroEmpresa_(body);    break;
      case 'salvarMeuCadastroSupervisor': result = salvarMeuCadastroSupervisor_(body); break;
      case 'enviarDocumentosEmpresa':     result = enviarDocumentosEmpresa_(body);     break;
      default: return jsonError_('Ação POST não reconhecida em empresas: ' + action, 'NOT_IMPLEMENTED');
    }
    return jsonOk_(result);
  } catch (err) {
    return jsonError_(err.message, 'BAD_REQUEST');
  }
}


function doGetPublicConfig(e) {
  var action = e.parameter && e.parameter.action;
  if (action === 'obterConfigCursos')    return obterConfigCursos_();
  if (action === 'listarCursos')         return listarCursos_();
  if (action === 'contarEstagiosAtivos')     return contarEstagiosAtivos_();
  if (action === 'validarTokenOportunidade') return validarTokenOportunidade_((e.parameter && e.parameter.token) || '');
  return jsonError_('AÃ§Ã£o nÃ£o implementada.', 'NOT_IMPLEMENTED');
}

// corrigirCabecalhoSolicitacoes_() permanece disponível para execução manual via editor GAS
