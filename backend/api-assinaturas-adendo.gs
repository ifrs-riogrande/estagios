/**
 * api-assinaturas-adendo.gs — Fluxo de Assinaturas do Adendo ao TCE
 * SGE — Sistema de Gestão de Estágios · IFRS Campus Rio Grande
 *
 * Fluxo waterfall (sequencial, uma etapa por vez):
 *   1. Estudante        → gov.br  (baixa, assina, envia PDF)
 *   2. Empresa          → gov.br
 *   3. Central (revisão)→ interno
 *   4. Direção-Geral    → gov.br
 *   5. Central (final)  → interno (atualiza adendo para 'Assinado')
 *
 * Armazenamento:
 *   PropertiesService  →  "adendoAss_[idEstagio]_[idAdendo]"  (estado JSON completo)
 *   Sheet "Fluxo Adendos"  →  resumo tabelado por etapa
 *   Google Drive       →  PDFs na mesma pasta do estágio
 *
 * Nomenclatura PDFs:
 *   ADENDO_[idEstagio]_v0_original.pdf
 *   ADENDO_[idEstagio]_v1_estudante.pdf
 *   ...
 */

'use strict';

var ADENDO_ASS_SHEET = 'Fluxo Adendos';

var ETAPAS_DEF_ADENDO = [
  { numero: 1, ator: 'estudante',      label: 'Estudante / Responsável Legal',     tipo: 'govbr'   },
  { numero: 2, ator: 'empresa',        label: 'Concedente',                        tipo: 'govbr'   },
  { numero: 3, ator: 'centralRevisao', label: 'Central de Estágios (revisão)',     tipo: 'interno' },
  { numero: 4, ator: 'direcao',        label: 'Direção-Geral',                     tipo: 'govbr'   },
  { numero: 5, ator: 'centralFinal',   label: 'Central de Estágios (finalização)', tipo: 'interno' },
];

// ── Inicialização ─────────────────────────────────────────────────────────────

/**
 * Inicia o fluxo de assinaturas do adendo.
 * Chamado por processarAdendo_ quando admin aprova.
 *
 * @param {string} idEstagio
 * @param {string} idAdendo    UUID único do adendo (coluna "ID Adendo" na aba Adendos)
 * @param {Object} dadosAdendo { tipoAlteracao, novaDataTermino, novaCarga, novoHorario, justificativa, emailEstudante }
 */
function iniciarFluxoAdendoAss_(idEstagio, idAdendo, dadosAdendo) {
  var sol    = _obterDadosSolicitacaoCompleto_(idEstagio);
  var prazos = obterPrazos_();

  // Reutiliza pasta existente do estágio (mesmo Drive do TCE)
  var pasta = _criarPastaAssinaturas_(idEstagio);

  // Gera PDF inicial do adendo
  var pdfInicial = null;
  try {
    pdfInicial = _gerarPdfAdendoInicial_(idEstagio, idAdendo, dadosAdendo, sol, pasta.getId());
  } catch (ePdf) {
    logErro_('iniciarFluxoAdendoAss_.gerarPdf', ePdf);
  }

  // Resolve e-mails dos atores
  var emails = {};
  ETAPAS_DEF_ADENDO.forEach(function(def) {
    emails[def.ator] = _resolverEmailAtorAdendo_(def.ator, sol, dadosAdendo);
  });

  var etapas = ETAPAS_DEF_ADENDO.map(function(def, idx) {
    return {
      numero:            def.numero,
      ator:              def.ator,
      label:             def.label,
      tipo:              def.tipo,
      email:             emails[def.ator] || '',
      token:             Utilities.getUuid(),
      status:            idx === 0 ? ASS_STATUS.AGUARDANDO : ASS_STATUS.PENDENTE,
      prazoVencimento:   idx === 0 ? calcularPrazoVencimento_(prazos.assinaturas[def.ator] || 5) : null,
      lembretesEnviados: 0,
      data:              null,
      driveUrl:          null,
      versao:            null,
      obs:               null,
    };
  });

  var fluxo = {
    idEstagio:          idEstagio,
    idAdendo:           idAdendo,
    dadosAdendo:        dadosAdendo || {},
    statusGeral:        'em_andamento',
    etapaAtual:         1,
    drivePastaId:       pasta.getId(),
    pdfOriginalUrl:     pdfInicial ? pdfInicial.getUrl() : null,
    timestampCriacao:   new Date().toISOString(),
    timestampConclusao: null,
    etapas:             etapas,
    historicoRejeicoes: [],
  };

  salvarFluxoAdendo_(idEstagio, idAdendo, fluxo);
  _atualizarFluxoAdendoNaPlanilha_(idEstagio, idAdendo, fluxo);

  // Notifica estudante (etapa 1)
  try {
    notificarAtorAdendo_(idEstagio, idAdendo, etapas[0], sol, fluxo);
  } catch (e) {
    logErro_('iniciarFluxoAdendoAss_.notificar', e);
  }

  return fluxo;
}

// ── Avançar etapa (concluir) ──────────────────────────────────────────────────

function concluirEtapaAdendo_(idEstagio, idAdendo, numeroEtapa, driveUrl, emailAtor) {
  var fluxo = obterFluxoAdendo_(idEstagio, idAdendo);
  if (!fluxo) return jsonError_('Fluxo de adendo não encontrado.', 'NOT_FOUND');

  var idx   = numeroEtapa - 1;
  var etapa = fluxo.etapas[idx];
  if (!etapa)                                 return jsonError_('Etapa inválida: ' + numeroEtapa, 'INVALID');
  if (etapa.status !== ASS_STATUS.AGUARDANDO) return jsonError_('Etapa não está aguardando ação.', 'INVALID_STATE');

  etapa.status    = ASS_STATUS.CONCLUIDO;
  etapa.data      = new Date().toISOString();
  etapa.driveUrl  = driveUrl || null;
  etapa.versao    = 'v' + numeroEtapa + '_' + etapa.ator;
  etapa.emailAtor = emailAtor;

  if (numeroEtapa === 5) {
    // ── Fluxo concluído ──────────────────────────────────────────────────────
    fluxo.statusGeral        = 'concluido';
    fluxo.timestampConclusao = new Date().toISOString();
    _concluirAdendo_(idEstagio, idAdendo);
    try { enviarPdfFinalAdendoParaTodos_(idEstagio, idAdendo, fluxo, driveUrl); } catch (e) { logErro_('enviarPdfFinalAdendoParaTodos_', e); }
  } else {
    // ── Ativa próxima etapa ──────────────────────────────────────────────────
    var prazos    = obterPrazos_();
    var proxEtapa = fluxo.etapas[idx + 1];
    proxEtapa.status          = ASS_STATUS.AGUARDANDO;
    proxEtapa.prazoVencimento = calcularPrazoVencimento_(prazos.assinaturas[proxEtapa.ator] || 5);
    fluxo.etapaAtual          = numeroEtapa + 1;

    try {
      var solProx = _obterDadosSolicitacaoCompleto_(idEstagio);
      if (!proxEtapa.email) proxEtapa.email = _resolverEmailAtorAdendo_(proxEtapa.ator, solProx, fluxo.dadosAdendo);
      notificarAtorAdendo_(idEstagio, idAdendo, proxEtapa, solProx, fluxo);
    } catch (e) { logErro_('concluirEtapaAdendo_.notificarProx', e); }
  }

  salvarFluxoAdendo_(idEstagio, idAdendo, fluxo);
  _atualizarFluxoAdendoNaPlanilha_(idEstagio, idAdendo, fluxo);
  return jsonOk_({ fluxo: fluxo });
}

// ── Rejeição ──────────────────────────────────────────────────────────────────

function rejeitarEtapaAdendo_(idEstagio, idAdendo, numeroEtapa, motivo, retornoParaEtapa, emailAdmin) {
  var fluxo = obterFluxoAdendo_(idEstagio, idAdendo);
  if (!fluxo) return jsonError_('Fluxo não encontrado.', 'NOT_FOUND');

  var etapa    = fluxo.etapas[numeroEtapa - 1];
  etapa.status = ASS_STATUS.REJEITADO;
  etapa.obs    = sanitizar_(motivo, 500);
  etapa.data   = new Date().toISOString();

  fluxo.historicoRejeicoes.push({
    etapa:            numeroEtapa,
    ator:             etapa.ator,
    label:            etapa.label,
    data:             new Date().toISOString(),
    motivo:           sanitizar_(motivo, 500),
    retornoParaEtapa: retornoParaEtapa,
    decididoPor:      emailAdmin,
  });

  var prazos = obterPrazos_();
  for (var i = retornoParaEtapa - 1; i < numeroEtapa; i++) {
    var et = fluxo.etapas[i];
    et.data    = null;
    et.driveUrl = null;
    et.versao  = null;
    if (i === retornoParaEtapa - 1) {
      et.status          = ASS_STATUS.AGUARDANDO;
      et.prazoVencimento = calcularPrazoVencimento_(prazos.assinaturas[et.ator] || 5);
    } else {
      et.status          = ASS_STATUS.PENDENTE;
      et.prazoVencimento = null;
    }
  }
  fluxo.etapaAtual = retornoParaEtapa;

  try {
    var solRej = _obterDadosSolicitacaoCompleto_(idEstagio);
    notificarAtorAdendo_(idEstagio, idAdendo, fluxo.etapas[retornoParaEtapa - 1], solRej, fluxo);
  } catch (e) { logErro_('rejeitarEtapaAdendo_.notificar', e); }

  salvarFluxoAdendo_(idEstagio, idAdendo, fluxo);
  _atualizarFluxoAdendoNaPlanilha_(idEstagio, idAdendo, fluxo);
  return jsonOk_({ fluxo: fluxo });
}

// ── PropertiesService ─────────────────────────────────────────────────────────

function obterFluxoAdendo_(idEstagio, idAdendo) {
  try {
    var raw = PropertiesService.getScriptProperties()
                .getProperty('adendoAss_' + idEstagio + '_' + idAdendo);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    logErro_('obterFluxoAdendo_', e);
    return null;
  }
}

function salvarFluxoAdendo_(idEstagio, idAdendo, fluxo) {
  try {
    PropertiesService.getScriptProperties()
      .setProperty('adendoAss_' + idEstagio + '_' + idAdendo, JSON.stringify(fluxo));
  } catch (e) {
    logErro_('salvarFluxoAdendo_', e);
    throw e;
  }
}

// ── Geração do PDF do Adendo ──────────────────────────────────────────────────

function _gerarPdfAdendoInicial_(idEstagio, idAdendo, dados, sol, pastaId) {
  var docId = null;
  try {
    var doc  = DocumentApp.create('ADENDO_' + idEstagio + '_v0_original');
    docId    = doc.getId();
    var body = doc.getBody();
    body.clear();
    body.setMarginTop(56).setMarginBottom(56).setMarginLeft(72).setMarginRight(72);

    // ── helpers de formatação ────────────────────────────────────────────────
    function kv(lbl, val) {
      var v   = (val !== undefined && val !== null && String(val).trim()) ? String(val) : '—';
      var full = lbl + ': ' + v;
      var p   = body.appendParagraph(full);
      p.setSpacingBefore(1).setSpacingAfter(1);
      var t   = p.editAsText();
      t.setFontFamily('Arial').setFontSize(10);
      t.setBold(0, lbl.length, true);
      if (full.length - 1 > lbl.length + 2) t.setBold(lbl.length + 2, full.length - 1, false);
      return p;
    }

    function txt(texto, opts) {
      opts = opts || {};
      var p = body.appendParagraph(texto || '');
      p.setSpacingBefore(opts.before !== undefined ? opts.before : 2);
      p.setSpacingAfter( opts.after  !== undefined ? opts.after  : 2);
      if (opts.center) p.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
      if (opts.indent) p.setIndentStart(opts.indent);
      var t = p.editAsText();
      t.setFontFamily('Arial').setFontSize(opts.size || 10);
      if (opts.bold)   t.setBold(true);
      if (opts.italic) t.setItalic(true);
      return p;
    }

    function sec(titulo) {
      var p = body.appendParagraph(titulo);
      p.setSpacingBefore(12).setSpacingAfter(3);
      p.editAsText().setFontFamily('Arial').setFontSize(10).setBold(true);
      body.appendHorizontalRule();
      return p;
    }

    function assin(nome, papel) {
      body.appendParagraph('').setSpacingBefore(28).setSpacingAfter(0);
      txt('_______________________________________', { before:0, after:0, center:true });
      txt(nome || '—', { before:0, after:0, bold:true, center:true });
      txt(papel || '',  { before:0, after:2, center:true });
    }

    // ── Cabeçalho institucional ──────────────────────────────────────────────
    var _logoBlob = _obterLogoCabecalho_();
    if (_logoBlob) {
      try {
        var logoImg = body.appendImage(_logoBlob);
        logoImg.setWidth(54).setHeight(54);
        logoImg.getParent().setAlignment(DocumentApp.HorizontalAlignment.CENTER);
        logoImg.getParent().setSpacingBefore(0).setSpacingAfter(2);
      } catch (_) {}
    }
    var iP1 = body.appendParagraph('MINISTÉRIO DA EDUCAÇÃO');
    iP1.setAlignment(DocumentApp.HorizontalAlignment.CENTER).setSpacingBefore(0).setSpacingAfter(1);
    iP1.editAsText().setFontFamily('Arial').setFontSize(8);

    var iP2 = body.appendParagraph('INSTITUTO FEDERAL DE EDUCAÇÃO, CIÊNCIA E TECNOLOGIA DO RIO GRANDE DO SUL');
    iP2.setAlignment(DocumentApp.HorizontalAlignment.CENTER).setSpacingBefore(1).setSpacingAfter(1);
    iP2.editAsText().setFontFamily('Arial').setFontSize(9).setBold(true);

    var iP3 = body.appendParagraph('Campus Rio Grande');
    iP3.setAlignment(DocumentApp.HorizontalAlignment.CENTER).setSpacingBefore(1).setSpacingAfter(10);
    iP3.editAsText().setFontFamily('Arial').setFontSize(8);

    // ── Título ───────────────────────────────────────────────────────────────
    var pTitulo = body.appendParagraph('ADITAMENTO AO TERMO DE COMPROMISSO DE ESTÁGIO');
    pTitulo.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    pTitulo.setSpacingBefore(4).setSpacingAfter(4);
    pTitulo.editAsText().setFontFamily('Arial').setFontSize(13).setBold(true);

    // ── Subtítulo: tipo de adendo ─────────────────────────────────────────────
    var tipoLabel = ((dados && dados.tipoAlteracao) || '').toUpperCase();
    if (tipoLabel) {
      var pSubtitulo = body.appendParagraph(tipoLabel);
      pSubtitulo.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
      pSubtitulo.setSpacingBefore(0).setSpacingAfter(10);
      pSubtitulo.editAsText().setFontFamily('Arial').setFontSize(10).setBold(false);
    }

    // ── Abertura ─────────────────────────────────────────────────────────────
    txt(
      'As partes abaixo qualificadas, signatárias do Termo de Compromisso de Estágio vigente ' +
      '(ID: ' + idEstagio + '), celebram entre si o presente ADITAMENTO, que passará a integrar ' +
      'o referido instrumento, alterando as condições indicadas nos termos a seguir:',
      { before:0, after:10 }
    );

    // ── Dados das partes ─────────────────────────────────────────────────────
    sec('DADOS DAS PARTES');
    kv('Estudante',              sol.nomeEstudante || '—');
    kv('E-mail',                 sol.emailEstudante || (dados && dados.emailEstudante) || '—');
    kv('Curso',                  sol.curso          || '—');
    kv('Instituição de Ensino',  'IFRS – Campus Rio Grande');
    kv('Empresa Concedente',     sol.nomeEmpresa    || '—');
    kv('CNPJ',                   _formatarCnpj_(sol.cnpjEmpresa));

    // ── Alterações ───────────────────────────────────────────────────────────
    sec('ALTERAÇÕES PACTUADAS');
    kv('Tipo de Alteração', (dados && dados.tipoAlteracao) || '—');
    if (dados && dados.novaDataTermino) kv('Nova Data de Término',     _formatarDataBr_(new Date(dados.novaDataTermino)));
    if (dados && dados.novoHorario) {
      var _parsedDias = null;
      try { _parsedDias = JSON.parse(dados.novoHorario); } catch (_) {}
      if (Array.isArray(_parsedDias) && _parsedDias.length) {
        // Renderiza como tabela (Dia / Entrada / Saída / Diária)
        var _tblData = [['Dia da Semana', 'Entrada', 'Saída', 'Carga Diária']].concat(
          _parsedDias.map(function(r) {
            return [r.dia || '', r.entrada || '', r.saida || '', r.diaria || ''];
          })
        );
        var _tbl = body.appendTable(_tblData);
        // Estilo header
        var _hRow = _tbl.getRow(0);
        for (var _ci = 0; _ci < 4; _ci++) {
          _hRow.getCell(_ci).editAsText().setFontFamily('Arial').setFontSize(9).setBold(true);
        }
        // Estilo dados
        for (var _ri = 1; _ri < _tbl.getNumRows(); _ri++) {
          for (var _ci2 = 0; _ci2 < 4; _ci2++) {
            _tbl.getRow(_ri).getCell(_ci2).editAsText().setFontFamily('Arial').setFontSize(9);
          }
        }
        if (dados.novaCarga) kv('Nova Carga Horária Semanal', dados.novaCarga);
      } else {
        // Texto puro (retrocompatibilidade)
        kv('Novo Horário', dados.novoHorario);
        if (dados.novaCarga) kv('Nova Carga Horária Semanal', dados.novaCarga);
      }
    } else if (dados && dados.novaCarga) {
      kv('Nova Carga Horária Semanal', dados.novaCarga);
    }
    if (dados && dados.justificativa)   kv('Justificativa',              dados.justificativa);

    // ── Texto legal ───────────────────────────────────────────────────────────
    txt(
      'As demais cláusulas e condições do Termo de Compromisso de Estágio original permanecem ' +
      'inalteradas, ficando o presente aditamento incorporado ao instrumento principal, ' +
      'produzindo todos os efeitos legais a partir da data de assinatura por todas as partes.',
      { before:14, after:10 }
    );

    // ── Data ─────────────────────────────────────────────────────────────────
    var _hoje    = new Date();
    var _mesesPt = ['janeiro','fevereiro','março','abril','maio','junho',
                    'julho','agosto','setembro','outubro','novembro','dezembro'];
    var _dia     = parseInt(Utilities.formatDate(_hoje, 'America/Sao_Paulo', 'd'), 10);
    var _mes     = parseInt(Utilities.formatDate(_hoje, 'America/Sao_Paulo', 'M'), 10) - 1;
    var _ano     = Utilities.formatDate(_hoje, 'America/Sao_Paulo', 'yyyy');
    txt('Rio Grande, ' + _dia + ' de ' + _mesesPt[_mes] + ' de ' + _ano + '.', { before:4, after:20 });

    // ── Assinaturas ───────────────────────────────────────────────────────────
    assin('Representante Legal', 'CONCEDENTE');
    assin('DIRETOR-GERAL DO IFRS – CAMPUS RIO GRANDE', 'INSTITUIÇÃO DE ENSINO');
    if (sol.nomeResp) {
      assin(sol.nomeResp, 'RESPONSÁVEL LEGAL DO(A) ESTAGIÁRIO(A) ' + (sol.nomeEstudante || '').toUpperCase());
    } else {
      assin(sol.nomeEstudante || 'ESTAGIÁRIO(A)', 'ESTAGIÁRIO(A)');
    }

    // ── Rodapé ────────────────────────────────────────────────────────────────
    var ftr = doc.addFooter();
    var fP  = ftr.appendParagraph(
      'SGE · IFRS Campus Rio Grande · Aditamento emitido em ' +
      _formatarDataBr_(new Date()) + ' · Estágio: ' + idEstagio
    );
    fP.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    fP.editAsText().setFontFamily('Arial').setFontSize(7).setItalic(true);

    doc.saveAndClose();

    var nomePdf  = 'ADENDO_' + idEstagio + '_v0_original.pdf';
    var pdfBlob  = DriveApp.getFileById(docId).getAs(MimeType.PDF).setName(nomePdf);
    var arquivo  = DriveApp.getFolderById(pastaId).createFile(pdfBlob);

    var docFile = DriveApp.getFileById(docId);
    try { DriveApp.getFolderById(pastaId).addFile(docFile); DriveApp.getRootFolder().removeFile(docFile); } catch (_) {}

    return arquivo;
  } catch (e) {
    logErro_('_gerarPdfAdendoInicial_', e);
    if (docId) { try { DriveApp.getFileById(docId).setTrashed(true); } catch (_) {} }
    throw e;
  }
}

// ── Planilha "Fluxo Adendos" ──────────────────────────────────────────────────

function _atualizarFluxoAdendoNaPlanilha_(idEstagio, idAdendo, fluxo) {
  try {
    var ss    = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName(ADENDO_ASS_SHEET);
    if (!sheet) {
      sheet = ss.insertSheet(ADENDO_ASS_SHEET);
      var hdr = ['ID Estágio', 'ID Adendo', 'Status Geral', 'Etapa Atual', 'Pasta Drive'];
      for (var n = 1; n <= 5; n++) hdr.push('Status Et.' + n, 'Data Et.' + n, 'Drive Et.' + n);
      hdr.push('Criação', 'Conclusão');
      sheet.appendRow(hdr);
    }

    var linha = [idEstagio, idAdendo, fluxo.statusGeral, fluxo.etapaAtual, fluxo.drivePastaId || ''];
    fluxo.etapas.forEach(function(et) { linha.push(et.status, et.data || '', et.driveUrl || ''); });
    linha.push(fluxo.timestampCriacao, fluxo.timestampConclusao || '');

    var dados  = sheet.getDataRange().getValues();
    var rowIdx = -1;
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][0]) === idEstagio && String(dados[i][1]) === idAdendo) { rowIdx = i + 1; break; }
    }
    if (rowIdx > 0) {
      sheet.getRange(rowIdx, 1, 1, linha.length).setValues([linha]);
    } else {
      sheet.appendRow(linha);
    }
  } catch (e) {
    logErro_('_atualizarFluxoAdendoNaPlanilha_', e);
  }
}

// ── Atualizar status final do adendo na aba Adendos ───────────────────────────

function _concluirAdendo_(idEstagio, idAdendo) {
  try {
    var ss    = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName('Adendos');
    if (!sheet) return;
    var dados  = sheet.getDataRange().getValues();
    var header = dados[0] || [];
    var colId = -1, colStatus = -1;
    for (var h = 0; h < header.length; h++) {
      var hn = String(header[h]).trim();
      if (hn === 'ID Adendo') colId     = h;
      if (hn === 'Status')    colStatus = h;
    }
    if (colId < 0 || colStatus < 0) return;
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][colId] || '').trim() === idAdendo) {
        sheet.getRange(i + 1, colStatus + 1).setValue('Assinado');
        return;
      }
    }
  } catch (e) {
    logErro_('_concluirAdendo_', e);
  }
}

// ── Resolução de e-mail por ator ──────────────────────────────────────────────

function _resolverEmailAtorAdendo_(ator, sol, dadosAdendo) {
  switch (ator) {
    case 'estudante':      return sol.emailEstudante || (dadosAdendo && dadosAdendo.emailEstudante) || '';
    case 'empresa':        return _obterEmailRepEmpresa_(sol.cnpjEmpresa, sol.emailEmpresa);
    case 'centralRevisao': return 'estagios@riogrande.ifrs.edu.br';
    case 'direcao':        return _obterEmailDirecao_() || '';
    case 'centralFinal':   return 'estagios@riogrande.ifrs.edu.br';
    default:               return '';
  }
}

// ── Notificações ──────────────────────────────────────────────────────────────

function notificarAtorAdendo_(idEstagio, idAdendo, etapa, sol, fluxo) {
  if (!etapa) return;
  if (!etapa.email) {
    logErro_('notificarAtorAdendo_', new Error('E-mail vazio para ator "' + (etapa.ator || '?') + '" — estágio ' + idEstagio));
    return;
  }

  var pageUrl = BASE_URL + '/assinaturas/adendo.html'
              + '?id='     + encodeURIComponent(idEstagio)
              + '&adendo=' + encodeURIComponent(idAdendo)
              + '&token='  + encodeURIComponent(etapa.token || '');

  var motivoRejeicao = null;
  if (fluxo && fluxo.historicoRejeicoes && fluxo.historicoRejeicoes.length) {
    var rejeicoes = fluxo.historicoRejeicoes.filter(function(r) { return r.retornoParaEtapa === etapa.numero; });
    if (rejeicoes.length) motivoRejeicao = rejeicoes[rejeicoes.length - 1].motivo || null;
  }

  var dadosEmail = {
    idEstagio:       idEstagio,
    nomeEstudante:   sol.nomeEstudante || '',
    tipoAdendo:      (fluxo.dadosAdendo && fluxo.dadosAdendo.tipoAlteracao) || '',
    labelAtor:       etapa.label,
    prazoVencimento: etapa.prazoVencimento || '',
    email:           etapa.email,
    pageUrl:         pageUrl,
    numeroEtapa:     etapa.numero,
    motivoRejeicao:  motivoRejeicao,
  };

  if (etapa.tipo === 'govbr') {
    MAIL.enviarEmailAssinaturaAdendoGovBr(dadosEmail);
  } else {
    MAIL.enviarEmailAssinaturaAdendoInterno(dadosEmail);
  }
}

function enviarPdfFinalAdendoParaTodos_(idEstagio, idAdendo, fluxo, driveUrl) {
  var sol = _obterDadosSolicitacaoCompleto_(idEstagio);
  var destinatarios = [
    { email: sol.emailEstudante,                                            nome: sol.nomeEstudante || 'Estudante'    },
    { email: _obterEmailRepEmpresa_(sol.cnpjEmpresa, sol.emailEmpresa),     nome: sol.nomeEmpresa   || 'Empresa'      },
    { email: 'estagios@riogrande.ifrs.edu.br',                             nome: 'Setor de Estágios'                  },
  ].filter(function(d) { return !!(d.email && String(d.email).indexOf('@') > 0); });

  var tokenPorAtor = {};
  if (fluxo && fluxo.etapas) {
    fluxo.etapas.forEach(function(et) { if (et.ator && et.token) tokenPorAtor[et.ator] = et.token; });
  }

  MAIL.enviarEmailPdfFinalAdendo({
    idEstagio:     idEstagio,
    idAdendo:      idAdendo,
    nomeEstudante: sol.nomeEstudante || '',
    tipoAdendo:    (fluxo.dadosAdendo && fluxo.dadosAdendo.tipoAlteracao) || '',
    tokenPorAtor:  tokenPorAtor,
    destinatarios: destinatarios,
  });
}

// ── Upload de PDF assinado ────────────────────────────────────────────────────

function uploadPdfAdendoAssinado_(idEstagio, idAdendo, numeroEtapa, pdfBase64, token) {
  if (!idEstagio || !idAdendo || !numeroEtapa || !pdfBase64) {
    return jsonError_('Parâmetros obrigatórios: idEstagio, idAdendo, numeroEtapa, pdfBase64.', 'MISSING_PARAM');
  }

  var fluxo = obterFluxoAdendo_(idEstagio, idAdendo);
  if (!fluxo) return jsonError_('Fluxo de adendo não encontrado.', 'NOT_FOUND');

  var etapaDoToken = _validarTokenAdendo_(fluxo, token);
  if (!etapaDoToken) return jsonError_('Token inválido ou não autorizado.', 'AUTH_ERROR');

  var etapa = fluxo.etapas[numeroEtapa - 1];
  if (!etapa)                                return jsonError_('Etapa inválida: ' + numeroEtapa, 'INVALID');
  if (etapa.numero !== etapaDoToken.numero)  return jsonError_('Token não corresponde a esta etapa.', 'AUTH_ERROR');
  if (etapa.status !== ASS_STATUS.AGUARDANDO) return jsonError_('Etapa não está aguardando ação.', 'INVALID_STATE');

  try {
    var pdfBytes = Utilities.base64Decode(pdfBase64);
    var nomePdf  = 'ADENDO_' + idEstagio + '_v' + numeroEtapa + '_' + etapa.ator + '.pdf';
    var blob     = Utilities.newBlob(pdfBytes, MimeType.PDF, nomePdf);
    var pasta    = DriveApp.getFolderById(fluxo.drivePastaId);
    var arquivo  = pasta.createFile(blob);
    return concluirEtapaAdendo_(idEstagio, idAdendo, numeroEtapa, arquivo.getUrl(), etapa.email || token);
  } catch (e) {
    logErro_('uploadPdfAdendoAssinado_', e);
    return jsonError_('Falha ao salvar PDF no Drive: ' + e.message, 'DRIVE_ERROR');
  }
}

// ── Validação de token ────────────────────────────────────────────────────────

function _validarTokenAdendo_(fluxo, token) {
  if (!token || !fluxo || !fluxo.etapas) return null;
  for (var i = 0; i < fluxo.etapas.length; i++) {
    if (fluxo.etapas[i].token === token) return fluxo.etapas[i];
  }
  return null;
}

// ── Handlers GET / POST ───────────────────────────────────────────────────────

function doGetAdendo(e) {
  var action   = (e.parameter && e.parameter.action) || '';
  var id       = (e.parameter && e.parameter.id)     || '';
  var idAdendo = (e.parameter && e.parameter.adendo) || '';

  switch (action) {

    case 'obterFluxoAdendo': {
      if (!id || !idAdendo) return jsonError_('Parâmetros id e adendo são obrigatórios.', 'MISSING_PARAM');
      var fluxo = obterFluxoAdendo_(id, idAdendo);
      if (!fluxo) return jsonError_('Fluxo de adendo não encontrado.', 'NOT_FOUND');

      var token   = (e.parameter && e.parameter.token) || '';
      var meuAtor = null;
      if (token) {
        var etapaToken = _validarTokenAdendo_(fluxo, token);
        if (!etapaToken) return jsonError_('Token inválido.', 'AUTH_ERROR');
        meuAtor = etapaToken.ator;
      }

      // Sanitiza — nunca expõe tokens nem driveUrls
      var fluxoPublico = JSON.parse(JSON.stringify(fluxo));
      fluxoPublico.etapas = fluxoPublico.etapas.map(function(et) {
        return {
          numero:          et.numero,
          ator:            et.ator,
          label:           et.label,
          tipo:            et.tipo,
          email:           et.email,
          status:          et.status,
          prazoVencimento: et.prazoVencimento,
          data:            et.data,
          versao:          et.versao,
          obs:             et.obs,
          temPdf:          !!(et.driveUrl),
        };
      });
      delete fluxoPublico.pdfOriginalUrl;
      fluxoPublico.temPdfOriginal = !!(fluxo.pdfOriginalUrl);
      if (meuAtor) fluxoPublico._meuAtor = meuAtor;

      try {
        var solInfo = _obterDadosSolicitacaoCompleto_(id);
        fluxoPublico._infoSolicitacao = {
          nomeEstudante: solInfo.nomeEstudante || '',
          nomeEmpresa:   solInfo.nomeEmpresa   || '',
          curso:         solInfo.curso         || '',
          dataInicio:    solInfo.dataInicio    || '',
          dataTermino:   solInfo.dataTermino   || '',
        };
      } catch (_) {}

      return jsonOk_(fluxoPublico);
    }

    case 'obterFluxoAdendoAdmin': {
      var authTk = (e.parameter && e.parameter.authToken) || '';
      try { validarTokenAdmin_(authTk); } catch(eA) { return jsonError_('Não autorizado: ' + eA.message, 'AUTH_ERROR'); }
      if (!id || !idAdendo) return jsonError_('Parâmetros id e adendo são obrigatórios.', 'MISSING_PARAM');
      var fluxoAdm = obterFluxoAdendo_(id, idAdendo);
      if (!fluxoAdm) return jsonError_('Fluxo não encontrado.', 'NOT_FOUND');
      var pub = JSON.parse(JSON.stringify(fluxoAdm));
      pub.etapas = pub.etapas.map(function(et) {
        return { numero: et.numero, ator: et.ator, label: et.label, tipo: et.tipo,
                 status: et.status, prazoVencimento: et.prazoVencimento,
                 data: et.data, versao: et.versao, obs: et.obs, driveUrl: et.driveUrl || null };
      });
      return jsonOk_(pub);
    }

    case 'baixarPdfAdendo': {
      if (!id || !idAdendo) return jsonError_('Parâmetros id e adendo são obrigatórios.', 'MISSING_PARAM');
      var token    = (e.parameter && e.parameter.token)     || '';
      var authTkDl = (e.parameter && e.parameter.authToken) || '';
      var fluxoDl  = obterFluxoAdendo_(id, idAdendo);
      if (!fluxoDl) return jsonError_('Fluxo não encontrado.', 'NOT_FOUND');

      var fileIdDl   = null;
      var etapaParam = e.parameter && e.parameter.etapa ? parseInt(e.parameter.etapa, 10) : 0;

      if (authTkDl) {
        try { validarTokenAdmin_(authTkDl); } catch(eAdm) { return jsonError_('Não autorizado.', 'AUTH_ERROR'); }
        if (etapaParam > 0 && etapaParam <= fluxoDl.etapas.length) {
          var etAdm = fluxoDl.etapas[etapaParam - 1];
          if (etAdm && etAdm.driveUrl) fileIdDl = _extrairFileIdDoUrl_(etAdm.driveUrl);
        } else {
          for (var ka = fluxoDl.etapas.length - 1; ka >= 0; ka--) {
            if (fluxoDl.etapas[ka].driveUrl) { fileIdDl = _extrairFileIdDoUrl_(fluxoDl.etapas[ka].driveUrl); break; }
          }
        }
        if (!fileIdDl) fileIdDl = _extrairFileIdDoUrl_(fluxoDl.pdfOriginalUrl);
      } else {
        if (!token) return jsonError_('Parâmetro token obrigatório.', 'MISSING_PARAM');
        var etapaDoToken = _validarTokenAdendo_(fluxoDl, token);
        if (!etapaDoToken) return jsonError_('Token inválido.', 'AUTH_ERROR');
        for (var j = etapaDoToken.numero - 2; j >= 0; j--) {
          var etJ = fluxoDl.etapas[j];
          if (etJ && etJ.driveUrl) { fileIdDl = _extrairFileIdDoUrl_(etJ.driveUrl); break; }
        }
        if (!fileIdDl) fileIdDl = _extrairFileIdDoUrl_(fluxoDl.pdfOriginalUrl);
      }

      if (!fileIdDl) return jsonError_('Nenhum PDF disponível para esta etapa.', 'NOT_FOUND');

      try {
        var fileDl  = DriveApp.getFileById(fileIdDl);
        var bytesDl = fileDl.getBlob().getBytes();
        return jsonOk_({ base64: Utilities.base64Encode(bytesDl), nome: fileDl.getName() });
      } catch (errDrive) {
        logErro_('baixarPdfAdendo', errDrive);
        return jsonError_('Erro ao acessar arquivo: ' + errDrive.message, 'DRIVE_ERROR');
      }
    }

    default:
      return jsonError_('Ação GET desconhecida: ' + action, 'UNKNOWN_ACTION');
  }
}

function doPostAdendo(e) {
  var body      = e._body    || {};
  var action    = body.action    || '';
  var idEstagio = body.idEstagio || '';
  var idAdendo  = body.idAdendo  || '';

  switch (action) {

    case 'uploadPdfAdendoAssinado':
      return uploadPdfAdendoAssinado_(idEstagio, idAdendo, body.numeroEtapa, body.pdfBase64, body.token);

    case 'concluirEtapaAdendo': {
      var fluxoCon = obterFluxoAdendo_(idEstagio, idAdendo);
      if (!fluxoCon) return jsonError_('Fluxo não encontrado.', 'NOT_FOUND');
      var etaTk = _validarTokenAdendo_(fluxoCon, body.token);
      if (!etaTk) return jsonError_('Token inválido.', 'AUTH_ERROR');
      return concluirEtapaAdendo_(idEstagio, idAdendo, body.numeroEtapa, body.driveUrl || null, etaTk.email || body.token);
    }

    case 'rejeitarEtapaAdendo': {
      var fluxoRej = obterFluxoAdendo_(idEstagio, idAdendo);
      if (!fluxoRej) return jsonError_('Fluxo não encontrado.', 'NOT_FOUND');
      var etaRej = _validarTokenAdendo_(fluxoRej, body.token);
      if (!etaRej) return jsonError_('Token inválido.', 'AUTH_ERROR');
      return rejeitarEtapaAdendo_(idEstagio, idAdendo, body.numeroEtapa, body.motivo, body.retornoParaEtapa, etaRej.email || body.token);
    }

    case 'reenviarNotificacaoAdendo': {
      try { validarTokenAdmin_(body.authToken); } catch(eAuth) { return jsonError_('Não autorizado.', 'AUTH_ERROR'); }
      if (!idEstagio || !idAdendo) return jsonError_('Parâmetros idEstagio e idAdendo obrigatórios.', 'MISSING_PARAM');
      var fluxoRenv = obterFluxoAdendo_(idEstagio, idAdendo);
      if (!fluxoRenv) return jsonError_('Fluxo não encontrado.', 'NOT_FOUND');
      var etaAtiva = null;
      for (var k = 0; k < fluxoRenv.etapas.length; k++) {
        if (fluxoRenv.etapas[k].status === ASS_STATUS.AGUARDANDO) { etaAtiva = fluxoRenv.etapas[k]; break; }
      }
      if (!etaAtiva) return jsonError_('Nenhuma etapa aguardando ação.', 'INVALID_STATE');
      var solRenv = _obterDadosSolicitacaoCompleto_(idEstagio);
      if (!etaAtiva.email) {
        etaAtiva.email = _resolverEmailAtorAdendo_(etaAtiva.ator, solRenv, fluxoRenv.dadosAdendo);
        if (!etaAtiva.email) return jsonError_('E-mail do ator "' + etaAtiva.label + '" não encontrado.', 'EMAIL_NOT_FOUND');
        salvarFluxoAdendo_(idEstagio, idAdendo, fluxoRenv);
      }
      try {
        notificarAtorAdendo_(idEstagio, idAdendo, etaAtiva, solRenv, fluxoRenv);
      } catch (e) {
        return jsonError_('Erro ao reenviar notificação: ' + e.message, 'SEND_ERROR');
      }
      return jsonOk_({ reenviado: true, etapa: etaAtiva.numero, label: etaAtiva.label, email: etaAtiva.email });
    }

    default:
      return jsonError_('Ação POST desconhecida: ' + action, 'UNKNOWN_ACTION');
  }
}
