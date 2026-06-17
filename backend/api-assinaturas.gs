/**
 * api-assinaturas.gs — Fluxo de Assinaturas do TCE
 * SGE — Sistema de Gestão de Estágios · IFRS Campus Rio Grande
 *
 * Fluxo waterfall (sequencial, uma etapa por vez):
 *   1. Estudante        → gov.br  (baixa, assina, envia PDF)
 *   2. Empresa          → gov.br
 *   3. Supervisor       → gov.br
 *   4. Orientador       → gov.br
 *   5. Coordenador      → gov.br
 *   6. Central (revisão)→ aprovação interna  (sem gov.br)
 *   7. Direção-Geral    → gov.br
 *   8. Central (final)  → arquiva, ativa estágio, envia PDF final a todos
 *
 * Armazenamento:
 *   PropertiesService  →  "assinaturas_[idEstagio]"  (estado JSON completo)
 *   Sheet "Fluxo TCE"  →  resumo tabelado por etapa
 *   Google Drive       →  PDFs versionados na pasta "TCE_[idEstagio]"
 *
 * Nomenclatura PDFs no Drive:
 *   TCE_[id]_v0_original.pdf
 *   TCE_[id]_v1_estudante.pdf
 *   TCE_[id]_v2_empresa.pdf
 *   ...
 *   TCE_[id]_vFinal.pdf
 */

'use strict';

// ── Constantes ────────────────────────────────────────────────────────────────

var BASE_URL          = 'https://ifrs-riogrande.github.io/estagios';
var ASSINATURAS_SHEET = 'Fluxo TCE';
// SS_ID já declarado em api-checklist.gs

var ASS_STATUS = {
  PENDENTE:   'pendente',    // etapa futura ainda não ativa
  AGUARDANDO: 'aguardando',  // ativa, esperando ação
  CONCLUIDO:  'concluido',
  REJEITADO:  'rejeitado',
};

/**
 * Mapa imutável das 8 etapas.
 * tipo: 'govbr' = ator baixa, assina com gov.br e envia PDF
 *       'interno' = ator age internamente no sistema (sem gov.br)
 */
var ETAPAS_DEF = [
  { numero: 1, ator: 'estudante',      label: 'Estudante / Responsável Legal',      tipo: 'govbr'   },
  { numero: 2, ator: 'empresa',        label: 'Concedente',                         tipo: 'govbr'   },
  { numero: 3, ator: 'centralRevisao', label: 'Central de Estágios (revisão)',      tipo: 'interno' },
  { numero: 4, ator: 'direcao',        label: 'Direção-Geral',                      tipo: 'govbr'   },
  { numero: 5, ator: 'centralFinal',   label: 'Central de Estágios (finalização)',  tipo: 'interno' },
];

// ── Inicialização ─────────────────────────────────────────────────────────────

/**
 * Inicia o fluxo de assinaturas após checklist 100% aprovado.
 * Chamado automaticamente por api-checklist.gs quando todos aprovam.
 *
 * @param {string} idEstagio
 */
function iniciarFluxoAssinaturas_(idEstagio) {
  var sol    = _obterDadosSolicitacaoCompleto_(idEstagio);
  var prazos = obterPrazos_();

  // Cria pasta no Drive para os PDFs desta solicitação
  var pasta  = _criarPastaAssinaturas_(idEstagio);

  // Gera o PDF inicial do TCE (não assinado) e salva no Drive
  var pdfInicial = null;
  try { pdfInicial = _gerarPdfTCEInicial_(idEstagio, sol, pasta.getId()); } catch (ePdfInicial) { logErro_('iniciarFluxoAssinaturas_.gerarPdfInicial', ePdfInicial); }

  // Mapa de e-mails dos atores — usando _resolverEmailAtor_ como fonte única
  var emails = {};
  ETAPAS_DEF.forEach(function(def) {
    emails[def.ator] = _resolverEmailAtor_(def.ator, sol);
  });

  // Monta o array de etapas
  var etapas = ETAPAS_DEF.map(function (def, idx) {
    return {
      numero:          def.numero,
      ator:            def.ator,
      label:           def.label,
      tipo:            def.tipo,
      email:           emails[def.ator] || '',
      token:           Utilities.getUuid(),
      status:          idx === 0 ? ASS_STATUS.AGUARDANDO : ASS_STATUS.PENDENTE,
      prazoVencimento: idx === 0 ? calcularPrazoVencimento_(prazos.assinaturas[def.ator]) : null,
      lembretesEnviados: 0,
      data:            null,
      driveUrl:        null,
      versao:          null,
      obs:             null,
    };
  });

  var fluxo = {
    idEstagio:          idEstagio,
    statusGeral:        'em_andamento',
    etapaAtual:         1,
    drivePastaId:       pasta.getId(),
    pdfOriginalUrl:     pdfInicial ? pdfInicial.getUrl() : null,
    timestampCriacao:   new Date().toISOString(),
    timestampConclusao: null,
    etapas:             etapas,
    historicoRejeicoes: [],
  };

  salvarFluxoAssinaturas_(idEstagio, fluxo);
  _atualizarFluxoNaPlanilha_(idEstagio, fluxo);

  // Notifica o estudante (etapa 1)
  try { notificarAtorAssinatura_(idEstagio, etapas[0], sol, fluxo); } catch (e) { logErro_('iniciarFluxoAssinaturas_.notificar', e); }

  return fluxo;
}

// ── Avançar etapa (concluir) ──────────────────────────────────────────────────

/**
 * Registra a conclusão de uma etapa e ativa a próxima.
 *
 * @param {string} idEstagio
 * @param {number} numeroEtapa  1–8
 * @param {string} driveUrl     URL do PDF assinado enviado pelo ator (null para etapas internas)
 * @param {string} emailAtor    E-mail do ator que concluiu (auditoria)
 */
function concluirEtapaAssinatura_(idEstagio, numeroEtapa, driveUrl, emailAtor) {
  var fluxo = obterFluxoAssinaturas_(idEstagio);
  if (!fluxo) return jsonError_('Fluxo de assinaturas não encontrado.', 'NOT_FOUND');

  var idx   = numeroEtapa - 1;
  var etapa = fluxo.etapas[idx];
  if (!etapa)                                 return jsonError_('Etapa inválida: ' + numeroEtapa, 'INVALID');
  if (etapa.status !== ASS_STATUS.AGUARDANDO) return jsonError_('Etapa não está aguardando ação.', 'INVALID_STATE');

  // Marca etapa atual como concluída
  etapa.status   = ASS_STATUS.CONCLUIDO;
  etapa.data     = new Date().toISOString();
  etapa.driveUrl = driveUrl || null;
  etapa.versao   = 'v' + numeroEtapa + '_' + etapa.ator;
  etapa.emailAtor = emailAtor;

  if (numeroEtapa === 5) {
    // ── Fluxo concluído ──────────────────────────────────────────────────
    fluxo.statusGeral        = 'concluido';
    fluxo.timestampConclusao = new Date().toISOString();
    _ativarEstagio_(idEstagio);
    // Envia PDF final a todos os atores
    try { enviarPdfFinalParaTodos_(idEstagio, fluxo, driveUrl); } catch (e) { logErro_('enviarPdfFinalParaTodos_', e); }
  } else {
    // ── Ativa a próxima etapa ────────────────────────────────────────────
    var prazos    = obterPrazos_();
    var proxEtapa = fluxo.etapas[idx + 1];
    proxEtapa.status          = ASS_STATUS.AGUARDANDO;
    proxEtapa.prazoVencimento = calcularPrazoVencimento_(prazos.assinaturas[proxEtapa.ator] || 5);
    fluxo.etapaAtual          = numeroEtapa + 1;

    // Notifica o próximo ator
    try {
      var solProx = _obterDadosSolicitacaoCompleto_(idEstagio);
      // Re-resolve e-mail se estava vazio no momento da criação do fluxo
      if (!proxEtapa.email) {
        proxEtapa.email = _resolverEmailAtor_(proxEtapa.ator, solProx);
      }
      notificarAtorAssinatura_(idEstagio, proxEtapa, solProx, fluxo);
    } catch (e) { logErro_('concluirEtapaAssinatura_.notificarProx', e); }
  }

  salvarFluxoAssinaturas_(idEstagio, fluxo);
  _atualizarFluxoNaPlanilha_(idEstagio, fluxo);
  return jsonOk_({ fluxo: fluxo });
}

// ── Rejeição ──────────────────────────────────────────────────────────────────

/**
 * Registra rejeição de uma etapa.
 * Admin recebe notificação e decide para qual etapa o fluxo retorna.
 *
 * @param {string} idEstagio
 * @param {number} numeroEtapa        Etapa que rejeitou
 * @param {string} motivo
 * @param {number} retornoParaEtapa   Etapa para onde o fluxo volta (1–7)
 * @param {string} emailAdmin         E-mail do Admin que decidiu o retorno
 */
function rejeitarEtapaAssinatura_(idEstagio, numeroEtapa, motivo, retornoParaEtapa, emailAdmin) {
  var fluxo = obterFluxoAssinaturas_(idEstagio);
  if (!fluxo) return jsonError_('Fluxo não encontrado.', 'NOT_FOUND');

  var etapa = fluxo.etapas[numeroEtapa - 1];
  etapa.status = ASS_STATUS.REJEITADO;
  etapa.obs    = sanitizar_(motivo, 500);
  etapa.data   = new Date().toISOString();

  // Registra no histórico
  fluxo.historicoRejeicoes.push({
    etapa:            numeroEtapa,
    ator:             etapa.ator,
    label:            etapa.label,
    data:             new Date().toISOString(),
    motivo:           sanitizar_(motivo, 500),
    retornoParaEtapa: retornoParaEtapa,
    decididoPor:      emailAdmin,
  });

  // Reseta etapas do ponto de retorno até a etapa rejeitada
  var prazos = obterPrazos_();
  for (var i = retornoParaEtapa - 1; i < numeroEtapa; i++) {
    var et = fluxo.etapas[i];
    et.data     = null;
    et.driveUrl = null;
    et.versao   = null;
    et.obs      = i === retornoParaEtapa - 1 ? null : et.obs;
    if (i === retornoParaEtapa - 1) {
      et.status          = ASS_STATUS.AGUARDANDO;
      et.prazoVencimento = calcularPrazoVencimento_(prazos.assinaturas[et.ator] || 5);
    } else {
      et.status          = ASS_STATUS.PENDENTE;
      et.prazoVencimento = null;
    }
  }

  fluxo.etapaAtual = retornoParaEtapa;

  // Notifica o ator que precisa reassinar a partir da etapa de retorno
  try {
    var solRej = _obterDadosSolicitacaoCompleto_(idEstagio);
    notificarAtorAssinatura_(idEstagio, fluxo.etapas[retornoParaEtapa - 1], solRej, fluxo);
  } catch (e) { logErro_('rejeitarEtapaAssinatura_.notificar', e); }

  salvarFluxoAssinaturas_(idEstagio, fluxo);
  _atualizarFluxoNaPlanilha_(idEstagio, fluxo);
  return jsonOk_({ fluxo: fluxo });
}

// ── PropertiesService ─────────────────────────────────────────────────────────

function obterFluxoAssinaturas_(idEstagio) {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty('assinaturas_' + idEstagio);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    logErro_('obterFluxoAssinaturas_', e);
    return null;
  }
}

function salvarFluxoAssinaturas_(idEstagio, fluxo) {
  try {
    PropertiesService.getScriptProperties()
      .setProperty('assinaturas_' + idEstagio, JSON.stringify(fluxo));
  } catch (e) {
    logErro_('salvarFluxoAssinaturas_', e);
    throw e;
  }
}

// ── Drive ─────────────────────────────────────────────────────────────────────

/**
 * Retorna a pasta do estágio no Drive para armazenar os PDFs do TCE.
 * Usa a pasta já criada para o estágio (driveUrl na solicitação).
 * Se não encontrar, cria em Estágios / [Ano] / [ID — Nome].
 */
function _criarPastaAssinaturas_(idEstagio) {
  try {
    var sol   = _obterDadosSolicitacaoCompleto_(idEstagio);
    var pasta = abrirPastaEstagio_(String(sol.driveUrl || ''));
    if (pasta) return pasta;
    // Fallback: cria a pasta na hierarquia correta
    var res = criarPastaEstagio_(idEstagio, String(sol.nomeEstudante || ''));
    if (res.folder) return res.folder;
  } catch (e) {
    logErro_('_criarPastaAssinaturas_', e);
  }
  // Último recurso — sempre dentro da pasta raiz de estágios
  return DriveApp.getFolderById(CFG_DRIVE.ESTAGIOS_ID).createFolder('Estagio_' + idEstagio);
}

// ── Helpers TCE: configurações do sistema ────────────────────────────────

/**
 * Retorna a string completa da apólice de seguro configurada pelo admin.
 * Fallback para os valores padrão do IFRS caso não configurado.
 */
function _obterApoliceSeguro_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var num   = props.getProperty('config_apolice_num') || '080.00982.00820';
    var seg   = props.getProperty('config_apolice_seg') || 'SEGUROS SURA S/A';
    return 'Apólice nº ' + num + ', ' + seg;
  } catch (e) {
    return 'Apólice nº 080.00982.00820, SEGUROS SURA S/A';
  }
}

/**
 * Retorna o Blob do logo configurado pelo admin (armazenado no Drive).
 * Retorna null se não configurado ou em caso de erro.
 */
function _obterLogoCabecalho_() {
  try {
    var logoId = PropertiesService.getScriptProperties().getProperty('config_logo_drive_id');
    if (!logoId) return null;
    // Usa UrlFetchApp + Drive API v3 (mesmo padrão do QR code que funciona no Web App)
    // DriveApp.getBlob() produz um blob que body.appendImage() não consegue usar no contexto Web App
    var token = ScriptApp.getOAuthToken();
    var resp = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + logoId.trim() + '?alt=media',
      { headers: { 'Authorization': 'Bearer ' + token }, muteHttpExceptions: true }
    );
    if (resp.getResponseCode() !== 200) return null;
    return resp.getBlob().setContentType('image/png').setName('logo.png');
  } catch (e) {
    logErro_('_obterLogoCabecalho_', e);
    return null;
  }
}

// ── Helpers TCE: dados complementares ────────────────────────────────────────

function _obterDadosEmpresaTCE_(cnpj) {
  try {
    var sheet = SpreadsheetApp.openById(SS_ID).getSheetByName('Empresas');
    if (!sheet) return {};
    var dados = sheet.getDataRange().getValues();
    var cnpjN = String(cnpj || '').replace(/\D/g, '');
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][COL_EMP.CNPJ] || '').replace(/\D/g, '') !== cnpjN) continue;
      return {
        endereco:     String(dados[i][COL_EMP.ENDERECO]      || ''),
        bairro:       String(dados[i][COL_EMP.BAIRRO]        || ''),
        municipio:    String(dados[i][COL_EMP.MUNICIPIO]     || ''),
        uf:           String(dados[i][COL_EMP.UF]            || ''),
        cep:          String(dados[i][COL_EMP.CEP]           || ''),
        telEmpresa:   String(dados[i][COL_EMP.TEL_EMPRESA]   || ''),
        emailEmpresa: String(dados[i][COL_EMP.EMAIL_EMPRESA] || ''),
        nomeRep:      String(dados[i][COL_EMP.NOME_REP]      || ''),
        cargoRep:     String(dados[i][COL_EMP.CARGO_REP]     || ''),
        cpfRep:       String(dados[i][COL_EMP.CPF_REP]       || ''),
      };
    }
  } catch (e) { logErro_('_obterDadosEmpresaTCE_', e); }
  return {};
}

function _obterDadosSupervisorTCE_(nomeSupervisor) {
  try {
    var sheet = SpreadsheetApp.openById(SS_ID).getSheetByName('Supervisores');
    if (!sheet) return {};
    var dados = sheet.getDataRange().getValues();
    var nomeN = String(nomeSupervisor || '').trim().toLowerCase();
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][COL_SUP.NOME] || '').trim().toLowerCase() !== nomeN) continue;
      return {
        setor:    String(dados[i][COL_SUP.SETOR]    || ''),
        telefone: String(dados[i][COL_SUP.TEL_SUP]  || dados[i][COL_SUP.TEL_SETOR] || ''),
      };
    }
  } catch (e) { logErro_('_obterDadosSupervisorTCE_', e); }
  return {};
}

function _obterTelOrientadorTCE_(nomeOrientador) {
  try {
    var sheet = SpreadsheetApp.openById(SS_ID).getSheetByName('Orientadores');
    if (!sheet) return '';
    var dados = sheet.getDataRange().getValues();
    var nomeN = String(nomeOrientador || '').trim().toLowerCase();
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][COL_ORI.NOME] || '').trim().toLowerCase() !== nomeN) continue;
      return String(dados[i][COL_ORI.TEL] || '');
    }
  } catch (e) { logErro_('_obterTelOrientadorTCE_', e); }
  return '';
}

function _obterEndEstudanteTCE_(cpf) {
  try {
    var sheet = SpreadsheetApp.openById(SS_ID).getSheetByName('Estudantes');
    if (!sheet) return {};
    var dados = sheet.getDataRange().getValues();
    var cpfN = String(cpf || '').replace(/\D/g, '');
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][COL_EST.CPF] || '').replace(/\D/g, '') !== cpfN) continue;
      return {
        endereco: String(dados[i][COL_EST.ENDERECO] || ''),
        bairro:   String(dados[i][COL_EST.BAIRRO]   || ''),
        cep:      String(dados[i][COL_EST.CEP]       || ''),
        cidade:   String(dados[i][COL_EST.CIDADE]    || ''),
        uf:       String(dados[i][COL_EST.UF]        || ''),
      };
    }
  } catch (e) { logErro_('_obterEndEstudanteTCE_', e); }
  return {};
}

/**
 * Gera o PDF inicial do TCE com os dados completos da solicitação.
 * Reproduz fielmente o modelo oficial IFRS (14 cláusulas, blocos de dados formatados).
 * Adapta título, Cláusula 1ª, bolsa e §1º da Cláusula 9ª conforme o tipo de estágio.
 *
 * @param {string} idEstagio
 * @param {Object} sol   Dados da solicitação (de _obterDadosSolicitacaoCompleto_)
 * @param {string} pastaId  ID da pasta no Drive onde salvar o arquivo
 * @returns {DriveFile|null}
 */
function _gerarPdfTCEInicial_(idEstagio, sol, pastaId) {
  var docId = null;
  try {
    var isObrig  = !/não/i.test(String(sol.tipoEstagio || ''));
    var tipoNome = isObrig ? 'OBRIGATÓRIO' : 'NÃO OBRIGATÓRIO';

    // Dados complementares buscados nos cadastros
    var emp    = _obterDadosEmpresaTCE_(sol.cnpjEmpresa);
    var sup    = _obterDadosSupervisorTCE_(sol.nomeSupervisor);
    var oriTel = _obterTelOrientadorTCE_(sol.nomeOrientador);
    var estEnd = _obterEndEstudanteTCE_(sol.cpf);

    var doc  = DocumentApp.create('TCE_' + idEstagio + '_v0_original');
    docId    = doc.getId();
    var body = doc.getBody();
    body.clear();
    // Margens: topo/base 2 cm, esquerda/direita 2,5 cm (em pontos: 1 pt ≈ 1,33 px; 1 cm ≈ 28 pt)
    body.setMarginTop(56).setMarginBottom(56).setMarginLeft(72).setMarginRight(72);

    // ── Helpers de formatação internos ──────────────────────────────────────

    /**
     * Parágrafo "Label: Valor" com label em negrito.
     * @param {string} lbl   Texto do rótulo (sem os ": ")
     * @param {string} val   Valor a exibir (fallback "—")
     * @param {number} [indent]  Indentação em pontos
     */
    function kv(lbl, val, indent) {
      var v   = (val !== undefined && val !== null && String(val).trim()) ? String(val) : '—';
      var txt = lbl + ': ' + v;
      var p   = body.appendParagraph(txt);
      p.setSpacingBefore(1).setSpacingAfter(1);
      if (indent) p.setIndentStart(indent);
      var t = p.editAsText();
      t.setFontFamily('Arial').setFontSize(10);
      t.setBold(0, lbl.length, true);             // negrito no rótulo + ":"
      if (txt.length - 1 > lbl.length + 2) t.setBold(lbl.length + 2, txt.length - 1, false); // normal no valor
      return p;
    }

    /**
     * Linha com vários pares "Label: Valor" separados por espaços.
     * @param {Array<[string,string]>} pares  Ex.: [['Cidade','Rio Grande'],['Estado','RS']]
     */
    function kvRow(pares) {
      var partes = pares.map(function(p) { return p[0] + ': ' + (p[1] || '—'); });
      var txt = partes.join('     ');
      var p = body.appendParagraph(txt);
      p.setSpacingBefore(1).setSpacingAfter(1);
      var t = p.editAsText();
      t.setFontFamily('Arial').setFontSize(10);
      var pos = 0;
      partes.forEach(function(parte, i) {
        var lblLen = pares[i][0].length;
        t.setBold(pos, pos + lblLen, true);
        if (parte.length > lblLen + 2) t.setBold(pos + lblLen + 2, pos + parte.length - 1, false);
        pos += parte.length + (i < partes.length - 1 ? 5 : 0);
      });
      return p;
    }

    /** Cabeçalho de seção: negrito + linha horizontal */
    function sec(titulo) {
      var p = body.appendParagraph(titulo);
      p.setSpacingBefore(10).setSpacingAfter(3);
      p.editAsText().setFontFamily('Arial').setFontSize(10).setBold(true);
      body.appendHorizontalRule();
      return p;
    }

    /** Parágrafo normal */
    function txt(texto, opts) {
      opts = opts || {};
      var p = body.appendParagraph(texto || '');
      p.setSpacingBefore(opts.before !== undefined ? opts.before : 2);
      p.setSpacingAfter( opts.after  !== undefined ? opts.after  : 2);
      if (opts.indent)  p.setIndentStart(opts.indent);
      if (opts.center)  p.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
      var t = p.editAsText();
      t.setFontFamily('Arial').setFontSize(opts.size || 10);
      if (opts.bold)    t.setBold(true);
      if (opts.italic)  t.setItalic(true);
      return p;
    }

    /**
     * Cláusula numerada: "CLÁUSULA Xª – texto"
     * @param {string} num  Ex.: '1ª', '2ª'
     * @param {string} texto
     */
    function cla(num, texto) {
      var lbl = 'CLÁUSULA ' + num + '– ';
      var full = lbl + texto;
      var p = body.appendParagraph(full);
      p.setSpacingBefore(7).setSpacingAfter(2);
      var t = p.editAsText();
      t.setFontFamily('Arial').setFontSize(10);
      t.setBold(0, lbl.length - 1, true);
      t.setBold(lbl.length, full.length - 1, false);
      return p;
    }

    /** Sub-item de cláusula: "a) texto" com indentação */
    function sub(letra, texto) {
      var lbl  = letra + ')';
      var full = lbl + ' ' + texto;
      var p = body.appendParagraph(full);
      p.setSpacingBefore(2).setSpacingAfter(2).setIndentStart(28);
      var t = p.editAsText();
      t.setFontFamily('Arial').setFontSize(10);
      t.setBold(0, lbl.length - 1, true);
      t.setBold(lbl.length + 1, full.length - 1, false);
      return p;
    }

    /** Parágrafo legal: "§ Nº texto" com indentação */
    function par(numOrd, texto) {
      var full = '§ ' + numOrd + ' ' + texto;
      var p = body.appendParagraph(full);
      p.setSpacingBefore(2).setSpacingAfter(2).setIndentStart(28);
      p.editAsText().setFontFamily('Arial').setFontSize(10).setBold(false);
      return p;
    }

    /** Linha de assinatura (centralizada, com espaço generoso para assinatura digital) */
    function assin(nome, papel, complemento) {
      body.appendParagraph('').setSpacingBefore(28).setSpacingAfter(0); // +25% vs 22 pt
      txt('_______________________________________', { before:0, after:0, center:true });
      txt(nome || '—', { before:0, after:0, bold:true, center:true });
      txt(papel || '',  { before:0, after:0, center:true });
      if (complemento) txt(complemento, { before:0, after:2, italic:true, center:true });
    }

    // ── IDENTIFICAÇÃO INSTITUCIONAL: logo + texto (tudo no corpo, header falha no Web App) ──
    var _logoBlob = _obterLogoCabecalho_();
    if (_logoBlob) {
      try {
        var logoImg = body.appendImage(_logoBlob);
        logoImg.setWidth(54).setHeight(54);
        logoImg.getParent().setAlignment(DocumentApp.HorizontalAlignment.CENTER);
        logoImg.getParent().setSpacingBefore(0).setSpacingAfter(2);
      } catch (_logoErr) { logErro_('_gerarPdfTCEInicial_.logo', _logoErr); }
    }
    var iP1 = body.appendParagraph('MINISTÉRIO DA EDUCAÇÃO');
    iP1.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    iP1.setSpacingBefore(0).setSpacingAfter(1);
    iP1.editAsText().setFontFamily('Arial').setFontSize(8);
    var iP2 = body.appendParagraph('INSTITUTO FEDERAL DE EDUCAÇÃO, CIÊNCIA E TECNOLOGIA DO RIO GRANDE DO SUL');
    iP2.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    iP2.setSpacingBefore(1).setSpacingAfter(1);
    iP2.editAsText().setFontFamily('Arial').setFontSize(9).setBold(true);
    var iP3 = body.appendParagraph('Campus Rio Grande');
    iP3.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    iP3.setSpacingBefore(1).setSpacingAfter(10);
    iP3.editAsText().setFontFamily('Arial').setFontSize(8);

    // ── TÍTULO ────────────────────────────────────────────────────────────────
    var pTitulo = body.appendParagraph('TERMO DE COMPROMISSO DE ESTÁGIO ' + tipoNome);
    pTitulo.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    pTitulo.setSpacingBefore(4).setSpacingAfter(8);
    pTitulo.editAsText().setFontFamily('Arial').setFontSize(13).setBold(true);

    // ── ABERTURA ──────────────────────────────────────────────────────────────
    txt(
      'As partes abaixo qualificadas celebram entre si este TERMO DE COMPROMISSO DE ESTÁGIO ' + tipoNome +
      ', nos termos da Lei nº 11.788, de 25 de setembro de 2008, Lei nº 9.394, de 20 de ' +
      'dezembro de 1996 e no que couber, da Lei nº 8.666, de 21 de junho de 1993, e demais ' +
      'disposições aplicáveis, mediante as seguintes cláusulas e condições:',
      { before:0, after:8 }
    );

    // ── 1. DADOS DO IFRS ─────────────────────────────────────────────────────
    sec('DADOS DO IFRS – CAMPUS RIO GRANDE');
    kv('CNPJ', '10.637.926/0005-70');
    kv('Endereço', 'Rua Engenheiro Alfredo Huch, nº 475, Bairro Centro');
    kvRow([['Cidade', 'Rio Grande'], ['Estado', 'RS'], ['Telefone', '(53) 3233-8681']]);
    kvRow([['Representante Legal', 'Carlos Fernandes Júnior'], ['Cargo', 'Diretor Geral do Campus Rio Grande']]);
    kv('Professor Orientador', sol.nomeOrientador || '');
    kvRow([['Telefone', oriTel || ''], ['E-mail', sol.emailOrientador || '']]);

    // ── 2. DADOS DA CONCEDENTE ───────────────────────────────────────────────
    sec('DADOS DA CONCEDENTE');
    kv('Razão Social', sol.nomeEmpresa || '');
    kv('CNPJ', _formatarCnpj_(sol.cnpjEmpresa));
    kv('Endereço', [emp.endereco, emp.bairro].filter(Boolean).join(', '));
    kvRow([['Cidade', emp.municipio || ''], ['Estado', emp.uf || '']]);
    kvRow([['Telefone', emp.telEmpresa || ''], ['E-mail', emp.emailEmpresa || '']]);
    kv('Representante Legal', emp.nomeRep || '');
    kvRow([['Cargo', emp.cargoRep || ''], ['CPF', _formatarCpf_(emp.cpfRep)]]);
    kv('Nome do supervisor do Estágio', sol.nomeSupervisor || '');
    kv('Setor em que ocorrerá o estágio', sup.setor || '');
    kvRow([['Telefone', sup.telefone || ''], ['E-mail', sol.emailSupervisor || '']]);

    // ── 3. DADOS DO ESTAGIÁRIO ────────────────────────────────────────────────
    sec('DADOS DO ESTAGIÁRIO');
    kv('Nome completo', sol.nomeEstudante || '');
    kv('Matrícula nº', sol.matricula || '');
    kv('Data de Nascimento', _formatarDataBr_(sol.dataNasc));
    kv('Endereço', [estEnd.endereco, estEnd.bairro].filter(Boolean).join(', '));
    kvRow([['CEP', estEnd.cep || ''], ['Cidade', estEnd.cidade || ''], ['Estado', estEnd.uf || '']]);
    kvRow([['Telefone Residencial', '—'], ['Tel. Celular', sol.telefone || '']]);
    kv('Curso – modalidade', sol.curso || '');
    kv('E-mail', sol.emailEstudante || '');
    kv('Nome completo do responsável ou representante (se menor de 18 anos)', sol.nomeResp || '—');

    body.appendParagraph('').setSpacingBefore(6).setSpacingAfter(6);

    // ── CLÁUSULAS ─────────────────────────────────────────────────────────────
    var tipoMenc = isObrig ? 'estágio obrigatório' : 'estágio não obrigatório';

    cla('1ª–', 'Este instrumento tem por objetivo formalizar as condições básicas para a realização de ' +
        tipoMenc + ' e particularizar a relação jurídica especial existente entre o ESTUDANTE, a INSTITUIÇÃO ' +
        'CONCEDENTE e a INSTITUIÇÃO DE ENSINO.');

    cla('2ª–', 'O estágio, como ato educativo supervisionado visa ao desenvolvimento de competências ' +
        'próprias da atividade profissional e à contextualização curricular, objetivando o desenvolvimento do ' +
        'estagiário para a vida cidadã e para o trabalho, fazendo parte do projeto pedagógico do curso e da Lei ' +
        'de Diretrizes e Bases da Educação Nacional nº 9.394 de 20 de dezembro de 1996.');

    cla('3ª–', 'O estágio não cria vínculo empregatício de qualquer natureza entre as partes ' +
        'envolvidas, desde que observado o cumprimento da Lei.');

    // Cláusula 4ª — com os dados do estágio
    cla('4ª–', 'Em comum acordo as partes convencionam e estabelecem:');

    // 4a) Horários, vigência e atividades
    var p4a = body.appendParagraph('a) HORÁRIOS, VIGÊNCIA DO ESTÁGIO E DESCRIÇÃO DAS ATIVIDADES:');
    p4a.setSpacingBefore(4).setSpacingAfter(2).setIndentStart(20);
    p4a.editAsText().setFontFamily('Arial').setFontSize(10).setBold(true);

    kv('Dias da Semana e Horários do estágio', sol.horario || '', 32);
    kv('Carga Horária Semanal',                sol.cargaHoraria || '', 32);
    kv('Início de Estágio',                    _formatarDataBr_(sol.dataInicio), 32);
    kv('Fim do Estágio',                       _formatarDataBr_(sol.dataTermino), 32);
    kv('Descrição das Atividades',             sol.planoAtividades || '', 32);

    // 4b) Bolsa
    var p4b = body.appendParagraph('b) BOLSA AUXÍLIO E OUTROS BENEFÍCIOS:');
    p4b.setSpacingBefore(4).setSpacingAfter(2).setIndentStart(20);
    p4b.editAsText().setFontFamily('Arial').setFontSize(10).setBold(true);

    if (isObrig) {
      txt('No estágio obrigatório, o pagamento de bolsa e auxílio-transporte é opcional, podendo ser ' +
          'oferecido pela concedente.', { before:2, after:2, indent:32 });
      var temBolsa = sol.valorBolsa && String(sol.valorBolsa).trim() && String(sol.valorBolsa) !== '0';
      var temTransp = sol.valorTransporte && String(sol.valorTransporte).trim() && String(sol.valorTransporte) !== '0';
      if (temBolsa)  kv('Bolsa', 'R$ ' + sol.valorBolsa, 32);
      if (temTransp) kv('Auxílio-transporte', 'R$ ' + sol.valorTransporte, 32);
      if (!temBolsa && !temTransp) txt('Não se aplica nesta modalidade.', { before:2, after:2, indent:32, italic:true });
    } else {
      txt('No estágio não obrigatório, a bolsa e o auxílio-transporte são obrigatórios.', { before:2, after:2, indent:32 });
      kv('Bolsa', 'R$ ' + (sol.valorBolsa || '—'), 32);
      kv('Auxílio-transporte', 'R$ ' + (sol.valorTransporte || '—'), 32);
    }
    if (sol.outroAux) kv('Outro auxílio', sol.outroAux, 32);

    // 4c) Carga horária e atividades — referência ao plano
    var p4c = body.appendParagraph('c) CARGA HORÁRIA E ATIVIDADES DO ESTÁGIO:');
    p4c.setSpacingBefore(4).setSpacingAfter(2).setIndentStart(20);
    p4c.editAsText().setFontFamily('Arial').setFontSize(10).setBold(true);
    txt('A carga horária e as atividades desenvolvidas durante o estágio deverão estar em conformidade ' +
        'com o plano de atividades.', { before:2, after:2, indent:32 });

    // 4d) Adendo contratual
    var p4d = body.appendParagraph('d) ADENDO CONTRATUAL:');
    p4d.setSpacingBefore(4).setSpacingAfter(2).setIndentStart(20);
    p4d.editAsText().setFontFamily('Arial').setFontSize(10).setBold(true);
    txt('Havendo interesse das partes envolvidas na prorrogação do contrato, deverá ser formalizado ' +
        'um adendo ao contrato vigente.', { before:2, after:2, indent:32 });

    cla('5ª–', 'A jornada de atividade em estágio deverá compatibilizar-se com o horário ' +
        'acadêmico do estagiário e com o horário da CONCEDENTE.');
    par('Único', 'Nos períodos de férias escolares, a jornada será estabelecida de comum acordo entre ' +
        'o estagiário e a CONCEDENTE.');

    cla('6ª–', 'Conforme expressa previsão contida no Art. 9º, inciso IV, da Lei ' +
        'nº 11.788/08 combinado com o parágrafo único do mesmo artigo, o (a) estudante-estagiário (a) ' +
        'está segurado (a) contra acidentes pessoais, pela ' + _obterApoliceSeguro_() + '.');

    cla('7ª–', 'O IFRS – CAMPUS RIO GRANDE deverá comprometer-se a:');
    sub('a', 'celebrar, com cada aluno, este TERMO DE COMPROMISSO DE ESTÁGIO, zelando por seu cumprimento; ' +
        'reorientando o estagiário para outro local em caso de descumprimento destas normas;');
    sub('b', 'gerenciar os CONVÊNIOS e os TERMOS DE COMPROMISSO DE ESTÁGIO, organizando a documentação ' +
        'relacionada aos estágios, encaminhando aos interessados as vias respectivas e mantendo arquivada ' +
        'uma via no IFRS – CAMPUS RIO GRANDE;');
    sub('c', 'dispor sobre programação, orientação, supervisão e avaliação dos estágios;');
    sub('d', 'indicar um professor orientador da área a ser desenvolvida no estágio, como responsável pelo ' +
        'acompanhamento e avaliação das atividades do estagiário;');
    sub('e', 'prestar informações acerca da vida acadêmica do estagiário.');

    cla('8ª–', 'Cabe ao ORIENTADOR de estágio do IFRS – CAMPUS RIO GRANDE:');
    sub('a', 'cumprir o papel de orientar o estagiário e avaliar seu aprendizado;');
    sub('b', 'avaliar, quando possível, as instalações da CONCEDENTE e sua adequação à formação cultural ' +
        'e profissional do educando;');
    sub('c', 'manter contatos regulares com o SUPERVISOR de estágio da CONCEDENTE;');
    sub('d', 'Estabelecer junto à Concedente, o Plano de Atividades do Estagiário, que consubstancie as ' +
        'condições e requisitos suficientes de adequação à formação profissional deste.');

    cla('9ª–', 'A CONCEDENTE deverá comprometer-se a:');
    sub('a', 'solicitar ao IFRS – CAMPUS RIO GRANDE a quantidade necessária de estagiários nos cursos ' +
        'de seu interesse;');
    sub('b', 'selecionar e indicar alunos candidatos à vaga de estágio, podendo adotar critérios e meios ' +
        'para aferir conhecimentos e aptidões;');
    sub('c', 'celebrar, com cada estagiário, este TERMO DE COMPROMISSO DE ESTÁGIO, zelando por seu cumprimento;');
    sub('d', 'indicar funcionário de seu quadro de pessoal, com formação ou experiência profissional na área ' +
        'de conhecimento desenvolvida no curso do estagiário, para orientar e supervisionar até 10 (dez) ' +
        'estagiários simultaneamente;');
    sub('e', 'oferecer condições para que os estagiários sejam supervisionados por servidores do IFRS – ' +
        'CAMPUS RIO GRANDE;');
    sub('f', 'ofertar instalações que tenham condições de proporcionar ao educando atividades de aprendizagem ' +
        'social, profissional e cultural;');
    sub('g', 'aplicar a legislação relacionada à saúde e segurança no trabalho;');
    sub('h', 'efetuar o controle da assiduidade dos estagiários;');
    sub('i', 'conceder ou não ao estagiário, enquanto perdurar o estágio, a importância mensal, a título de ' +
        'bolsa, conforme o valor estipulado neste TERMO DE COMPROMISSO DE ESTÁGIO;');
    sub('j', 'autorizar o início do estágio somente após a assinatura, pelas partes envolvidas, deste ' +
        'TERMO DE COMPROMISSO DE ESTÁGIO;');
    sub('k', 'não alterar as atividades do estagiário sem prévia comunicação e anuência do IFRS – ' +
        'CAMPUS RIO GRANDE;');
    sub('l', 'manter à disposição da fiscalização documentos que comprovem a relação de estágio;');
    sub('m', 'emitir documentos comprobatórios do estágio;');
    sub('n', 'Proporcionar ao estagiário as condições para o exercício das atividades práticas compatíveis ' +
        'com seu Plano de Atividades.');
    if (isObrig) {
      par('1º', 'No caso de estágio obrigatório, a responsabilidade pela contratação do seguro, poderá ' +
          'alternativamente, ser assumida pelo IFRS – CAMPUS RIO GRANDE.');
    }
    par('2º', 'É assegurado ao estagiário, sempre que o estágio tenha duração igual ou superior a 01 ' +
        '(um) ano, período de recesso de 30 (trinta) dias, a ser gozado preferencialmente durante suas férias ' +
        'escolares. Este recesso deverá ser remunerado quando o estagiário receber bolsa ou outra forma de ' +
        'contraprestação. Os dias de recesso previstos neste parágrafo serão concedidos de maneira proporcional, ' +
        'nos casos de o estágio ter duração inferior a 01 (um) ano.');

    cla('10ª–', 'Cabe ao SUPERVISOR de estágio da CONCEDENTE:');
    sub('a', 'orientar o estagiário acerca das atividades a serem desenvolvidas;');
    sub('b', 'orientar o estagiário sobre aspectos comportamentais e normas da CONCEDENTE, inclusive no que ' +
        'se refere à postura e vestuário adequados;');
    sub('c', 'acompanhar profissionalmente o estagiário, de modo especial no que se refere à verificação da ' +
        'existência de correlação entre as atividades desenvolvidas pelo mesmo e as exigidas pelo IFRS – ' +
        'CAMPUS RIO GRANDE;');
    sub('d', 'avaliar o desempenho do estagiário;');
    sub('e', 'manter contatos regulares com o ORIENTADOR de estágio do IFRS – CAMPUS RIO GRANDE;');
    sub('f', 'estimular a produção de novos conhecimentos, bem como a reflexão crítica quando da análise de ' +
        'situações, visando o aprendizado da atuação profissional do estagiário;');
    sub('g', 'Enviar à instituição de ensino, com periodicidade não superior a 06 (seis) meses o relatório ' +
        'de atividades, com vista obrigatória ao estagiário;');
    sub('h', 'comunicar ao IFRS – CAMPUS RIO GRANDE sobre a eventual alteração de SUPERVISOR de ' +
        'estágio na CONCEDENTE.');

    cla('11ª–', 'O ESTAGIÁRIO deverá comprometer-se a:');
    sub('a', 'zelar pelo cumprimento deste TERMO DE COMPROMISSO DE ESTÁGIO;');
    sub('b', 'cumprir com empenho a programação de estágio;');
    sub('c', 'cumprir as normas de trabalho estabelecidas pela CONCEDENTE, com responsabilidade, empenho e ' +
        'atenção, especialmente aquelas que resguardam sigilo às informações a que tenha acesso em decorrência ' +
        'do estágio;');
    sub('d', 'informar quando suas atividades de estágio estiverem em desacordo com as atividades descritas ' +
        'neste TERMO DE COMPROMISSO DE ESTÁGIO ou com seu curso de formação;');
    sub('e', 'utilizar os equipamentos de proteção individual e coletiva fornecidos pela CONCEDENTE;');
    sub('f', 'responder por perdas e danos consequentes da inobservância das normas internas da CONCEDENTE ' +
        'ou das constantes do presente TERMO DE COMPROMISSO DE ESTÁGIO;');
    sub('g', 'ser pontual, assíduo e responsável;');
    sub('h', 'Preencher o relatório de atividades e entregá-lo na Instituição de Ensino na periodicidade ' +
        'máxima a cada 06 (seis) meses ou ao término do estágio;');
    sub('i', 'portar-se com urbanidade, respeito e cordialidade;');
    sub('j', 'zelar pelos equipamentos e bens em geral da CONCEDENTE;');
    sub('k', 'racionalizar o uso do material da CONCEDENTE, evitando desperdícios;');
    sub('l', 'procurar elevar sempre o nome do IFRS – CAMPUS RIO GRANDE;');
    sub('m', 'procurar os responsáveis pelo seu estágio sempre que necessário.');

    cla('12ª–', 'Este TERMO DE COMPROMISSO DE ESTÁGIO poderá ser alterado, ou prorrogado, mediante ' +
        'TERMO ADITIVO; ou rescindido, de comum acordo entre as partes, ou unilateralmente, mediante ' +
        'notificação escrita, com antecedência mínima de 05 (cinco) dias.');

    cla('13ª–', 'Os casos omissos serão resolvidos conjuntamente pela CONCEDENTE e pelo ' +
        'IFRS – CAMPUS RIO GRANDE.');

    cla('14ª–', 'Fica eleito o foro da Justiça Federal de RIO GRANDE/RS como competente para ' +
        'dirimir qualquer questão proveniente deste TERMO DE COMPROMISSO DE ESTÁGIO, eventualmente não ' +
        'resolvida no âmbito administrativo.');

    // ── FECHAMENTO ────────────────────────────────────────────────────────────
    txt('Assim, por estarem de comum acordo, as partes envolvidas assinam o presente Termo de Compromisso, ' +
        'em 03 (três) vias de igual teor e forma.', { before:10, after:8 });
    // Data de geração real por extenso em português, fuso horário de Brasília
    var _hojeDate  = new Date();
    var _mesesPt   = ['janeiro','fevereiro','março','abril','maio','junho','julho',
                      'agosto','setembro','outubro','novembro','dezembro'];
    var _diaNum    = parseInt(Utilities.formatDate(_hojeDate, 'America/Sao_Paulo', 'd'), 10);
    var _mesNum    = parseInt(Utilities.formatDate(_hojeDate, 'America/Sao_Paulo', 'M'), 10) - 1;
    var _anoNum    = Utilities.formatDate(_hojeDate, 'America/Sao_Paulo', 'yyyy');
    var _dataTCE   = 'Rio Grande, ' + _diaNum + ' de ' + _mesesPt[_mesNum] + ' de ' + _anoNum + '.';
    txt(_dataTCE, { before:4, after:20 });

    // ── ASSINATURAS ───────────────────────────────────────────────────────────
    assin('Representante',                            'CONCEDENTE',         null);
    assin('DIRETOR-GERAL DO IFRS – CAMPUS RIO GRANDE','INSTITUIÇÃO DE ENSINO', null);
    if (sol.nomeResp) {
      // Estagiário menor de idade: responsável legal assina no lugar do estagiário
      assin(sol.nomeResp,
            'RESPONSÁVEL LEGAL DO(A) ESTAGIÁRIO(A) ' + (sol.nomeEstudante || '').toUpperCase(),
            'CPF: ' + _formatarCpf_(sol.cpfResp));
    } else {
      // Estagiário maior de idade: assina por si mesmo
      assin(sol.nomeEstudante || 'ESTAGIÁRIO(A)', 'ESTAGIÁRIO(A)', null);
    }

    // ── RODAPÉ ────────────────────────────────────────────────────────────────
    var ftr = doc.addFooter();
    var fP  = ftr.appendParagraph(
      'SGE · IFRS Campus Rio Grande · Emitido automaticamente em ' +
      _formatarDataBr_(new Date()) + ' · ID: ' + idEstagio
    );
    fP.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    fP.editAsText().setFontFamily('Arial').setFontSize(7).setItalic(true);

    doc.saveAndClose();

    // ── EXPORTAR COMO PDF ─────────────────────────────────────────────────────
    var pdfBlob = DriveApp.getFileById(docId)
        .getAs(MimeType.PDF)
        .setName('TCE_' + idEstagio + '_v0_original.pdf');
    var arquivo = DriveApp.getFolderById(pastaId).createFile(pdfBlob);

    // Mantém o Google Doc na pasta junto com o PDF
    var docFile = DriveApp.getFileById(docId);
    try {
      DriveApp.getFolderById(pastaId).addFile(docFile);
      DriveApp.getRootFolder().removeFile(docFile);
    } catch (_mv) {}

    return arquivo;

  } catch (e) {
    logErro_('_gerarPdfTCEInicial_', e);
    if (docId) { try { DriveApp.getFileById(docId).setTrashed(true); } catch (_) {} }
    throw e;  // propaga para o chamador poder reportar o erro real
  }
}

// ── Formatadores usados na geração do PDF ─────────────────────────────────────

function _formatarDataBr_(val) {
  if (!val) return '—';
  try {
    var d = (val instanceof Date) ? val
          : new Date(String(val).indexOf('T') === -1 ? val + 'T12:00:00' : val);
    if (isNaN(d.getTime())) return String(val);
    return d.toLocaleDateString('pt-BR',
      { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' });
  } catch (e) { return String(val); }
}

function _formatarCpf_(cpf) {
  if (!cpf) return '—';
  var c = String(cpf).replace(/\D/g, '');
  if (c.length !== 11) return String(cpf);
  return c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

function _formatarCnpj_(cnpj) {
  if (!cnpj) return '—';
  var c = String(cnpj).replace(/\D/g, '');
  if (c.length !== 14) return String(cnpj);
  return c.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

// ── Planilha: aba "Fluxo TCE" ─────────────────────────────────────────────────

function _atualizarFluxoNaPlanilha_(idEstagio, fluxo) {
  try {
    var sheet = SpreadsheetApp.openById(SS_ID).getSheetByName(ASSINATURAS_SHEET);
    if (!sheet) return;

    // Monta linha: [ID, statusGeral, etapaAtual, pastaId,
    //              (status, data, url) × 8 etapas,
    //              tsCriacao, tsConclusao]
    var linha = [idEstagio, fluxo.statusGeral, fluxo.etapaAtual, fluxo.drivePastaId || ''];
    fluxo.etapas.forEach(function (et) {
      linha.push(et.status, et.data || '', et.driveUrl || '');
    });
    linha.push(fluxo.timestampCriacao, fluxo.timestampConclusao || '');

    var dados  = sheet.getDataRange().getValues();
    var rowIdx = -1;
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][0]) === String(idEstagio)) { rowIdx = i + 1; break; }
    }
    if (rowIdx > 0) {
      sheet.getRange(rowIdx, 1, 1, linha.length).setValues([linha]);
    } else {
      sheet.appendRow(linha);
    }
  } catch (e) {
    logErro_('_atualizarFluxoNaPlanilha_', e);
  }
}

// ── Utilitários ───────────────────────────────────────────────────────────────

/** Busca e-mail do Diretor Geral ativo na aba "Diretor Geral". */
function _obterEmailDirecao_() {
  try {
    var sheet = SpreadsheetApp.openById(SS_ID).getSheetByName('Diretor Geral');
    if (!sheet) return null;
    var dados = sheet.getDataRange().getValues();
    // Cabeçalho: Nome | SIAPE | CPF | E-mail | Status
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][4]).toLowerCase() === 'ativo') return dados[i][3];
    }
    return null;
  } catch (e) {
    return null;
  }
}

/** Atualiza Status na aba Solicitações para "Ativo" e registra data de ativação. */
function _ativarEstagio_(idEstagio) {
  try {
    var sheet = SpreadsheetApp.openById(SS_ID).getSheetByName('Solicitações');
    if (!sheet) return;
    var dados = sheet.getDataRange().getValues();
    // Col 2 (índice 1) = ID Estágio | Col 29 (índice 28) = Status | Col 35 (índice 34) = Data Ativação
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][1]) === String(idEstagio)) {
        sheet.getRange(i + 1, 29).setValue('Ativo');
        sheet.getRange(i + 1, 35).setValue(new Date().toISOString());
        return;
      }
    }
  } catch (e) {
    logErro_('_ativarEstagio_', e);
  }
}

/**
 * Busca todos os dados de uma solicitação na aba Solicitações.
 * Usa os índices de COL_SOL (definidos em api-solicitacao.gs) para acesso
 * direto e retorna o conjunto completo de campos — inclusive os necessários
 * para geração do PDF do TCE.
 *
 * @param  {string} idEstagio
 * @returns {Object}
 */
function _obterDadosSolicitacaoCompleto_(idEstagio) {
  try {
    var sheet = SpreadsheetApp.openById(SS_ID).getSheetByName('Solicitações');
    if (!sheet) return {};
    var dados = sheet.getDataRange().getValues();

    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][COL_SOL.ID_ESTAGIO]) === String(idEstagio)) {
        var r = dados[i];
        var curso = String(r[COL_SOL.CURSO] || '');
        return {
          // ── Identificação ─────────────────────────────────────────────────
          idEstagio:       r[COL_SOL.ID_ESTAGIO]          || '',
          // ── Estudante ─────────────────────────────────────────────────────
          nomeEstudante:   r[COL_SOL.NOME_ESTUDANTE]       || '',
          emailEstudante:  r[COL_SOL.EMAIL_ESTUDANTE]      || '',
          matricula:       r[COL_SOL.MATRICULA]            || '',
          curso:           curso,
          cpf:             r[COL_SOL.CPF]                  || '',
          dataNasc:        r[COL_SOL.DATA_NASC]            || '',
          telefone:        r[COL_SOL.TELEFONE]             || '',
          turno:           r[COL_SOL.TURNO]                || '',
          semestre:        r[COL_SOL.SEMESTRE_SOL]         || '',
          formando:        r[COL_SOL.FORMANDO]             || '',
          nee:             r[COL_SOL.NEE]                  || '',
          nomeResp:        r[COL_SOL.NOME_RESP]            || '',
          cpfResp:         r[COL_SOL.CPF_RESP]             || '',
          telResp:         r[COL_SOL.TEL_RESP]             || '',
          // ── Empresa ───────────────────────────────────────────────────────
          nomeEmpresa:     r[COL_SOL.NOME_EMPRESA]         || '',
          cnpjEmpresa:     r[COL_SOL.CNPJ_EMPRESA]         || '',
          nomeSupervisor:  r[COL_SOL.NOME_SUPERVISOR]      || '',
          emailSupervisor: r[COL_SOL.EMAIL_SUPERVISOR]     || '',
          nomeAgente:      r[COL_SOL.NOME_AGENTE]          || '',
          // emailEmpresa: usada em notificações para o ator "empresa" no checklist/assinaturas
          emailEmpresa:    r[COL_SOL.EMAIL_INST_ESTAGIO]   || '',
          // ── Orientador ────────────────────────────────────────────────────
          nomeOrientador:  r[COL_SOL.NOME_ORIENTADOR]      || '',
          emailOrientador: r[COL_SOL.EMAIL_ORIENTADOR]     || '',
          // ── Estágio ───────────────────────────────────────────────────────
          tipoEstagio:     r[COL_SOL.TIPO_ESTAGIO]         || '',
          dataInicio:      r[COL_SOL.DATA_INICIO]          || '',
          dataTermino:     r[COL_SOL.DATA_TERMINO]         || '',
          cargaHoraria:    r[COL_SOL.CARGA_HOR]            || '',
          horario:         r[COL_SOL.HORARIO]              || '',
          remuneracao:     r[COL_SOL.REMUNERACAO]          || '',
          valorBolsa:      r[COL_SOL.VALOR_BOLSA]          || '',
          valorTransporte: r[COL_SOL.VALOR_TRANSPORTE]     || '',
          planoAtividades: r[COL_SOL.PLANO_ATIVIDADES]     || '',
          // ── Documentos ────────────────────────────────────────────────────
          linkDocMat:      r[COL_SOL.LINK_DOC_MAT]         || '',
          linkDocId:       r[COL_SOL.LINK_DOC_ID]          || '',
          linkDocBol:      r[COL_SOL.LINK_DOC_BOL]         || '',
          driveUrl:        r[COL_SOL.DRIVE_URL]             || '',
          // ── Coordenador (calculado por curso) ─────────────────────────────
          emailCoordenador: _obterEmailCoordenadorPorCurso_(curso),
        };
      }
    }
    return {};
  } catch (e) {
    logErro_('_obterDadosSolicitacaoCompleto_', e);
    return {};
  }
}

/**
 * Busca o e-mail do representante da empresa na aba "Empresas" pelo CNPJ.
 * Retorna EMAIL_REP (e-mail do representante legal) como destino das notificações.
 * Fallback: valor já armazenado na solicitação (emailEmpresa / emailInstEstagio).
 *
 * @param {string} cnpjEmpresa  CNPJ (com ou sem máscara)
 * @param {string} fallback     E-mail alternativo se não encontrar
 * @return {string}
 */
function _obterEmailRepEmpresa_(cnpjEmpresa, fallback) {
  try {
    var sheet = SpreadsheetApp.openById(SS_ID).getSheetByName('Empresas');
    if (!sheet) return fallback || '';
    var cnpjNorm = String(cnpjEmpresa || '').replace(/\D/g, '').trim();
    if (!cnpjNorm) return fallback || '';
    var dados = sheet.getDataRange().getValues();
    for (var i = 1; i < dados.length; i++) {
      var status = String(dados[i][COL_EMP.STATUS] || '').trim();
      if (status === 'Excluído') continue;
      var cnpjRow = String(dados[i][COL_EMP.CNPJ] || '').replace(/\D/g, '').trim();
      if (cnpjRow !== cnpjNorm) continue;
      var emailRep = String(dados[i][COL_EMP.EMAIL_REP] || '').trim();
      if (emailRep) return emailRep;
    }
  } catch (e) {
    logErro_('_obterEmailRepEmpresa_', e);
  }
  return fallback || '';
}

/** Busca e-mail do coordenador ativo de um curso. */
function _obterEmailCoordenadorPorCurso_(curso) {
  try {
    if (!curso) {
      logErro_('_obterEmailCoordenadorPorCurso_', new Error('Curso vazio'));
      return '';
    }
    var sheet = SpreadsheetApp.openById(SS_ID).getSheetByName('Coordenadores');
    if (!sheet) {
      logErro_('_obterEmailCoordenadorPorCurso_', new Error('Aba Coordenadores não encontrada'));
      return '';
    }
    var dados  = sheet.getDataRange().getValues();
    var cursoN = String(curso).trim().toLowerCase();
    // 1ª passagem — correspondência exata de curso + status Ativo
    for (var i = 1; i < dados.length; i++) {
      var cursoRow  = String(dados[i][COL_COORD.CURSO]  || '').trim().toLowerCase();
      var statusRow = String(dados[i][COL_COORD.STATUS] || '').trim().toLowerCase();
      var emailRow  = String(dados[i][COL_COORD.EMAIL]  || '').trim();
      if (cursoRow === cursoN && statusRow === 'ativo' && emailRow) return emailRow;
    }
    // 2ª passagem — correspondência parcial (curso contém ou é contido)
    for (var j = 1; j < dados.length; j++) {
      var cRow2 = String(dados[j][COL_COORD.CURSO]  || '').trim().toLowerCase();
      var sRow2 = String(dados[j][COL_COORD.STATUS] || '').trim().toLowerCase();
      var eRow2 = String(dados[j][COL_COORD.EMAIL]  || '').trim();
      if (sRow2 === 'ativo' && eRow2
          && (cRow2.indexOf(cursoN) !== -1 || cursoN.indexOf(cRow2) !== -1)) {
        return eRow2;
      }
    }
    logErro_('_obterEmailCoordenadorPorCurso_', new Error('Nenhum coordenador ativo para o curso: "' + curso + '"'));
    return '';
  } catch (e) {
    logErro_('_obterEmailCoordenadorPorCurso_', e);
    return '';
  }
}

// ── Resolução de e-mails por ator ────────────────────────────────────────────

/**
 * Retorna o e-mail correto para um ator do fluxo.
 * Usado tanto na criação do fluxo quanto no reenvio (caso o e-mail tenha ficado vazio).
 *
 * @param {string} ator  Nome do ator (estudante, empresa, supervisor, orientador, coordenador, …)
 * @param {Object} sol   Dados completos da solicitação
 * @return {string}
 */
function _resolverEmailAtor_(ator, sol) {
  switch (ator) {
    case 'estudante':      return sol.emailEstudante  || '';
    case 'empresa':        return _obterEmailRepEmpresa_(sol.cnpjEmpresa, sol.emailEmpresa);
    case 'supervisor':     return _obterEmailSetorSupervisor_(sol.nomeSupervisor, sol.emailSupervisor);
    case 'orientador':     return sol.emailOrientador || '';
    case 'coordenador':    return _obterEmailCoordenadorPorCurso_(sol.curso);
    case 'centralRevisao': return 'estagios@riogrande.ifrs.edu.br';
    case 'direcao':        return _obterEmailDirecao_() || '';
    case 'centralFinal':   return 'estagios@riogrande.ifrs.edu.br';
    default:               return '';
  }
}

// ── Notificações de E-mail ────────────────────────────────────────────────────

/**
 * Notifica o ator da etapa atual que é a vez dele agir.
 *
 * @param {string} idEstagio
 * @param {Object} etapa   Objeto de etapa do fluxo (com .tipo, .email, .label, .numero, .prazoVencimento)
 * @param {Object} sol     Dados completos da solicitação
 * @param {Object} fluxo   Estado atual do fluxo (para pegar URL do PDF mais recente)
 */
function notificarAtorAssinatura_(idEstagio, etapa, sol, fluxo) {
  if (!etapa) return;
  if (!etapa.email) {
    logErro_('notificarAtorAssinatura_', new Error(
      'E-mail vazio para o ator "' + (etapa.ator || etapa.label) + '" (etapa ' + etapa.numero + ') — estágio ' + idEstagio
    ));
    return;
  }

  // URL da página com magic-link token (sem links diretos ao Drive)
  var pageUrl = BASE_URL + '/assinaturas/?id=' + encodeURIComponent(idEstagio)
                + '&token=' + encodeURIComponent(etapa.token || '');

  // Verifica se esta notificação é fruto de uma rejeição (para incluir motivo no e-mail)
  var motivoRejeicao = null;
  if (fluxo && fluxo.historicoRejeicoes && fluxo.historicoRejeicoes.length) {
    var rejeicoes = fluxo.historicoRejeicoes.filter(function(r) { return r.retornoParaEtapa === etapa.numero; });
    if (rejeicoes.length) motivoRejeicao = rejeicoes[rejeicoes.length - 1].motivo || null;
  }

  if (etapa.tipo === 'govbr') {
    MAIL.enviarEmailAssinaturaGovBr({
      idEstagio:       idEstagio,
      nomeEstudante:   sol.nomeEstudante || '',
      labelAtor:       etapa.label,
      prazoVencimento: etapa.prazoVencimento || '',
      email:           etapa.email,
      pageUrl:         pageUrl,
      numeroEtapa:     etapa.numero,
      motivoRejeicao:  motivoRejeicao,
    });
  } else {
    MAIL.enviarEmailAssinaturaInterno({
      idEstagio:       idEstagio,
      nomeEstudante:   sol.nomeEstudante || '',
      labelAtor:       etapa.label,
      prazoVencimento: etapa.prazoVencimento || '',
      email:           etapa.email,
      pageUrl:         pageUrl,
      numeroEtapa:     etapa.numero,
      motivoRejeicao:  motivoRejeicao,
    });
  }

  // Bell notification para atores com acesso OAuth ao sistema
  try {
    if (etapa.ator === 'estudante' && etapa.email) {
      criarNotificacao_({
        email:     etapa.email,
        perfil:    'estudante',
        idEstagio: idEstagio,
        tipo:      'lembrete_assinatura',
        mensagem:  'TCE de estágio aguarda sua assinatura.',
      });
    } else if ((etapa.ator === 'centralRevisao' || etapa.ator === 'centralFinal') && CFG_ADMIN && CFG_ADMIN.ADMIN_EMAILS) {
      var _msgTCE = etapa.ator === 'centralRevisao'
        ? 'TCE aguarda revisão — ' + (sol.nomeEstudante || idEstagio)
        : 'TCE aguarda finalização — ' + (sol.nomeEstudante || idEstagio);
      CFG_ADMIN.ADMIN_EMAILS.forEach(function(adminEmail) {
        criarNotificacao_({
          email:     adminEmail,
          perfil:    'admin',
          idEstagio: idEstagio,
          tipo:      'lembrete_assinatura',
          mensagem:  _msgTCE,
        });
      });
    }
  } catch (_) {}
}

/**
 * Envia o PDF final assinado para todos os envolvidos ao concluir o fluxo.
 *
 * @param {string} idEstagio
 * @param {Object} fluxo
 * @param {string} driveUrl  URL do arquivo final enviado pela Central (etapa 8)
 */
function enviarPdfFinalParaTodos_(idEstagio, fluxo, driveUrl) {
  var sol = _obterDadosSolicitacaoCompleto_(idEstagio);
  var destinatarios = [
    { email: sol.emailEstudante,                                                           nome: sol.nomeEstudante  || 'Estudante'  },
    { email: _obterEmailRepEmpresa_(sol.cnpjEmpresa, sol.emailEmpresa),                   nome: sol.nomeEmpresa    || 'Empresa'    },
    { email: _obterEmailSetorSupervisor_(sol.nomeSupervisor, sol.emailSupervisor),         nome: sol.nomeSupervisor || 'Supervisor' },
    { email: sol.emailOrientador,                                                          nome: sol.nomeOrientador || 'Orientador' },
    { email: sol.emailCoordenador,                                                         nome: 'Coordenador'                      },
    { email: 'estagios@riogrande.ifrs.edu.br',                                            nome: 'Setor de Estágios'                },
  ].filter(function (d) { return !!(d.email && String(d.email).indexOf('@') > 0); });

  // URL final: preferência para arquivo enviado pela Central; fallback para último PDF do fluxo
  var urlFinal = driveUrl || '';
  if (!urlFinal && fluxo && fluxo.etapas) {
    for (var i = fluxo.etapas.length - 1; i >= 0; i--) {
      if (fluxo.etapas[i].driveUrl) { urlFinal = fluxo.etapas[i].driveUrl; break; }
    }
  }

  // Monta mapa token por ator para links individuais
  var tokenPorAtor = {};
  if (fluxo && fluxo.etapas) {
    fluxo.etapas.forEach(function(et) {
      if (et.ator && et.token) tokenPorAtor[et.ator] = et.token;
    });
  }

  MAIL.enviarEmailPdfFinalAssinaturas({
    idEstagio:     idEstagio,
    nomeEstudante: sol.nomeEstudante || '',
    tokenPorAtor:  tokenPorAtor,
    destinatarios: destinatarios,
  });
}

// ── Upload de PDF assinado ────────────────────────────────────────────────────

/**
 * Recebe um PDF assinado em base64, salva no Drive e avança a etapa.
 * Usado pelos atores das etapas govbr (e opcionalmente pela centralFinal).
 *
 * @param {string} idEstagio
 * @param {number} numeroEtapa
 * @param {string} pdfBase64    Conteúdo do PDF em base64
 * @param {string} emailAtor    E-mail do ator que está enviando (auditoria + validação)
 * @returns {Object} jsonOk_ / jsonError_
 */
function uploadPdfAssinado_(idEstagio, numeroEtapa, pdfBase64, token) {
  if (!idEstagio || !numeroEtapa || !pdfBase64) {
    return jsonError_('Parâmetros obrigatórios: idEstagio, numeroEtapa, pdfBase64.', 'MISSING_PARAM');
  }

  var fluxo = obterFluxoAssinaturas_(idEstagio);
  if (!fluxo) return jsonError_('Fluxo de assinaturas não encontrado.', 'NOT_FOUND');

  // Valida pelo token
  var etapaDoToken = _validarTokenFluxo_(fluxo, token);
  if (!etapaDoToken) return jsonError_('Token inválido ou não autorizado.', 'AUTH_ERROR');

  var etapa = fluxo.etapas[numeroEtapa - 1];
  if (!etapa)                                 return jsonError_('Etapa inválida: ' + numeroEtapa, 'INVALID');
  if (etapa.numero !== etapaDoToken.numero)   return jsonError_('Token não corresponde a esta etapa.', 'AUTH_ERROR');
  if (etapa.status !== ASS_STATUS.AGUARDANDO) return jsonError_('Etapa não está aguardando ação.', 'INVALID_STATE');

  // Decodifica e salva o PDF no Drive (privado)
  try {
    var pdfBytes = Utilities.base64Decode(pdfBase64);
    var nomePdf  = 'TCE_' + idEstagio + '_v' + numeroEtapa + '_' + etapa.ator + '.pdf';
    var blob     = Utilities.newBlob(pdfBytes, MimeType.PDF, nomePdf);
    var pasta    = DriveApp.getFolderById(fluxo.drivePastaId);
    var arquivo  = pasta.createFile(blob);
    var driveUrl = arquivo.getUrl();

    return concluirEtapaAssinatura_(idEstagio, numeroEtapa, driveUrl, etapa.email || token);
  } catch (e) {
    logErro_('uploadPdfAssinado_', e);
    return jsonError_('Falha ao salvar PDF no Drive: ' + e.message, 'DRIVE_ERROR');
  }
}

// ── Handlers GET / POST ───────────────────────────────────────────────────────

/**
 * Lista todos os fluxos de assinaturas onde a etapa `numEtapa` está com
 * status "aguardando". Lê a aba "Fluxo TCE" para eficiência; carrega
 * PropertiesService apenas para os itens relevantes.
 *
 * Layout da aba "Fluxo TCE" (0-based):
 *   0=ID, 1=statusGeral, 2=etapaAtual, 3=pastaId
 *   4+(n-1)*3 = status da etapa n, +1 = data, +2 = driveUrl
 *
 * @param  {number} numEtapa  1–8
 * @returns {Array<Object>}
 */
function listarFluxosPendentesEtapa_(numEtapa) {
  try {
    var sheet = SpreadsheetApp.openById(SS_ID).getSheetByName(ASSINATURAS_SHEET);
    if (!sheet) return [];
    var dados   = sheet.getDataRange().getValues();
    var statusCol = 4 + (numEtapa - 1) * 3; // 0-based

    var resultado = [];
    for (var i = 1; i < dados.length; i++) {
      var row = dados[i];
      if (!row[0]) continue;
      if (String(row[1]).toLowerCase() !== 'em_andamento') continue;
      if (String(row[statusCol]).toLowerCase() !== ASS_STATUS.AGUARDANDO) continue;

      var id    = String(row[0]);
      var fluxo = obterFluxoAssinaturas_(id);
      if (!fluxo) continue;

      var sol = {};
      try { sol = _obterDadosSolicitacaoCompleto_(id); } catch (_) {}

      var etapa   = fluxo.etapas && fluxo.etapas[numEtapa - 1];
      var prevEt  = fluxo.etapas && numEtapa > 1 ? fluxo.etapas[numEtapa - 2] : null;
      var pdfUrl  = (prevEt && prevEt.driveUrl) || fluxo.pdfOriginalUrl || '';

      resultado.push({
        idEstagio:      id,
        nomeEstudante:  sol.nomeEstudante  || '',
        nomeEmpresa:    sol.nomeEmpresa    || '',
        curso:          sol.curso          || '',
        tipoEstagio:    sol.tipoEstagio    || '',
        pdfUrl:         pdfUrl,
        prazoVencimento: etapa ? (etapa.prazoVencimento || '') : '',
        tsFluxo:        fluxo.timestampCriacao || '',
      });
    }
    return resultado;
  } catch (e) {
    logErro_('listarFluxosPendentesEtapa_', e);
    return [];
  }
}

/** Encontra a etapa do fluxo que corresponde ao token. Retorna null se não encontrar. */
function _validarTokenFluxo_(fluxo, token) {
  if (!token || !fluxo || !fluxo.etapas) return null;
  for (var i = 0; i < fluxo.etapas.length; i++) {
    if (fluxo.etapas[i].token === token) return fluxo.etapas[i];
  }
  return null;
}

/** Extrai o ID de arquivo do Drive a partir de uma URL do Drive. */
function _extrairFileIdDoUrl_(url) {
  if (!url) return null;
  var m = String(url).match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  m = String(url).match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  return m ? m[1] : null;
}

// ── Handlers GET / POST ───────────────────────────────────────────────────────

function doGetAssinaturas(e) {
  var action = (e.parameter && e.parameter.action) || '';
  var id     = (e.parameter && e.parameter.id)     || '';

  switch (action) {
    case 'listarFluxosPendentesEtapa': {
      var numEt = parseInt(e.parameter.etapa, 10);
      if (!numEt || numEt < 1 || numEt > 8)
        return jsonError_('Parâmetro etapa deve ser 1–8.', 'MISSING_PARAM');
      return jsonOk_(listarFluxosPendentesEtapa_(numEt));
    }

    case 'obterFluxoAssinaturas': {
      if (!id) return jsonError_('Parâmetro id obrigatório.', 'MISSING_PARAM');
      var fluxo = obterFluxoAssinaturas_(id);
      if (!fluxo) return jsonError_('Fluxo não encontrado.', 'NOT_FOUND');

      // Detecta ator pelo token
      var token = (e.parameter && e.parameter.token) || '';
      var meuAtor = null;
      if (token) {
        var etapaToken = _validarTokenFluxo_(fluxo, token);
        if (!etapaToken) return jsonError_('Token inválido.', 'AUTH_ERROR');
        meuAtor = etapaToken.ator;
      }

      // Sanitiza: remove tokens e driveUrls internos do response
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
          // token e driveUrl nunca expostos
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
      } catch (_e) { /* não bloqueia */ }

      return jsonOk_(fluxoPublico);
    }

    case 'obterFluxoAssinaturasAdmin': {
      // Admin-only: retorna fluxo completo com pdfOriginalUrl e driveUrl por etapa
      var authTkAdmin = (e.parameter && e.parameter.authToken) || '';
      try { validarTokenAdmin_(authTkAdmin); } catch(eAuthAdm) { return jsonError_('Não autorizado: ' + eAuthAdm.message, 'AUTH_ERROR'); }
      if (!id) return jsonError_('Parâmetro id obrigatório.', 'MISSING_PARAM');
      var fluxoAdm = obterFluxoAssinaturas_(id);
      if (!fluxoAdm) return jsonError_('Fluxo não encontrado.', 'NOT_FOUND');
      // Retorna fluxo sem tokens mas com URLs de PDF
      var fluxoAdmPub = JSON.parse(JSON.stringify(fluxoAdm));
      fluxoAdmPub.etapas = fluxoAdmPub.etapas.map(function(et) {
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
          driveUrl:        et.driveUrl || null,
        };
      });
      return jsonOk_(fluxoAdmPub);
    }

    case 'baixarPdfAssinatura': {
      if (!id) return jsonError_('Parâmetro id obrigatório.', 'MISSING_PARAM');
      var token    = (e.parameter && e.parameter.token)     || '';
      var authTkDl = (e.parameter && e.parameter.authToken) || '';

      var fluxoDl = obterFluxoAssinaturas_(id);
      if (!fluxoDl) return jsonError_('Fluxo não encontrado.', 'NOT_FOUND');

      var fileIdDl  = null;
      var etapaParam = e.parameter && e.parameter.etapa ? parseInt(e.parameter.etapa, 10) : 0;

      if (authTkDl) {
        // Caminho admin (OAuth): valida authToken e entrega o PDF mais recente disponível
        try { validarTokenAdmin_(authTkDl); } catch(eAdm) { return jsonError_('Não autorizado: ' + eAdm.message, 'AUTH_ERROR'); }
        if (etapaParam > 0 && etapaParam <= fluxoDl.etapas.length) {
          var etAdm = fluxoDl.etapas[etapaParam - 1];
          if (etAdm && etAdm.driveUrl) fileIdDl = _extrairFileIdDoUrl_(etAdm.driveUrl);
        } else {
          // Percorre etapas do fim para o início buscando PDF já gerado
          for (var ka = fluxoDl.etapas.length - 1; ka >= 0; ka--) {
            if (fluxoDl.etapas[ka].driveUrl) { fileIdDl = _extrairFileIdDoUrl_(fluxoDl.etapas[ka].driveUrl); break; }
          }
        }
        if (!fileIdDl) fileIdDl = _extrairFileIdDoUrl_(fluxoDl.pdfOriginalUrl);
      } else {
        // Caminho magic-link (signatário)
        if (!token) return jsonError_('Parâmetro token obrigatório.', 'MISSING_PARAM');
        var etapaDoToken = _validarTokenFluxo_(fluxoDl, token);
        if (!etapaDoToken) return jsonError_('Token inválido.', 'AUTH_ERROR');

        if (etapaParam > 0 && etapaParam <= fluxoDl.etapas.length) {
          // PDF de etapa específica
          var etSpec = fluxoDl.etapas[etapaParam - 1];
          if (etSpec && etSpec.driveUrl) fileIdDl = _extrairFileIdDoUrl_(etSpec.driveUrl);
        } else {
          // PDF mais recente antes da etapa do token (ou o original)
          for (var j = etapaDoToken.numero - 2; j >= 0; j--) {
            var etJ = fluxoDl.etapas[j];
            if (etJ && etJ.driveUrl) { fileIdDl = _extrairFileIdDoUrl_(etJ.driveUrl); break; }
          }
          if (!fileIdDl) fileIdDl = _extrairFileIdDoUrl_(fluxoDl.pdfOriginalUrl);
        }
      }

      if (!fileIdDl) return jsonError_('Nenhum PDF disponível para esta etapa.', 'NOT_FOUND');

      try {
        var fileDl  = DriveApp.getFileById(fileIdDl);
        var bytesDl = fileDl.getBlob().getBytes();
        return jsonOk_({ base64: Utilities.base64Encode(bytesDl), nome: fileDl.getName() });
      } catch (errDrive) {
        logErro_('baixarPdfAssinatura', errDrive);
        return jsonError_('Erro ao acessar arquivo: ' + errDrive.message, 'DRIVE_ERROR');
      }
    }

    default:
      return jsonError_('Ação GET desconhecida: ' + action, 'UNKNOWN_ACTION');
  }
}

function doPostAssinaturas(e) {
  var body   = e._body || {};
  var action = body.action || '';

  switch (action) {
    case 'uploadPdfAssinado':
      return uploadPdfAssinado_(body.idEstagio, body.numeroEtapa, body.pdfBase64, body.token);

    case 'concluirEtapa': {
      // Valida token antes de concluir
      var fluxoCon = obterFluxoAssinaturas_(body.idEstagio);
      if (!fluxoCon) return jsonError_('Fluxo não encontrado.', 'NOT_FOUND');
      var etaTk = _validarTokenFluxo_(fluxoCon, body.token);
      if (!etaTk) return jsonError_('Token inválido.', 'AUTH_ERROR');
      return concluirEtapaAssinatura_(body.idEstagio, body.numeroEtapa, body.driveUrl || null, etaTk.email || body.token);
    }

    case 'rejeitarEtapa': {
      // Valida token antes de rejeitar
      var fluxoRej = obterFluxoAssinaturas_(body.idEstagio);
      if (!fluxoRej) return jsonError_('Fluxo não encontrado.', 'NOT_FOUND');
      var etaRej = _validarTokenFluxo_(fluxoRej, body.token);
      if (!etaRej) return jsonError_('Token inválido.', 'AUTH_ERROR');
      return rejeitarEtapaAssinatura_(body.idEstagio, body.numeroEtapa, body.motivo, body.retornoParaEtapa, etaRej.email || body.token);
    }

    case 'reenviarNotificacaoAssinatura': {
      // Exclusivo para admin autenticado
      try { validarTokenAdmin_(body.authToken); } catch(eAuth) { return jsonError_('Não autorizado: ' + eAuth.message, 'AUTH_ERROR'); }
      if (!body.idEstagio) return jsonError_('Parâmetro idEstagio obrigatório.', 'MISSING_PARAM');
      var fluxoRenv = obterFluxoAssinaturas_(body.idEstagio);
      if (!fluxoRenv) return jsonError_('Fluxo de assinaturas não encontrado.', 'NOT_FOUND');
      var etaAtiva = null;
      for (var k = 0; k < fluxoRenv.etapas.length; k++) {
        if (fluxoRenv.etapas[k].status === ASS_STATUS.AGUARDANDO) { etaAtiva = fluxoRenv.etapas[k]; break; }
      }
      if (!etaAtiva) return jsonError_('Nenhuma etapa aguardando ação no momento.', 'INVALID_STATE');
      var solRenv = _obterDadosSolicitacaoCompleto_(body.idEstagio);
      // Se o e-mail estava vazio (falha na criação do fluxo), resolve agora e salva
      if (!etaAtiva.email) {
        var emailResolvido = _resolverEmailAtor_(etaAtiva.ator, solRenv);
        if (!emailResolvido) {
          var dicaDiag = {
            coordenador:    'Verifique se há coordenador Ativo cadastrado para o curso "' + (solRenv.curso || '?') + '" na aba Coordenadores da planilha.',
            direcao:        'Verifique se há um Diretor Geral com Status "Ativo" na aba "Diretor Geral" da planilha SGE.',
            empresa:        'Verifique o e-mail do representante legal da empresa na aba Empresas.',
            supervisor:     'Verifique o e-mail do supervisor na aba Supervisores.',
          };
          return jsonError_(
            'E-mail do ator "' + etaAtiva.label + '" não encontrado. ' + (dicaDiag[etaAtiva.ator] || 'Verifique o cadastro deste ator na planilha SGE.'),
            'EMAIL_NOT_FOUND'
          );
        }
        etaAtiva.email = emailResolvido;
        salvarFluxoAssinaturas_(body.idEstagio, fluxoRenv);
      }
      try {
        notificarAtorAssinatura_(body.idEstagio, etaAtiva, solRenv, fluxoRenv);
      } catch (e) {
        return jsonError_('Erro ao reenviar notificação: ' + e.message, 'SEND_ERROR');
      }
      return jsonOk_({ reenviado: true, etapa: etaAtiva.numero, label: etaAtiva.label, email: etaAtiva.email });
    }

    case 'regenerarTCEInicial': {
      try { validarTokenAdmin_(body.authToken); } catch(eA) { return jsonError_('Não autorizado', 'AUTH_ERROR'); }
      if (!body.idEstagio) return jsonError_('idEstagio obrigatório', 'MISSING_PARAM');
      try {
        var fluxoReg = obterFluxoAssinaturas_(body.idEstagio);
        if (!fluxoReg) return jsonError_('Fluxo de assinaturas não encontrado.', 'NOT_FOUND');

        var solReg = _obterDadosSolicitacaoCompleto_(body.idEstagio);
        var pastaIdReg = fluxoReg.drivePastaId || null;
        if (!pastaIdReg) {
          // Tenta derivar da URL do Drive da solicitação
          var driveUrlReg = String(solReg.driveUrl || '');
          var mReg = driveUrlReg.match(/[-\w]{25,}/);
          if (mReg) pastaIdReg = mReg[0];
        }
        if (!pastaIdReg) return jsonError_('Pasta do estágio não encontrada.', 'NOT_FOUND');

        var arquivoReg = _gerarPdfTCEInicial_(body.idEstagio, solReg, pastaIdReg);

        // Atualiza pdfOriginalUrl no fluxo
        fluxoReg.pdfOriginalUrl = arquivoReg.getUrl();
        salvarFluxoAssinaturas_(body.idEstagio, fluxoReg);

        return jsonOk_({ urlPdf: arquivoReg.getUrl() });
      } catch (eTCE) {
        return jsonError_('Erro ao gerar TCE: ' + eTCE.message, 'GENERATE_ERROR');
      }
    }

    default:
      return jsonError_('Ação POST desconhecida: ' + action, 'UNKNOWN_ACTION');
  }
}
