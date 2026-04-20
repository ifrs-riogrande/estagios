/**
 * api-agentes.gs — Web App: Agentes de Integração
 * SGE — Sistema de Gestão de Estágios · IFRS Campus Rio Grande
 *
 * Rotas GET:  ?action=listarAgentes
 * Rotas POST: { action: 'cadastrarAgente', ...dados }
 *
 * Planilha de Agentes ID: 1jCb0xNx3aRPGgyuRDekcxpzGk1j5qTiK4kCO-87KX7Y
 */

'use strict';

var CFG_AGT = {
  SS_ID: '1zVyseifVC6xeMpNjqwYd6jCq9HTJ2NS8BlN1dtM4s7Y',  // planilha consolidada SGE
  ABA:   'Agentes',
};

/**
 * Mapa de colunas da planilha de Agentes (base 0).
 * Mantém compatibilidade com o formulário original.
 */
var COL_AGT = {
  TIMESTAMP:       0,
  TIPO:            1,
  NOME:            2,
  SIGLA:           3,
  CNPJ:            4,
  SITE:            5,
  TEL:             6,
  EMAIL:           7,
  NUM_EDITAL:      8,
  PERIODO:         9,
  LINK_EDITAL:     10,
  OBS:             11,
  STATUS:          12,   // 'Ativo' | 'Inativo' | 'Pendente'
  CADASTRADO_POR:  13,
};

// ---------------------------------------------------------------------------
// Roteamento
// ---------------------------------------------------------------------------

function doGet(e) {
  try {
    var action = (e.parameter && e.parameter.action) || '';
    if (action === 'listarAgentes') return listarAgentes_();
    return jsonError_('Ação não reconhecida.', 'UNKNOWN_ACTION');
  } catch (err) {
    logErro_('api-agentes.doGet', err);
    return jsonError_('Erro interno.', 'INTERNAL');
  }
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
    if (action === 'cadastrarAgente') return cadastrarAgente_(dados);
    return jsonError_('Ação não reconhecida.', 'UNKNOWN_ACTION');
  } catch (err) {
    logErro_('api-agentes.doPost[' + (dados && dados.action) + ']', err);
    if (err instanceof ErroAutenticacao) return jsonError_(err.message, 'AUTH_ERROR');
    return jsonError_('Erro interno ao processar a requisição.', 'INTERNAL');
  }
}

// ---------------------------------------------------------------------------
// GET — Listar agentes ativos
// ---------------------------------------------------------------------------

function listarAgentes_() {
  var sheet  = abrirAba_(CFG_AGT.SS_ID, CFG_AGT.ABA);
  var dados  = sheet.getDataRange().getValues();
  var lista  = [];

  for (var i = 1; i < dados.length; i++) {
    var linha = dados[i];
    var status = String(linha[COL_AGT.STATUS] || '').trim();
    if (status !== 'Ativo') continue;

    lista.push({
      tipo:            String(linha[COL_AGT.TIPO]   || ''),
      nome:            String(linha[COL_AGT.NOME]   || ''),
      sigla:           String(linha[COL_AGT.SIGLA]  || ''),
      tel:             String(linha[COL_AGT.TEL]    || ''),
      email:           String(linha[COL_AGT.EMAIL]  || ''),
      site:            String(linha[COL_AGT.SITE]   || ''),
      periodoConvenio: String(linha[COL_AGT.PERIODO]|| ''),
    });
  }

  return jsonOk_(lista);
}

// ---------------------------------------------------------------------------
// POST — Cadastrar agente
// ---------------------------------------------------------------------------

function cadastrarAgente_(dados) {
  // Autenticação — apenas servidores podem cadastrar agentes
  validarTokenServidor_(dados.authToken);

  if (!checkRateLimit_('cadastrarAgente')) {
    return jsonError_('Muitas requisições. Aguarde um momento.', 'RATE_LIMIT');
  }

  // Validações
  var nome  = sanitizar_(dados.nomeAgente, 200);
  var sigla = sanitizar_(dados.siglaAgente, 20).toUpperCase();
  var cnpj  = sanitizar_(dados.cnpjAgente, 14).replace(/\D/g, '');
  var tipo  = sanitizar_(dados.tipoAgente, 50);
  var tel   = sanitizar_(dados.telAgente,  30);
  var email = sanitizar_(dados.emailAgente,100).toLowerCase();
  var edital= sanitizar_(dados.numEdital,  100);
  var period= sanitizar_(dados.periodoConvenio, 100);
  var site  = sanitizar_(dados.siteAgente, 300);
  var link  = sanitizar_(dados.linkEdital, 300);
  var obs   = sanitizar_(dados.obsAgente,  1000);

  if (!nome)  return jsonError_('Nome do agente é obrigatório.', 'VALIDATION');
  if (!sigla) return jsonError_('Sigla é obrigatória.', 'VALIDATION');
  if (!tipo)  return jsonError_('Tipo de agente é obrigatório.', 'VALIDATION');
  if (!validarCNPJ_(cnpj)) return jsonError_('CNPJ inválido.', 'VALIDATION');
  if (!tel)   return jsonError_('Telefone é obrigatório.', 'VALIDATION');
  if (!validarEmail_(email)) return jsonError_('E-mail inválido.', 'VALIDATION');
  if (!edital) return jsonError_('Número do edital é obrigatório.', 'VALIDATION');
  if (!period) return jsonError_('Período de vigência é obrigatório.', 'VALIDATION');

  // Verifica duplicidade por CNPJ
  var sheet = abrirAba_(CFG_AGT.SS_ID, CFG_AGT.ABA);
  var idx   = buscarNaColuna_(sheet, COL_AGT.CNPJ, cnpj);
  if (idx !== -1) return jsonError_('Já existe um agente cadastrado com este CNPJ.', 'DUPLICATE');

  // Monta linha (mesma estrutura que o Form original)
  var now  = new Date();
  var linha = [];
  linha[COL_AGT.TIMESTAMP]      = now;
  linha[COL_AGT.TIPO]           = tipo;
  linha[COL_AGT.NOME]           = nome;
  linha[COL_AGT.SIGLA]          = sigla;
  linha[COL_AGT.CNPJ]           = cnpj;
  linha[COL_AGT.SITE]           = site;
  linha[COL_AGT.TEL]            = tel;
  linha[COL_AGT.EMAIL]          = email;
  linha[COL_AGT.NUM_EDITAL]     = edital;
  linha[COL_AGT.PERIODO]        = period;
  linha[COL_AGT.LINK_EDITAL]    = link;
  linha[COL_AGT.OBS]            = obs;
  linha[COL_AGT.STATUS]         = 'Pendente';
  linha[COL_AGT.CADASTRADO_POR] = dados.authToken ? '(via SGE)' : '';

  sheet.appendRow(linha);

  // Notificação ao setor
  try { enviarEmailNovoAgente_(dados); } catch (e) { logErro_('cadastrarAgente_.mail', e); }

  return jsonOk_({ mensagem: 'Agente cadastrado com sucesso. Aguardando ativação pelo setor.' });
}
