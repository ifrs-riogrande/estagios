/**
 * api-oportunidades.gs — Web App: Portal de Oportunidades (público)
 * SGE — Sistema de Gestão de Estágios · IFRS Campus Rio Grande
 *
 * Rotas GET:  ?action=listarOportunidades[&curso=X][&tipo=X][&modalidade=X][&cidade=X]
 *
 * As oportunidades são cadastradas em empresas/oportunidades.html
 * e ficam na aba "Oportunidades" da planilha de Empresas.
 * Este script apenas as lista (status=Aprovada).
 *
 * Planilha de Empresas ID: 1pbngqAv9hjqlVMF50SIz-3wD2F94__-QA9DawBjMTKk
 */

'use strict';

var CFG_OPP = {
  SS_ID:    '1iAnurghOelZQiYMIevO1xxnx0ptz5bxyniuUe5KZx3Y',  // planilha consolidada SGE
  ABA_OPP:  'Oportunidades',
};

/**
 * Mapa de colunas da aba Oportunidades (base 0).
 * Deve coincidir com o appendRow em api-empresas.gs :: cadastrarOportunidade_.
 */
var COL_OPP = {
  TIMESTAMP:     0,
  NOME_EMPRESA:  1,
  RESPONSAVEL:   2,
  EMAIL_CONTATO: 3,
  TEL_CONTATO:   4,
  TIPO_VAGA:     5,
  NUM_VAGAS:     6,
  TITULO:        7,
  AREA:          8,
  ATIVIDADES:    9,
  REQUISITOS:    10,
  INFO_COMPL:    11,
  CIDADE:        12,
  MODALIDADE:    13,
  CARGA_HOR:     14,
  REMUNERACAO:   15,
  BENEFICIOS:    16,
  COMO_CANDIDATAR: 17,
  CONTATO_CAND:  18,
  PRAZO:         19,
  INSTAGRAM:     20,
  LINKEDIN:      21,
  STATUS:        22,  // 'Aprovada' | 'Pendente' | 'Encerrada'
};

// ---------------------------------------------------------------------------
// Roteamento
// ---------------------------------------------------------------------------

function doGet(e) {
  try {
    var action = (e.parameter && e.parameter.action) || 'listarOportunidades';
    if (action === 'listarOportunidades') {
      var filtros = {
        curso:      (e.parameter && e.parameter.curso)      || '',
        tipo:       (e.parameter && e.parameter.tipo)       || '',
        modalidade: (e.parameter && e.parameter.modalidade) || '',
        cidade:     (e.parameter && e.parameter.cidade)     || '',
      };
      return listarOportunidades_(filtros);
    }
    return jsonError_('Ação não reconhecida.', 'UNKNOWN_ACTION');
  } catch (err) {
    logErro_('api-oportunidades.doGet', err);
    return jsonError_('Erro interno.', 'INTERNAL');
  }
}

// POST não é necessário aqui — o cadastro é feito pelo api-empresas.gs
function doPost(e) {
  return jsonError_('Método não suportado neste endpoint.', 'METHOD_NOT_ALLOWED');
}

// ---------------------------------------------------------------------------
// GET — Listar oportunidades aprovadas
// ---------------------------------------------------------------------------

function listarOportunidades_(filtros) {
  var ss = SpreadsheetApp.openById(CFG_OPP.SS_ID);
  var sheet = ss.getSheetByName(CFG_OPP.ABA_OPP);
  if (!sheet) return jsonOk_([]); // aba ainda não existe

  var dados = sheet.getDataRange().getValues();
  var lista = [];
  var hoje  = new Date();
  hoje.setHours(0, 0, 0, 0);

  var cursoBusca     = String(filtros.curso      || '').toLowerCase().trim();
  var tipoBusca      = String(filtros.tipo       || '').toLowerCase().trim();
  var modalidadeBusca= String(filtros.modalidade || '').toLowerCase().trim();
  var cidadeBusca    = String(filtros.cidade     || '').toLowerCase().trim();

  for (var i = 1; i < dados.length; i++) {
    var linha  = dados[i];
    var status = String(linha[COL_OPP.STATUS] || '').trim();
    if (status !== 'Aprovada') continue;

    // Exclui oportunidades com prazo vencido
    var prazoVal = linha[COL_OPP.PRAZO];
    if (prazoVal) {
      var dtPrazo = prazoVal instanceof Date ? prazoVal : new Date(prazoVal);
      if (!isNaN(dtPrazo.getTime())) {
        dtPrazo.setHours(0, 0, 0, 0);
        if (dtPrazo < hoje) continue;
      }
    }

    var area       = String(linha[COL_OPP.AREA]      || '');
    var tipoVaga   = String(linha[COL_OPP.TIPO_VAGA]  || '');
    var modalidade = String(linha[COL_OPP.MODALIDADE]  || '');
    var cidade     = String(linha[COL_OPP.CIDADE]      || '');

    // Filtros server-side (o front também filtra, mas reduz payload)
    if (cursoBusca     && !area.toLowerCase().includes(cursoBusca))           continue;
    if (tipoBusca      && !tipoVaga.toLowerCase().includes(tipoBusca))         continue;
    if (modalidadeBusca&& !modalidade.toLowerCase().includes(modalidadeBusca)) continue;
    if (cidadeBusca    && !cidade.toLowerCase().includes(cidadeBusca))         continue;

    // Formata prazo
    var prazoISO = '';
    if (prazoVal) {
      var dp = prazoVal instanceof Date ? prazoVal : new Date(prazoVal);
      if (!isNaN(dp.getTime())) prazoISO = dp.toISOString().split('T')[0];
    }

    lista.push({
      nomeEmpresa:      String(linha[COL_OPP.NOME_EMPRESA]   || ''),
      tipoVaga:         tipoVaga,
      numVagas:         linha[COL_OPP.NUM_VAGAS] || '',
      titulo:           String(linha[COL_OPP.TITULO]         || ''),
      area:             area,
      atividades:       String(linha[COL_OPP.ATIVIDADES]     || ''),
      requisitos:       String(linha[COL_OPP.REQUISITOS]     || ''),
      cidade:           cidade,
      modalidade:       modalidade,
      cargaHoraria:     String(linha[COL_OPP.CARGA_HOR]      || ''),
      remuneracao:      String(linha[COL_OPP.REMUNERACAO]    || ''),
      beneficios:       String(linha[COL_OPP.BENEFICIOS]     || ''),
      linkCandidatura:  String(linha[COL_OPP.COMO_CANDIDATAR]|| ''),
      contatoCandidatura:String(linha[COL_OPP.CONTATO_CAND]  || ''),
      prazo:            prazoISO,
      instagram:        String(linha[COL_OPP.INSTAGRAM]      || ''),
      linkedin:         String(linha[COL_OPP.LINKEDIN]       || ''),
    });
  }

  // Mais recentes primeiro (invertendo — appendRow coloca mais recentes no final)
  lista.reverse();

  return jsonOk_(lista);
}
