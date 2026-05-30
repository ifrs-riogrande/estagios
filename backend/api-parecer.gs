/**
 * api-parecer.gs — Parecer Final de Estágio
 * SGE — Sistema de Gestão de Estágios · IFRS Campus Rio Grande
 *
 * Disponível ao final do estágio, após todas as avaliações concluídas.
 *
 * Fluxo:
 *   aguardando_coordenador
 *     → Coordenador de curso preenche parecer + auto-assina
 *   aguardando_diretoria
 *     → Diretor DEN (obrigatório) ou DEX (não-obrigatório) preenche + auto-assina
 *   aguardando_admin
 *     → Admin aprova → PDF gerado → aprovado
 *     → Admin reprova com motivo → volta para aguardando_coordenador (novo ciclo)
 *   aprovado
 *     → Admin clica "Estágio Concluído" → status do estágio muda para Concluído
 *
 * parecerId = [idEstagio]_parecer
 */

'use strict';

var PARECER_SHEET_NAME = 'Pareceres';

var PARECER_ST = {
  AGUARDANDO_COORDENADOR: 'aguardando_coordenador',
  AGUARDANDO_DIRETORIA:   'aguardando_diretoria',
  AGUARDANDO_ADMIN:       'aguardando_admin',
  APROVADO:               'aprovado',
};

var EMAIL_DEN = 'den@riogrande.ifrs.edu.br';
var EMAIL_DEX = 'dex@riogrande.ifrs.edu.br';

// ── PropertiesService ─────────────────────────────────────────────────────────

function obterParecer_(idEstagio) {
  try {
    var raw = PropertiesService.getScriptProperties()
      .getProperty('parecer_' + idEstagio);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { logErro_('obterParecer_', e); return null; }
}

function salvarParecer_(idEstagio, parecer) {
  try {
    PropertiesService.getScriptProperties()
      .setProperty('parecer_' + idEstagio, JSON.stringify(parecer));
  } catch (e) { logErro_('salvarParecer_', e); throw e; }
}

// ── Calcular total de horas do estágio ────────────────────────────────────────

function _calcularTotalHorasEstagio_(idEstagio) {
  try {
    var props = PropertiesService.getScriptProperties().getProperties();
    var total = 0;
    var prefix = 'avaliacao_' + idEstagio + '_concedente_';
    Object.keys(props).forEach(function (k) {
      if (k.indexOf(prefix) !== 0) return;
      try {
        var f = JSON.parse(props[k]);
        if (f && f.statusGeral === AVAL_ST.CONCLUIDO && f.dadosFormulario && f.dadosFormulario.horasNoPeriodo) {
          total += parseInt(f.dadosFormulario.horasNoPeriodo, 10) || 0;
        }
      } catch (_) {}
    });
    return total;
  } catch (e) { return 0; }
}

// ── Verificar se todas as avaliações previstas estão concluídas ───────────────

function _todasAvaliacoesConcluidas_(idEstagio, dataInicio, dataTermino) {
  try {
    var periodos = _calcularPeriodosAvaliacao_(
      new Date(normalizarDataISO_(dataInicio)),
      new Date(normalizarDataISO_(dataTermino))
    );
    for (var i = 0; i < periodos.length; i++) {
      var per = periodos[i];
      var fC = obterFluxoAvaliacao_(idEstagio + '_concedente_' + per.tipo);
      var fA = obterFluxoAvaliacao_(idEstagio + '_aluno_' + per.tipo);
      if (!fC || fC.statusGeral !== AVAL_ST.CONCLUIDO) return false;
      if (!fA || fA.statusGeral !== AVAL_ST.CONCLUIDO) return false;
    }
    return true;
  } catch (e) { return false; }
}

// ── Iniciar Parecer Final ─────────────────────────────────────────────────────

function iniciarParecerFinal_(idEstagio, authToken) {
  try { validarTokenAdmin_(authToken); } catch (eA) {
    return jsonError_('Não autorizado: ' + eA.message, 'AUTH_ERROR');
  }

  var existente = obterParecer_(idEstagio);
  if (existente && existente.statusGeral !== PARECER_ST.APROVADO) {
    return jsonError_(
      'Parecer já existe para este estágio (status: ' + existente.statusGeral + ').',
      'DUPLICATE'
    );
  }

  var sol = _obterDadosSolicitacaoCompleto_(idEstagio);
  if (!sol || !sol.idEstagio) {
    return jsonError_('Estágio não encontrado.', 'NOT_FOUND');
  }

  // Determina diretoria conforme tipo de estágio
  var tipoEstagio   = String(sol.tipoEstagio || '').toLowerCase();
  var isObrigatorio = tipoEstagio.indexOf('não') === -1 && tipoEstagio.indexOf('nao') === -1;
  var tipoDiretoria = isObrigatorio ? 'DEN' : 'DEX';
  var dadosDiretoria = obterDadosDiretoria_(tipoDiretoria);
  var emailDiretoria = dadosDiretoria.email;
  var nomeDiretoria  = dadosDiretoria.nome;

  var emailCoordenador = _ckObterEmailCoordenador_(sol.curso || '');
  var nomeCoordenador  = _ckObterNomeCoordenador_(sol.curso || '');

  if (!emailCoordenador) {
    return jsonError_(
      'E-mail do coordenador do curso não encontrado para: ' + sol.curso,
      'EMAIL_NOT_FOUND'
    );
  }

  var totalHoras = _calcularTotalHorasEstagio_(idEstagio);

  var agora = new Date().toISOString();
  var parecer = {
    parecerId:           idEstagio + '_parecer',
    idEstagio:           idEstagio,
    statusGeral:         PARECER_ST.AGUARDANDO_COORDENADOR,
    tipoDiretoria:       tipoDiretoria,
    ciclo:               1,

    // Dados de identificação (pré-preenchidos)
    nomeAluno:           sol.nomeEstudante  || '',
    curso:               sol.curso          || '',
    matricula:           sol.matricula      || '',
    totalHoras:          totalHoras,
    modalidade:          sol.tipoEstagio    || '',

    // Coordenador
    emailCoordenador:    emailCoordenador,
    nomeCoordenador:     nomeCoordenador,
    tokenCoordenador:    Utilities.getUuid(),
    parecerCoordenador:  null,
    assinaturaCoordenador: null,
    tsParecerCoordenador:  null,

    // Diretoria
    emailDiretoria:      emailDiretoria,
    nomeDiretoria:       nomeDiretoria,
    tokenDiretoria:      Utilities.getUuid(),
    parecerDiretoria:    null,
    assinaturaDiretoria: null,
    tsParecerDiretoria:  null,

    // PDF
    pdfUrl:              '',
    tokenValidacao:      null,

    // Meta
    tsInicio:            agora,
    tsConclusao:         null,
    historico:           [],
  };

  salvarParecer_(idEstagio, parecer);
  _atualizarParecer_Planilha_(parecer);

  // Notifica coordenador
  try { _notificarParecerCoordenador_(parecer); } catch (e) { logErro_('iniciarParecerFinal_.notif', e); }

  return jsonOk_({
    parecerId:       parecer.parecerId,
    status:          parecer.statusGeral,
    emailCoordenador: emailCoordenador,
    tipoDiretoria:   tipoDiretoria,
    totalHoras:      totalHoras,
  });
}

// ── Salvar Parecer do Coordenador ─────────────────────────────────────────────

function salvarParecerCoordenador_(idEstagio, token, dados) {
  var parecer = obterParecer_(idEstagio);
  if (!parecer) return jsonError_('Parecer não encontrado.', 'NOT_FOUND');
  if (parecer.tokenCoordenador !== token) return jsonError_('Token inválido.', 'AUTH_ERROR');
  if (parecer.statusGeral !== PARECER_ST.AGUARDANDO_COORDENADOR) {
    return jsonError_('Parecer não está aguardando o coordenador (status: ' + parecer.statusGeral + ').', 'INVALID_STATE');
  }

  var agora = new Date().toISOString();
  parecer.parecerCoordenador   = {
    resultado: String(dados.resultado || ''),
    texto:     String(dados.texto     || ''),
  };
  // Permite atualizar totalHoras manualmente
  if (dados.totalHoras) parecer.totalHoras = parseInt(dados.totalHoras, 10) || parecer.totalHoras;

  parecer.assinaturaCoordenador = _buildAssinaturaParecer_(parecer, 'coordenador', agora);
  parecer.tsParecerCoordenador  = agora;
  parecer.statusGeral           = PARECER_ST.AGUARDANDO_DIRETORIA;
  // Gera novo token para próximo ciclo caso haja reprovação futura
  parecer.tokenCoordenador = Utilities.getUuid();

  salvarParecer_(idEstagio, parecer);
  _atualizarParecer_Planilha_(parecer);

  try { _notificarParecerDiretoria_(parecer); } catch (e) { logErro_('salvarParecerCoordenador_.notif', e); }

  return jsonOk_({ status: parecer.statusGeral });
}

// ── Salvar Parecer da Diretoria ───────────────────────────────────────────────

function salvarParecerDiretoria_(idEstagio, token, dados) {
  var parecer = obterParecer_(idEstagio);
  if (!parecer) return jsonError_('Parecer não encontrado.', 'NOT_FOUND');
  if (parecer.tokenDiretoria !== token) return jsonError_('Token inválido.', 'AUTH_ERROR');
  if (parecer.statusGeral !== PARECER_ST.AGUARDANDO_DIRETORIA) {
    return jsonError_('Parecer não está aguardando a diretoria (status: ' + parecer.statusGeral + ').', 'INVALID_STATE');
  }

  var agora = new Date().toISOString();
  parecer.parecerDiretoria   = {
    resultado: String(dados.resultado || ''),
    texto:     String(dados.texto     || ''),
  };
  parecer.assinaturaDiretoria = _buildAssinaturaParecer_(parecer, 'diretoria', agora);
  parecer.tsParecerDiretoria  = agora;
  parecer.statusGeral         = PARECER_ST.AGUARDANDO_ADMIN;
  parecer.tokenDiretoria      = Utilities.getUuid();

  salvarParecer_(idEstagio, parecer);
  _atualizarParecer_Planilha_(parecer);

  try { _notificarParecerAdmin_(parecer); } catch (e) { logErro_('salvarParecerDiretoria_.notif', e); }

  return jsonOk_({ status: parecer.statusGeral });
}

// ── Aprovar (Admin) → gera PDF ────────────────────────────────────────────────

function aprovarParecerAdmin_(idEstagio, authToken) {
  try { validarTokenAdmin_(authToken); } catch (eA) {
    return jsonError_('Não autorizado: ' + eA.message, 'AUTH_ERROR');
  }

  var parecer = obterParecer_(idEstagio);
  if (!parecer) return jsonError_('Parecer não encontrado.', 'NOT_FOUND');
  if (parecer.statusGeral !== PARECER_ST.AGUARDANDO_ADMIN) {
    return jsonError_('Parecer não está aguardando aprovação do admin (status: ' + parecer.statusGeral + ').', 'INVALID_STATE');
  }

  parecer.statusGeral  = PARECER_ST.APROVADO;
  parecer.tsConclusao  = new Date().toISOString();

  // Gera PDF
  try {
    var sol    = _obterDadosSolicitacaoCompleto_(idEstagio);
    var urlPdf = gerarPdfParecer_(parecer, sol);
    parecer.pdfUrl = urlPdf;
  } catch (ePdf) {
    logErro_('aprovarParecerAdmin_.gerarPdf', ePdf);
    return jsonError_('Parecer aprovado mas erro ao gerar PDF: ' + ePdf.message, 'PDF_ERROR');
  }

  salvarParecer_(idEstagio, parecer);
  _atualizarParecer_Planilha_(parecer);

  try {
    var solN = _obterDadosSolicitacaoCompleto_(idEstagio);
    _notificarParecerConclusao_(parecer, solN);
  } catch (e) { logErro_('aprovarParecerAdmin_.notif', e); }

  return jsonOk_({ status: parecer.statusGeral, pdfUrl: parecer.pdfUrl });
}

// ── Reprovar (Admin) → volta para coordenador ─────────────────────────────────

function reprovarParecerAdmin_(idEstagio, authToken, motivo) {
  try { validarTokenAdmin_(authToken); } catch (eA) {
    return jsonError_('Não autorizado: ' + eA.message, 'AUTH_ERROR');
  }
  if (!motivo || !String(motivo).trim()) {
    return jsonError_('Motivo de reprovação obrigatório.', 'MISSING_PARAM');
  }

  var parecer = obterParecer_(idEstagio);
  if (!parecer) return jsonError_('Parecer não encontrado.', 'NOT_FOUND');
  if (parecer.statusGeral !== PARECER_ST.AGUARDANDO_ADMIN) {
    return jsonError_('Parecer não está aguardando aprovação do admin.', 'INVALID_STATE');
  }

  var agora = new Date().toISOString();

  // Registra no histórico
  parecer.historico.push({
    ciclo:      parecer.ciclo,
    evento:     'reprovado_admin',
    motivo:     String(motivo).trim(),
    dataHora:   agora,
    parecerC:   parecer.parecerCoordenador,
    parecerD:   parecer.parecerDiretoria,
    assinaturaC: parecer.assinaturaCoordenador,
    assinaturaD: parecer.assinaturaDiretoria,
  });

  // Reinicia para novo ciclo
  parecer.ciclo++;
  parecer.statusGeral           = PARECER_ST.AGUARDANDO_COORDENADOR;
  parecer.parecerCoordenador    = null;
  parecer.parecerDiretoria      = null;
  parecer.assinaturaCoordenador = null;
  parecer.assinaturaDiretoria   = null;
  parecer.tsParecerCoordenador  = null;
  parecer.tsParecerDiretoria    = null;
  parecer.tokenCoordenador      = Utilities.getUuid();
  parecer.tokenDiretoria        = Utilities.getUuid();

  salvarParecer_(idEstagio, parecer);
  _atualizarParecer_Planilha_(parecer);

  try { _notificarParecerReprovadoAdmin_(parecer, motivo); } catch (e) { logErro_('reprovarParecerAdmin_.notif', e); }

  return jsonOk_({ status: parecer.statusGeral, ciclo: parecer.ciclo });
}

// ── Regenerar PDF ─────────────────────────────────────────────────────────────

function regenerarPdfParecer_(idEstagio, authToken) {
  try { validarTokenAdmin_(authToken); } catch (eA) {
    return jsonError_('Não autorizado: ' + eA.message, 'AUTH_ERROR');
  }

  var parecer = obterParecer_(idEstagio);
  if (!parecer) return jsonError_('Parecer não encontrado.', 'NOT_FOUND');
  if (parecer.statusGeral !== PARECER_ST.APROVADO) {
    return jsonError_('Só é possível regenerar PDF de parecer aprovado.', 'INVALID_STATE');
  }

  try {
    parecer.tokenValidacao = Utilities.getUuid();
    var sol    = _obterDadosSolicitacaoCompleto_(idEstagio);
    var urlPdf = gerarPdfParecer_(parecer, sol);
    parecer.pdfUrl = urlPdf;
  } catch (e) {
    return jsonError_('Erro ao regenerar PDF: ' + e.message, 'PDF_ERROR');
  }

  salvarParecer_(idEstagio, parecer);
  _atualizarParecer_Planilha_(parecer);

  return jsonOk_({ pdfUrl: parecer.pdfUrl });
}

// ── Concluir Estágio ──────────────────────────────────────────────────────────

function concluirEstagio_(idEstagio, authToken) {
  try { validarTokenAdmin_(authToken); } catch (eA) {
    return jsonError_('Não autorizado: ' + eA.message, 'AUTH_ERROR');
  }

  var parecer = obterParecer_(idEstagio);
  if (!parecer || parecer.statusGeral !== PARECER_ST.APROVADO) {
    return jsonError_('O parecer final deve estar aprovado antes de concluir o estágio.', 'INVALID_STATE');
  }

  try {
    var ss    = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName('Solicitações');
    if (!sheet) return jsonError_('Aba Solicitações não encontrada.', 'INTERNAL');

    var dados = sheet.getDataRange().getValues();
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][COL_SOL.ID_ESTAGIO] || '').trim() === String(idEstagio).trim()) {
        sheet.getRange(i + 1, COL_SOL.STATUS + 1).setValue('Concluído');
        sheet.getRange(i + 1, 1).setValue(new Date().toISOString()); // atualiza timestamp
        break;
      }
    }
  } catch (e) {
    logErro_('concluirEstagio_', e);
    return jsonError_('Erro ao atualizar status do estágio: ' + e.message, 'INTERNAL');
  }

  return jsonOk_({ idEstagio: idEstagio, status: 'Concluído' });
}

// ── Obter Parecer (GET) ───────────────────────────────────────────────────────

function obterParecer_Handler_(idEstagio, token, authToken) {
  var parecer = obterParecer_(idEstagio);
  if (!parecer) return jsonError_('Parecer não encontrado.', 'NOT_FOUND');

  var isAdmin    = false;
  var meuPapel   = null;

  if (authToken) {
    try { validarTokenAdmin_(authToken); isAdmin = true; } catch (_) {}
  }
  if (!isAdmin) {
    if (!token) return jsonError_('Token obrigatório.', 'MISSING_PARAM');
    if      (parecer.tokenCoordenador === token) meuPapel = 'coordenador';
    else if (parecer.tokenDiretoria   === token) meuPapel = 'diretoria';
    else return jsonError_('Token inválido ou link expirado.', 'AUTH_ERROR');
  }

  var sol = null;
  try { sol = _obterDadosSolicitacaoCompleto_(idEstagio); } catch (_) {}

  var pub = {
    parecerId:             parecer.parecerId,
    idEstagio:             parecer.idEstagio,
    statusGeral:           parecer.statusGeral,
    tipoDiretoria:         parecer.tipoDiretoria,
    ciclo:                 parecer.ciclo,
    nomeAluno:             parecer.nomeAluno,
    curso:                 parecer.curso,
    matricula:             parecer.matricula,
    totalHoras:            parecer.totalHoras,
    modalidade:            parecer.modalidade,
    nomeCoordenador:       parecer.nomeCoordenador,
    nomeDiretoria:         parecer.nomeDiretoria,
    parecerCoordenador:    parecer.parecerCoordenador,
    parecerDiretoria:      parecer.parecerDiretoria,
    assinaturaCoordenador: parecer.assinaturaCoordenador,
    assinaturaDiretoria:   parecer.assinaturaDiretoria,
    pdfUrl:                parecer.pdfUrl || '',
    tsInicio:              parecer.tsInicio,
    tsParecerCoordenador:  parecer.tsParecerCoordenador,
    tsParecerDiretoria:    parecer.tsParecerDiretoria,
    tsConclusao:           parecer.tsConclusao,
    historico:             parecer.historico || [],
    _sol: sol ? {
      nomeEstudante:  sol.nomeEstudante  || '',
      nomeEmpresa:    sol.nomeEmpresa    || '',
      curso:          sol.curso          || '',
      nomeSupervisor: sol.nomeSupervisor || '',
    } : {},
  };

  if (meuPapel) pub._meuPapel = meuPapel;
  if (isAdmin)  pub._isAdmin  = true;

  return jsonOk_(pub);
}

// ── Listar Pareceres Pendentes (para DEN/DEX/Coordenador) ─────────────────────

function listarPareceresPendentes_(papel, emailOuTipo) {
  // papel: 'coordenador' | 'diretoria'
  // emailOuTipo: email do coordenador ou 'DEN'/'DEX'
  try {
    var props = PropertiesService.getScriptProperties().getProperties();
    var lista = [];
    Object.keys(props).forEach(function (k) {
      if (k.indexOf('parecer_') !== 0) return;
      try {
        var p = JSON.parse(props[k]);
        if (!p || !p.parecerId) return;

        if (papel === 'coordenador'
            && p.statusGeral === PARECER_ST.AGUARDANDO_COORDENADOR
            && p.emailCoordenador === emailOuTipo) {
          lista.push(_pubParecer_(p));
        } else if (papel === 'diretoria'
            && p.statusGeral === PARECER_ST.AGUARDANDO_DIRETORIA
            && p.tipoDiretoria === emailOuTipo) {
          lista.push(_pubParecer_(p));
        }
      } catch (_) {}
    });
    return jsonOk_(lista);
  } catch (e) {
    logErro_('listarPareceresPendentes_', e);
    return jsonError_('Erro ao listar pareceres.', 'INTERNAL');
  }
}

function _pubParecer_(p) {
  return {
    parecerId:    p.parecerId,
    idEstagio:    p.idEstagio,
    statusGeral:  p.statusGeral,
    nomeAluno:    p.nomeAluno    || '',
    curso:        p.curso        || '',
    matricula:    p.matricula    || '',
    totalHoras:   p.totalHoras   || 0,
    modalidade:   p.modalidade   || '',
    tipoDiretoria:p.tipoDiretoria|| '',
    tsInicio:     p.tsInicio     || '',
    tokenCoordenador: p.tokenCoordenador || '',
    tokenDiretoria:   p.tokenDiretoria   || '',
    pdfUrl:           p.pdfUrl           || '',
  };
}

// ── Gerar PDF do Parecer Final ────────────────────────────────────────────────

function gerarPdfParecer_(parecer, sol) {
  var docId = null;
  try {
    var docName = 'ParecerFinal — ' + String(parecer.nomeAluno || parecer.idEstagio).replace(/[\/\\]/g, '-');

    var tokenValidacao = parecer.tokenValidacao || Utilities.getUuid();
    parecer.tokenValidacao = tokenValidacao;
    PropertiesService.getScriptProperties()
      .setProperty('val_parecer_' + tokenValidacao, parecer.idEstagio);
    var urlValidacao = BASE_URL + '/validar/?t=' + encodeURIComponent(tokenValidacao);

    var doc  = DocumentApp.create(docName);
    docId    = doc.getId();
    var body = doc.getBody();
    body.clear();
    body.setMarginTop(56).setMarginBottom(56).setMarginLeft(72).setMarginRight(72);

    var _fmtIso = function (iso) {
      if (!iso) return '—';
      try { return Utilities.formatDate(new Date(iso), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss'); }
      catch (_) { return String(iso); }
    };

    function kv(lbl, val) {
      var v   = (val !== undefined && val !== null && String(val).trim()) ? String(val) : '—';
      var str = lbl + ': ' + v;
      var p   = body.appendParagraph(str);
      p.setSpacingBefore(2).setSpacingAfter(2);
      var t = p.editAsText(); t.setFontFamily('Arial').setFontSize(10);
      t.setBold(0, lbl.length, true);
      if (str.length > lbl.length + 2) t.setBold(lbl.length + 2, str.length - 1, false);
    }

    function sec(titulo_) {
      var p = body.appendParagraph(titulo_);
      p.setSpacingBefore(12).setSpacingAfter(4);
      p.editAsText().setFontFamily('Arial').setFontSize(10).setBold(true);
      body.appendHorizontalRule();
    }

    // Cabeçalho institucional
    var _logo = _obterLogoCabecalho_();
    if (_logo) {
      try {
        var li = body.appendImage(_logo);
        li.setWidth(54).setHeight(54);
        li.getParent().setAlignment(DocumentApp.HorizontalAlignment.CENTER).setSpacingBefore(0).setSpacingAfter(2);
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

    // Título
    var pTit = body.appendParagraph('PARECER FINAL DE ESTÁGIO');
    pTit.setAlignment(DocumentApp.HorizontalAlignment.CENTER).setSpacingBefore(4).setSpacingAfter(10);
    pTit.editAsText().setFontFamily('Arial').setFontSize(13).setBold(true);

    // Identificação
    sec('IDENTIFICAÇÃO');
    kv('Aluno(a)',      parecer.nomeAluno  || '');
    kv('Curso',         parecer.curso      || '');
    kv('Matrícula',     parecer.matricula  || '');
    kv('Total de Horas',String(parecer.totalHoras || 0) + 'h');
    kv('Modalidade',    parecer.modalidade || '');
    if (sol) {
      kv('Entidade Concedente', sol.nomeEmpresa    || '');
      kv('Supervisor(a)',       sol.nomeSupervisor || '');
    }

    // Parecer do Coordenador
    sec('PARECER DO(A) COORDENADOR(A) DO CURSO EM RELAÇÃO AO TÉRMINO DO ESTÁGIO');
    var resC = parecer.parecerCoordenador ? parecer.parecerCoordenador.resultado : '';
    var pRC  = body.appendParagraph(
      '[' + (resC === 'aprovado' ? 'X' : ' ') + '] Aprovado    ' +
      '[' + (resC === 'reprovado' ? 'X' : ' ') + '] Reprovado'
    );
    pRC.editAsText().setFontFamily('Arial').setFontSize(10);
    pRC.setSpacingBefore(4).setSpacingAfter(4);

    var textoC = parecer.parecerCoordenador ? (parecer.parecerCoordenador.texto || '') : '';
    if (textoC) {
      var pTC = body.appendParagraph(textoC);
      pTC.editAsText().setFontFamily('Arial').setFontSize(10);
      pTC.setSpacingBefore(4).setSpacingAfter(8);
    }

    // Assinatura Coordenador
    body.appendParagraph('');
    var sigCPar = body.appendParagraph('Assinatura do(a) Coordenador(a) do Curso — Assinatura eletrônica pelo sistema SGE');
    sigCPar.editAsText().setFontFamily('Arial').setFontSize(10).setBold(true);
    var sigC = parecer.assinaturaCoordenador;
    if (sigC) {
      kv('Nome',        sigC.nome);
      kv('E-mail',      sigC.email);
      kv('Data e Hora', _fmtIso(sigC.dataHora));
    }

    // Parecer da Diretoria
    sec('PARECER FINAL DA ' + (parecer.tipoDiretoria === 'DEN' ? 'DIRETORIA DE ENSINO' : 'DIRETORIA DE EXTENSÃO') + ' QUANTO À DOCUMENTAÇÃO DE ESTÁGIO');
    var resD = parecer.parecerDiretoria ? parecer.parecerDiretoria.resultado : '';
    var pRD  = body.appendParagraph(
      '[' + (resD === 'aprovado' ? 'X' : ' ') + '] Aprovado    ' +
      '[' + (resD === 'reprovado' ? 'X' : ' ') + '] Reprovado'
    );
    pRD.editAsText().setFontFamily('Arial').setFontSize(10);
    pRD.setSpacingBefore(4).setSpacingAfter(4);

    var textoD = parecer.parecerDiretoria ? (parecer.parecerDiretoria.texto || '') : '';
    if (textoD) {
      var pTD = body.appendParagraph(textoD);
      pTD.editAsText().setFontFamily('Arial').setFontSize(10);
      pTD.setSpacingBefore(4).setSpacingAfter(8);
    }

    // Assinatura Diretoria
    body.appendParagraph('');
    var sigDLabel = 'Assinatura da ' + (parecer.tipoDiretoria === 'DEN' ? 'Diretoria de Ensino' : 'Diretoria de Extensão') + ' — Assinatura eletrônica pelo sistema SGE';
    var sigDPar = body.appendParagraph(sigDLabel);
    sigDPar.editAsText().setFontFamily('Arial').setFontSize(10).setBold(true);
    var sigD = parecer.assinaturaDiretoria;
    if (sigD) {
      kv('Nome',        sigD.nome);
      kv('E-mail',      sigD.email);
      kv('Data e Hora', _fmtIso(sigD.dataHora));
    }

    // QR Code
    body.appendParagraph('');
    sec('VALIDAÇÃO DO DOCUMENTO');
    var instrP = body.appendParagraph('Escaneie o QR Code ou acesse o link para verificar a autenticidade deste documento.');
    instrP.editAsText().setFontFamily('Arial').setFontSize(9);
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
          var qrImg = body.appendImage(qrResp.getBlob().setContentType('image/png').setName('qr.png'));
          qrImg.setWidth(130).setHeight(130);
          body.appendParagraph('');
          qrGerado = true;
        }
      } catch (_) {}
    }

    var validP = body.appendParagraph('🔗 ' + urlValidacao);
    validP.editAsText().setFontFamily('Arial').setFontSize(9);

    var rodapeP = body.appendParagraph(
      'Documento gerado pelo SGE — IFRS Campus Rio Grande · '
      + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss')
    );
    rodapeP.editAsText().setFontFamily('Arial').setFontSize(8).setItalic(true);
    rodapeP.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

    doc.saveAndClose();

    // Exporta PDF e salva na pasta do estágio
    var docFile = DriveApp.getFileById(docId);
    var pdfBlob = docFile.getAs('application/pdf').setName(docName + '.pdf');
    var pastaId = sol ? (sol.driveUrl ? null : null) : null;
    var pasta;
    try {
      pasta = _obterPastaEstagioById_(sol);
    } catch (_) {
      pasta = DriveApp.getFolderById(CFG_DRIVE.ESTAGIOS_ID);
    }
    var pdfFile = pasta.createFile(pdfBlob);
    pdfFile.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);

    try { pasta.addFile(docFile); DriveApp.getRootFolder().removeFile(docFile); } catch (_) {}

    return pdfFile.getUrl();

  } catch (e) {
    logErro_('gerarPdfParecer_', e);
    if (docId) { try { DriveApp.getFileById(docId).setTrashed(true); } catch (_) {} }
    throw e;
  }
}

function _obterPastaEstagioById_(sol) {
  if (sol && sol.driveUrl) {
    var fileId = _extrairFileIdDoUrl_(sol.driveUrl);
    if (fileId) {
      try { return DriveApp.getFolderById(fileId); } catch (_) {}
    }
  }
  return DriveApp.getFolderById(CFG_DRIVE.ESTAGIOS_ID);
}

// ── Assinatura eletrônica ─────────────────────────────────────────────────────

function _buildAssinaturaParecer_(parecer, papel, dataHora) {
  try {
    if (papel === 'coordenador') {
      var cpfC = '';
      try { cpfC = _ckObterCpfOrientador_(parecer.emailCoordenador); } catch (_) {}
      return { nome: parecer.nomeCoordenador || '', cpf: cpfC, email: parecer.emailCoordenador || '', dataHora: String(dataHora) };
    } else {
      return { nome: parecer.nomeDiretoria || '', cpf: '', email: parecer.emailDiretoria || '', dataHora: String(dataHora) };
    }
  } catch (e) {
    return { nome: '', cpf: '', email: '', dataHora: String(dataHora) };
  }
}

// ── Planilha ──────────────────────────────────────────────────────────────────

function _atualizarParecer_Planilha_(parecer) {
  try {
    var sheet = SpreadsheetApp.openById(SS_ID).getSheetByName(PARECER_SHEET_NAME);
    if (!sheet) return;
    var linha = [
      new Date().toISOString(),
      parecer.parecerId,
      parecer.idEstagio,
      parecer.statusGeral,
      parecer.tipoDiretoria,
      parecer.ciclo,
      parecer.nomeAluno,
      parecer.curso,
      parecer.totalHoras,
      parecer.modalidade,
      parecer.emailCoordenador,
      parecer.emailDiretoria,
      parecer.parecerCoordenador ? parecer.parecerCoordenador.resultado : '',
      parecer.parecerDiretoria   ? parecer.parecerDiretoria.resultado   : '',
      parecer.pdfUrl || '',
      parecer.tsInicio || '',
      parecer.tsParecerCoordenador || '',
      parecer.tsParecerDiretoria   || '',
      parecer.tsConclusao          || '',
    ];
    var dados = sheet.getDataRange().getValues();
    var rowIdx = -1;
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][1] || '') === String(parecer.parecerId)) { rowIdx = i + 1; break; }
    }
    if (rowIdx > 0) sheet.getRange(rowIdx, 1, 1, linha.length).setValues([linha]);
    else sheet.appendRow(linha);
  } catch (e) { logErro_('_atualizarParecer_Planilha_', e); }
}

// ── E-mails ───────────────────────────────────────────────────────────────────

function _parecerUrl_(idEstagio, token) {
  return BASE_URL + '/parecer/?id=' + encodeURIComponent(idEstagio) + '&token=' + encodeURIComponent(token);
}

function _parecerEmailHtml_(titulo, corpo) {
  return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">'
    + '<style>body{font-family:Arial,sans-serif;font-size:14px;color:#374151;margin:0;background:#f9fafb;}'
    + '.w{max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;}'
    + '.h{background:#1d4ed8;padding:24px 32px;}.h h1{color:#fff;margin:0;font-size:18px;font-weight:600;}'
    + '.b{padding:32px;}.b p{margin:0 0 16px;line-height:1.6;}'
    + '.btn{display:inline-block;background:#1d4ed8;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin:8px 0;}'
    + '.ft{background:#f3f4f6;padding:16px 32px;font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;}'
    + '</style></head><body><div class="w">'
    + '<div class="h"><h1>' + titulo + '</h1></div>'
    + '<div class="b">' + corpo + '</div>'
    + '<div class="ft">Central de Estágios IFRS Campus Rio Grande · <a href="mailto:estagios@riogrande.ifrs.edu.br" style="color:#6b7280;">estagios@riogrande.ifrs.edu.br</a></div>'
    + '</div></body></html>';
}

function _parecerEnviarEmail_(para, assunto, html) {
  if (!para || String(para).indexOf('@') < 0) return;
  try { GmailApp.sendEmail(para, assunto, '', { htmlBody: html, name: 'Central de Estágios IFRS' }); }
  catch (_) { try { MailApp.sendEmail({ to: para, subject: assunto, htmlBody: html, name: 'Central de Estágios IFRS' }); } catch (_2) {} }
}

function _notificarParecerCoordenador_(parecer) {
  var url = _parecerUrl_(parecer.idEstagio, parecer.tokenCoordenador);
  var html = _parecerEmailHtml_(
    'Parecer Final de Estágio — Preenchimento',
    '<p>Olá' + (parecer.nomeCoordenador ? ', <strong>' + parecer.nomeCoordenador + '</strong>' : '') + '!</p>'
    + '<p>O estágio do(a) aluno(a) <strong>' + (parecer.nomeAluno || '—') + '</strong> chegou ao final e aguarda seu parecer como coordenador(a) do curso.</p>'
    + (parecer.ciclo > 1 ? '<p><strong>⚠️ Este parecer foi devolvido para revisão (ciclo ' + parecer.ciclo + ').</strong></p>' : '')
    + '<p><strong>Curso:</strong> ' + (parecer.curso || '—') + '<br><strong>Total de Horas:</strong> ' + (parecer.totalHoras || 0) + 'h</p>'
    + '<a href="' + url + '" class="btn">Preencher Parecer</a>'
    + '<p style="font-size:12px;color:#6b7280;margin-top:16px;">Ou copie: ' + url + '</p>'
  );
  _parecerEnviarEmail_(parecer.emailCoordenador,
    '[SGE] Parecer Final de Estágio — ' + (parecer.nomeAluno || parecer.idEstagio), html);
}

function _notificarParecerDiretoria_(parecer) {
  var url = _parecerUrl_(parecer.idEstagio, parecer.tokenDiretoria);
  var dirLabel = parecer.tipoDiretoria === 'DEN' ? 'Diretoria de Ensino' : 'Diretoria de Extensão';
  var html = _parecerEmailHtml_(
    'Parecer Final de Estágio — ' + dirLabel,
    '<p>O parecer do coordenador de curso foi registrado. Agora aguarda o parecer final da <strong>' + dirLabel + '</strong>.</p>'
    + '<p><strong>Aluno(a):</strong> ' + (parecer.nomeAluno || '—') + '<br>'
    + '<strong>Curso:</strong> ' + (parecer.curso || '—') + '<br>'
    + '<strong>Total de Horas:</strong> ' + (parecer.totalHoras || 0) + 'h<br>'
    + '<strong>Parecer do Coordenador:</strong> ' + (parecer.parecerCoordenador ? parecer.parecerCoordenador.resultado : '—') + '</p>'
    + '<a href="' + url + '" class="btn">Preencher Parecer</a>'
    + '<p style="font-size:12px;color:#6b7280;margin-top:16px;">Ou copie: ' + url + '</p>'
  );
  _parecerEnviarEmail_(parecer.emailDiretoria,
    '[SGE] Parecer Final de Estágio — ' + (parecer.nomeAluno || parecer.idEstagio), html);
}

function _notificarParecerAdmin_(parecer) {
  var adminUrl = BASE_URL + '/admin/estagio.html?id=' + encodeURIComponent(parecer.idEstagio);
  var html = _parecerEmailHtml_(
    'Parecer Final — Aguardando Aprovação',
    '<p>O parecer final do estágio de <strong>' + (parecer.nomeAluno || '—') + '</strong> foi preenchido e assinado por coordenador e diretoria. Aguarda sua aprovação.</p>'
    + '<p><strong>Coord.:</strong> ' + (parecer.parecerCoordenador ? parecer.parecerCoordenador.resultado : '—') + '<br>'
    + '<strong>' + (parecer.tipoDiretoria === 'DEN' ? 'DEN' : 'DEX') + ':</strong> ' + (parecer.parecerDiretoria ? parecer.parecerDiretoria.resultado : '—') + '</p>'
    + '<a href="' + adminUrl + '" class="btn">Revisar e Aprovar</a>'
  );
  _parecerEnviarEmail_('estagios@riogrande.ifrs.edu.br',
    '[SGE] Parecer Final pronto para aprovação — ' + (parecer.nomeAluno || parecer.idEstagio), html);
}

function _notificarParecerReprovadoAdmin_(parecer, motivo) {
  var html = _parecerEmailHtml_(
    'Parecer Final Devolvido — Novo Ciclo',
    '<p>Olá' + (parecer.nomeCoordenador ? ', <strong>' + parecer.nomeCoordenador + '</strong>' : '') + '!</p>'
    + '<p>O parecer final do estágio de <strong>' + (parecer.nomeAluno || '—') + '</strong> foi devolvido pela Central de Estágios para revisão.</p>'
    + '<p><strong>Motivo:</strong> ' + (motivo || '—') + '</p>'
    + '<a href="' + _parecerUrl_(parecer.idEstagio, parecer.tokenCoordenador) + '" class="btn">Preencher Novamente</a>'
  );
  _parecerEnviarEmail_(parecer.emailCoordenador,
    '[SGE] Parecer Final Devolvido — ' + (parecer.nomeAluno || parecer.idEstagio), html);
}

function _notificarParecerConclusao_(parecer, sol) {
  var html = _parecerEmailHtml_(
    'Parecer Final Aprovado — Estágio Concluído',
    '<p>O parecer final do estágio foi aprovado pela Central de Estágios. O PDF está disponível no Drive.</p>'
    + '<p><strong>Aluno(a):</strong> ' + (parecer.nomeAluno || '—') + '<br>'
    + '<strong>Curso:</strong> ' + (parecer.curso || '—') + '</p>'
    + (parecer.pdfUrl ? '<a href="' + parecer.pdfUrl + '" class="btn">Baixar PDF</a>' : '')
  );
  var dests = [
    parecer.emailCoordenador,
    parecer.emailDiretoria,
    sol ? sol.emailEstudante : '',
    'estagios@riogrande.ifrs.edu.br',
  ].filter(function (e) { return !!(e && String(e).indexOf('@') > 0); });
  var vistos = {};
  dests.forEach(function (e) {
    if (!vistos[e]) { vistos[e] = true; _parecerEnviarEmail_(e, '[SGE] Parecer Final Aprovado — ' + (parecer.nomeAluno || parecer.idEstagio), html); }
  });
}

// ── Handlers GET / POST ───────────────────────────────────────────────────────

function doGetParecer(e) {
  var action  = (e.parameter && e.parameter.action)    || '';
  var id      = (e.parameter && e.parameter.id)        || '';
  var token   = (e.parameter && e.parameter.token)     || '';
  var authTk  = (e.parameter && e.parameter.authToken) || '';

  switch (action) {
    case 'obterParecerFinal':
      if (!id) return jsonError_('Parâmetro id obrigatório.', 'MISSING_PARAM');
      return obterParecer_Handler_(id, token, authTk);

    case 'listarPareceresPendentes': {
      // Coordenador acessa autenticado — valida token de staff
      var papel = (e.parameter && e.parameter.papel) || '';
      var ref   = (e.parameter && e.parameter.ref)   || '';
      if (!papel || !ref) return jsonError_('Parâmetros papel e ref obrigatórios.', 'MISSING_PARAM');
      return listarPareceresPendentes_(papel, ref);
    }

    default:
      return jsonError_('Ação GET desconhecida em parecer: ' + action, 'UNKNOWN_ACTION');
  }
}

function doPostParecer(e) {
  var body   = e._body || {};
  var action = body.action || '';

  switch (action) {
    case 'iniciarParecerFinal':
      return iniciarParecerFinal_(body.idEstagio || '', body.authToken || '');

    case 'salvarParecerCoordenador':
      return salvarParecerCoordenador_(body.idEstagio || '', body.token || '', body.dados || {});

    case 'salvarParecerDiretoria':
      return salvarParecerDiretoria_(body.idEstagio || '', body.token || '', body.dados || {});

    case 'aprovarParecerAdmin':
      return aprovarParecerAdmin_(body.idEstagio || '', body.authToken || '');

    case 'reprovarParecerAdmin':
      return reprovarParecerAdmin_(body.idEstagio || '', body.authToken || '', body.motivo || '');

    case 'regenerarPdfParecer':
      return regenerarPdfParecer_(body.idEstagio || '', body.authToken || '');

    case 'concluirEstagio':
      return concluirEstagio_(body.idEstagio || '', body.authToken || '');

    default:
      return jsonError_('Ação POST desconhecida em parecer: ' + action, 'UNKNOWN_ACTION');
  }
}
