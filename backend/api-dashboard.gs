/**
 * api-dashboard.gs — Web App: Dashboard do Setor de Estágios
 * SGE — Sistema de Gestão de Estágios · IFRS Campus Rio Grande
 *
 * Rotas GET:  ?action=dashboard
 *
 * Requer autenticação de servidor (@riogrande.ifrs.edu.br).
 * Agrega dados de todas as planilhas e retorna:
 *   - stats:         { ativos, pendentes, encerrados, empresas }
 *   - alertas:       [ { titulo, descricao, nivel } ]
 *   - solicitacoes:  [ { id, nomeEstudante, curso, empresa, tipo, status, dataSolicitacao, periodo } ]
 *   - porCurso:      [ { curso, total } ]
 *   - topEmpresas:   [ { razaoSocial, nomeFantasia, total } ]
 *
 * Planilhas:
 *   Solicitações: 1iAnurghOelZQiYMIevO1xxnx0ptz5bxyniuUe5KZx3Y
 *   Orientadores: 1lmwm-9_UYqqP2dWRhZdaBmSD5Qb8h8KZk6x6FJVSHJE
 */

'use strict';

var CFG_DASH = {
  SS_SOL:   '1iAnurghOelZQiYMIevO1xxnx0ptz5bxyniuUe5KZx3Y',
  SS_ORI:   '1lmwm-9_UYqqP2dWRhZdaBmSD5Qb8h8KZk6x6FJVSHJE',
  ABA_SOL:  'Solicitações',
  ABA_PARC: 'Relatórios Parciais',
  ABA_FINAL:'Relatórios Finais',
  ABA_ADENDO:'Adendos',

  // Alertas: contratos de substitutos com vencimento <= N dias
  ALERTA_CONTRATO_DIAS: 30,
  // Estágios com término próximo (sem relatório final) <= N dias
  ALERTA_TERMINO_DIAS: 15,
  // Número de solicitações mais recentes retornadas
  MAX_SOLICITACOES: 200,
};

// Índices de coluna da aba Solicitações (mesmo COL_SOL de api-solicitacao.gs)
var _COL_SOL = {
  TIMESTAMP:       0,
  ID_ESTAGIO:      1,
  EMAIL_ESTUDANTE: 2,
  NOME_ESTUDANTE:  3,
  MATRICULA:       4,
  CURSO:           5,
  TIPO_ESTAGIO:    9,
  NOME_EMPRESA:    10,
  EMAIL_ORIENTADOR:16,
  DATA_INICIO:     17,
  DATA_TERMINO:    18,
  STATUS:          28,
};

// Índices de coluna da aba Orientadores
var _COL_ORI = {
  NOME:         4,
  EMAIL:        8,
  TIPO_VINCULO: 1,
  FIM_CONTRATO: 3,
  STATUS:       12,
};

// ---------------------------------------------------------------------------
// Roteamento
// ---------------------------------------------------------------------------

function doGet(e) {
  try {
    var token  = e.parameter && e.parameter.authToken;
    validarTokenServidor_(token);

    var action = (e.parameter && e.parameter.action) || 'dashboard';
    if (action === 'dashboard') return gerarDashboard_();
    return jsonError_('Ação não reconhecida.', 'UNKNOWN_ACTION');
  } catch (err) {
    if (err instanceof ErroAutenticacao) return jsonError_(err.message, 'AUTH_ERROR');
    logErro_('api-dashboard.doGet', err);
    return jsonError_('Erro interno.', 'INTERNAL');
  }
}

function doPost(e) {
  return jsonError_('Método não suportado.', 'METHOD_NOT_ALLOWED');
}

// ---------------------------------------------------------------------------
// Dashboard principal
// ---------------------------------------------------------------------------

function gerarDashboard_() {
  var hoje = new Date(); hoje.setHours(0, 0, 0, 0);

  // Lê planilha de solicitações
  var ss    = SpreadsheetApp.openById(CFG_DASH.SS_SOL);
  var sheet = ss.getSheetByName(CFG_DASH.ABA_SOL) || ss.getSheets()[0];
  var dados = sheet.getDataRange().getValues();

  // ── Stats ────────────────────────────────────────────────────────────────
  var ativos     = 0;
  var pendentes  = 0;
  var encerrados = 0;
  var empresasSet= {};

  // ── Por curso ────────────────────────────────────────────────────────────
  var porCursoMap = {};

  // ── Top empresas (estágios ativos) ───────────────────────────────────────
  var empresasMap = {};

  // ── Alertas ──────────────────────────────────────────────────────────────
  var alertas = [];

  // ── IDs com relatório final (para detectar pendentes) ────────────────────
  var comRelatorioFinal = {};
  var sheetFinal = ss.getSheetByName(CFG_DASH.ABA_FINAL);
  if (sheetFinal) {
    var dadosFinal = sheetFinal.getDataRange().getValues();
    for (var f = 1; f < dadosFinal.length; f++) {
      var idF = String(dadosFinal[f][1] || '').trim();
      if (idF) comRelatorioFinal[idF] = true;
    }
  }

  // ── Processamento das solicitações ───────────────────────────────────────
  var solicitacoesRetorno = [];

  for (var i = 1; i < dados.length; i++) {
    var linha  = dados[i];
    var status = String(linha[_COL_SOL.STATUS] || '').trim();
    var id     = String(linha[_COL_SOL.ID_ESTAGIO] || '').trim();
    var curso  = String(linha[_COL_SOL.CURSO] || '').trim();
    var empresa= String(linha[_COL_SOL.NOME_EMPRESA] || '').trim();
    var tipo   = String(linha[_COL_SOL.TIPO_ESTAGIO] || '').trim();

    // Stats por status
    if (status === 'Ativo')     { ativos++;    empresasSet[empresa] = true; }
    if (status === 'Pendente' || status === 'Em análise') pendentes++;
    if (status === 'Encerrado') encerrados++;

    // Por curso (apenas ativos)
    if (status === 'Ativo' && curso) {
      porCursoMap[curso] = (porCursoMap[curso] || 0) + 1;
    }

    // Por empresa (apenas ativos)
    if (status === 'Ativo' && empresa) {
      empresasMap[empresa] = (empresasMap[empresa] || 0) + 1;
    }

    // Alerta: estágio ativo com término iminente sem relatório final
    if (status === 'Ativo' && !comRelatorioFinal[id]) {
      var dtTermino = linha[_COL_SOL.DATA_TERMINO];
      if (dtTermino) {
        var dt = dtTermino instanceof Date ? dtTermino : new Date(dtTermino);
        dt.setHours(0, 0, 0, 0);
        var diasAoTermino = Math.round((dt - hoje) / 86400000);
        if (diasAoTermino >= 0 && diasAoTermino <= CFG_DASH.ALERTA_TERMINO_DIAS) {
          var nomeEst = String(linha[_COL_SOL.NOME_ESTUDANTE] || '').trim();
          alertas.push({
            titulo:    'Estágio encerrando em breve: ' + nomeEst,
            descricao: id + ' · Término em ' + formatarData_(dt) + ' (' + diasAoTermino + ' dias) · Relatório final pendente.',
            nivel:     diasAoTermino <= 5 ? 'error' : 'warning',
          });
        }
      }
    }

    // Coleta para a tabela de solicitações
    var tsVal = linha[_COL_SOL.TIMESTAMP];
    var tsISO = '';
    if (tsVal) {
      var ts = tsVal instanceof Date ? tsVal : new Date(tsVal);
      if (!isNaN(ts.getTime())) tsISO = ts.toISOString().split('T')[0];
    }

    // Período: derivado do semestre de início
    var periodo = '';
    if (tsISO) {
      var ano = tsISO.slice(0, 4);
      var mes = parseInt(tsISO.slice(5, 7));
      periodo = ano + '/' + (mes <= 6 ? '1' : '2');
    }

    solicitacoesRetorno.push({
      id:              id,
      nomeEstudante:   String(linha[_COL_SOL.NOME_ESTUDANTE] || ''),
      curso:           curso,
      empresa:         empresa,
      tipo:            tipo,
      status:          status,
      dataSolicitacao: tsISO,
      periodo:         periodo,
    });
  }

  // Mais recentes primeiro
  solicitacoesRetorno.reverse();
  if (solicitacoesRetorno.length > CFG_DASH.MAX_SOLICITACOES) {
    solicitacoesRetorno = solicitacoesRetorno.slice(0, CFG_DASH.MAX_SOLICITACOES);
  }

  // ── Alertas de adendos pendentes ─────────────────────────────────────────
  var sheetAdendo = ss.getSheetByName(CFG_DASH.ABA_ADENDO);
  if (sheetAdendo) {
    var dadosAdendo = sheetAdendo.getDataRange().getValues();
    var adendosPendentes = 0;
    for (var a = 1; a < dadosAdendo.length; a++) {
      if (String(dadosAdendo[a][9] || '').trim() === 'Pendente') adendosPendentes++;
    }
    if (adendosPendentes > 0) {
      alertas.push({
        titulo:    adendosPendentes + ' adendo' + (adendosPendentes > 1 ? 's' : '') + ' pendente' + (adendosPendentes > 1 ? 's' : '') + ' de análise',
        descricao: 'Solicitações de alteração ao TCE aguardando aprovação do setor.',
        nivel:     'warning',
      });
    }
  }

  // ── Alertas de orientadores substitutos com contrato vencendo ────────────
  try {
    var ssOri  = SpreadsheetApp.openById(CFG_DASH.SS_ORI);
    var shOri  = ssOri.getSheets()[0];
    var dadOri = shOri.getDataRange().getValues();
    for (var o = 1; o < dadOri.length; o++) {
      var linhaOri = dadOri[o];
      var statusOri = String(linhaOri[_COL_ORI.STATUS] || '').trim();
      if (statusOri === 'Inativo') continue;
      var vinculoOri = String(linhaOri[_COL_ORI.TIPO_VINCULO] || '').trim();
      if (vinculoOri !== 'Substituto') continue;
      var fimContr = linhaOri[_COL_ORI.FIM_CONTRATO];
      if (!fimContr) continue;
      var dtFim = fimContr instanceof Date ? fimContr : new Date(fimContr);
      dtFim.setHours(0, 0, 0, 0);
      var diasFim = Math.round((dtFim - hoje) / 86400000);
      if (diasFim >= 0 && diasFim <= CFG_DASH.ALERTA_CONTRATO_DIAS) {
        var nomeOri = String(linhaOri[_COL_ORI.NOME] || '').trim();
        alertas.push({
          titulo:    'Contrato de substituto vencendo: ' + nomeOri,
          descricao: 'Contrato encerra em ' + formatarData_(dtFim) + ' (' + diasFim + ' dias). Verifique os estágios orientados.',
          nivel:     diasFim <= 7 ? 'error' : 'warning',
        });
      }
    }
  } catch (e) { /* planilha de orientadores pode estar vazia — não crítico */ }

  // Ordena alertas: error primeiro
  alertas.sort(function (a, b) {
    return (a.nivel === 'error' ? 0 : 1) - (b.nivel === 'error' ? 0 : 1);
  });

  // ── Por curso: transforma map em array ordenado ──────────────────────────
  var porCurso = Object.keys(porCursoMap)
    .map(function (c) { return { curso: c, total: porCursoMap[c] }; })
    .sort(function (a, b) { return b.total - a.total; });

  // ── Top empresas ─────────────────────────────────────────────────────────
  var topEmpresas = Object.keys(empresasMap)
    .map(function (e) { return { razaoSocial: e, nomeFantasia: e, total: empresasMap[e] }; })
    .sort(function (a, b) { return b.total - a.total; })
    .slice(0, 10);

  return jsonOk_({
    stats: {
      ativos:     ativos,
      pendentes:  pendentes,
      encerrados: encerrados,
      empresas:   Object.keys(empresasSet).length,
    },
    alertas:       alertas,
    solicitacoes:  solicitacoesRetorno,
    porCurso:      porCurso,
    topEmpresas:   topEmpresas,
  });
}
