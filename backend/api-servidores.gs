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
  SS_ID: '1lmwm-9_UYqqP2dWRhZdaBmSD5Qb8h8KZk6x6FJVSHJE',
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
  STATUS:       12,  // 'Ativo' | 'Inativo'
};

// ---------------------------------------------------------------------------
// Roteamento
// ---------------------------------------------------------------------------

function doGet(e) {
  try {
    var action = (e.parameter && e.parameter.action) || '';
    if (action === 'listarOrientadores') {
      var curso = (e.parameter && e.parameter.curso) ? decodeURIComponent(e.parameter.curso) : '';
      return listarOrientadores_(curso);
    }
    return jsonError_('Ação não reconhecida.', 'UNKNOWN_ACTION');
  } catch (err) {
    logErro_('api-servidores.doGet', err);
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
    if (action === 'cadastrarOrientador') return cadastrarOrientador_(dados);
    return jsonError_('Ação não reconhecida.', 'UNKNOWN_ACTION');
  } catch (err) {
    logErro_('api-servidores.doPost[' + (dados && dados.action) + ']', err);
    if (err instanceof ErroAutenticacao) return jsonError_(err.message, 'AUTH_ERROR');
    return jsonError_('Erro interno ao processar a requisição.', 'INTERNAL');
  }
}

// ---------------------------------------------------------------------------
// GET — Listar orientadores (opcionalmente filtrados por curso)
// ---------------------------------------------------------------------------

function listarOrientadores_(curso) {
  var sheet = abrirAba_(CFG_SRV.SS_ID);
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
  var sheet = abrirAba_(CFG_SRV.SS_ID);
  var idx   = buscarNaColuna_(sheet, COL_ORI.CPF, cpf);
  if (idx !== -1) {
    // Atualiza cadastro existente em vez de duplicar
    var rowIdx = idx + 1; // base-1 para sheet
    sheet.getRange(rowIdx, COL_ORI.VINCULO + 1).setValue(vinculo);
    sheet.getRange(rowIdx, COL_ORI.TEL + 1).setValue(tel);
    sheet.getRange(rowIdx, COL_ORI.TITULACAO + 1).setValue(titulac);
    sheet.getRange(rowIdx, COL_ORI.AREA + 1).setValue(area);
    sheet.getRange(rowIdx, COL_ORI.CURSOS + 1).setValue(cursos);
    if (vinculo === 'Substituto') {
      sheet.getRange(rowIdx, COL_ORI.INI_CONTRATO + 1).setValue(iniCont);
      sheet.getRange(rowIdx, COL_ORI.FIM_CONTRATO + 1).setValue(fimCont);
    }
    return jsonOk_({ mensagem: 'Cadastro atualizado com sucesso.' });
  }

  // Nova linha
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
  linha[COL_ORI.STATUS]       = 'Ativo';

  sheet.appendRow(linha);

  // Notificação ao setor
  try { enviarEmailNovoOrientador_(dados); } catch (e) { logErro_('cadastrarOrientador_.mail', e); }

  return jsonOk_({ mensagem: 'Orientador cadastrado com sucesso!' });
}
