/**
 * api-declaracoes.gs — Declarações de Orientação e Supervisão de Estágio
 * SGE — Sistema de Gestão de Estágios · IFRS Campus Rio Grande
 *
 * Declaração emitida em PDF, enviada por e-mail ao solicitante.
 * Histórico registrado na aba "Declarações" da planilha.
 *
 * Rotas GET:
 *   listarDeclaracoes          → servidor (próprias) ou admin (todas)
 *   validarDeclaracao          → público (sem auth)
 *
 * Rotas POST:
 *   solicitarDeclaracao        → servidor
 *   gerarDeclaracaoAdmin       → admin (em nome de qualquer servidor)
 */

'use strict';

// ── Aba da planilha ────────────────────────────────────────────────────────────
var DECL_SHEET_NAME = 'Declarações';

// Índices das colunas (base 0)
var COL_DECL = {
  ID:             0,
  DATA_EMISSAO:   1,
  EMAIL_SERVIDOR: 2,
  NOME_SERVIDOR:  3,
  FUNCAO:         4,   // 'orientador' | 'supervisor' | 'ambos'
  MODALIDADE:     5,   // 'Obrigatório' | 'Não Obrigatório' | 'Ambos'
  PERIODO_INICIO: 6,
  PERIODO_FIM:    7,
  TOKEN:          8,
  ESTAGIOS_JSON:  9,
  EMITIDO_POR:    10,  // 'servidor' | 'admin'
  NOME_EMITENTE:  11,  // nome do admin quando emitido_por='admin'
};

// ── Handlers de rota ──────────────────────────────────────────────────────────

function doGetDeclaracoes(e) {
  var action = (e.parameter && e.parameter.action) || '';
  if (action === 'listarDeclaracoesServidor') return listarDeclaracoesServidor_(e);
  if (action === 'listarDeclaracoesAdmin')    return listarDeclaracoesAdmin_(e);
  if (action === 'validarDeclaracao')         return validarDeclaracao_(e);
  return jsonError_('Ação GET não reconhecida em declaracoes: ' + action, 'NOT_IMPLEMENTED');
}

function doPostDeclaracoes(e) {
  var body   = e._body || {};
  var action = body.action || '';
  if (action === 'solicitarDeclaracao')   return solicitarDeclaracao_(body);
  if (action === 'gerarDeclaracaoAdmin')  return gerarDeclaracaoAdmin_(body);
  return jsonError_('Ação POST não reconhecida em declaracoes: ' + action, 'NOT_IMPLEMENTED');
}

// ── GET: listar declarações do próprio servidor ────────────────────────────────

function listarDeclaracoesServidor_(e) {
  var tokenInfo = validarTokenServidor_(e.parameter && e.parameter.authToken);
  var email = tokenInfo.email.toLowerCase().trim();
  var lista = _listarDeclaracoesPorEmail_(email);
  return jsonOk_(lista);
}

// ── GET: listar todas as declarações (admin) ──────────────────────────────────

function listarDeclaracoesAdmin_(e) {
  try { validarTokenAdmin_(e.parameter && e.parameter.authToken); }
  catch (eAuth) { return jsonError_('Não autorizado: ' + eAuth.message, 'AUTH_ERROR'); }
  var lista = _listarTodasDeclaracoes_();
  return jsonOk_(lista);
}

// ── GET público: validar declaração por token ─────────────────────────────────

function validarDeclaracao_(e) {
  var token = String((e.parameter && e.parameter.t) || '').trim();
  if (!token) return jsonError_('Token obrigatório.', 'MISSING_PARAM');

  var idDecl = PropertiesService.getScriptProperties().getProperty('decl_' + token);
  if (!idDecl) return jsonError_('Token inválido ou declaração não encontrada.', 'NOT_FOUND');

  var decl = _obterDeclaracaoPorId_(idDecl);
  if (!decl || decl.token !== token) return jsonError_('Token inválido.', 'AUTH_ERROR');

  // Mascaramento LGPD
  var emailMask = _mascaraEmail_(decl.emailServidor);
  return jsonOk_({
    valido:        true,
    tipo:          'declaracao',
    id:            decl.id,
    dataEmissao:   decl.dataEmissao,
    nomeServidor:  decl.nomeServidor,
    emailServidor: emailMask,
    funcao:        decl.funcao,
    modalidade:    decl.modalidade,
    periodoInicio: decl.periodoInicio,
    periodoFim:    decl.periodoFim,
    totalEstagios: (decl.estagios || []).length,
  });
}

// ── POST: servidor solicita declaração ────────────────────────────────────────

function solicitarDeclaracao_(body) {
  try {
    var tokenInfo = validarTokenServidor_(body.authToken);
    var emailServidor = tokenInfo.email.toLowerCase().trim();
    return _processarDeclaracao_(body, emailServidor, 'servidor', null);
  } catch (e) {
    logErro_('solicitarDeclaracao_', e);
    if (e && (e.code === 'AUTH_ERROR' || e.name === 'ErroAutenticacao')) {
      return jsonError_(e.message, 'AUTH_ERROR');
    }
    // Retorna mensagem detalhada para diagnóstico
    return jsonError_('Erro ao gerar declaração: ' + e.message + (e.stack ? ' | ' + String(e.stack).substring(0, 300) : ''), 'INTERNAL');
  }
}

// ── POST: admin emite declaração em nome de servidor ──────────────────────────

function gerarDeclaracaoAdmin_(body) {
  var adminInfo;
  try { adminInfo = validarTokenAdmin_(body.authToken); }
  catch (eAuth) { return jsonError_('Não autorizado: ' + eAuth.message, 'AUTH_ERROR'); }

  var emailServidor = sanitizar_(body.emailServidor || '', 200).toLowerCase().trim();
  if (!emailServidor) return jsonError_('E-mail do servidor obrigatório.', 'MISSING_PARAM');

  var nomeEmitente = (adminInfo && adminInfo.nome) ? adminInfo.nome : 'Administrador';
  return _processarDeclaracao_(body, emailServidor, 'admin', nomeEmitente);
}

// ── Core: gera PDF e salva registro ──────────────────────────────────────────

function _processarDeclaracao_(body, emailServidor, emitidoPor, nomeEmitente) {
  var funcao     = sanitizar_(body.funcao     || '', 20).trim();
  var modalidade = sanitizar_(body.modalidade || '', 30).trim();
  var periodoIni = sanitizar_(body.periodoInicio || '', 20).trim();
  var periodoFim = sanitizar_(body.periodoFim    || '', 20).trim();

  if (!funcao || !modalidade || !periodoIni || !periodoFim) {
    return jsonError_('Parâmetros obrigatórios: funcao, modalidade, periodoInicio, periodoFim.', 'VALIDATION');
  }
  if (!['orientador', 'supervisor', 'ambos'].includes(funcao)) {
    return jsonError_('Função inválida. Use: orientador, supervisor ou ambos.', 'VALIDATION');
  }
  if (!['Obrigatório', 'Não Obrigatório', 'Ambos'].includes(modalidade)) {
    return jsonError_('Modalidade inválida.', 'VALIDATION');
  }

  // Busca nome do servidor na planilha; fallback para nome do token Google
  var nomeServidor = _obterNomeServidor_(emailServidor);
  if (!nomeServidor && body._nomeServidor) {
    nomeServidor = sanitizar_(String(body._nomeServidor), 100).trim();
  }
  if (!nomeServidor) {
    nomeServidor = emailServidor.split('@')[0].replace(/\./g, ' ');
  }

  // Filtra estágios do servidor no período/modalidade/função
  var estagios = _filtrarEstagiosDeclaracao_(emailServidor, funcao, modalidade, periodoIni, periodoFim);
  if (estagios.length === 0) {
    return jsonError_('Nenhum estágio encontrado para os critérios informados.', 'NOT_FOUND');
  }

  // Gera token de validação
  var token = Utilities.getUuid();
  var id    = 'DECL-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd') + '-' + token.substring(0, 8).toUpperCase();

  PropertiesService.getScriptProperties().setProperty('decl_' + token, id);

  // Gera PDF
  var pdfBlob = _gerarPdfDeclaracao_({
    id:            id,
    nomeServidor:  nomeServidor,
    emailServidor: emailServidor,
    funcao:        funcao,
    modalidade:    modalidade,
    periodoInicio: periodoIni,
    periodoFim:    periodoFim,
    estagios:      estagios,
    token:         token,
    dataEmissao:   new Date().toISOString(),
  });

  // Envia por e-mail com PDF em anexo
  _enviarEmailDeclaracao_(emailServidor, nomeServidor, id, pdfBlob, {
    funcao: funcao, modalidade: modalidade,
    periodoInicio: periodoIni, periodoFim: periodoFim,
    totalEstagios: estagios.length,
  });

  // Salva registro na planilha
  _salvarRegistroDeclaracao_({
    id:            id,
    dataEmissao:   new Date().toISOString(),
    emailServidor: emailServidor,
    nomeServidor:  nomeServidor,
    funcao:        funcao,
    modalidade:    modalidade,
    periodoInicio: periodoIni,
    periodoFim:    periodoFim,
    token:         token,
    estagios:      estagios,
    emitidoPor:    emitidoPor,
    nomeEmitente:  nomeEmitente || '',
  });

  return jsonOk_({
    mensagem:      'Declaração gerada e enviada para ' + emailServidor,
    id:            id,
    totalEstagios: estagios.length,
  });
}

// ── Geração do PDF ────────────────────────────────────────────────────────────

function _gerarPdfDeclaracao_(dados) {
  var CINZA = '#6b7280';
  var PRETO = '#111827';
  var fmtData = function (iso) {
    if (!iso) return '—';
    try { return Utilities.formatDate(new Date(iso), Session.getScriptTimeZone(), 'dd/MM/yyyy'); }
    catch (_) { return String(iso); }
  };
  // periodoInicio/Fim chegam como YYYY-MM-DD ou DD/MM/YYYY
  var fmtPeriodo = function (v) {
    if (!v) return '—';
    var m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[3] + '/' + m[2] + '/' + m[1];
    return v;
  };

  var labelFuncao = dados.funcao === 'orientador' ? 'orientador(a)' :
                    dados.funcao === 'supervisor'  ? 'supervisor(a)' :
                    'orientador(a) e supervisor(a)';

  var urlValidacao = BASE_URL_SGE_ + '/validar/?t=' + encodeURIComponent(dados.token);
  var docName = 'Declaracao-' + dados.nomeServidor.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-]/g, '') + '-' + dados.id;

  var doc  = DocumentApp.create(docName);
  var docId = doc.getId();
  var body = doc.getBody();
  body.clear();
  body.setMarginTop(56).setMarginBottom(56).setMarginLeft(72).setMarginRight(72);

  // ── Cabeçalho institucional ──────────────────────────────────────────────────
  var logoBlob = _obterLogoCabecalho_();
  if (logoBlob) {
    try {
      var logoImg = body.appendImage(logoBlob);
      logoImg.setWidth(54).setHeight(54);
      logoImg.getParent().setAlignment(DocumentApp.HorizontalAlignment.CENTER);
      logoImg.getParent().setSpacingBefore(0).setSpacingAfter(2);
    } catch (_) {}
  }
  var p1 = body.appendParagraph('MINISTÉRIO DA EDUCAÇÃO');
  p1.setAlignment(DocumentApp.HorizontalAlignment.CENTER).setSpacingBefore(0).setSpacingAfter(1);
  p1.editAsText().setFontFamily('Arial').setFontSize(8);

  var p2 = body.appendParagraph('INSTITUTO FEDERAL DE EDUCAÇÃO, CIÊNCIA E TECNOLOGIA DO RIO GRANDE DO SUL');
  p2.setAlignment(DocumentApp.HorizontalAlignment.CENTER).setSpacingBefore(1).setSpacingAfter(1);
  p2.editAsText().setFontFamily('Arial').setFontSize(9).setBold(true);

  var p3 = body.appendParagraph('Campus Rio Grande');
  p3.setAlignment(DocumentApp.HorizontalAlignment.CENTER).setSpacingBefore(1).setSpacingAfter(10);
  p3.editAsText().setFontFamily('Arial').setFontSize(8);

  // ── Título ───────────────────────────────────────────────────────────────────
  var pTitulo = body.appendParagraph('DECLARAÇÃO');
  pTitulo.setAlignment(DocumentApp.HorizontalAlignment.CENTER).setSpacingBefore(8).setSpacingAfter(12);
  pTitulo.editAsText().setFontFamily('Arial').setFontSize(14).setBold(true);

  // ── Corpo da declaração ──────────────────────────────────────────────────────
  var textoPrincipal =
    'Declaramos, para os devidos fins, que o(a) professor(a) ' +
    dados.nomeServidor +
    ' atuou como ' + labelFuncao +
    ' dos estágios relacionados abaixo:';

  var pCorpo = body.appendParagraph(textoPrincipal);
  pCorpo.setAlignment(DocumentApp.HorizontalAlignment.JUSTIFY).setSpacingBefore(4).setSpacingAfter(12);
  pCorpo.editAsText().setFontFamily('Arial').setFontSize(11);

  // ── Tabela de estágios ───────────────────────────────────────────────────────
  var cabecalhos = ['Estagiário(a)', 'Entidade Concedente', 'Período', 'Função', 'Modalidade'];
  var numCols    = cabecalhos.length;
  var numLinhas  = dados.estagios.length + 1; // +1 para cabeçalho

  var tabela = body.appendTable();
  tabela.setSpacingBefore(6).setSpacingAfter(16);

  // Cabeçalho da tabela
  var linhaCab = tabela.appendTableRow();
  cabecalhos.forEach(function (cab) {
    var cell = linhaCab.appendTableCell(cab);
    cell.editAsText().setFontFamily('Arial').setFontSize(9).setBold(true);
    cell.setBackgroundColor('#e5e7eb');
    cell.setPaddingTop(4).setPaddingBottom(4).setPaddingLeft(6).setPaddingRight(6);
  });

  // Linhas de dados
  dados.estagios.forEach(function (est, idx) {
    var linha = tabela.appendTableRow();
    var bg    = idx % 2 === 0 ? '#ffffff' : '#f9fafb';
    var periodoStr = fmtPeriodo(est.dataInicio) + ' a ' + fmtPeriodo(est.dataTermino);
    var funcaoLabel = est.funcao === 'orientador' ? 'Orientador(a)' :
                      est.funcao === 'supervisor'  ? 'Supervisor(a)' : 'Orientador(a) / Supervisor(a)';

    [est.nomeEstudante, est.nomeEmpresa, periodoStr, funcaoLabel, est.tipoEstagio].forEach(function (val) {
      var cell = linha.appendTableCell(String(val || '—'));
      cell.editAsText().setFontFamily('Arial').setFontSize(9);
      cell.setBackgroundColor(bg);
      cell.setPaddingTop(3).setPaddingBottom(3).setPaddingLeft(6).setPaddingRight(6);
    });
  });

  // ── Assinatura eletrônica da Central de Estágios ─────────────────────────────
  var _linha = function (label, valor) {
    var v   = (valor !== undefined && valor !== null && String(valor).trim()) ? String(valor) : '—';
    var txt = label + ': ' + v;
    var p   = body.appendParagraph(txt);
    p.setSpacingBefore(1).setSpacingAfter(1);
    var t = p.editAsText();
    t.setFontFamily('Arial').setFontSize(10);
    t.setBold(0, label.length, true);
    if (txt.length - 1 > label.length + 2) t.setBold(label.length + 2, txt.length - 1, false);
  };
  var _secao = function (titulo) {
    var p = body.appendParagraph(titulo);
    p.setSpacingBefore(10).setSpacingAfter(3);
    p.editAsText().setFontFamily('Arial').setFontSize(10).setBold(true);
    body.appendHorizontalRule();
  };

  body.appendParagraph('');
  _secao('ASSINATURA ELETRÔNICA');

  // Assinatura 1: Central de Estágios (assinatura institucional)
  var agora = new Date().toISOString();
  body.appendParagraph('');
  var titCentral = body.appendParagraph('1. Central de Estágios — IFRS Campus Rio Grande');
  titCentral.editAsText().setFontFamily('Arial').setFontSize(10).setBold(true);
  _linha('Responsável', 'Setor de Estágios');
  _linha('E-mail', 'estagios@riogrande.ifrs.edu.br');
  _linha('Data e Hora', Utilities.formatDate(new Date(agora), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss'));
  var rodCentral = body.appendParagraph('Documento emitido eletronicamente pelo SGE — IFRS Campus Rio Grande.');
  rodCentral.getChild(0).setFontSize(8).setForegroundColor(CINZA).setItalic(true);

  // Assinatura 2: Servidor solicitante
  body.appendParagraph('');
  var titServidor = body.appendParagraph('2. Professor(a) Solicitante');
  titServidor.editAsText().setFontFamily('Arial').setFontSize(10).setBold(true);
  _linha('Nome', dados.nomeServidor);
  _linha('E-mail', dados.emailServidor);
  _linha('Data e Hora', Utilities.formatDate(new Date(agora), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss'));
  var rodSrv = body.appendParagraph('Assinatura realizada eletronicamente conforme os termos do SGE — IFRS Campus Rio Grande.');
  rodSrv.getChild(0).setFontSize(8).setForegroundColor(CINZA).setItalic(true);

  // ── QR Code de validação ──────────────────────────────────────────────────────
  body.appendParagraph('');
  _secao('VALIDAÇÃO DO DOCUMENTO');

  var instrPar = body.appendParagraph(
    'Escaneie o QR Code ou acesse o link abaixo para verificar a autenticidade desta declaração.'
  );
  instrPar.getChild(0).setFontSize(9).setForegroundColor(CINZA);
  body.appendParagraph('');

  var qrGerado = false;
  var qrApis = [
    'https://quickchart.io/qr?size=200&margin=2&text=' + encodeURIComponent(urlValidacao),
    'https://chart.googleapis.com/chart?cht=qr&chs=200x200&chld=M|1&chl=' + encodeURIComponent(urlValidacao),
  ];
  for (var qi = 0; qi < qrApis.length && !qrGerado; qi++) {
    try {
      var qrResp = UrlFetchApp.fetch(qrApis[qi], { muteHttpExceptions: true });
      if (qrResp.getResponseCode() === 200) {
        var qrBlob = qrResp.getBlob().setContentType('image/png').setName('qrcode.png');
        var qrImg  = body.appendImage(qrBlob);
        qrImg.setWidth(130).setHeight(130);
        body.appendParagraph('');
        qrGerado = true;
      }
    } catch (_) {}
  }

  var validLabel = body.appendParagraph('🔗 Link de validação:');
  validLabel.editAsText().setFontFamily('Arial').setFontSize(9).setBold(true);
  var validPar = body.appendParagraph(urlValidacao);
  validPar.editAsText().setFontFamily('Arial').setFontSize(9);

  var rodapeFinal = body.appendParagraph(
    'Declaração gerada automaticamente pelo SGE — IFRS Campus Rio Grande · ' +
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss')
  );
  rodapeFinal.editAsText().setFontFamily('Arial').setFontSize(8).setItalic(true);
  rodapeFinal.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  doc.saveAndClose();

  // Exporta como PDF blob (não salva no Drive)
  var docFile = DriveApp.getFileById(docId);
  var pdfBlob = docFile.getAs('application/pdf').setName(docName + '.pdf');

  // Remove o Google Doc temporário
  try { docFile.setTrashed(true); } catch (_) {}

  return pdfBlob;
}

// ── Envio do e-mail com PDF em anexo ─────────────────────────────────────────

function _enviarEmailDeclaracao_(emailServidor, nomeServidor, id, pdfBlob, info) {
  var labelFuncao = info.funcao === 'orientador' ? 'Orientação' :
                    info.funcao === 'supervisor'  ? 'Supervisão' :
                    'Orientação e Supervisão';
  var assunto = '[SGE] Declaração de ' + labelFuncao + ' de Estágio — ' + id;

  var fmtP = function (v) {
    if (!v) return '—';
    var m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[3] + '/' + m[2] + '/' + m[1];
    return v;
  };

  var corpo = '<p>Olá, <strong>' + nomeServidor + '</strong>.</p>'
    + '<p>Segue em anexo sua declaração de ' + labelFuncao.toLowerCase() + ' de estágio solicitada via SGE — IFRS Campus Rio Grande.</p>'
    + '<table style="border-collapse:collapse;width:100%;margin:16px 0;">'
    + '<tr><td style="padding:6px 0;color:#6b7280;font-size:12px;text-transform:uppercase;width:130px;">ID</td>'
    +    '<td style="padding:6px 0;font-weight:600;">' + id + '</td></tr>'
    + '<tr><td style="padding:6px 0;color:#6b7280;font-size:12px;text-transform:uppercase;">Período</td>'
    +    '<td style="padding:6px 0;">' + fmtP(info.periodoInicio) + ' a ' + fmtP(info.periodoFim) + '</td></tr>'
    + '<tr><td style="padding:6px 0;color:#6b7280;font-size:12px;text-transform:uppercase;">Modalidade</td>'
    +    '<td style="padding:6px 0;">' + info.modalidade + '</td></tr>'
    + '<tr><td style="padding:6px 0;color:#6b7280;font-size:12px;text-transform:uppercase;">Estágios</td>'
    +    '<td style="padding:6px 0;">' + info.totalEstagios + ' registro(s)</td></tr>'
    + '</table>'
    + '<p style="font-size:13px;color:#6b7280;">Dúvidas: '
    + '<a href="mailto:estagios@riogrande.ifrs.edu.br" style="color:#6b7280;">estagios@riogrande.ifrs.edu.br</a></p>';

  var htmlFull ='<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">'
    + '<style>body{font-family:Arial,sans-serif;font-size:14px;color:#374151;margin:0;padding:0;background:#f9fafb;}'
    + '.wrapper{max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;}'
    + '.header{background:#1d4ed8;padding:24px 32px;} .header h1{color:#fff;margin:0;font-size:20px;}'
    + '.body{padding:32px;} .body p{margin:0 0 16px;line-height:1.6;}'
    + '.footer{background:#f3f4f6;padding:16px 32px;font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;}'
    + '</style></head><body>'
    + '<div class="wrapper">'
    + '<div class="header"><h1>Declaração de ' + labelFuncao + '</h1></div>'
    + '<div class="body">' + corpo + '</div>'
    + '<div class="footer">Central de Estágios IFRS · IFRS Campus Rio Grande · '
    + '<a href="mailto:estagios@riogrande.ifrs.edu.br" style="color:#9ca3af;">estagios@riogrande.ifrs.edu.br</a></div>'
    + '</div></body></html>';

  try {
    MailApp.sendEmail({
      to:          emailServidor,
      subject:     assunto,
      htmlBody:    htmlFull,
      name:        'Central de Estágios IFRS',
      attachments: [pdfBlob],
    });
  } catch (e) {
    logErro_('_enviarEmailDeclaracao_', e);
    throw new Error('Falha ao enviar e-mail: ' + e.message);
  }
}

// ── Filtrar estágios do servidor ──────────────────────────────────────────────

function _filtrarEstagiosDeclaracao_(emailServidor, funcao, modalidade, periodoIni, periodoFim) {
  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID || SS_ID);
  var sheet = ss.getSheetByName('Solicitações');
  if (!sheet) return [];

  var dados = sheet.getDataRange().getValues();
  var resultado = [];

  // Normaliza datas de filtro (aceita YYYY-MM-DD ou DD/MM/YYYY)
  var _normData = function (v) {
    if (!v) return null;
    var s = String(v).trim();
    var m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m1) return new Date(m1[1], parseInt(m1[2]) - 1, parseInt(m1[3]));
    var m2 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (m2) return new Date(m2[3], parseInt(m2[2]) - 1, parseInt(m2[1]));
    return null;
  };

  var dtFiltroIni = _normData(periodoIni);
  var dtFiltroFim = _normData(periodoFim);

  var statusValidos = ['Ativo', 'Concluído', 'Em análise', 'Aprovado', 'Aguardando DG'];

  for (var i = 1; i < dados.length; i++) {
    var linha = dados[i];
    var emailOri = String(linha[COL_SOL.EMAIL_ORIENTADOR] || '').toLowerCase().trim();
    var emailSup = String(linha[COL_SOL.EMAIL_SUPERVISOR]  || '').toLowerCase().trim();
    var status   = String(linha[COL_SOL.STATUS] || '').trim();

    if (!statusValidos.includes(status)) continue;

    // Determina função deste estágio para o servidor
    var ehOrientador = (emailOri === emailServidor);
    var ehSupervisor = (emailSup === emailServidor);

    var funcaoEstag = null;
    if (funcao === 'ambos') {
      if (ehOrientador && ehSupervisor) funcaoEstag = 'ambos';
      else if (ehOrientador) funcaoEstag = 'orientador';
      else if (ehSupervisor) funcaoEstag = 'supervisor';
    } else if (funcao === 'orientador' && ehOrientador) {
      funcaoEstag = 'orientador';
    } else if (funcao === 'supervisor' && ehSupervisor) {
      funcaoEstag = 'supervisor';
    }
    if (!funcaoEstag) continue;

    // Filtro de modalidade
    var tipoEstagio = String(linha[COL_SOL.TIPO_ESTAGIO] || '').trim();
    if (modalidade !== 'Ambos' && tipoEstagio !== modalidade) continue;

    // Filtro de período: estágio deve se sobrepor ao período solicitado
    var dtIni = _normData(String(linha[COL_SOL.DATA_INICIO]   || ''));
    var dtFim = _normData(String(linha[COL_SOL.DATA_TERMINO]  || ''));

    if (dtFiltroIni && dtFiltroFim && dtIni && dtFim) {
      // Sobreposição: início do estágio <= fim do filtro E fim do estágio >= início do filtro
      if (dtIni > dtFiltroFim || dtFim < dtFiltroIni) continue;
    }

    resultado.push({
      idEstagio:     String(linha[COL_SOL.ID_ESTAGIO]      || ''),
      nomeEstudante: String(linha[COL_SOL.NOME_ESTUDANTE]  || ''),
      nomeEmpresa:   String(linha[COL_SOL.NOME_EMPRESA]    || ''),
      dataInicio:    String(linha[COL_SOL.DATA_INICIO]     || ''),
      dataTermino:   String(linha[COL_SOL.DATA_TERMINO]    || ''),
      tipoEstagio:   tipoEstagio,
      funcao:        funcaoEstag,
    });
  }

  // Ordena por data de início
  resultado.sort(function (a, b) {
    return String(a.dataInicio).localeCompare(String(b.dataInicio));
  });

  return resultado;
}

// ── Planilha: salvar e listar ──────────────────────────────────────────────────

function _obterAbaDeclaracoes_() {
  var ss    = SpreadsheetApp.openById(CFG_ADMIN.SS_ID || SS_ID);
  var sheet = ss.getSheetByName(DECL_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(DECL_SHEET_NAME);
    var cab = ['ID', 'Data Emissão', 'Email Servidor', 'Nome Servidor',
               'Função', 'Modalidade', 'Período Início', 'Período Fim',
               'Token', 'Estágios JSON', 'Emitido Por', 'Nome Emitente'];
    sheet.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold');
  }
  return sheet;
}

function _salvarRegistroDeclaracao_(d) {
  var sheet = _obterAbaDeclaracoes_();
  sheet.appendRow([
    d.id,
    d.dataEmissao,
    d.emailServidor,
    d.nomeServidor,
    d.funcao,
    d.modalidade,
    d.periodoInicio,
    d.periodoFim,
    d.token,
    JSON.stringify(d.estagios),
    d.emitidoPor,
    d.nomeEmitente || '',
  ]);
}

function _listarDeclaracoesPorEmail_(emailServidor) {
  var sheet = _obterAbaDeclaracoes_();
  var dados = sheet.getDataRange().getValues();
  var lista = [];
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][COL_DECL.EMAIL_SERVIDOR] || '').toLowerCase().trim() !== emailServidor) continue;
    lista.push(_linhaParaDecl_(dados[i]));
  }
  return lista.reverse(); // mais recentes primeiro
}

function _listarTodasDeclaracoes_() {
  var sheet = _obterAbaDeclaracoes_();
  var dados = sheet.getDataRange().getValues();
  var lista = [];
  for (var i = 1; i < dados.length; i++) {
    lista.push(_linhaParaDecl_(dados[i]));
  }
  return lista.reverse();
}

function _linhaParaDecl_(linha) {
  var estagios = [];
  try { estagios = JSON.parse(String(linha[COL_DECL.ESTAGIOS_JSON] || '[]')); } catch (_) {}
  return {
    id:            String(linha[COL_DECL.ID]             || ''),
    dataEmissao:   String(linha[COL_DECL.DATA_EMISSAO]   || ''),
    emailServidor: String(linha[COL_DECL.EMAIL_SERVIDOR] || ''),
    nomeServidor:  String(linha[COL_DECL.NOME_SERVIDOR]  || ''),
    funcao:        String(linha[COL_DECL.FUNCAO]         || ''),
    modalidade:    String(linha[COL_DECL.MODALIDADE]     || ''),
    periodoInicio: String(linha[COL_DECL.PERIODO_INICIO] || ''),
    periodoFim:    String(linha[COL_DECL.PERIODO_FIM]    || ''),
    token:         String(linha[COL_DECL.TOKEN]          || ''),
    totalEstagios: estagios.length,
    emitidoPor:    String(linha[COL_DECL.EMITIDO_POR]   || ''),
    nomeEmitente:  String(linha[COL_DECL.NOME_EMITENTE] || ''),
  };
}

function _obterDeclaracaoPorId_(id) {
  var sheet = _obterAbaDeclaracoes_();
  var dados = sheet.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][COL_DECL.ID] || '') !== id) continue;
    var estagios = [];
    try { estagios = JSON.parse(String(dados[i][COL_DECL.ESTAGIOS_JSON] || '[]')); } catch (_) {}
    return Object.assign(_linhaParaDecl_(dados[i]), { estagios: estagios });
  }
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _obterNomeServidor_(email) {
  var ss = SpreadsheetApp.openById(CFG_ADMIN.SS_ID || SS_ID);

  // Aba Orientadores: COL_ORI.EMAIL = 8, COL_ORI.NOME = 4
  var sheetOri = ss.getSheetByName('Orientadores');
  if (sheetOri) {
    var dadosOri = sheetOri.getDataRange().getValues();
    for (var i = 1; i < dadosOri.length; i++) {
      if (String(dadosOri[i][COL_ORI.EMAIL] || '').toLowerCase().trim() === email) {
        return String(dadosOri[i][COL_ORI.NOME] || '').trim();
      }
    }
  }

  // Fallback: busca na aba Solicitações como orientador ou supervisor
  var sheetSol = ss.getSheetByName('Solicitações');
  if (sheetSol) {
    var dadosSol = sheetSol.getDataRange().getValues();
    for (var j = 1; j < dadosSol.length; j++) {
      if (String(dadosSol[j][COL_SOL.EMAIL_ORIENTADOR] || '').toLowerCase().trim() === email) {
        var nome = String(dadosSol[j][COL_SOL.NOME_ORIENTADOR] || '').trim();
        if (nome) return nome;
      }
      if (String(dadosSol[j][COL_SOL.EMAIL_SUPERVISOR] || '').toLowerCase().trim() === email) {
        var nomeSup = String(dadosSol[j][COL_SOL.NOME_SUPERVISOR] || '').trim();
        if (nomeSup) return nomeSup;
      }
    }
  }

  return '';
}

function _mascaraEmail_(email) {
  if (!email) return '';
  var partes = String(email).split('@');
  if (partes.length < 2) return email;
  var local  = partes[0];
  var masked = local.substring(0, Math.min(2, local.length)) + '***';
  return masked + '@' + partes[1];
}
