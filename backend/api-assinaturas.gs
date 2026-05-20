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
  // empresa   → representante legal (EMAIL_REP na tabela Empresas, via CNPJ)
  // supervisor → E-mail Setor na tabela Supervisores (mesmo critério do checklist)
  var emails = {
    estudante:      sol.emailEstudante      || '',
    empresa:        _obterEmailRepEmpresa_(sol.cnpjEmpresa, sol.emailEmpresa),
    supervisor:     _obterEmailSetorSupervisor_(sol.nomeSupervisor, sol.emailSupervisor),
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
    sec('4. PLANO DE ATIVIDADES');
    body.appendParagraph(sol.planoAtividades || '—')
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

  // URL da página com magic-link token (sem links diretos ao Drive)
  var pageUrl = BASE_URL + '/assinaturas/?id=' + encodeURIComponent(idEstagio)
                + '&token=' + encodeURIComponent(etapa.token || '');

  if (etapa.tipo === 'govbr') {
    MAIL.enviarEmailAssinaturaGovBr({
      idEstagio:       idEstagio,
      nomeEstudante:   sol.nomeEstudante || '',
      labelAtor:       etapa.label,
      prazoVencimento: etapa.prazoVencimento || '',
      email:           etapa.email,
      pageUrl:         pageUrl,
      numeroEtapa:     etapa.numero,
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

    case 'baixarPdfAssinatura': {
      if (!id) return jsonError_('Parâmetro id obrigatório.', 'MISSING_PARAM');
      var token = (e.parameter && e.parameter.token) || '';
      if (!token) return jsonError_('Parâmetro token obrigatório.', 'MISSING_PARAM');

      var fluxo = obterFluxoAssinaturas_(id);
      if (!fluxo) return jsonError_('Fluxo não encontrado.', 'NOT_FOUND');

      var etapaDoToken = _validarTokenFluxo_(fluxo, token);
      if (!etapaDoToken) return jsonError_('Token inválido.', 'AUTH_ERROR');

      // Etapa específica solicitada (opcional) — para download histórico pelo admin
      var etapaParam = e.parameter && e.parameter.etapa ? parseInt(e.parameter.etapa, 10) : 0;

      var fileId = null;
      if (etapaParam > 0 && etapaParam <= fluxo.etapas.length) {
        // PDF de etapa específica
        var etSpec = fluxo.etapas[etapaParam - 1];
        if (etSpec && etSpec.driveUrl) fileId = _extrairFileIdDoUrl_(etSpec.driveUrl);
      } else {
        // PDF mais recente antes da etapa do token (ou o original)
        for (var j = etapaDoToken.numero - 2; j >= 0; j--) {
          var etJ = fluxo.etapas[j];
          if (etJ && etJ.driveUrl) { fileId = _extrairFileIdDoUrl_(etJ.driveUrl); break; }
        }
        if (!fileId) fileId = _extrairFileIdDoUrl_(fluxo.pdfOriginalUrl);
      }

      if (!fileId) return jsonError_('Nenhum PDF disponível para esta etapa.', 'NOT_FOUND');

      try {
        var file  = DriveApp.getFileById(fileId);
        var bytes = file.getBlob().getBytes();
        return jsonOk_({ base64: Utilities.base64Encode(bytes), nome: file.getName() });
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
      try {
        var solRenv = _obterDadosSolicitacaoCompleto_(body.idEstagio);
        notificarAtorAssinatura_(body.idEstagio, etaAtiva, solRenv, fluxoRenv);
      } catch (e) {
        return jsonError_('Erro ao reenviar notificação: ' + e.message, 'SEND_ERROR');
      }
      return jsonOk_({ reenviado: true, etapa: etaAtiva.numero, label: etaAtiva.label, email: etaAtiva.email });
    }

    default:
      return jsonError_('Ação POST desconhecida: ' + action, 'UNKNOWN_ACTION');
  }
}
