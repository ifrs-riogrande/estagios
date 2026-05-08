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
  { numero: 1, ator: 'estudante',      label: 'Estudante',                          tipo: 'govbr'   },
  { numero: 2, ator: 'empresa',        label: 'Empresa',                            tipo: 'govbr'   },
  { numero: 3, ator: 'supervisor',     label: 'Supervisor',                         tipo: 'govbr'   },
  { numero: 4, ator: 'orientador',     label: 'Orientador',                         tipo: 'govbr'   },
  { numero: 5, ator: 'coordenador',    label: 'Coordenador de Curso',               tipo: 'govbr'   },
  { numero: 6, ator: 'centralRevisao', label: 'Central de Estágios (revisão)',      tipo: 'interno' },
  { numero: 7, ator: 'direcao',        label: 'Direção-Geral',                      tipo: 'govbr'   },
  { numero: 8, ator: 'centralFinal',   label: 'Central de Estágios (finalização)',  tipo: 'interno' },
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
  var pdfInicial = _gerarPdfTCEInicial_(idEstagio, sol, pasta.getId());

  // Mapa de e-mails dos atores
  var emails = {
    estudante:      sol.emailEstudante      || '',
    empresa:        sol.emailEmpresa        || '',
    supervisor:     sol.emailSupervisor     || '',
    orientador:     sol.emailOrientador     || '',
    coordenador:    sol.emailCoordenador    || '',
    centralRevisao: 'estagios@riogrande.ifrs.edu.br',
    direcao:        _obterEmailDirecao_()   || '',
    centralFinal:   'estagios@riogrande.ifrs.edu.br',
  };

  // Monta o array de etapas
  var etapas = ETAPAS_DEF.map(function (def, idx) {
    return {
      numero:          def.numero,
      ator:            def.ator,
      label:           def.label,
      tipo:            def.tipo,
      email:           emails[def.ator] || '',
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

  if (numeroEtapa === 8) {
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
 * Cria pasta no Drive para armazenar os PDFs desta solicitação.
 * Pasta criada dentro da pasta raiz configurada em "config_drive_pasta_id".
 */
function _criarPastaAssinaturas_(idEstagio) {
  try {
    var pastaRaizId = PropertiesService.getScriptProperties().getProperty('config_drive_pasta_id');
    var pai         = pastaRaizId ? DriveApp.getFolderById(pastaRaizId) : DriveApp.getRootFolder();
    return pai.createFolder('TCE_' + idEstagio);
  } catch (e) {
    logErro_('_criarPastaAssinaturas_', e);
    return DriveApp.createFolder('TCE_' + idEstagio);
  }
}

/**
 * Gera o PDF inicial do TCE com os dados da solicitação.
 * Cria um Google Doc estruturado e exporta como PDF.
 *
 * @param {string} idEstagio
 * @param {Object} sol   Dados completos da solicitação (de _obterDadosSolicitacaoCompleto_)
 * @param {string} pastaId  ID da pasta no Drive onde salvar o arquivo
 * @returns {DriveFile|null}
 */
function _gerarPdfTCEInicial_(idEstagio, sol, pastaId) {
  var docId = null;
  try {
    var doc  = DocumentApp.create('TCE_' + idEstagio + '_rascunho_temp');
    docId    = doc.getId();
    var body = doc.getBody();
    body.clear();
    body.setMarginTop(50).setMarginBottom(50)
        .setMarginLeft(60).setMarginRight(60);

    // ── Cabeçalho ────────────────────────────────────────────────────────────
    var hdr = doc.addHeader();
    hdr.appendParagraph('MINISTÉRIO DA EDUCAÇÃO')
       .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
       .editAsText().setFontSize(8);
    hdr.appendParagraph('INSTITUTO FEDERAL DE EDUCAÇÃO, CIÊNCIA E TECNOLOGIA DO RIO GRANDE DO SUL')
       .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
       .editAsText().setFontSize(9).setBold(true);
    hdr.appendParagraph('Campus Rio Grande — Coordenadoria de Estágios')
       .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
       .editAsText().setFontSize(8);

    // ── Título ────────────────────────────────────────────────────────────────
    body.appendParagraph('TERMO DE COMPROMISSO DE ESTÁGIO')
        .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
        .setSpacingBefore(8).setSpacingAfter(4)
        .editAsText().setFontSize(14).setBold(true);

    body.appendParagraph('Estágio ' + (sol.tipoEstagio || '') + ' — ' + (sol.curso || ''))
        .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
        .setSpacingAfter(10)
        .editAsText().setFontSize(11).setItalic(true);

    body.appendParagraph('Identificação: ' + idEstagio
        + '   ·   Emitido em: ' + _formatarDataBr_(new Date()))
        .setSpacingAfter(6)
        .editAsText().setFontSize(9);

    body.appendHorizontalRule();

    // ── Helpers internos ──────────────────────────────────────────────────────
    function sec(titulo) {
      var p = body.appendParagraph(titulo);
      p.setSpacingBefore(14).setSpacingAfter(4);
      p.editAsText().setFontSize(11).setBold(true);
    }
    function kv(label, valor) {
      var p = body.appendParagraph(label + ': ' + (valor || '—'));
      p.setSpacingBefore(1).setSpacingAfter(1);
      p.editAsText().setFontSize(10);
    }
    function assinatura(nome, papel) {
      body.appendParagraph('')
          .setSpacingBefore(20);
      body.appendParagraph('___________________________________')
          .setSpacingAfter(0)
          .editAsText().setFontSize(10);
      var pNome = body.appendParagraph(nome || '—');
      pNome.setSpacingAfter(0);
      pNome.editAsText().setFontSize(10).setBold(true);
      body.appendParagraph(papel)
          .setSpacingAfter(0)
          .editAsText().setFontSize(9).setItalic(true);
      body.appendParagraph('Data: _____ / _____ / _________')
          .setSpacingAfter(2)
          .editAsText().setFontSize(9);
    }

    // ── 1. Dados do Estudante ─────────────────────────────────────────────────
    sec('1. DADOS DO ESTUDANTE');
    kv('Nome completo',     sol.nomeEstudante);
    kv('Matrícula',         sol.matricula);
    kv('Curso',             sol.curso);
    kv('Turno / Semestre',  (sol.turno || '—') + ' / ' + (sol.semestre || '—'));
    kv('CPF',               _formatarCpf_(sol.cpf));
    kv('Data de nascimento',_formatarDataBr_(sol.dataNasc));
    kv('Telefone',          sol.telefone);
    kv('E-mail',            sol.emailEstudante);
    if (sol.nomeResp) {
      kv('Responsável legal',
         sol.nomeResp
         + (sol.cpfResp ? ' — CPF: ' + _formatarCpf_(sol.cpfResp) : '')
         + (sol.telResp ? ' — Fone: ' + sol.telResp : ''));
    }

    // ── 2. Empresa Concedente ────────────────────────────────────────────────
    sec('2. EMPRESA CONCEDENTE');
    kv('Razão social',         sol.nomeEmpresa);
    kv('CNPJ',                 _formatarCnpj_(sol.cnpjEmpresa));
    kv('Supervisor(a)',        sol.nomeSupervisor);
    kv('E-mail do supervisor', sol.emailSupervisor);
    if (sol.nomeAgente) {
      kv('Agente de integração', sol.nomeAgente);
    }

    // ── 3. Dados do Estágio ──────────────────────────────────────────────────
    sec('3. DADOS DO ESTÁGIO');
    kv('Tipo de estágio',  sol.tipoEstagio);
    kv('Data de início',   _formatarDataBr_(sol.dataInicio));
    kv('Data de término',  _formatarDataBr_(sol.dataTermino));
    kv('Carga horária',    sol.cargaHoraria);
    kv('Horários / dias',  sol.horario);
    kv('Remunerado',       sol.remuneracao === 'Sim' ? 'Sim' : 'Não');
    if (sol.remuneracao === 'Sim' && sol.valorBolsa) {
      kv('Valor da bolsa',       'R$ ' + sol.valorBolsa);
    }
    if (sol.valorTransporte) {
      kv('Auxílio-transporte',   'R$ ' + sol.valorTransporte);
    }

    // ── 4. Plano de Atividades ────────────────────────────────────────────────
    sec('4. PLANO DE ATIVIDADES / OBJETIVOS');
    body.appendParagraph(sol.planoAtividades || sol.objetivos || '—')
        .setSpacingBefore(2).setSpacingAfter(4)
        .editAsText().setFontSize(10);

    // ── 5. Orientação Acadêmica ──────────────────────────────────────────────
    sec('5. ORIENTAÇÃO ACADÊMICA');
    kv('Orientador(a)', sol.nomeOrientador);
    kv('E-mail',        sol.emailOrientador);

    // ── 6. Disposições Legais ────────────────────────────────────────────────
    sec('6. DISPOSIÇÕES LEGAIS');
    [
      'O estágio é regido pela Lei nº 11.788/2008 e pelas normas internas do IFRS Campus Rio Grande.',
      'O estágio não cria vínculo empregatício de qualquer natureza, conforme art. 3º da Lei nº 11.788/2008.',
      'O estudante deverá cumprir as atividades descritas no plano de atividades e zelar pelo bom nome da instituição.',
      'Qualquer alteração das condições previstas neste Termo deverá ser formalizada mediante adendo assinado pelas partes.',
      'O descumprimento das obrigações aqui estabelecidas poderá ensejar o encerramento imediato do estágio.',
    ].forEach(function (cl, i) {
      var p = body.appendParagraph((i + 1) + '. ' + cl);
      p.setSpacingBefore(2).setSpacingAfter(2);
      p.editAsText().setFontSize(10);
    });

    // ── 7. Assinaturas ────────────────────────────────────────────────────────
    sec('7. ASSINATURAS');
    body.appendParagraph(
        'As partes declaram ter lido e concordado com os termos acima, '
        + 'firmando o presente instrumento na data de suas respectivas assinaturas.')
        .setSpacingAfter(8)
        .editAsText().setFontSize(10);

    assinatura(sol.nomeEstudante,  'Estudante');
    assinatura(sol.nomeEmpresa,    'Empresa Concedente');
    assinatura(sol.nomeSupervisor, 'Supervisor(a) na Empresa');
    assinatura(sol.nomeOrientador, 'Orientador(a) de Estágio');
    assinatura('Coordenador(a) de Curso', sol.curso || '');
    assinatura('Central de Estágios', 'IFRS Campus Rio Grande');
    assinatura('Direção-Geral',       'IFRS Campus Rio Grande');

    // ── Rodapé ────────────────────────────────────────────────────────────────
    var ftr = doc.addFooter();
    ftr.appendParagraph(
        'SGE · IFRS Campus Rio Grande · Emitido automaticamente em '
        + _formatarDataBr_(new Date()) + ' · ID: ' + idEstagio)
       .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
       .editAsText().setFontSize(7).setItalic(true);

    doc.saveAndClose();

    // ── Exportar como PDF ─────────────────────────────────────────────────────
    var pdfBlob = DriveApp.getFileById(docId)
        .getAs(MimeType.PDF)
        .setName('TCE_' + idEstagio + '_v0_original.pdf');
    var arquivo = DriveApp.getFolderById(pastaId).createFile(pdfBlob);
    arquivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    // Apaga o Google Doc temporário
    DriveApp.getFileById(docId).setTrashed(true);

    return arquivo;

  } catch (e) {
    logErro_('_gerarPdfTCEInicial_', e);
    if (docId) {
      try { DriveApp.getFileById(docId).setTrashed(true); } catch (_) {}
    }
    return null;
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
          objetivos:       r[COL_SOL.OBJETIVOS]            || '',
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

/** Busca e-mail do coordenador ativo de um curso. */
function _obterEmailCoordenadorPorCurso_(curso) {
  try {
    if (!curso) return '';
    var sheet = SpreadsheetApp.openById(SS_ID).getSheetByName('Coordenadores');
    if (!sheet) return '';
    var dados = sheet.getDataRange().getValues();
    // Cabeçalho: CPF | Matrícula SIAPE | Nome | E-mail | Telefone | Titulação | Curso | Timestamp | Status
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][6]).trim().toLowerCase() === String(curso).trim().toLowerCase()
          && String(dados[i][8]).toLowerCase() === 'ativo') {
        return dados[i][3]; // E-mail
      }
    }
    return '';
  } catch (e) {
    return '';
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
  if (!etapa || !etapa.email) return;

  // Obtém URL do PDF mais recente: última etapa concluída ou PDF original
  var pdfUrl = (fluxo && fluxo.pdfOriginalUrl) ? fluxo.pdfOriginalUrl : '';
  if (fluxo && fluxo.etapas) {
    for (var i = etapa.numero - 2; i >= 0; i--) {
      var et = fluxo.etapas[i];
      if (et && et.driveUrl) { pdfUrl = et.driveUrl; break; }
    }
  }

  if (etapa.tipo === 'govbr') {
    MAIL.enviarEmailAssinaturaGovBr({
      idEstagio:       idEstagio,
      nomeEstudante:   sol.nomeEstudante || '',
      labelAtor:       etapa.label,
      prazoVencimento: etapa.prazoVencimento || '',
      email:           etapa.email,
      driveUrl:        pdfUrl,
      numeroEtapa:     etapa.numero,
    });
  } else {
    MAIL.enviarEmailAssinaturaInterno({
      idEstagio:       idEstagio,
      nomeEstudante:   sol.nomeEstudante || '',
      labelAtor:       etapa.label,
      prazoVencimento: etapa.prazoVencimento || '',
      email:           etapa.email,
      numeroEtapa:     etapa.numero,
    });
  }
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
    { email: sol.emailEstudante,               nome: sol.nomeEstudante  || 'Estudante'       },
    { email: sol.emailEmpresa,                 nome: sol.nomeEmpresa    || 'Empresa'          },
    { email: sol.emailSupervisor,              nome: sol.nomeSupervisor || 'Supervisor'       },
    { email: sol.emailOrientador,              nome: sol.nomeOrientador || 'Orientador'       },
    { email: sol.emailCoordenador,             nome: 'Coordenador'                            },
    { email: 'estagios@riogrande.ifrs.edu.br', nome: 'Setor de Estágios'                     },
  ].filter(function (d) { return !!(d.email && String(d.email).indexOf('@') > 0); });

  // URL final: preferência para arquivo enviado pela Central; fallback para último PDF do fluxo
  var urlFinal = driveUrl || '';
  if (!urlFinal && fluxo && fluxo.etapas) {
    for (var i = fluxo.etapas.length - 1; i >= 0; i--) {
      if (fluxo.etapas[i].driveUrl) { urlFinal = fluxo.etapas[i].driveUrl; break; }
    }
  }

  MAIL.enviarEmailPdfFinalAssinaturas({
    idEstagio:     idEstagio,
    nomeEstudante: sol.nomeEstudante || '',
    driveUrl:      urlFinal,
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
function uploadPdfAssinado_(idEstagio, numeroEtapa, pdfBase64, emailAtor) {
  if (!idEstagio || !numeroEtapa || !pdfBase64) {
    return jsonError_('Parâmetros obrigatórios: idEstagio, numeroEtapa, pdfBase64.', 'MISSING_PARAM');
  }

  var fluxo = obterFluxoAssinaturas_(idEstagio);
  if (!fluxo) return jsonError_('Fluxo de assinaturas não encontrado.', 'NOT_FOUND');

  var etapa = fluxo.etapas[numeroEtapa - 1];
  if (!etapa)                                 return jsonError_('Etapa inválida: ' + numeroEtapa, 'INVALID');
  if (etapa.status !== ASS_STATUS.AGUARDANDO) return jsonError_('Etapa não está aguardando ação.', 'INVALID_STATE');

  // Valida e-mail do ator (etapas internas aceitam apenas o Admin)
  if (etapa.email && emailAtor
      && String(etapa.email).toLowerCase() !== String(emailAtor).toLowerCase()) {
    return jsonError_('E-mail não autorizado para esta etapa.', 'AUTH_ERROR');
  }

  // Decodifica e salva o PDF no Drive
  try {
    var pdfBytes = Utilities.base64Decode(pdfBase64);
    var nomePdf  = 'TCE_' + idEstagio + '_v' + numeroEtapa + '_' + etapa.ator + '.pdf';
    var blob     = Utilities.newBlob(pdfBytes, MimeType.PDF, nomePdf);
    var pasta    = DriveApp.getFolderById(fluxo.drivePastaId);
    var arquivo  = pasta.createFile(blob);
    arquivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var driveUrl = arquivo.getUrl();

    return concluirEtapaAssinatura_(idEstagio, numeroEtapa, driveUrl, emailAtor);
  } catch (e) {
    logErro_('uploadPdfAssinado_', e);
    return jsonError_('Falha ao salvar PDF no Drive: ' + e.message, 'DRIVE_ERROR');
  }
}

// ── Handlers GET / POST ───────────────────────────────────────────────────────

function doGetAssinaturas(e) {
  var action = (e.parameter && e.parameter.action) || '';
  var id     = (e.parameter && e.parameter.id)     || '';

  switch (action) {
    case 'obterFluxoAssinaturas':
      if (!id) return jsonError_('Parâmetro id obrigatório.', 'MISSING_PARAM');
      var fluxo = obterFluxoAssinaturas_(id);
      if (!fluxo) return jsonError_('Fluxo não encontrado.', 'NOT_FOUND');
      try {
        var solInfo = _obterDadosSolicitacaoCompleto_(id);
        fluxo._infoSolicitacao = {
          nomeEstudante: solInfo.nomeEstudante || '',
          nomeEmpresa:   solInfo.nomeEmpresa   || '',
          curso:         solInfo.curso         || '',
          dataInicio:    solInfo.dataInicio    || '',
          dataTermino:   solInfo.dataTermino   || '',
        };
      } catch (e) { /* não bloqueia */ }
      return jsonOk_(fluxo);

    default:
      return jsonError_('Ação GET desconhecida: ' + action, 'UNKNOWN_ACTION');
  }
}

function doPostAssinaturas(e) {
  var body   = e._body || {};
  var action = body.action || '';

  switch (action) {
    case 'uploadPdfAssinado':
      return uploadPdfAssinado_(body.idEstagio, body.numeroEtapa, body.pdfBase64, body.emailAtor);

    case 'concluirEtapa':
      return concluirEtapaAssinatura_(body.idEstagio, body.numeroEtapa, body.driveUrl || null, body.emailAtor);

    case 'rejeitarEtapa':
      return rejeitarEtapaAssinatura_(body.idEstagio, body.numeroEtapa, body.motivo, body.retornoParaEtapa, body.emailAdmin);

    default:
      return jsonError_('Ação POST desconhecida: ' + action, 'UNKNOWN_ACTION');
  }
}
