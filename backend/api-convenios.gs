/**
 * api-convenios.gs — Fluxo de Convênio de Estágio
 * SGE — Sistema de Gestão de Estágios · IFRS Campus Rio Grande
 *
 * Fluxo waterfall (sequencial, uma etapa por vez):
 *   1. Empresa (Concedente)      → gov.br  (baixa, assina, envia PDF)
 *   2. Central (revisão)         → interno
 *   3. Direção-Geral             → gov.br
 *   4. Central (aprovação final) → interno (marca convênio como Aprovado)
 *
 * Numeração: XXX/AAAA (ex: 001/2026), sequencial por ano.
 * ID interno: 001-2026 (usado em URLs e chaves do PropertiesService)
 *
 * Armazenamento:
 *   PropertiesService  →  "convenioAss_[idConvenio]"
 *   Sheet "Convenios"  →  registro do convênio por empresa
 *   Sheet "Fluxo Convenios" → histórico de etapas
 *   Google Drive       →  PDFs em Cadastros/Convenios/[idConvenio]/
 */

'use strict';

var CONVENIO_SHEET   = 'Convenios';
var CONV_ASS_SHEET   = 'Fluxo Convenios';
var CONV_BASE_URL    = 'https://ifrs-riogrande.github.io/estagios';
var CONV_SETOR_EMAIL = 'estagios@riogrande.ifrs.edu.br';

var ETAPAS_DEF_CONVENIO = [
  { numero: 1, ator: 'empresa',        label: 'Concedente',                       tipo: 'govbr'   },
  { numero: 2, ator: 'centralRevisao', label: 'Central de Estágios (revisão)',    tipo: 'interno' },
  { numero: 3, ator: 'direcao',        label: 'Direção-Geral',                    tipo: 'govbr'   },
  { numero: 4, ator: 'centralFinal',   label: 'Central de Estágios (aprovação)',  tipo: 'interno' },
];

// Colunas da aba "Convenios" (0-based)
var CONV_COL = {
  ID: 0, NUMERO: 1, ANO: 2, CNPJ: 3, RAZAO_SOCIAL: 4, MUNICIPIO: 5,
  NOME_REP: 6, CARGO_REP: 7, EMAIL_REP: 8, CPF_REP: 9,
  NOME_DG: 10, CPF_DG: 11, STATUS: 12, DRIVE_PASTA: 13,
  PDF_ORIGINAL: 14, TS_CRIACAO: 15, TS_CONCLUSAO: 16,
};

// ── Aba "Convenios" ───────────────────────────────────────────────────────────

function _getConvenioSheet_() {
  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var sheet = ss.getSheetByName(CONVENIO_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(CONVENIO_SHEET);
    sheet.appendRow([
      'id','numero','ano','cnpj','razaoSocial','municipio',
      'nomeRep','cargoRep','emailRep','cpfRep',
      'nomeDG','cpfDG','status','drivePastaId','pdfOriginalUrl',
      'timestampCriacao','timestampConclusao',
    ]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ── Numeração sequencial por ano ──────────────────────────────────────────────

function _proxNumeroConvenio_(ano) {
  var sheet = _getConvenioSheet_();
  var dados = sheet.getDataRange().getValues();
  var max   = 0;
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][CONV_COL.ANO]) === String(ano)) {
      var n = parseInt(dados[i][CONV_COL.NUMERO], 10);
      if (!isNaN(n) && n > max) max = n;
    }
  }
  return max + 1;
}

// ── Obter empresa por CNPJ ────────────────────────────────────────────────────

function _obterEmpresaPorCnpjConv_(cnpj) {
  var cnpjLimpo = String(cnpj || '').replace(/\D/g, '');
  var sheet     = SpreadsheetApp.openById(CFG_ADMIN.SS_ID).getSheetByName(CFG_ADMIN.ABA_EMPRESAS);
  if (!sheet) return null;
  var dados = sheet.getDataRange().getValues();
  // COL_EMP: 3=RazaoSocial,4=NomeFantasia,5=CNPJ,9=Municipio,10=UF,15=NomeRep,16=CargoRep,17=EmailRep,18=CpfRep,19=Status
  for (var i = 1; i < dados.length; i++) {
    var r = dados[i];
    if (String(r[5] || '').replace(/\D/g, '') === cnpjLimpo) {
      return {
        razaoSocial: String(r[3]  || ''),
        cnpj:        String(r[5]  || ''),
        municipio:   String(r[9]  || ''),
        uf:          String(r[10] || ''),
        nomeRep:     String(r[15] || ''),
        cargoRep:    String(r[16] || ''),
        emailRep:    String(r[17] || ''),
        cpfRep:      String(r[18] || ''),
        status:      String(r[19] || ''),
      };
    }
  }
  return null;
}

// ── Obter dados do Diretor Geral ──────────────────────────────────────────────

function _obterDadosDGConv_() {
  try {
    var sheet = SpreadsheetApp.openById(CFG_ADMIN.SS_ID).getSheetByName('Diretor Geral');
    if (!sheet) return { nome: '', cpf: '', email: '' };
    var dados = sheet.getDataRange().getValues();
    // Cabeçalho: Nome | SIAPE | CPF | E-mail | Status
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][4]).toLowerCase() === 'ativo') {
        return {
          nome:  String(dados[i][0] || ''),
          cpf:   String(dados[i][2] || ''),
          email: String(dados[i][3] || ''),
        };
      }
    }
    return { nome: '', cpf: '', email: '' };
  } catch (e) {
    return { nome: '', cpf: '', email: '' };
  }
}

// ── Pasta Drive para os PDFs ──────────────────────────────────────────────────

function _criarPastaConvenio_(idConvenio) {
  var raiz    = DriveApp.getFolderById(CFG_DRIVE.CADASTROS_ID);
  var pastaC  = DRIVE.obterOuCriarPasta(raiz, 'Convenios');
  return DRIVE.obterOuCriarPasta(pastaC, idConvenio);
}

// ── Geração do PDF inicial ────────────────────────────────────────────────────

function _gerarPdfConvenioInicial_(idConvenio, empresa, dg, pastaId) {
  var docId = null;
  try {
    var nomeDoc = 'CONV_' + idConvenio + '_v0_original';
    var doc     = DocumentApp.create(nomeDoc);
    docId       = doc.getId();
    var body    = doc.getBody();
    body.clear();
    body.setMarginTop(56).setMarginBottom(56).setMarginLeft(72).setMarginRight(72);

    function kv(lbl, val) {
      var v    = (val !== undefined && val !== null && String(val).trim()) ? String(val) : '—';
      var full = lbl + ': ' + v;
      var p    = body.appendParagraph(full);
      p.setSpacingBefore(1).setSpacingAfter(1);
      var t    = p.editAsText();
      t.setFontFamily('Arial').setFontSize(10);
      t.setBold(0, lbl.length, true);
      if (full.length - 1 > lbl.length + 2) t.setBold(lbl.length + 2, full.length - 1, false);
      return p;
    }

    function txt(texto, opts) {
      opts = opts || {};
      var p = body.appendParagraph(texto || '');
      p.setSpacingBefore(opts.before !== undefined ? opts.before : 2);
      p.setSpacingAfter(opts.after   !== undefined ? opts.after  : 2);
      if (opts.center) p.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
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
      txt('_______________________________________', { before: 0, after: 0, center: true });
      txt(nome  || '—', { before: 0, after: 0, bold: true, center: true });
      txt(papel || '',  { before: 0, after: 2, center: true });
    }

    // Cabeçalho institucional
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

    var numLegivel = idConvenio.replace('-', '/');
    var pTitulo = body.appendParagraph('CONVÊNIO DE ESTÁGIO Nº ' + numLegivel);
    pTitulo.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    pTitulo.setSpacingBefore(4).setSpacingAfter(8);
    pTitulo.editAsText().setFontFamily('Arial').setFontSize(13).setBold(true);

    txt(
      'O INSTITUTO FEDERAL DE EDUCAÇÃO, CIÊNCIA E TECNOLOGIA DO RIO GRANDE DO SUL – IFRS, ' +
      'Campus Rio Grande, CNPJ nº 10.637.926/0005-70, doravante denominado IFRS, ' +
      'e a empresa ' + empresa.razaoSocial + ', CNPJ nº ' + _formatarCnpj_(empresa.cnpj.replace(/\D/g, '')) + ', ' +
      'com sede em ' + empresa.municipio + (empresa.uf ? '/' + empresa.uf : '') + ', doravante denominada CONCEDENTE, ' +
      'celebram o presente Convênio de Estágio, nos termos da Lei nº 11.788/2008 e demais normas aplicáveis:',
      { before: 0, after: 10 }
    );

    sec('DADOS DAS PARTES');

    txt('INSTITUIÇÃO DE ENSINO:', { bold: true, before: 6, after: 2 });
    kv('Razão Social',     'Instituto Federal de Educação, Ciência e Tecnologia do Rio Grande do Sul – IFRS');
    kv('CNPJ',             '10.637.926/0005-70');
    kv('Campus',           'Rio Grande');
    kv('Coordenador Adm.', 'Carlos Fernandes Junior');
    kv('Diretor-Geral',    dg.nome || '—');
    kv('CPF do Diretor',   _formatarCpf_(dg.cpf) || '—');

    txt('CONCEDENTE:', { bold: true, before: 8, after: 2 });
    kv('Razão Social',         empresa.razaoSocial);
    kv('CNPJ',                 _formatarCnpj_(empresa.cnpj.replace(/\D/g, '')));
    kv('Município/UF',         empresa.municipio + (empresa.uf ? '/' + empresa.uf : ''));
    kv('Representante Legal',  empresa.nomeRep  || '—');
    kv('Cargo',                empresa.cargoRep || '—');
    kv('CPF do Representante', _formatarCpf_(empresa.cpfRep) || '—');

    sec('OBJETO');
    txt(
      'O presente Convênio tem por objeto estabelecer as condições para a realização de Estágios ' +
      'de estudantes regularmente matriculados no IFRS Campus Rio Grande junto à CONCEDENTE, ' +
      'conforme o Plano de Atividades de Estágio a ser definido individualmente para cada estagiário.',
      { before: 0, after: 6 }
    );

    sec('OBRIGAÇÕES DAS PARTES');
    txt('São obrigações do IFRS:', { bold: true, before: 4, after: 2 });
    txt(
      'I. Indicar supervisor de estágio pertencente ao seu quadro de pessoal;\n' +
      'II. Acompanhar o desenvolvimento das atividades do estagiário;\n' +
      'III. Zelar pelo cumprimento deste Convênio.',
      { before: 0, after: 6 }
    );
    txt('São obrigações da CONCEDENTE:', { bold: true, before: 4, after: 2 });
    txt(
      'I. Ofertar instalações adequadas para o desenvolvimento das atividades;\n' +
      'II. Indicar funcionário de seu quadro para supervisionar o estagiário;\n' +
      'III. Contratar seguro contra acidentes pessoais em favor do estagiário;\n' +
      'IV. Preencher, assinar e entregar o Termo de Compromisso de Estágio conforme formulário próprio do IFRS.',
      { before: 0, after: 6 }
    );

    sec('VIGÊNCIA');
    txt(
      'O presente Convênio entra em vigor na data de sua assinatura e vigorará por prazo indeterminado, ' +
      'podendo ser rescindido por qualquer das partes mediante notificação prévia de 30 (trinta) dias.',
      { before: 0, after: 6 }
    );

    sec('FORO');
    txt(
      'Fica eleito o foro da Comarca de Bento Gonçalves/RS para dirimir quaisquer litígios ' +
      'decorrentes do presente instrumento.',
      { before: 0, after: 8 }
    );

    var _hoje    = new Date();
    var _mesesPt = ['janeiro','fevereiro','março','abril','maio','junho',
                    'julho','agosto','setembro','outubro','novembro','dezembro'];
    var _dia  = parseInt(Utilities.formatDate(_hoje, 'America/Sao_Paulo', 'd'), 10);
    var _mes  = parseInt(Utilities.formatDate(_hoje, 'America/Sao_Paulo', 'M'), 10) - 1;
    var _ano  = Utilities.formatDate(_hoje, 'America/Sao_Paulo', 'yyyy');
    txt('Rio Grande, ' + _dia + ' de ' + _mesesPt[_mes] + ' de ' + _ano + '.', { before: 4, after: 20 });

    assin(empresa.nomeRep || 'Representante Legal', 'CONCEDENTE — ' + empresa.razaoSocial.toUpperCase());
    assin(dg.nome || 'DIRETOR-GERAL DO IFRS', 'DIRETOR-GERAL DO IFRS – CAMPUS RIO GRANDE');

    var ftr = doc.addFooter();
    var fP  = ftr.appendParagraph(
      'SGE · IFRS Campus Rio Grande · Convênio Nº ' + numLegivel + ' · Emitido em ' + _formatarDataBr_(new Date())
    );
    fP.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    fP.editAsText().setFontFamily('Arial').setFontSize(7).setItalic(true);

    doc.saveAndClose();

    var nomePdf = 'CONV_' + idConvenio + '_v0_original.pdf';
    var pdfBlob = DriveApp.getFileById(docId).getAs(MimeType.PDF).setName(nomePdf);
    var arquivo = DriveApp.getFolderById(pastaId).createFile(pdfBlob);

    var docFile = DriveApp.getFileById(docId);
    try { DriveApp.getFolderById(pastaId).addFile(docFile); DriveApp.getRootFolder().removeFile(docFile); } catch (_) {}

    return arquivo;
  } catch (e) {
    logErro_('_gerarPdfConvenioInicial_', e);
    if (docId) { try { DriveApp.getFileById(docId).setTrashed(true); } catch (_) {} }
    throw e;
  }
}

// ── Iniciar fluxo ─────────────────────────────────────────────────────────────

function iniciarFluxoConvenio_(cnpj) {
  var empresa = _obterEmpresaPorCnpjConv_(cnpj);
  if (!empresa)                    throw new Error('Empresa não encontrada (CNPJ: ' + cnpj + ').');
  if (empresa.status !== 'Validada') throw new Error('Apenas empresas Validadas podem gerar convênio.');
  if (!empresa.emailRep)             throw new Error('Empresa não possui e-mail do representante cadastrado.');

  var dg  = _obterDadosDGConv_();
  var ano = new Date().getFullYear();
  var num = _proxNumeroConvenio_(ano);
  var idConvenio = String(num).padStart(3, '0') + '-' + String(ano);
  var numLegivel = String(num).padStart(3, '0') + '/' + String(ano);

  var pasta   = _criarPastaConvenio_(idConvenio);
  var pastaId = pasta.getId();

  var pdfInicial = null;
  try {
    pdfInicial = _gerarPdfConvenioInicial_(idConvenio, empresa, dg, pastaId);
  } catch (ePdf) {
    logErro_('iniciarFluxoConvenio_.gerarPdf', ePdf);
  }

  var etapas = ETAPAS_DEF_CONVENIO.map(function(def, idx) {
    var emailAtor = '';
    if      (def.ator === 'empresa')      emailAtor = empresa.emailRep;
    else if (def.ator === 'direcao')      emailAtor = dg.email || '';
    else                                  emailAtor = CONV_SETOR_EMAIL;

    return {
      numero:            def.numero,
      ator:              def.ator,
      label:             def.label,
      tipo:              def.tipo,
      email:             emailAtor,
      token:             Utilities.getUuid(),
      status:            idx === 0 ? ASS_STATUS.AGUARDANDO : ASS_STATUS.PENDENTE,
      prazoVencimento:   idx === 0 ? _calcPrazoConv_(10) : null,
      lembretesEnviados: 0,
      data:              null,
      driveUrl:          null,
      versao:            null,
      obs:               null,
    };
  });

  var fluxo = {
    idConvenio:         idConvenio,
    numero:             numLegivel,
    cnpj:               empresa.cnpj,
    razaoSocial:        empresa.razaoSocial,
    municipio:          empresa.municipio,
    nomeRep:            empresa.nomeRep,
    cargoRep:           empresa.cargoRep,
    emailRep:           empresa.emailRep,
    cpfRep:             empresa.cpfRep,
    nomeDG:             dg.nome  || '',
    cpfDG:              dg.cpf   || '',
    statusGeral:        'em_andamento',
    etapaAtual:         1,
    drivePastaId:       pastaId,
    pdfOriginalUrl:     pdfInicial ? pdfInicial.getUrl() : null,
    timestampCriacao:   new Date().toISOString(),
    timestampConclusao: null,
    etapas:             etapas,
    historicoRejeicoes: [],
  };

  _salvarFluxoConvenio_(idConvenio, fluxo);
  _registrarConvenioNaPlanilha_(idConvenio, empresa, dg, num, ano, pastaId, pdfInicial);
  _atualizarFluxoConvenioNaPlanilha_(idConvenio, fluxo);

  try { _notificarAtorConvenio_(idConvenio, etapas[0], fluxo); }
  catch (e) { logErro_('iniciarFluxoConvenio_.notificar', e); }

  return { idConvenio: idConvenio, numero: numLegivel };
}

// ── Avançar etapa ─────────────────────────────────────────────────────────────

function concluirEtapaConvenio_(idConvenio, numeroEtapa, driveUrl, emailAtor) {
  var fluxo = _obterFluxoConvenio_(idConvenio);
  if (!fluxo) return jsonError_('Fluxo não encontrado.', 'NOT_FOUND');

  var idx   = numeroEtapa - 1;
  var etapa = fluxo.etapas[idx];
  if (!etapa)                                 return jsonError_('Etapa inválida: ' + numeroEtapa, 'INVALID');
  if (etapa.status !== ASS_STATUS.AGUARDANDO) return jsonError_('Etapa não está aguardando ação.', 'INVALID_STATE');

  etapa.status    = ASS_STATUS.CONCLUIDO;
  etapa.data      = new Date().toISOString();
  etapa.driveUrl  = driveUrl || null;
  etapa.versao    = 'v' + numeroEtapa + '_' + etapa.ator;
  etapa.emailAtor = emailAtor;

  if (numeroEtapa === 4) {
    fluxo.statusGeral        = 'concluido';
    fluxo.timestampConclusao = new Date().toISOString();
    _marcarConvenioAprovado_(idConvenio);
    try { _enviarEmailConvenioAprovado_(idConvenio, fluxo); } catch (e) { logErro_('_enviarEmailConvenioAprovado_', e); }
  } else {
    var proxEtapa              = fluxo.etapas[idx + 1];
    proxEtapa.status           = ASS_STATUS.AGUARDANDO;
    proxEtapa.prazoVencimento  = _calcPrazoConv_(proxEtapa.tipo === 'govbr' ? 10 : 5);
    fluxo.etapaAtual           = numeroEtapa + 1;
    try { _notificarAtorConvenio_(idConvenio, proxEtapa, fluxo); }
    catch (e) { logErro_('concluirEtapaConvenio_.notificar', e); }
  }

  _salvarFluxoConvenio_(idConvenio, fluxo);
  _atualizarFluxoConvenioNaPlanilha_(idConvenio, fluxo);
  return jsonOk_({ fluxo: _fluxoPublicoConvenio_(fluxo, null) });
}

// ── Rejeição ──────────────────────────────────────────────────────────────────

function rejeitarEtapaConvenio_(idConvenio, numeroEtapa, motivo, retornoParaEtapa, emailAdmin) {
  var fluxo = _obterFluxoConvenio_(idConvenio);
  if (!fluxo) return jsonError_('Fluxo não encontrado.', 'NOT_FOUND');

  var etapa    = fluxo.etapas[numeroEtapa - 1];
  etapa.status = ASS_STATUS.REJEITADO;
  etapa.obs    = String(motivo || '').trim().substring(0, 500);
  etapa.data   = new Date().toISOString();

  fluxo.historicoRejeicoes.push({
    etapa:            numeroEtapa,
    ator:             etapa.ator,
    label:            etapa.label,
    data:             new Date().toISOString(),
    motivo:           String(motivo || '').trim().substring(0, 500),
    retornoParaEtapa: retornoParaEtapa,
    decididoPor:      emailAdmin,
  });

  for (var i = retornoParaEtapa - 1; i < numeroEtapa; i++) {
    var et = fluxo.etapas[i];
    et.data     = null;
    et.driveUrl = null;
    et.versao   = null;
    if (i === retornoParaEtapa - 1) {
      et.status          = ASS_STATUS.AGUARDANDO;
      et.prazoVencimento = _calcPrazoConv_(et.tipo === 'govbr' ? 10 : 5);
    } else {
      et.status          = ASS_STATUS.PENDENTE;
      et.prazoVencimento = null;
    }
  }
  fluxo.etapaAtual = retornoParaEtapa;

  try { _notificarAtorConvenio_(idConvenio, fluxo.etapas[retornoParaEtapa - 1], fluxo); }
  catch (e) { logErro_('rejeitarEtapaConvenio_.notificar', e); }

  _salvarFluxoConvenio_(idConvenio, fluxo);
  _atualizarFluxoConvenioNaPlanilha_(idConvenio, fluxo);
  return jsonOk_({ fluxo: _fluxoPublicoConvenio_(fluxo, null) });
}

// ── Upload PDF ────────────────────────────────────────────────────────────────

function uploadPdfConvenioAssinado_(idConvenio, numeroEtapa, pdfBase64, token) {
  if (!idConvenio || !numeroEtapa || !pdfBase64)
    return jsonError_('Parâmetros obrigatórios: idConvenio, numeroEtapa, pdfBase64.', 'MISSING_PARAM');

  var fluxo = _obterFluxoConvenio_(idConvenio);
  if (!fluxo) return jsonError_('Fluxo não encontrado.', 'NOT_FOUND');

  var etapaDoToken = _validarTokenConvenio_(fluxo, token);
  if (!etapaDoToken)                              return jsonError_('Token inválido.', 'AUTH_ERROR');

  var etapa = fluxo.etapas[numeroEtapa - 1];
  if (!etapa)                                     return jsonError_('Etapa inválida.', 'INVALID');
  if (etapa.numero !== etapaDoToken.numero)        return jsonError_('Token não corresponde a esta etapa.', 'AUTH_ERROR');
  if (etapa.status !== ASS_STATUS.AGUARDANDO)      return jsonError_('Etapa não está aguardando ação.', 'INVALID_STATE');

  try {
    var pdfBytes = Utilities.base64Decode(pdfBase64);
    var nomePdf  = 'CONV_' + idConvenio + '_v' + numeroEtapa + '_' + etapa.ator + '.pdf';
    var blob     = Utilities.newBlob(pdfBytes, MimeType.PDF, nomePdf);
    var pasta    = DriveApp.getFolderById(fluxo.drivePastaId);
    var arquivo  = pasta.createFile(blob);
    return concluirEtapaConvenio_(idConvenio, numeroEtapa, arquivo.getUrl(), etapa.email || '');
  } catch (e) {
    logErro_('uploadPdfConvenioAssinado_', e);
    return jsonError_('Falha ao salvar PDF: ' + e.message, 'DRIVE_ERROR');
  }
}

// ── PropertiesService ─────────────────────────────────────────────────────────

function _obterFluxoConvenio_(idConvenio) {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty('convenioAss_' + idConvenio);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { logErro_('_obterFluxoConvenio_', e); return null; }
}

function _salvarFluxoConvenio_(idConvenio, fluxo) {
  try {
    PropertiesService.getScriptProperties()
      .setProperty('convenioAss_' + idConvenio, JSON.stringify(fluxo));
  } catch (e) { logErro_('_salvarFluxoConvenio_', e); throw e; }
}

function _validarTokenConvenio_(fluxo, token) {
  if (!token || !fluxo || !fluxo.etapas) return null;
  for (var i = 0; i < fluxo.etapas.length; i++) {
    if (fluxo.etapas[i].token === token) return fluxo.etapas[i];
  }
  return null;
}

// ── Planilhas ─────────────────────────────────────────────────────────────────

function _registrarConvenioNaPlanilha_(idConvenio, empresa, dg, numero, ano, pastaId, pdfFile) {
  try {
    var sheet = _getConvenioSheet_();
    var dados = sheet.getDataRange().getValues();
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][CONV_COL.ID]) === idConvenio) return;
    }
    sheet.appendRow([
      idConvenio, numero, ano, empresa.cnpj, empresa.razaoSocial, empresa.municipio,
      empresa.nomeRep, empresa.cargoRep, empresa.emailRep, empresa.cpfRep,
      dg.nome || '', dg.cpf || '',
      'Aguardando empresa',
      pastaId,
      pdfFile ? pdfFile.getUrl() : '',
      new Date().toISOString(), '',
    ]);
  } catch (e) { logErro_('_registrarConvenioNaPlanilha_', e); }
}

function _marcarConvenioAprovado_(idConvenio) {
  try {
    var sheet = _getConvenioSheet_();
    var dados = sheet.getDataRange().getValues();
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][CONV_COL.ID]) === idConvenio) {
        sheet.getRange(i + 1, CONV_COL.STATUS + 1).setValue('Aprovado');
        sheet.getRange(i + 1, CONV_COL.TS_CONCLUSAO + 1).setValue(new Date().toISOString());
        return;
      }
    }
  } catch (e) { logErro_('_marcarConvenioAprovado_', e); }
}

function _atualizarFluxoConvenioNaPlanilha_(idConvenio, fluxo) {
  try {
    var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
    var sheet = ss.getSheetByName(CONV_ASS_SHEET);
    if (!sheet) {
      sheet = ss.insertSheet(CONV_ASS_SHEET);
      var hdr = ['ID Convênio', 'Status Geral', 'Etapa Atual'];
      for (var n = 1; n <= 4; n++) hdr.push('Status Et.' + n, 'Data Et.' + n);
      hdr.push('Criação', 'Conclusão');
      sheet.appendRow(hdr);
    }

    var linha = [idConvenio, fluxo.statusGeral, fluxo.etapaAtual];
    fluxo.etapas.forEach(function(et) { linha.push(et.status, et.data || ''); });
    linha.push(fluxo.timestampCriacao, fluxo.timestampConclusao || '');

    var dados  = sheet.getDataRange().getValues();
    var rowIdx = -1;
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][0]) === idConvenio) { rowIdx = i + 1; break; }
    }
    if (rowIdx > 0) sheet.getRange(rowIdx, 1, 1, linha.length).setValues([linha]);
    else            sheet.appendRow(linha);

    // Atualiza status na aba Convenios
    var shConv  = _getConvenioSheet_();
    var dadosC  = shConv.getDataRange().getValues();
    for (var j = 1; j < dadosC.length; j++) {
      if (String(dadosC[j][CONV_COL.ID]) === idConvenio) {
        shConv.getRange(j + 1, CONV_COL.STATUS + 1).setValue(_statusConvenioLabel_(fluxo));
        break;
      }
    }
  } catch (e) { logErro_('_atualizarFluxoConvenioNaPlanilha_', e); }
}

function _statusConvenioLabel_(fluxo) {
  if (fluxo.statusGeral === 'concluido') return 'Aprovado';
  var labels = { 1: 'Aguardando empresa', 2: 'Em revisão (central)', 3: 'Aguardando DG', 4: 'Em aprovação final' };
  return labels[fluxo.etapaAtual] || 'Em andamento';
}

// ── Fluxo público (sem tokens/urls internas) ──────────────────────────────────

function _fluxoPublicoConvenio_(fluxo, meuAtor) {
  var pub = JSON.parse(JSON.stringify(fluxo));
  pub.etapas = pub.etapas.map(function(et) {
    return {
      numero:          et.numero,
      ator:            et.ator,
      label:           et.label,
      tipo:            et.tipo,
      status:          et.status,
      prazoVencimento: et.prazoVencimento,
      data:            et.data,
      versao:          et.versao,
      obs:             et.obs,
      temPdf:          !!(et.driveUrl),
    };
  });
  delete pub.pdfOriginalUrl;
  pub.temPdfOriginal = !!(fluxo.pdfOriginalUrl);
  if (meuAtor) pub._meuAtor = meuAtor;
  return pub;
}

// ── Listar convênios e empresas com status ────────────────────────────────────

function _listarConvenios_() {
  var sheet = _getConvenioSheet_();
  var dados = sheet.getDataRange().getValues();
  var res   = [];
  for (var i = 1; i < dados.length; i++) {
    var r = dados[i];
    if (!r[CONV_COL.ID]) continue;
    res.push({
      idConvenio:       String(r[CONV_COL.ID]          || ''),
      numero:           String(r[CONV_COL.NUMERO]       || ''),
      cnpj:             String(r[CONV_COL.CNPJ]         || ''),
      razaoSocial:      String(r[CONV_COL.RAZAO_SOCIAL] || ''),
      municipio:        String(r[CONV_COL.MUNICIPIO]    || ''),
      nomeRep:          String(r[CONV_COL.NOME_REP]     || ''),
      status:           String(r[CONV_COL.STATUS]       || ''),
      timestampCriacao: String(r[CONV_COL.TS_CRIACAO]   || ''),
    });
  }
  return res.reverse();
}

function _listarEmpresasComConvenio_() {
  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID);
  var shEmp = ss.getSheetByName(CFG_ADMIN.ABA_EMPRESAS);
  if (!shEmp) return [];

  // Mapa CNPJ → dados do convênio
  var shConv    = _getConvenioSheet_();
  var dadosConv = shConv.getDataRange().getValues();
  var mapaConv  = {};
  for (var c = 1; c < dadosConv.length; c++) {
    var cr = dadosConv[c];
    if (!cr[CONV_COL.CNPJ]) continue;
    var key = String(cr[CONV_COL.CNPJ]).replace(/\D/g, '');
    mapaConv[key] = {
      idConvenio: String(cr[CONV_COL.ID]     || ''),
      numero:     String(cr[CONV_COL.NUMERO] || ''),
      status:     String(cr[CONV_COL.STATUS] || ''),
    };
  }

  var dados  = shEmp.getDataRange().getValues();
  var result = [];
  for (var i = 1; i < dados.length; i++) {
    var r      = dados[i];
    var status = String(r[19] || '');
    if (status !== 'Validada') continue;
    var cnpjKey = String(r[5] || '').replace(/\D/g, '');
    result.push({
      razaoSocial: String(r[3]  || ''),
      cnpj:        String(r[5]  || ''),
      municipio:   String(r[9]  || ''),
      uf:          String(r[10] || ''),
      nomeRep:     String(r[15] || ''),
      emailRep:    String(r[17] || ''),
      convenio:    mapaConv[cnpjKey] || null,
    });
  }
  return result;
}

// ── Notificações por e-mail ───────────────────────────────────────────────────

function _notificarAtorConvenio_(idConvenio, etapa, fluxo) {
  if (!etapa || !etapa.email) {
    logErro_('_notificarAtorConvenio_', new Error('E-mail vazio para "' + (etapa && etapa.ator || '?') + '"'));
    return;
  }

  var pageUrl = CONV_BASE_URL + '/convenios/'
    + '?id='    + encodeURIComponent(idConvenio)
    + '&token=' + encodeURIComponent(etapa.token || '');

  var motivoRejeicao = null;
  if (fluxo.historicoRejeicoes && fluxo.historicoRejeicoes.length) {
    var rejeicoes = fluxo.historicoRejeicoes.filter(function(r) { return r.retornoParaEtapa === etapa.numero; });
    if (rejeicoes.length) motivoRejeicao = rejeicoes[rejeicoes.length - 1].motivo || null;
  }

  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  var bannerRejeicao = '';
  if (motivoRejeicao) {
    bannerRejeicao = '<div style="background:#fef2f2;border-left:4px solid #ef4444;padding:12px 16px;margin-bottom:16px;border-radius:4px;">'
      + '<strong style="color:#dc2626;">⚠️ Correção solicitada</strong><br>'
      + '<p style="margin:4px 0 0;color:#374151;font-size:13px;"><strong>Motivo:</strong> ' + esc(motivoRejeicao) + '</p>'
      + '</div>';
  }

  var instrucoes = etapa.tipo === 'govbr'
    ? '<p>Acesse o link abaixo, <strong>baixe o PDF</strong> do convênio, assine com o <strong>gov.br</strong> em <strong>assinador.iti.br</strong> e faça o upload do arquivo assinado.</p>'
    : '<p>Acesse o sistema pelo botão abaixo para revisar e aprovar o documento.</p>';

  var corpo = bannerRejeicao
    + '<p>Você tem uma ação pendente referente ao <strong>Convênio de Estágio Nº ' + esc(fluxo.numero) + '</strong> entre o <strong>IFRS Campus Rio Grande</strong> e a empresa <strong>' + esc(fluxo.razaoSocial) + '</strong>.</p>'
    + instrucoes
    + '<p class="label">Convênio</p><p class="value">' + esc(fluxo.numero) + ' — ' + esc(fluxo.razaoSocial) + '</p>'
    + '<p class="label">Sua etapa</p><p class="value">Etapa ' + etapa.numero + '/4 — ' + esc(etapa.label) + '</p>'
    + (etapa.prazoVencimento ? '<p class="label">Prazo</p><p class="value">' + esc(etapa.prazoVencimento) + '</p>' : '')
    + '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px;">'
    + '<tr><td bgcolor="#1d4ed8" style="border-radius:6px;">'
    + '<a href="' + esc(pageUrl) + '" target="_blank" style="display:block;padding:14px 28px;font-family:Arial,sans-serif;font-size:15px;font-weight:700;color:#ffffff !important;text-decoration:none;">'
    + '<span style="color:#ffffff;">' + (etapa.tipo === 'govbr' ? 'Acessar e Assinar Convênio' : 'Acessar e Revisar Convênio') + '</span>'
    + '</a></td></tr></table>';

  var assunto = '[SGE] ' + (motivoRejeicao ? 'Correção solicitada' : 'Ação necessária') + ' — Convênio Nº ' + fluxo.numero;
  var html    = _htmlEmailConvenio_(assunto, corpo);

  _enviarEmailConv_(etapa.email, assunto, html);

  if (etapa.tipo === 'interno' && CFG_ADMIN && CFG_ADMIN.ADMIN_EMAILS) {
    var _msgConv = 'Convênio ' + fluxo.numero + ' (' + fluxo.razaoSocial + '): ' + etapa.label + ' pendente.';
    CFG_ADMIN.ADMIN_EMAILS.forEach(function(adminEmail) {
      try {
        criarNotificacao_({
          email:    adminEmail,
          perfil:   'admin',
          idEstagio:'',
          tipo:     'convenio',
          mensagem: _msgConv,
        });
      } catch (_) {}
    });
  }
}

function _enviarEmailConvenioAprovado_(idConvenio, fluxo) {
  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  var assunto = '[SGE] Convênio aprovado — ' + fluxo.numero + ' — ' + fluxo.razaoSocial;
  var corpo   = '<p>O <strong>Convênio de Estágio Nº ' + esc(fluxo.numero) + '</strong> foi assinado por todas as partes e está aprovado.</p>'
    + '<p class="label">Empresa</p><p class="value">' + esc(fluxo.razaoSocial) + '</p>'
    + '<p>O convênio está vigente. Novos estágios poderão ser vinculados a este convênio.</p>';
  var html    = _htmlEmailConvenio_(assunto, corpo);
  [CONV_SETOR_EMAIL, fluxo.emailRep].filter(Boolean).forEach(function(email) {
    _enviarEmailConv_(email, assunto, html);
  });
}

function _htmlEmailConvenio_(titulo, corpo) {
  return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">'
    + '<style>body{font-family:Arial,sans-serif;font-size:14px;color:#374151;margin:0;padding:0;background:#f9fafb;}'
    + '.wrapper{max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;}'
    + '.header{background:#1d4ed8;padding:24px 32px;} .header h1{color:#fff;margin:0;font-size:20px;}'
    + '.body{padding:32px;} .body p{margin:0 0 16px;line-height:1.6;}'
    + '.label{font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px;}'
    + '.value{font-weight:600;color:#111827;margin-bottom:12px;}'
    + '.footer{background:#f3f4f6;padding:16px 32px;font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;}'
    + '</style></head><body>'
    + '<div class="wrapper">'
    + '<div class="header"><h1>Convênio de Estágio — SGE IFRS</h1></div>'
    + '<div class="body">' + corpo + '</div>'
    + '<div class="footer">Central de Estágios IFRS · IFRS Campus Rio Grande · '
    + '<a href="mailto:' + CONV_SETOR_EMAIL + '" style="color:#6b7280;">' + CONV_SETOR_EMAIL + '</a></div>'
    + '</div></body></html>';
}

function _enviarEmailConv_(para, assunto, htmlBody) {
  try {
    GmailApp.sendEmail(para, assunto, '', { htmlBody: htmlBody, name: 'Central de Estágios IFRS' });
  } catch (e) {
    try { MailApp.sendEmail({ to: para, subject: assunto, htmlBody: htmlBody, name: 'Central de Estágios IFRS' }); } catch (_) {}
  }
}

function _calcPrazoConv_(dias) {
  var d = new Date();
  d.setDate(d.getDate() + (dias || 10));
  return Utilities.formatDate(d, 'America/Sao_Paulo', 'yyyy-MM-dd');
}

// ── Handlers HTTP ─────────────────────────────────────────────────────────────

function doGetConvenios(e) {
  var action = (e.parameter && e.parameter.action) || '';

  switch (action) {

    case 'listarEmpresasComConvenio': {
      var tk = (e.parameter && e.parameter.authToken) || '';
      try { validarTokenAdmin_(tk); } catch(eA) { return jsonError_('Não autorizado: ' + (eA.message || eA), 'AUTH_ERROR'); }
      return jsonOk_({ empresas: _listarEmpresasComConvenio_() });
    }

    case 'listarConvenios': {
      var tk2 = (e.parameter && e.parameter.authToken) || '';
      try { validarTokenAdmin_(tk2); } catch(eA2) { return jsonError_('Não autorizado: ' + (eA2.message || eA2), 'AUTH_ERROR'); }
      return jsonOk_({ convenios: _listarConvenios_() });
    }

    case 'obterFluxoConvenio': {
      var id    = (e.parameter && e.parameter.id)        || '';
      var token = (e.parameter && e.parameter.token)     || '';
      var tkAdm = (e.parameter && e.parameter.authToken) || '';
      if (!id) return jsonError_('Parâmetro id obrigatório.', 'MISSING_PARAM');

      var fluxo = _obterFluxoConvenio_(id);
      if (!fluxo) return jsonError_('Convênio não encontrado.', 'NOT_FOUND');

      var meuAtor = null;
      if (token) {
        var etapaToken = _validarTokenConvenio_(fluxo, token);
        if (!etapaToken) return jsonError_('Token inválido.', 'AUTH_ERROR');
        meuAtor = etapaToken.ator;
      } else if (tkAdm) {
        try { validarTokenAdmin_(tkAdm); } catch(eAdm) { return jsonError_('Não autorizado.', 'AUTH_ERROR'); }
        meuAtor = 'admin';
      }

      return jsonOk_(_fluxoPublicoConvenio_(fluxo, meuAtor));
    }

    case 'baixarPdfConvenio': {
      var id    = (e.parameter && e.parameter.id)        || '';
      var token = (e.parameter && e.parameter.token)     || '';
      var tkAdm = (e.parameter && e.parameter.authToken) || '';
      if (!id) return jsonError_('Parâmetro id obrigatório.', 'MISSING_PARAM');

      var fluxoDl = _obterFluxoConvenio_(id);
      if (!fluxoDl) return jsonError_('Convênio não encontrado.', 'NOT_FOUND');

      var fileIdDl   = null;
      var etapaParam = e.parameter && e.parameter.etapa ? parseInt(e.parameter.etapa, 10) : 0;

      if (tkAdm) {
        try { validarTokenAdmin_(tkAdm); } catch(eAdmDl) { return jsonError_('Não autorizado.', 'AUTH_ERROR'); }
        if (etapaParam > 0) {
          var etAdm = fluxoDl.etapas[etapaParam - 1];
          if (etAdm && etAdm.driveUrl) fileIdDl = _extrairFileIdDoUrl_(etAdm.driveUrl);
        }
        if (!fileIdDl) {
          for (var ka = fluxoDl.etapas.length - 1; ka >= 0; ka--) {
            if (fluxoDl.etapas[ka].driveUrl) { fileIdDl = _extrairFileIdDoUrl_(fluxoDl.etapas[ka].driveUrl); break; }
          }
        }
        if (!fileIdDl) fileIdDl = _extrairFileIdDoUrl_(fluxoDl.pdfOriginalUrl);
      } else {
        if (!token) return jsonError_('Token obrigatório.', 'MISSING_PARAM');
        var etaToken = _validarTokenConvenio_(fluxoDl, token);
        if (!etaToken) return jsonError_('Token inválido.', 'AUTH_ERROR');
        for (var j = etaToken.numero - 2; j >= 0; j--) {
          var etJ = fluxoDl.etapas[j];
          if (etJ && etJ.driveUrl) { fileIdDl = _extrairFileIdDoUrl_(etJ.driveUrl); break; }
        }
        if (!fileIdDl) fileIdDl = _extrairFileIdDoUrl_(fluxoDl.pdfOriginalUrl);
      }

      if (!fileIdDl) return jsonError_('Nenhum PDF disponível.', 'NOT_FOUND');
      try {
        var fileDl  = DriveApp.getFileById(fileIdDl);
        var bytesDl = fileDl.getBlob().getBytes();
        return jsonOk_({ base64: Utilities.base64Encode(bytesDl), nome: fileDl.getName() });
      } catch (errD) {
        return jsonError_('Erro ao acessar arquivo: ' + errD.message, 'DRIVE_ERROR');
      }
    }

    default:
      return jsonError_('Ação GET desconhecida: ' + action, 'UNKNOWN_ACTION');
  }
}

function doPostConvenios(e) {
  var body       = e._body    || {};
  var action     = body.action    || '';
  var idConvenio = body.idConvenio || '';

  switch (action) {

    case 'gerarConvenio': {
      try { validarTokenAdmin_(body.authToken); } catch(eA) { return jsonError_('Não autorizado: ' + (eA.message || eA), 'AUTH_ERROR'); }
      var cnpj = String(body.cnpj || '').trim();
      if (!cnpj) return jsonError_('CNPJ obrigatório.', 'MISSING_PARAM');
      try {
        var res = iniciarFluxoConvenio_(cnpj);
        return jsonOk_({ idConvenio: res.idConvenio, numero: res.numero });
      } catch (eGen) {
        logErro_('doPostConvenios.gerarConvenio', eGen);
        return jsonError_(eGen.message || 'Erro ao gerar convênio.', 'INTERNAL');
      }
    }

    case 'uploadPdfConvenioAssinado':
      return uploadPdfConvenioAssinado_(idConvenio, body.numeroEtapa, body.pdfBase64, body.token);

    case 'concluirEtapaConvenio': {
      var fluxoCon = _obterFluxoConvenio_(idConvenio);
      if (!fluxoCon) return jsonError_('Fluxo não encontrado.', 'NOT_FOUND');

      var etaTk  = body.token ? _validarTokenConvenio_(fluxoCon, body.token) : null;
      var numEta = body.numeroEtapa;

      if (!etaTk) {
        try { validarTokenAdmin_(body.authToken); } catch(eA2) { return jsonError_('Não autorizado: ' + (eA2.message || eA2), 'AUTH_ERROR'); }
        etaTk = fluxoCon.etapas.find(function(et) { return et.status === ASS_STATUS.AGUARDANDO; });
        if (!etaTk) return jsonError_('Nenhuma etapa aguardando.', 'INVALID_STATE');
      }
      numEta = numEta || etaTk.numero;
      return concluirEtapaConvenio_(idConvenio, numEta, body.driveUrl || null, etaTk.email || '');
    }

    case 'rejeitarEtapaConvenio': {
      var fluxoRej = _obterFluxoConvenio_(idConvenio);
      if (!fluxoRej) return jsonError_('Fluxo não encontrado.', 'NOT_FOUND');

      var etaRej = body.token ? _validarTokenConvenio_(fluxoRej, body.token) : null;
      if (!etaRej) {
        try { validarTokenAdmin_(body.authToken); } catch(eA3) { return jsonError_('Não autorizado: ' + (eA3.message || eA3), 'AUTH_ERROR'); }
        etaRej = fluxoRej.etapas.find(function(et) { return et.status === ASS_STATUS.AGUARDANDO; });
        if (!etaRej) return jsonError_('Nenhuma etapa aguardando.', 'INVALID_STATE');
      }
      return rejeitarEtapaConvenio_(idConvenio, body.numeroEtapa || etaRej.numero, body.motivo, body.retornoParaEtapa, etaRej.email || '');
    }

    case 'reenviarNotificacaoConvenio': {
      try { validarTokenAdmin_(body.authToken); } catch(eA4) { return jsonError_('Não autorizado: ' + (eA4.message || eA4), 'AUTH_ERROR'); }
      if (!idConvenio) return jsonError_('idConvenio obrigatório.', 'MISSING_PARAM');
      var fluxoRenv = _obterFluxoConvenio_(idConvenio);
      if (!fluxoRenv) return jsonError_('Fluxo não encontrado.', 'NOT_FOUND');
      var etaAtiva  = null;
      for (var kk = 0; kk < fluxoRenv.etapas.length; kk++) {
        if (fluxoRenv.etapas[kk].status === ASS_STATUS.AGUARDANDO) { etaAtiva = fluxoRenv.etapas[kk]; break; }
      }
      if (!etaAtiva) return jsonError_('Nenhuma etapa aguardando.', 'INVALID_STATE');
      try { _notificarAtorConvenio_(idConvenio, etaAtiva, fluxoRenv); }
      catch (eRenv) { return jsonError_('Erro ao reenviar: ' + eRenv.message, 'SEND_ERROR'); }
      return jsonOk_({ reenviado: true, etapa: etaAtiva.numero, label: etaAtiva.label });
    }

    default:
      return jsonError_('Ação POST desconhecida: ' + action, 'UNKNOWN_ACTION');
  }
}
