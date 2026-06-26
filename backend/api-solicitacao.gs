/**
 * api-solicitacao.gs — Web App: Solicitações de Estágio, Relatórios e Adendos
 * SGE — Sistema de Gestão de Estágios · IFRS Campus Rio Grande
 *
 * Rotas POST:
 *   solicitarEstagio         — Nova solicitação de TCE
 *   enviarRelatorioParcial   — Relatório semestral
 *   enviarRelatorioFinal     — Relatório de conclusão
 *   enviarAdendo             — Adendo ao TCE
 *
 * Planilha de Solicitações ID: 1zVyseifVC6xeMpNjqwYd6jCq9HTJ2NS8BlN1dtM4s7Y
 */

'use strict';

var CFG_SOL = {
  SS_ID:         '1zVyseifVC6xeMpNjqwYd6jCq9HTJ2NS8BlN1dtM4s7Y',
  ABA_SOL:       'Solicitações',
  ABA_PARC:      'Relatórios Parciais',
  ABA_FINAL:     'Relatórios Finais',
  ABA_ADENDO:    'Adendos',
  ABA_DOC:       'Documentos',
};

/**
 * Colunas da aba de Solicitações (base 0).
 * Mesmo formato do Form original para manter compatibilidade.
 */
var COL_SOL = {
  TIMESTAMP:         0,
  ID_ESTAGIO:        1,
  EMAIL_ESTUDANTE:   2,
  NOME_ESTUDANTE:    3,
  MATRICULA:         4,
  CURSO:             5,
  CPF:               6,
  DATA_NASC:         7,
  TELEFONE:          8,
  TIPO_ESTAGIO:      9,
  NOME_EMPRESA:      10,
  CNPJ_EMPRESA:      11,
  NOME_SUPERVISOR:   12,
  EMAIL_SUPERVISOR:  13,
  NOME_AGENTE:       14,
  NOME_ORIENTADOR:   15,
  EMAIL_ORIENTADOR:  16,
  DATA_INICIO:       17,
  DATA_TERMINO:      18,
  CARGA_HOR:         19,
  HORARIO:           20,
  REMUNERACAO:       21,
  VALOR_BOLSA:       22,
  VALOR_TRANSPORTE:  23,
  PLANO_ATIVIDADES:  24,
  LINK_DOC_MAT:      25,   // matrícula
  LINK_DOC_ID:       26,   // identidade
  LINK_DOC_BOL:      27,   // boletim
  STATUS:            28,   // Pendente / Em análise / Aguardando Documentos / etc.
  OBS_SETOR:         29,   // Observações do setor
  MOTIVO_REPROVACAO: 30,   // Motivo de reprovação de documentos
  DRIVE_URL:         31,   // URL da pasta no Drive (alias: LINK_PASTA_DRIVE)
  DATA_APROVACAO:    32,   // Data de aprovação da solicitação
  DATA_DOC_ENVIADO:  33,   // Data em que o estudante enviou os documentos assinados
  DATA_ATIVACAO:     34,   // Data de ativação do estágio
  OBJETIVOS:         35,   // Objetivos do estágio (campo da solicitação)
  FORMANDO:          36,   // "Sim" ou "Não" — último semestre/ano letivo
  TURNO:             37,   // Turno do estudante no curso (informado na solicitação)
  SEMESTRE_SOL:      38,   // Período/Semestre atual (informado na solicitação)
  EMAIL_INST_ESTAGIO:39,   // E-mail institucional do vínculo usado neste estágio
  NOME_RESP:         40,   // Nome do responsável legal (menores de 18 anos)
  CPF_RESP:          41,   // CPF do responsável legal
  TEL_RESP:          42,   // Telefone do responsável legal
  NEE:               43,   // Portador de Necessidades Específicas — copiado do cadastro do estudante
  TOKEN_ACEITE_ORI:  44,   // UUID de uso único para aceite/recusa do orientador via magic link
  IDEMPOTENCY_KEY:   45,   // Chave única gerada no frontend para evitar submissões duplicadas
  CARGA_HOR_TOTAL:   46,   // Carga horária total do estágio (h semanal × semanas do período)
};

/** Colunas da aba Relatórios Parciais (base 0). */
var COL_PARC = {
  TIMESTAMP:           0,
  ID_ESTAGIO:          1,
  EMAIL_ESTUDANTE:     2,
  PERIODO_REF:         3,
  ATIVIDADES:          4,
  APRENDIZAGENS:       5,
  RELACAO_CURSO:       6,
  AVALIACAO:           7,
  DIFICULDADES:        8,
  SUGESTOES:           9,
};

/** Colunas da aba Relatórios Finais (base 0). */
var COL_FINAL = {
  TIMESTAMP:             0,
  ID_ESTAGIO:            1,
  EMAIL_ESTUDANTE:       2,
  DATA_ENCERRAMENTO:     3,
  RESUMO:                4,
  COMPETENCIAS:          5,
  CONTRIBUICAO:          6,
  AVAL_CONCEDENTE:       7,
  AVAL_ORIENTADOR:       8,
  RECOMENDARIA:          9,
  CONSIDERACOES:         10,
};

/** Colunas da aba Documentos Avulsos (base 0). */
var COL_DOC = {
  TIMESTAMP:      0,
  ID_ESTAGIO:     1,
  EMAIL_UPLOADER: 2,
  PERFIL:         3,  // 'Estudante' | 'Admin'
  TITULO:         4,
  LINK_DRIVE:     5,
  NOME_ARQUIVO:   6,
  DOC_ID:         7,  // UUID gerado no upload (substitui chave no PropertiesService)
  REVISADO_ADMIN: 8,  // 'Sim' | '' — marcado pelo admin
  OBS_ADMIN:      9,  // Observação do admin ao revisar
};

/** Colunas da aba Adendos (base 0). */
var COL_ADENDO = {
  TIMESTAMP:          0,
  ID_ESTAGIO:         1,
  EMAIL_ESTUDANTE:    2,
  TIPO_ADENDO:        3,
  NOVA_DATA_TERMINO:  4,
  NOVA_CARGA:         5,
  NOVO_HORARIO:       6,
  JUSTIFICATIVA:      7,
  OBS:                8,
  STATUS:             9,  // Pendente / Aprovado / Reprovado
};

// ---------------------------------------------------------------------------
// POST — Solicitar estágio
// ---------------------------------------------------------------------------

function solicitarEstagio_(dados) {
  var tokenInfo = validarTokenEstudante_(dados.authToken);

  if (!checkRateLimit_('solicitarEstagio', 3)) {
    return jsonError_('Muitas requisições. Aguarde um momento.', 'RATE_LIMIT');
  }

  // Obtém dados do estudante pelo e-mail autenticado
  var estudante;
  try {
    estudante = buscarEstudantePorEmail_(tokenInfo.email);
  } catch (e) {
    return jsonError_(e.message, 'AUTH_ERROR');
  }

  // Sanitização dos campos da solicitação
  var tipoEstagio    = sanitizar_(dados.tipoEstagio, 30);
  var nomeEmpresa    = sanitizar_(dados.nomeEmpresa, 200);
  var cnpjEmpresa    = sanitizar_(dados.cnpjEmpresa, 14).replace(/\D/g, '');
  var nomeSupervisor = sanitizar_(dados.nomeSupervisor, 200);
  var emailSupervisor= sanitizar_(dados.emailSupervisor, 100);
  var nomeAgente     = sanitizar_(dados.nomeAgente, 100);
  var nomeOrientador = sanitizar_(dados.nomeOrientador, 200);
  var emailOrientador= sanitizar_(dados.emailOrientador, 100);
  var dataInicio     = sanitizar_(dados.dataInicio, 10);
  var dataTermino    = sanitizar_(dados.dataTermino, 10);
  var cargaHor       = sanitizar_(dados.cargaHoraria, 20);
  var horario        = sanitizar_(dados.diasHorarios, 500);
  var remuneracao    = sanitizar_(dados.remunerado, 5);
  var valorBolsa     = sanitizar_(dados.valorBolsa, 20);
  var valorTransp    = sanitizar_(dados.valorTransporte, 20);
  var planoAtiv      = _normalizarAtividades_(dados.atividadesPrevistas || dados.planoAtividades);
  var formando       = sanitizar_(dados.formando, 50).indexOf('Sim') === 0 ? 'Sim' : 'Não';
  // docs de admissão: chegam como { nome, base64 } do frontend
  var arqMat = (dados.docMatricula  && dados.docMatricula.base64)  ? dados.docMatricula  : null;
  var arqId  = (dados.docIdentidade && dados.docIdentidade.base64) ? dados.docIdentidade : null;
  var arqBol = (dados.docBoletim    && dados.docBoletim.base64)    ? dados.docBoletim    : null;

  // Validação de magic bytes: todos os arquivos devem ser PDF (%PDF = bytes 25 50 44 46)
  function isPdfBase64_(arq) {
    if (!arq || !arq.base64) return false;
    try {
      var bytes = Utilities.base64Decode(arq.base64.slice(0, 8));
      return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
    } catch (_) { return false; }
  }
  if (arqMat && !isPdfBase64_(arqMat)) return jsonError_('O comprovante de matrícula não é um PDF válido.', 'VALIDATION');
  if (arqId  && !isPdfBase64_(arqId))  return jsonError_('O documento de identidade não é um PDF válido.', 'VALIDATION');
  if (arqBol && !isPdfBase64_(arqBol)) return jsonError_('O boletim não é um PDF válido.', 'VALIDATION');
  // Curso e matrícula específicos deste estágio (podem diferir do curso principal do estudante)
  var cursoEstagio     = sanitizar_(dados.cursoEstagio     || dados.curso,     100) || estudante.curso;
  var matriculaEstagio = sanitizar_(dados.matriculaEstagio || dados.matricula, 20).replace(/\D/g, '') || estudante.matricula;
  // Turno e semestre: informados na solicitação (não estão mais no cadastro)
  var turno              = sanitizar_(dados.turno, 30);
  var semestreAtual      = sanitizar_(dados.semestreAtual, 30);
  // E-mail institucional do vínculo deste estágio (pode diferir do e-mail principal do cadastro)
  var emailInstEstagio   = sanitizar_(dados.emailInstEstagio || '', 100).toLowerCase() || estudante.emailInst;

  // ── Validação de idade ────────────────────────────────────────────────────
  var idadeEstudante = 99; // fallback seguro: sem restrição
  var dnEst = String(estudante.dataNasc || '').trim();
  if (dnEst) {
    var dnObj = null;
    var partesDn = dnEst.split('-');
    if (partesDn.length >= 3 && /^\d{4}$/.test(partesDn[0])) {
      // Formato ISO YYYY-MM-DD (texto puro)
      dnObj = new Date(parseInt(partesDn[0]), parseInt(partesDn[1]) - 1, parseInt(partesDn[2]));
    } else {
      // Fallback: Google Sheets converteu para Date e String() gerou formato longo
      dnObj = new Date(dnEst);
    }
    if (dnObj && !isNaN(dnObj.getTime())) {
      var hojeEst = new Date();
      idadeEstudante = hojeEst.getFullYear() - dnObj.getFullYear();
      var mEst = hojeEst.getMonth() - dnObj.getMonth();
      if (mEst < 0 || (mEst === 0 && hojeEst.getDate() < dnObj.getDate())) idadeEstudante--;
    }
  }
  if (idadeEstudante < 16) {
    return jsonError_('Estudantes com menos de 16 anos não podem realizar estágio (Lei nº 11.788/2008).', 'VALIDATION');
  }

  // ── Responsável legal (obrigatório para menores de 18 anos) ──────────────
  var nomeResp = sanitizar_(dados.nomeResponsavel || '', 200);
  var cpfResp  = sanitizar_(dados.cpfResponsavel  || '', 14).replace(/\D/g, '');
  var telResp  = sanitizar_(dados.telResponsavel  || '', 30);
  if (idadeEstudante < 18) {
    if (!nomeResp) return jsonError_('Nome do responsável legal é obrigatório para menores de 18 anos.', 'VALIDATION');
    if (!telResp)  return jsonError_('Telefone do responsável legal é obrigatório para menores de 18 anos.', 'VALIDATION');
    if (cpfResp && !validarCPF_(cpfResp)) return jsonError_('CPF do responsável legal inválido.', 'VALIDATION');
  }

  // Validações
  if (!tipoEstagio)    return jsonError_('Tipo de estágio é obrigatório.', 'VALIDATION');
  if (!nomeEmpresa)    return jsonError_('Empresa é obrigatória.', 'VALIDATION');
  if (!nomeSupervisor) return jsonError_('Supervisor é obrigatório.', 'VALIDATION');
  if (!nomeOrientador) return jsonError_('Orientador é obrigatório.', 'VALIDATION');

  // Valida domínio do e-mail do orientador (deve ser servidor institucional)
  if (emailOrientador) {
    if (!validarEmail_(emailOrientador)) {
      return jsonError_('E-mail do orientador inválido.', 'VALIDATION');
    }
    var emailOriDomain = emailOrientador.split('@')[1] || '';
    if (emailOriDomain !== 'riogrande.ifrs.edu.br') {
      return jsonError_('O e-mail do orientador deve ser institucional (@riogrande.ifrs.edu.br).', 'VALIDATION');
    }
  }
  if (!dataInicio)     return jsonError_('Data de início é obrigatória.', 'VALIDATION');
  if (!dataTermino)    return jsonError_('Data de término é obrigatória.', 'VALIDATION');
  if (!cargaHor)       return jsonError_('Carga horária é obrigatória.', 'VALIDATION');

  // Valida carga horária máxima conforme NEE (Lei nº 11.788/2008)
  var cargaHorNums = parseInt(String(cargaHor).replace(/\D/g, ''), 10) || 0;
  if (estudante.nee === 'Sim' && cargaHorNums > 20) {
    return jsonError_('Estudantes com NEE têm carga horária máxima de 20h semanais.', 'VALIDATION');
  }
  if (cargaHorNums > 40) {
    return jsonError_('Carga horária semanal não pode exceder 40h.', 'VALIDATION');
  }
  if (cargaHorNums < 1) {
    return jsonError_('Carga horária inválida.', 'VALIDATION');
  }

  // Verifica aceite da declaração de veracidade (assinatura eletrônica)
  if (String(dados.declaracoes || '').trim() !== 'Todas aceitas') {
    return jsonError_('É necessário aceitar a declaração de veracidade das informações.', 'VALIDATION');
  }
  // Data início deve ser >= hoje + N dias (configurável pelo Admin em Configurações → Prazos)
  var _prazos      = obterPrazos_();
  var _minDias     = (_prazos.solicitacao && _prazos.solicitacao.minimoInicio) || 7;
  var hoje         = new Date(); hoje.setHours(0, 0, 0, 0);
  var minInicio    = new Date(hoje.getTime() + _minDias * 86400000);
  var dtInicio     = new Date(dataInicio + 'T00:00:00');
  if (dtInicio < minInicio) {
    return jsonError_('A data de início deve ser de pelo menos ' + _minDias + ' dias a partir de hoje.', 'VALIDATION');
  }
  if (dataTermino <= dataInicio) {
    return jsonError_('A data de término deve ser posterior à data de início.', 'VALIDATION');
  }

  // Gera ID único — verifica colisão na planilha (Math.random não é CSPRNG)
  var ss    = SpreadsheetApp.openById(CFG_SOL.SS_ID);
  var sheet = ss.getSheetByName(CFG_SOL.ABA_SOL) || ss.getSheets()[0];

  // ── Idempotência: se a chave já existe, devolve o ID já registrado ──────────
  var idemKey = sanitizar_(dados.solicitacaoKey || '', 64);
  if (idemKey) {
    var idemVals = sheet.getDataRange().getValues();
    for (var ik = 1; ik < idemVals.length; ik++) {
      if (String(idemVals[ik][COL_SOL.IDEMPOTENCY_KEY] || '').trim() === idemKey) {
        var idExist = String(idemVals[ik][COL_SOL.ID_ESTAGIO] || '');
        return jsonOk_({
          idEstagio:           idExist,
          orientadorConvidado: false,
          mensagem:            'Solicitação já registrada anteriormente (ID: ' + idExist + '). Verifique seu e-mail de confirmação.',
          idempotente:         true,
        });
      }
    }
  }

  var idEstagio;
  (function gerarIdUnico() {
    for (var t = 0; t < 10; t++) {
      var candidato = gerarIdEstagio_();
      var vals      = sheet.getDataRange().getValues();
      var existe    = false;
      for (var ci = 1; ci < vals.length; ci++) {
        if (String(vals[ci][COL_SOL.ID_ESTAGIO] || '').trim() === candidato) {
          existe = true; break;
        }
      }
      if (!existe) { idEstagio = candidato; return; }
    }
    idEstagio = gerarIdEstagio_(); // fallback final (colisão improvável)
  })();

  // ── Orientador: cria entrada provisional se ainda não cadastrado ────────────
  var oriConvidado = false;
  if (emailOrientador) {
    try {
      var oriExistente = verificarOrientadorPorEmail_(emailOrientador);
      if (!oriExistente) {
        criarOrientadorConvidado_(emailOrientador, nomeOrientador);
        oriConvidado = true;
      } else {
        // Considera 'Convidado' como ainda não cadastrado (cadastro incompleto)
        var oriStatus = String(oriExistente.data[COL_ORI.STATUS] || '').trim();
        if (oriStatus === 'Convidado') oriConvidado = true;
      }
    } catch (eOri) { logErro_('solicitarEstagio_.verificarOrientador', eOri); }
  }

  // Cria pasta no Drive imediatamente para armazenar os documentos de admissão.
  // Estrutura: Estágios / [Ano] / [ID — Nome]
  // Mesmo que a solicitação seja reprovada depois, a pasta já existe e pode ser reutilizada.
  var driveUrlSol  = '';
  var docMatLink   = '';
  var docIdLink    = '';
  var docBolLink   = '';

  try {
    var driveRes = criarPastaEstagio_(idEstagio, estudante.nome || '');
    var pastaEst = driveRes.folder;
    driveUrlSol  = driveRes.url;

    if (pastaEst) {
      // Sobe cada documento de admissão na subpasta Admissão
      var pastaAdm = obterOuCriarPasta_(pastaEst, 'Admissão');

      var uploadArqAdm_ = function(arq) {
        if (!arq || !arq.base64 || !arq.nome) return '';
        try {
          // Valida extensão + magic bytes (o cliente não controla o MIME final)
          var val = validarArquivoUpload_(arq, ['pdf', 'png', 'jpg', 'jpeg']);
          if (!val.ok) { logErro_('uploadArqAdm_', new Error(val.erro)); return ''; }
          // Remove prefixo data-URI antes de decodificar
          var b64raw = String(arq.base64);
          var ci = b64raw.indexOf(',');
          if (ci !== -1) b64raw = b64raw.slice(ci + 1);
          var bytes = Utilities.base64Decode(b64raw);
          var blob  = Utilities.newBlob(bytes, val.mime, sanitizarNomeArquivo_(arq.nome));
          var file  = pastaAdm.createFile(blob);
          // DOMAIN_WITH_LINK: restrito ao domínio institucional (LGPD — docs pessoais)
          file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
          return file.getUrl();
        } catch (eU) { logErro_('solicitarEstagio_.uploadAdm', eU); return ''; }
      };

      docMatLink = uploadArqAdm_(arqMat);
      docIdLink  = uploadArqAdm_(arqId);
      docBolLink = uploadArqAdm_(arqBol);
    }

  } catch (eDrive) {
    logErro_('solicitarEstagio_.drive', eDrive);
    // Drive falhou mas não bloqueia a submissão — docs ficam sem link
  }

  // Monta linha (ss e sheet já abertos acima para verificar unicidade do ID)
  var now = new Date();

  var linha = [];
  linha[COL_SOL.TIMESTAMP]        = now;
  linha[COL_SOL.ID_ESTAGIO]       = idEstagio;
  linha[COL_SOL.EMAIL_ESTUDANTE]  = estudante.emailInst;
  linha[COL_SOL.NOME_ESTUDANTE]   = estudante.nome;
  linha[COL_SOL.MATRICULA]        = matriculaEstagio;   // matrícula do curso deste estágio
  linha[COL_SOL.CURSO]            = cursoEstagio;        // curso deste estágio
  linha[COL_SOL.CPF]              = estudante.cpf;
  linha[COL_SOL.DATA_NASC]        = estudante.dataNasc;
  linha[COL_SOL.TELEFONE]         = estudante.telefone;
  linha[COL_SOL.TIPO_ESTAGIO]     = tipoEstagio;
  linha[COL_SOL.NOME_EMPRESA]     = nomeEmpresa;
  linha[COL_SOL.CNPJ_EMPRESA]     = cnpjEmpresa;
  linha[COL_SOL.NOME_SUPERVISOR]  = nomeSupervisor;
  linha[COL_SOL.EMAIL_SUPERVISOR] = emailSupervisor;
  linha[COL_SOL.NOME_AGENTE]      = nomeAgente;
  linha[COL_SOL.NOME_ORIENTADOR]  = nomeOrientador;
  linha[COL_SOL.EMAIL_ORIENTADOR] = emailOrientador;
  linha[COL_SOL.DATA_INICIO]      = dataInicio;
  linha[COL_SOL.DATA_TERMINO]     = dataTermino;
  linha[COL_SOL.CARGA_HOR]        = cargaHor;
  linha[COL_SOL.HORARIO]          = horario;
  linha[COL_SOL.REMUNERACAO]      = remuneracao;
  linha[COL_SOL.VALOR_BOLSA]      = valorBolsa;
  linha[COL_SOL.VALOR_TRANSPORTE] = valorTransp;
  linha[COL_SOL.PLANO_ATIVIDADES] = planoAtiv;
  linha[COL_SOL.OBJETIVOS]        = sanitizar_(dados.objetivos || '', 2000);
  linha[COL_SOL.FORMANDO]         = formando;
  linha[COL_SOL.TURNO]              = turno;
  linha[COL_SOL.SEMESTRE_SOL]       = semestreAtual;
  linha[COL_SOL.EMAIL_INST_ESTAGIO] = emailInstEstagio;
  linha[COL_SOL.NOME_RESP]          = nomeResp;
  linha[COL_SOL.CPF_RESP]           = cpfResp;
  linha[COL_SOL.TEL_RESP]           = telResp;
  linha[COL_SOL.NEE]                = estudante.nee || 'Não';
  linha[COL_SOL.LINK_DOC_MAT]       = docMatLink;
  linha[COL_SOL.LINK_DOC_ID]       = docIdLink;
  linha[COL_SOL.LINK_DOC_BOL]      = docBolLink;
  // Status inicial: checklist já inicia imediatamente com o orientador
  linha[COL_SOL.STATUS]            = 'Em Checklist';
  linha[COL_SOL.OBS_SETOR]         = '';
  linha[COL_SOL.MOTIVO_REPROVACAO] = '';
  linha[COL_SOL.DRIVE_URL]         = driveUrlSol;
  // Token de acesso ao checklist do orientador (magic-link)
  var aceiteToken = Utilities.getUuid();
  linha[COL_SOL.TOKEN_ACEITE_ORI]  = aceiteToken;
  linha[COL_SOL.IDEMPOTENCY_KEY]   = idemKey;
  // Carga horária total: enviada pelo frontend (cálculo preciso por dia da semana)
  // Fallback: horas semanais × semanas do período, se o frontend não enviou
  var _chTotalRaw = sanitizar_(dados.cargaHorariaTotal || '', 20).trim();
  if (!_chTotalRaw && cargaHorNums > 0) {
    var _dtIni  = new Date(dataInicio  + 'T00:00:00');
    var _dtFim  = new Date(dataTermino + 'T00:00:00');
    var _semanas = Math.round((_dtFim - _dtIni) / (7 * 24 * 3600 * 1000));
    if (_semanas > 0) _chTotalRaw = (cargaHorNums * _semanas) + 'h';
  }
  linha[COL_SOL.CARGA_HOR_TOTAL]   = _chTotalRaw;

  // Lock atômico: impede que duas submissões simultâneas com a mesma chave de idempotência gravem duas linhas
  var lockSol = LockService.getScriptLock();
  try {
    lockSol.waitLock(10000);
  } catch (_ls) {
    try { if (driveRes && driveRes.folder) driveRes.folder.setTrashed(true); } catch (_) {}
    throw new Error('Servidor ocupado. Aguarde alguns instantes e tente novamente.');
  }
  try {
    // Re-verifica idempotência dentro do lock (outro thread pode ter gravado entre a pré-checagem e agora)
    if (idemKey) {
      var idemVals2 = sheet.getDataRange().getValues();
      for (var ik2 = 1; ik2 < idemVals2.length; ik2++) {
        if (String(idemVals2[ik2][COL_SOL.IDEMPOTENCY_KEY] || '').trim() === idemKey) {
          var idExist2 = String(idemVals2[ik2][COL_SOL.ID_ESTAGIO] || '');
          try { if (driveRes && driveRes.folder) driveRes.folder.setTrashed(true); } catch (_) {}
          return jsonOk_({
            idEstagio:           idExist2,
            orientadorConvidado: false,
            mensagem:            'Solicitação já registrada anteriormente (ID: ' + idExist2 + '). Verifique seu e-mail de confirmação.',
            idempotente:         true,
          });
        }
      }
    }
    // Persiste na planilha — se falhar, desfaz a pasta Drive criada acima (rollback best-effort)
    try {
      sheet.appendRow(linha);
    } catch (eSheet) {
      try { if (driveRes && driveRes.folder) driveRes.folder.setTrashed(true); } catch (_) {}
      logErro_('solicitarEstagio_.appendRow', eSheet);
      return jsonError_('Erro ao registrar a solicitação. Tente novamente.', 'INTERNAL');
    }
  } finally {
    lockSol.releaseLock();
  }

  // ── Inicia o checklist imediatamente (1º ator: orientador) ───────────────
  try {
    iniciarChecklist_(idEstagio, {
      dataNasc:        estudante.dataNasc || '',
      dataInicio:      dataInicio,
      nomeAgente:      nomeAgente,
      tokenOrientador: aceiteToken,
      // Assinatura eletrônica do estagiário — registrada no momento da submissão
      assinaturaEstudante: {
        nome:         String(estudante.nome      || ''),
        cpf:          String(estudante.cpf       || ''),
        email:        String(estudante.emailInst || tokenInfo.email || ''),
        dataHora:     now.toISOString(),
        aceitouTermo: true,
      },
    });
  } catch (eCk) { logErro_('solicitarEstagio_.checklist', eCk); }

  // ── Notificações ─────────────────────────────────────────────────────────
  // Estudante: confirmação de envio (o orientador receberá e-mail separado via iniciarChecklist_)
  try {
    enviarEmailAguardandoAceiteEstudante_({
      nomeEstudante:  estudante.nome,
      emailEstudante: estudante.emailInst,
      idEstagio:      idEstagio,
      nomeOrientador: nomeOrientador,
      nomeEmpresa:    nomeEmpresa,
      tipoEstagio:    tipoEstagio,
      dataInicio:     formatarData_(dataInicio),
      dataTermino:    formatarData_(dataTermino),
    });
  } catch (e) { logErro_('solicitarEstagio_.mailEstudante', e); }

  return jsonOk_({
    idEstagio:          idEstagio,
    orientadorConvidado: oriConvidado,
    mensagem: oriConvidado
      ? 'Solicitação enviada! Um convite foi enviado para ' + emailOrientador + ' para que o(a) professor(a) complete o cadastro e revise o checklist. Você será notificado(a) assim que ele(a) responder.'
      : 'Solicitação enviada! O(a) orientador(a) ' + nomeOrientador + ' receberá um e-mail para revisar e validar o checklist. Você será notificado(a) assim que ele(a) responder.',
  });
}

// ---------------------------------------------------------------------------
// POST — Enviar adendo
// ---------------------------------------------------------------------------

function enviarAdendo_(dados) {
  var tokenInfo = validarTokenEstudante_(dados.authToken);

  if (!checkRateLimit_('enviarAdendo')) {
    return jsonError_('Muitas requisições. Aguarde um momento.', 'RATE_LIMIT');
  }

  var idEstagio = sanitizar_(dados.idEstagio, 20).toUpperCase().trim();
  if (!idEstagio.match(/^RG\d{2}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)) {
    return jsonError_('ID do estágio inválido.', 'VALIDATION');
  }

  var tipoAdendo   = sanitizar_(dados.tipoAdendo, 50);
  var novaData     = sanitizar_(dados.novaDataTermino, 10);
  var novaCarga    = sanitizar_(dados.novaCargaHoraria, 20);
  var novoHorario  = sanitizar_(dados.novoHorario, 3000); // JSON para tabela de horários
  var justificativa= sanitizar_(dados.justificativa, 2000);
  var obs          = sanitizar_(dados.obsAdicionais, 500);

  if (!tipoAdendo) return jsonError_('Tipo de adendo é obrigatório.', 'VALIDATION');
  // justificativa é opcional

  if ((tipoAdendo === 'Prorrogação de prazo' || tipoAdendo === 'Redução de prazo') && !novaData)
    return jsonError_('Nova data de término é obrigatória para este tipo de adendo.', 'VALIDATION');
  if (tipoAdendo === 'Alteração de horário / carga horária' && !novoHorario)
    return jsonError_('Os dias e horários do estágio são obrigatórios para este tipo de adendo.', 'VALIDATION');

  verificarIdEstagio_(idEstagio, tokenInfo.email);

  var idAdendo = Utilities.getUuid(); // ID único e estável para o adendo

  var ss    = SpreadsheetApp.openById(CFG_SOL.SS_ID);
  var sheet = obterOuCriarAba_(ss, CFG_SOL.ABA_ADENDO,
    ['Timestamp','ID Estágio','E-mail Estudante','Tipo de Adendo','Nova Data Término',
     'Nova Carga Horária','Novo Horário','Justificativa','Observações','Status','ID Adendo']);

  var linha = [];
  linha[COL_ADENDO.TIMESTAMP]         = new Date();
  linha[COL_ADENDO.ID_ESTAGIO]        = idEstagio;
  linha[COL_ADENDO.EMAIL_ESTUDANTE]   = tokenInfo.email;
  linha[COL_ADENDO.TIPO_ADENDO]       = tipoAdendo;
  linha[COL_ADENDO.NOVA_DATA_TERMINO] = novaData;
  linha[COL_ADENDO.NOVA_CARGA]        = novaCarga;
  linha[COL_ADENDO.NOVO_HORARIO]      = novoHorario;
  linha[COL_ADENDO.JUSTIFICATIVA]     = justificativa;
  linha[COL_ADENDO.OBS]               = obs;
  linha[COL_ADENDO.STATUS]            = 'Pendente';
  linha[10]                           = idAdendo; // coluna ID Adendo (índice 10)

  sheet.appendRow(linha);

  // Notificação
  try {
    enviarEmailAdendoRecebido_({
      idEstagio:       idEstagio,
      emailEstudante:  tokenInfo.email,
      tipoAdendo:      tipoAdendo,
      novaDataTermino: novaData ? formatarData_(novaData) : '',
      novaCargaHoraria:novaCarga,
      novoHorario:     novoHorario,
      justificativa:   justificativa,
    });
  } catch (e) { logErro_('enviarAdendo_.mail', e); }

  return jsonOk_({ mensagem: 'Adendo enviado com sucesso!' });
}

// ---------------------------------------------------------------------------
// GET — Verificar token de aceite do orientador
// ---------------------------------------------------------------------------

/**
 * Valida o token de aceite e retorna os dados da solicitação (sem dados sensíveis).
 * Chamado pela página orientadores/aceite-orientacao.html via ?token=UUID
 */
function verificarAceiteOrientador_(e) {
  var token = (e.parameter && e.parameter.token) || '';
  if (!token) return jsonError_('Token não informado.', 'VALIDATION');

  // Localiza o idEstagio pelo token na planilha
  var ss    = SpreadsheetApp.openById(CFG_SOL.SS_ID);
  var sheet = ss.getSheetByName(CFG_SOL.ABA_SOL);
  if (!sheet) return jsonError_('Planilha não configurada.', 'NOT_FOUND');
  var dados = sheet.getDataRange().getValues();

  for (var i = 1; i < dados.length; i++) {
    var tokenLinha = String(dados[i][COL_SOL.TOKEN_ACEITE_ORI] || '').trim();
    if (tokenLinha !== token) continue;

    var idEstagio = String(dados[i][COL_SOL.ID_ESTAGIO] || '');

    // Verifica expiração: token válido por N dias configuráveis (Admin → Configurações → Prazos)
    var tsLinha = dados[i][COL_SOL.TIMESTAMP];
    if (tsLinha) {
      var dtSol = tsLinha instanceof Date ? tsLinha : new Date(tsLinha);
      var _prazosToken   = obterPrazos_();
      var _validadeDias  = (_prazosToken.solicitacao && _prazosToken.solicitacao.validadeTokenOrientador) || 30;
      if (!isNaN(dtSol.getTime()) && (Date.now() - dtSol.getTime()) > _validadeDias * 86400000) {
        return jsonError_('Este link expirou (mais de ' + _validadeDias + ' dias). Solicite um novo link ao estudante.', 'EXPIRED');
      }
    }

    // Valida contra o checklist (token deve estar pendente)
    var ck = obterChecklist_(idEstagio);
    if (!ck || !ck.orientador) {
      return jsonError_('Checklist não encontrado.', 'NOT_FOUND');
    }
    if (ck.orientador.token !== token) {
      return jsonError_('Token inválido.', 'INVALID_TOKEN');
    }
    if (ck.orientador.status !== 'pendente') {
      return jsonError_('Este link já foi utilizado.', 'EXPIRED');
    }

    // Retorna dados da solicitação + itens do checklist do orientador
    var _curso    = String(dados[i][COL_SOL.CURSO]            || '');
    var _cnpj     = String(dados[i][COL_SOL.CNPJ_EMPRESA]     || '');
    var _emailSup = String(dados[i][COL_SOL.EMAIL_SUPERVISOR]  || '');

    // Verifica se o orientador ainda precisa completar o cadastro
    var _emailOri = String(dados[i][COL_SOL.EMAIL_ORIENTADOR] || '').toLowerCase().trim();
    var _oriPrecisaCadastro = false;
    if (_emailOri) {
      try {
        var _oriEntry  = verificarOrientadorPorEmail_(_emailOri);
        var _oriStatus = _oriEntry ? String(_oriEntry.data[COL_ORI.STATUS] || '').trim() : '';
        _oriPrecisaCadastro = (!_oriEntry || _oriStatus === 'Convidado');
      } catch (_eOri) { /* ignora — não bloqueia o aceite */ }
    }

    return jsonOk_({
      idEstagio:          idEstagio,
      // ── Estudante ─────────────────────────────────────────────
      nomeEstudante:      String(dados[i][COL_SOL.NOME_ESTUDANTE]   || ''),
      emailEstudante:     String(dados[i][COL_SOL.EMAIL_ESTUDANTE]  || ''),
      matricula:          String(dados[i][COL_SOL.MATRICULA]        || ''),
      curso:              _curso,
      modalidade:         _ckDerivarModalidade_(_curso),
      turno:              String(dados[i][COL_SOL.TURNO]            || ''),
      semestre:           String(dados[i][COL_SOL.SEMESTRE_SOL]     || ''),
      formando:           String(dados[i][COL_SOL.FORMANDO]         || ''),
      telefoneEstudante:  String(dados[i][COL_SOL.TELEFONE]         || ''),
      // ── Responsável Legal (menores) ───────────────────────────
      nomeResp:           String(dados[i][COL_SOL.NOME_RESP]        || ''),
      cpfResp:            mascararCPF_(dados[i][COL_SOL.CPF_RESP]),
      // ── Empresa ───────────────────────────────────────────────
      nomeEmpresa:        String(dados[i][COL_SOL.NOME_EMPRESA]     || ''),
      cnpjEmpresa:        _cnpj,
      telEmpresa:         _ckObterTelEmpresa_(_cnpj),
      tipoEstagio:        String(dados[i][COL_SOL.TIPO_ESTAGIO]     || ''),
      // ── Supervisor ────────────────────────────────────────────
      nomeSupervisor:     String(dados[i][COL_SOL.NOME_SUPERVISOR]  || ''),
      emailSupervisor:    _emailSup,
      formacaoSupervisor: _ckObterFormacaoSupervisor_(_emailSup),
      // ── Orientador ────────────────────────────────────────────
      nomeOrientador:     String(dados[i][COL_SOL.NOME_ORIENTADOR]  || ''),
      // ── Coordenador ───────────────────────────────────────────
      nomeCoordenador:    _ckObterNomeCoordenador_(_curso),
      // ── Período e atividades ──────────────────────────────────
      dataInicio:         formatarData_(String(dados[i][COL_SOL.DATA_INICIO]  || '')),
      dataTermino:        formatarData_(String(dados[i][COL_SOL.DATA_TERMINO] || '')),
      cargaHoraria:       String(dados[i][COL_SOL.CARGA_HOR]        || ''),
      horario:            String(dados[i][COL_SOL.HORARIO]          || ''),
      planoAtividades:    String(dados[i][COL_SOL.PLANO_ATIVIDADES] || ''),
      // Itens do checklist do orientador para renderização na página
      checklistItens:         ck.orientador.itens || [],
      prazoVencimento:        ck.orientador.prazoVencimento || '',
      // Flag: orientador ainda não completou o cadastro (status 'Convidado' ou inexistente)
      orientadorPrecisaCadastro: _oriPrecisaCadastro,
      emailOrientador:           _emailOri,
    });
  }
  return jsonError_('Link inválido ou expirado.', 'NOT_FOUND');
}

// ---------------------------------------------------------------------------
// POST — Orientador responde ao aceite (aceito / recusado)
// ---------------------------------------------------------------------------

/**
 * POST — Orientador responde ao checklist (aceite/recusa/aprovação).
 * Delega para salvarRespostaAtor_ no api-checklist.gs.
 *
 * Body: { token, idEstagio, itens, decisao: 'aprovado'|'recusado'|'ajuste', obs }
 */
function responderAceiteOrientador_(body) {
  var token     = String(body.token     || '').trim();
  var idEstagio = sanitizar_(body.idEstagio || '', 20);
  var itens     = Array.isArray(body.itens) ? body.itens : [];
  var decisao   = String(body.decisao   || '').trim();
  var obs       = sanitizar_(body.obs   || '', 500);

  if (!token) return jsonError_('Token não informado.', 'VALIDATION');
  if (!decisao) return jsonError_('Decisão não informada.', 'VALIDATION');

  // Localiza a solicitação pelo token (ou pelo idEstagio se já veio)
  var ss    = SpreadsheetApp.openById(CFG_SOL.SS_ID);
  var sheet = ss.getSheetByName(CFG_SOL.ABA_SOL);
  if (!sheet) return jsonError_('Planilha não configurada.', 'INTERNAL');

  var dados = sheet.getDataRange().getValues();
  var linhaToken = null;

  if (!idEstagio) {
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][COL_SOL.TOKEN_ACEITE_ORI] || '') === token) {
        idEstagio  = String(dados[i][COL_SOL.ID_ESTAGIO] || '');
        linhaToken = dados[i];
        break;
      }
    }
    if (!idEstagio) return jsonError_('Token não encontrado ou já utilizado.', 'NOT_FOUND');
  } else {
    // idEstagio veio no body — localiza para validar o token
    for (var j = 1; j < dados.length; j++) {
      if (String(dados[j][COL_SOL.ID_ESTAGIO] || '') === idEstagio) {
        linhaToken = dados[j];
        break;
      }
    }
  }

  // Valida token contra a planilha (evita uso de token de outro estágio)
  if (linhaToken && String(linhaToken[COL_SOL.TOKEN_ACEITE_ORI] || '') !== token) {
    return jsonError_('Token inválido para este estágio.', 'AUTH_ERROR');
  }

  // Verifica se o status ainda permite resposta do orientador
  var statusAtual = linhaToken ? String(linhaToken[COL_SOL.STATUS] || '').trim() : '';
  if (statusAtual && statusAtual !== 'Em Checklist') {
    return jsonError_(
      'Este estágio não está mais aguardando resposta do orientador (status: ' + statusAtual + ').',
      'INVALID_STATE'
    );
  }

  return salvarRespostaAtor_(idEstagio, 'orientador', itens, decisao, obs, null, token);
}

// ---------------------------------------------------------------------------
// POST — Estudante troca orientador após recusa
// ---------------------------------------------------------------------------

function trocarOrientador_(body) {
  var tokenInfo = validarTokenEstudante_(body.authToken);

  var idEstagio       = sanitizar_(body.idEstagio, 20);
  var nomeOrientador  = sanitizar_(body.nomeOrientador, 200);
  var emailOrientador = sanitizar_(body.emailOrientador, 100).toLowerCase();

  if (!idEstagio)                        return jsonError_('ID do estágio é obrigatório.', 'VALIDATION');
  if (!nomeOrientador)                   return jsonError_('Orientador é obrigatório.', 'VALIDATION');
  if (!validarEmail_(emailOrientador))   return jsonError_('E-mail do orientador inválido.', 'VALIDATION');

  var ss    = SpreadsheetApp.openById(CFG_SOL.SS_ID);
  var sheet = ss.getSheetByName(CFG_SOL.ABA_SOL);
  if (!sheet) return jsonError_('Planilha não configurada.', 'NOT_FOUND');
  var dados = sheet.getDataRange().getValues();

  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][COL_SOL.ID_ESTAGIO] || '') !== idEstagio) continue;

    var emailEst = String(dados[i][COL_SOL.EMAIL_ESTUDANTE] || '').toLowerCase();
    if (emailEst !== tokenInfo.email.toLowerCase()) {
      return jsonError_('Esta solicitação não pertence a este estudante.', 'AUTH_ERROR');
    }

    var statusAtual = String(dados[i][COL_SOL.STATUS] || '').trim();
    if (statusAtual !== 'Aceite recusado') {
      return jsonError_('Só é possível trocar o orientador quando o status for "Aceite recusado" (atual: ' + statusAtual + ').', 'VALIDATION');
    }

    var novoToken       = Utilities.getUuid();
    var nomeEstudante   = String(dados[i][COL_SOL.NOME_ESTUDANTE]   || '');
    var nomeEmpresa     = String(dados[i][COL_SOL.NOME_EMPRESA]     || '');
    var tipoEstagio     = String(dados[i][COL_SOL.TIPO_ESTAGIO]     || '');
    var curso           = String(dados[i][COL_SOL.CURSO]            || '');
    var turno           = String(dados[i][COL_SOL.TURNO]            || '');
    var semestre        = String(dados[i][COL_SOL.SEMESTRE_SOL]     || '');
    var dataInicio      = String(dados[i][COL_SOL.DATA_INICIO]      || '');
    var dataTermino     = String(dados[i][COL_SOL.DATA_TERMINO]     || '');
    var cargaHor        = String(dados[i][COL_SOL.CARGA_HOR]        || '');
    var horario         = String(dados[i][COL_SOL.HORARIO]          || '');
    var planoAtiv       = String(dados[i][COL_SOL.PLANO_ATIVIDADES] || '');

    // Atualiza planilha
    sheet.getRange(i + 1, COL_SOL.NOME_ORIENTADOR  + 1).setValue(nomeOrientador);
    sheet.getRange(i + 1, COL_SOL.EMAIL_ORIENTADOR + 1).setValue(emailOrientador);
    sheet.getRange(i + 1, COL_SOL.STATUS           + 1).setValue('Em Checklist');
    sheet.getRange(i + 1, COL_SOL.OBS_SETOR        + 1).setValue('');
    sheet.getRange(i + 1, COL_SOL.TOKEN_ACEITE_ORI + 1).setValue(novoToken);

    // Reinicia a seção do orientador no checklist (mantém histórico das demais etapas)
    try {
      var ck = obterChecklist_(idEstagio);
      if (ck) {
        var prazos = obterPrazos_();
        var solTroca      = _obterDadosSolicitacaoCompleto_(idEstagio);
        var itemAceiteTroca = {
          id: 'aceite_orientacao', label: 'Aceito formalmente a orientação deste estágio',
          valor: '', sensivel: false, isDoc: false, secao: 'aceite',
          checked: false, obs: '', auto: false, obrigatorio: true,
        };
        ck.orientador = {
          status:            'pendente',
          data:              null,
          obs:               '',
          prazoVencimento:   calcularPrazoVencimento_(prazos.checklist.orientador),
          lembretesEnviados: 0,
          token:             novoToken,
          itens:             [itemAceiteTroca].concat(itensCamposSolicitacao_(solTroca)),
        };
        ck.supervisor    = null;
        ck.admin         = null;
        ck.etapaAtiva    = 'orientador';
        ck.statusGeral   = 'em_andamento';
        salvarChecklist_(idEstagio, ck);
        _atualizarStatusChecklistNaPlanilha_(idEstagio, ck);
      } else {
        // Checklist não existia — cria do zero
        iniciarChecklist_(idEstagio, {
          dataNasc:        String(dados[i][COL_SOL.DATA_NASC]  || ''),
          dataInicio:      String(dados[i][COL_SOL.DATA_INICIO] || ''),
          nomeAgente:      String(dados[i][COL_SOL.NOME_AGENTE] || ''),
          tokenOrientador: novoToken,
        });
      }
    } catch (eCk) { logErro_('trocarOrientador_.checklist', eCk); }

    // Notifica o novo orientador via e-mail do checklist
    try {
      var urlChecklist = 'https://ifrs-riogrande.github.io/estagios/orientadores/aceite-orientacao.html'
                       + '?token=' + encodeURIComponent(novoToken)
                       + '&id='    + encodeURIComponent(idEstagio);
      MAIL.enviarEmailChecklistOrientador({
        idEstagio:       idEstagio,
        nomeEstudante:   nomeEstudante,
        curso:           curso,
        turno:           turno,
        semestre:        semestre,
        nomeEmpresa:     nomeEmpresa,
        tipoEstagio:     tipoEstagio,
        dataInicio:      formatarData_(dataInicio),
        dataTermino:     formatarData_(dataTermino),
        cargaHoraria:    cargaHor,
        horario:         horario,
        planoAtividades: planoAtiv,
        nomeOrientador:  nomeOrientador,
        emailOrientador: emailOrientador,
        urlChecklist:    urlChecklist,
        prazoVencimento: '',
      });
    } catch (e) { logErro_('trocarOrientador_.mail', e); }

    return jsonOk_({ mensagem: 'Novo orientador selecionado. Aguardando validação de ' + nomeOrientador + '.' });
  }

  return jsonError_('Solicitação não encontrada.', 'NOT_FOUND');
}

// ---------------------------------------------------------------------------
// Funções auxiliares internas
// ---------------------------------------------------------------------------

/**
 * Handler GET para ?action=verificarIdEstagio&idEstagio=RG25-...&authToken=...
 * Separado de verificarIdEstagio_() que é usado como validador interno (throws).
 */
function getVerificarIdEstagio_(e) {
  var token     = (e.parameter && e.parameter.authToken) || '';
  var idEstagio = sanitizar_((e.parameter && e.parameter.idEstagio) || '', 20).toUpperCase().trim();

  if (!idEstagio) return jsonError_('ID do estágio é obrigatório.', 'VALIDATION');
  if (!idEstagio.match(/^RG\d{2}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)) {
    return jsonError_('ID do estágio inválido.', 'VALIDATION');
  }
  try {
    var tokenInfo = validarTokenEstudante_(token);
    verificarIdEstagio_(idEstagio, tokenInfo.email);
    return jsonOk_({ existe: true, idEstagio: idEstagio });
  } catch (err) {
    return jsonError_(err.message, 'NOT_FOUND');
  }
}

/**
 * Verifica se o ID de estágio existe na planilha e pertence ao estudante.
 * Aceita qualquer e-mail do estudante (principal ou vínculo) via resolverEmailPrimario_.
 * Lança erro se não encontrado ou se não pertencer ao estudante.
 */
function verificarIdEstagio_(idEstagio, emailEstudante) {
  // Resolve o e-mail principal mesmo que o estudante tenha feito login com e-mail de vínculo
  var emailPrimario = resolverEmailPrimario_(emailEstudante);
  var emailToken    = emailEstudante.toLowerCase().trim();

  var ss    = SpreadsheetApp.openById(CFG_SOL.SS_ID);
  var sheet = ss.getSheetByName(CFG_SOL.ABA_SOL) || ss.getSheets()[0];
  var dados = sheet.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    var linha = dados[i];
    if (String(linha[COL_SOL.ID_ESTAGIO] || '').trim() !== idEstagio) continue;
    var emailNaSol = String(linha[COL_SOL.EMAIL_ESTUDANTE] || '').toLowerCase().trim();
    if (emailNaSol !== emailPrimario && emailNaSol !== emailToken) {
      throw new Error('Este ID de estágio não pertence à sua conta.');
    }
    return; // OK
  }
  throw new Error('ID de estágio não encontrado.');
}

/**
 * Obtém o e-mail do orientador vinculado a um ID de estágio.
 * @returns {string} e-mail ou ''
 */
function buscarEmailOrientador_(idEstagio) {
  var ss    = SpreadsheetApp.openById(CFG_SOL.SS_ID);
  var sheet = ss.getSheetByName(CFG_SOL.ABA_SOL) || ss.getSheets()[0];
  var dados = sheet.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][COL_SOL.ID_ESTAGIO] || '').trim() === idEstagio) {
      return String(dados[i][COL_SOL.EMAIL_ORIENTADOR] || '');
    }
  }
  return '';
}

/**
 * Atualiza o campo STATUS de uma solicitação.
 */
function atualizarStatusSolicitacao_(idEstagio, novoStatus) {
  var ss    = SpreadsheetApp.openById(CFG_SOL.SS_ID);
  var sheet = ss.getSheetByName(CFG_SOL.ABA_SOL) || ss.getSheets()[0];
  var dados = sheet.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][COL_SOL.ID_ESTAGIO] || '').trim() === idEstagio) {
      sheet.getRange(i + 1, COL_SOL.STATUS + 1).setValue(novoStatus);
      return;
    }
  }
}

/**
 * Obtém ou cria uma aba na planilha, adicionando cabeçalho se nova.
 */
function obterOuCriarAba_(ss, nomeAba, cabecalho) {
  var sheet = ss.getSheetByName(nomeAba);
  if (!sheet) {
    sheet = ss.insertSheet(nomeAba);
    if (cabecalho && cabecalho.length) {
      sheet.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);
      sheet.getRange(1, 1, 1, cabecalho.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

// ---------------------------------------------------------------------------
// GET — Listar estágios do estudante logado
// ---------------------------------------------------------------------------

/**
 * Retorna todos os estágios do estudante autenticado.
 * Rota: GET ?action=listarMeusEstagios&authToken=...
 *
 * Resposta: array de objetos com os dados resumidos do estágio.
 */
function listarMeusEstagios_(e) {
  try {
    var token     = e.parameter && e.parameter.authToken;
    var tokenInfo = validarTokenEstudante_(token);
    // Resolve e-mail principal (o estudante pode ter feito login com e-mail de vínculo)
    var email = resolverEmailPrimario_(tokenInfo.email.toLowerCase());

    var ss    = SpreadsheetApp.openById(CFG_SOL.SS_ID);
    var sheet = ss.getSheetByName(CFG_SOL.ABA_SOL);
    if (!sheet) return jsonOk_([]);

    var dados = sheet.getDataRange().getValues();

    // ── Carrega abas auxiliares uma única vez ──────────────────────
    var _rowsCoordAln = (function() {
      try { var s = ss.getSheetByName('Coordenadores'); return s ? s.getDataRange().getValues() : []; } catch(e) { return []; }
    })();
    var _rowsOriAln = (function() {
      try { var s = ss.getSheetByName('Orientadores'); return s ? s.getDataRange().getValues() : []; } catch(e) { return []; }
    })();
    var _rowsEmpAln = (function() {
      try { var s = ss.getSheetByName('Empresas'); return s ? s.getDataRange().getValues() : []; } catch(e) { return []; }
    })();
    var _rowsSupAln = (function() {
      try {
        var shSup = SpreadsheetApp.openById(CFG.ID_SUPERVISORES).getSheetByName(CFG.ABA_SUP_RESPOSTAS);
        return shSup ? shSup.getDataRange().getValues() : [];
      } catch(e) { return []; }
    })();

    var _coordAln = function(curso) {
      if (!curso) return { nome: '', email: '' };
      var alvo = curso.trim().toLowerCase();
      for (var k = 1; k < _rowsCoordAln.length; k++) {
        if (String(_rowsCoordAln[k][8] || '').trim() !== 'Ativo') continue;
        var partes = String(_rowsCoordAln[k][6] || '').split(',');
        for (var p = 0; p < partes.length; p++) {
          if (partes[p].trim().toLowerCase() === alvo)
            return { nome: String(_rowsCoordAln[k][2] || ''), email: String(_rowsCoordAln[k][3] || '') };
        }
      }
      return { nome: '', email: '' };
    };
    var _oriAln = function(email) {
      if (!email) return { tipoVinculo: '', titulacao: '', area: '' };
      var em = email.toLowerCase().trim();
      for (var k = 1; k < _rowsOriAln.length; k++) {
        if (String(_rowsOriAln[k][COL_ORI.EMAIL] || '').toLowerCase().trim() !== em) continue;
        return {
          tipoVinculo: String(_rowsOriAln[k][COL_ORI.TIPO_VINCULO] || '').trim(),
          titulacao:   String(_rowsOriAln[k][COL_ORI.TITULACAO]    || '').trim(),
          area:        String(_rowsOriAln[k][COL_ORI.AREA]         || '').trim(),
          tel:         String(_rowsOriAln[k][COL_ORI.TEL]          || '').trim(),
        };
      }
      return { tipoVinculo: '', titulacao: '', area: '', tel: '' };
    };
    var _empAln = function(cnpj) {
      var vazio = { endereco: '', bairro: '', municipio: '', uf: '', cep: '', telefone: '', email: '', nomeRep: '', cargoRep: '', cpfRep: '' };
      if (!cnpj) return vazio;
      for (var k = 1; k < _rowsEmpAln.length; k++) {
        if (String(_rowsEmpAln[k][COL_EMP.CNPJ] || '').replace(/\D/g,'').trim() !== cnpj) continue;
        return {
          endereco:  String(_rowsEmpAln[k][COL_EMP.ENDERECO]      || '').trim(),
          bairro:    String(_rowsEmpAln[k][COL_EMP.BAIRRO]        || '').trim(),
          municipio: String(_rowsEmpAln[k][COL_EMP.MUNICIPIO]     || '').trim(),
          uf:        String(_rowsEmpAln[k][COL_EMP.UF]            || '').trim(),
          cep:       String(_rowsEmpAln[k][COL_EMP.CEP]           || '').trim(),
          telefone:  String(_rowsEmpAln[k][COL_EMP.TEL_EMPRESA]   || '').trim(),
          email:     String(_rowsEmpAln[k][COL_EMP.EMAIL_EMPRESA] || '').trim(),
          nomeRep:   String(_rowsEmpAln[k][COL_EMP.NOME_REP]      || '').trim(),
          cargoRep:  String(_rowsEmpAln[k][COL_EMP.CARGO_REP]     || '').trim(),
          cpfRep:    String(_rowsEmpAln[k][COL_EMP.CPF_REP]       || '').trim(),
        };
      }
      return vazio;
    };
    var _supAln = function(email) {
      var vazio = { cargo: '', telefone: '', formacao: '', instituicao: '', tempoExp: '', descExp: '' };
      if (!email) return vazio;
      var em = email.toLowerCase().trim();
      for (var k = 1; k < _rowsSupAln.length; k++) {
        if (String(_rowsSupAln[k][COL_SUP.EMAIL_SUP] || '').toLowerCase().trim() !== em) continue;
        var nf = String(_rowsSupAln[k][COL_SUP.NIVEL_FORMACAO] || '').trim();
        var af = String(_rowsSupAln[k][COL_SUP.AREA_FORMACAO]  || '').trim();
        return {
          cargo:      String(_rowsSupAln[k][COL_SUP.CARGO]       || '').trim(),
          telefone:   String(_rowsSupAln[k][COL_SUP.TEL_SUP]     || '').trim(),
          formacao:   nf && af ? nf + ' em ' + af : (nf || af),
          instituicao: String(_rowsSupAln[k][COL_SUP.INSTITUICAO] || '').trim(),
          tempoExp:   String(_rowsSupAln[k][COL_SUP.TEMPO_EXP]   || '').trim(),
          descExp:    String(_rowsSupAln[k][COL_SUP.DESC_EXP]    || '').trim(),
        };
      }
      return vazio;
    };
    // ──────────────────────────────────────────────────────────────

    var lista = [];

    for (var i = 1; i < dados.length; i++) {
      var r = dados[i];
      if (String(r[COL_SOL.EMAIL_ESTUDANTE] || '').trim().toLowerCase() !== email) continue;

      var _cnpjAluno   = String(r[COL_SOL.CNPJ_EMPRESA]    || '').replace(/\D/g, '').trim();
      var _emailSupAln = String(r[COL_SOL.EMAIL_SUPERVISOR] || '').toLowerCase().trim();
      var _emailOriAln = String(r[COL_SOL.EMAIL_ORIENTADOR] || '').toLowerCase().trim();
      var _cursoAln    = String(r[COL_SOL.CURSO]             || '').trim();
      var _empDadosAln = _empAln(_cnpjAluno);
      var _supDadosAln = _supAln(_emailSupAln);
      var _oriDadosAln = _oriAln(_emailOriAln);
      var _coordDadosAln = _coordAln(_cursoAln);
      var _endEmpAln   = [_empDadosAln.endereco, _empDadosAln.bairro, _empDadosAln.municipio, _empDadosAln.uf, _empDadosAln.cep]
                           .filter(Boolean).join(', ');
      lista.push({
        // ── Identificação ──
        id:                   String(r[COL_SOL.ID_ESTAGIO]        || ''),
        status:               String(r[COL_SOL.STATUS]             || 'Pendente'),
        // ── Estudante ──
        nomeEstudante:        String(r[COL_SOL.NOME_ESTUDANTE]      || ''),
        dataNasc:             formatarData_(r[COL_SOL.DATA_NASC]),
        cpf:                  mascararCPF_(r[COL_SOL.CPF]),
        emailEstudante:       String(r[COL_SOL.EMAIL_ESTUDANTE]     || ''),
        telefoneEstudante:    String(r[COL_SOL.TELEFONE]            || ''),
        nomeResponsavel:      String(r[COL_SOL.NOME_RESP]           || ''),
        cpfResponsavel:       mascararCPF_(r[COL_SOL.CPF_RESP]),
        telResponsavel:       String(r[COL_SOL.TEL_RESP]            || ''),
        // ── Curso ──
        matricula:            String(r[COL_SOL.MATRICULA]           || ''),
        curso:                _cursoAln,
        semestreAtual:        String(r[COL_SOL.SEMESTRE_SOL]        || ''),
        formando:             String(r[COL_SOL.FORMANDO]            || ''),
        turno:                String(r[COL_SOL.TURNO]               || ''),
        // ── Orientador ──
        nomeOrientador:       String(r[COL_SOL.NOME_ORIENTADOR]    || ''),
        emailOrientador:      _emailOriAln,
        vinculoOrientador:    _oriDadosAln.tipoVinculo,
        titulacaoOrientador:  _oriDadosAln.titulacao,
        areaOrientador:       _oriDadosAln.area,
        telefoneOrientador:   _oriDadosAln.tel,
        // ── Coordenador ──
        nomeCoordenador:      _coordDadosAln.nome,
        emailCoordenador:     _coordDadosAln.email,
        // ── Concedente ──
        empresa:              String(r[COL_SOL.NOME_EMPRESA]       || ''),
        cnpjEmpresa:          _cnpjAluno,
        enderecoEmpresa:      _endEmpAln,
        telefoneEmpresa:      _empDadosAln.telefone,
        emailEmpresa:         _empDadosAln.email,
        nomeRepEmpresa:       _empDadosAln.nomeRep,
        cargoRepEmpresa:      _empDadosAln.cargoRep,
        cpfRepEmpresa:        mascararCPF_(_empDadosAln.cpfRep),
        // ── Supervisor ──
        nomeSupervisor:       String(r[COL_SOL.NOME_SUPERVISOR]    || ''),
        emailSupervisor:      _emailSupAln,
        cargoSupervisor:         _supDadosAln.cargo,
        formacaoSupervisor:      _supDadosAln.formacao,
        telefoneSupervisor:      _supDadosAln.telefone,
        instituicaoSupervisor:   _supDadosAln.instituicao,
        tempoExpSupervisor:      _supDadosAln.tempoExp,
        descExpSupervisor:       _supDadosAln.descExp,
        // ── Estágio ──
        tipoEstagio:          String(r[COL_SOL.TIPO_ESTAGIO]       || ''),
        dataInicio:           formatarData_(r[COL_SOL.DATA_INICIO]),
        dataTermino:          formatarData_(r[COL_SOL.DATA_TERMINO]),
        cargaHorariaSemanal:  String(r[COL_SOL.CARGA_HOR]          || ''),
        cargaHorariaTotal:    String(r[COL_SOL.CARGA_HOR_TOTAL]    || ''),
        horario:              String(r[COL_SOL.HORARIO]             || ''),
        nomeAgente:           String(r[COL_SOL.NOME_AGENTE]        || ''),
        remuneracao:          String(r[COL_SOL.REMUNERACAO]         || ''),
        valorBolsa:           String(r[COL_SOL.VALOR_BOLSA]         || ''),
        valorTransporte:      String(r[COL_SOL.VALOR_TRANSPORTE]    || ''),
        planoAtividades:      String(r[COL_SOL.PLANO_ATIVIDADES]    || ''),
        // ── Meta ──
        dataSolicitacao:      formatarData_(r[COL_SOL.TIMESTAMP]),
        motivoReprovacao:     String(r[COL_SOL.MOTIVO_REPROVACAO]   || ''),
        observacaoSetor:      String(r[COL_SOL.OBS_SETOR]           || ''),
        driveUrl:             String(r[COL_SOL.DRIVE_URL]           || ''),
        linkDocMatricula:     String(r[COL_SOL.LINK_DOC_MAT]        || ''),
        linkDocIdentidade:    String(r[COL_SOL.LINK_DOC_ID]         || ''),
        linkDocBoletim:       String(r[COL_SOL.LINK_DOC_BOL]        || ''),
        // ── PDF Checklist ──
        checklistPdfUrl:      (function() {
          try {
            var ck = PropertiesService.getScriptProperties().getProperty('checklist_' + String(r[COL_SOL.ID_ESTAGIO] || ''));
            if (!ck) return '';
            var ckObj = JSON.parse(ck);
            return String(ckObj.urlPdfChecklist || '');
          } catch(_) { return ''; }
        })(),
      });
    }

    // Mais recente primeiro (por ID decrescente)
    lista.sort(function (a, b) { return b.id.localeCompare(a.id); });

    return jsonOk_(lista);

  } catch (err) {
    if (err instanceof ErroAutenticacao) return jsonError_(err.message, 'AUTH_ERROR');
    logErro_('listarMeusEstagios_', err);
    return jsonError_('Erro ao carregar seus estágios.', 'INTERNAL');
  }
}

// ---------------------------------------------------------------------------
// POST — Enviar documentos assinados pelo estudante
// ---------------------------------------------------------------------------

/**
 * Recebe os PDFs assinados pelo estudante (TCE + Solicitação de Ingresso)
 * em base64, salva na pasta do Drive do estágio e muda o status para
 * "Docs Enviados".
 *
 * Body: {
 *   idEstagio : string,
 *   authToken : string,
 *   arquivos  : {
 *     tce          : { nome: string, base64: string },  // obrigatório
 *     solicitacao  : { nome: string, base64: string },  // opcional p/ alguns tipos
 *   }
 * }
 */
function enviarDocumentosAssinados_(body) {
  var tokenInfo = validarTokenEstudante_(body.authToken);

  if (!checkRateLimit_('enviarDocumentosAssinados')) {
    return jsonError_('Muitas requisições. Aguarde um momento.', 'RATE_LIMIT');
  }

  var idEstagio = sanitizar_(body.idEstagio, 20).toUpperCase().trim();
  if (!idEstagio.match(/^RG\d{2}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)) {
    return jsonError_('ID do estágio inválido.', 'VALIDATION');
  }

  var arquivos = body.arquivos || {};
  var arqTce   = arquivos.tce;
  if (!arqTce || !arqTce.base64 || !arqTce.nome) {
    return jsonError_('O arquivo do TCE é obrigatório.', 'VALIDATION');
  }
  // Valida tamanho do base64 (~10 MB → ~13,6 M chars em base64)
  if (arqTce.base64.length > 14000000) {
    return jsonError_('Arquivo do TCE muito grande (máx. 10 MB).', 'VALIDATION');
  }
  if (arquivos.solicitacao && arquivos.solicitacao.base64 &&
      arquivos.solicitacao.base64.length > 14000000) {
    return jsonError_('Arquivo da Solicitação muito grande (máx. 10 MB).', 'VALIDATION');
  }

  // Localiza o registro na planilha
  var ss    = SpreadsheetApp.openById(CFG_SOL.SS_ID);
  var sheet = ss.getSheetByName(CFG_SOL.ABA_SOL);
  if (!sheet) return jsonError_('Planilha não encontrada.', 'INTERNAL');

  var dados  = sheet.getDataRange().getValues();
  var linhaIdx = -1;
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][COL_SOL.ID_ESTAGIO] || '').trim() === idEstagio &&
        String(dados[i][COL_SOL.EMAIL_ESTUDANTE] || '').trim().toLowerCase() === tokenInfo.email.toLowerCase()) {
      linhaIdx = i;
      break;
    }
  }
  if (linhaIdx === -1) {
    return jsonError_('Estágio não encontrado ou não pertence à sua conta.', 'NOT_FOUND');
  }

  var statusAtual = String(dados[linhaIdx][COL_SOL.STATUS] || '');
  if (statusAtual !== 'Aguardando Documentos') {
    return jsonError_(
      'Este estágio não está aguardando documentos (status atual: ' + statusAtual + ').',
      'INVALID_STATE'
    );
  }

  // Recupera URL da pasta do Drive
  var driveUrl = String(dados[linhaIdx][COL_SOL.DRIVE_URL] || '');
  var folder;
  try {
    var folderId = driveUrl.match(/[-\w]{25,}/);
    if (!folderId) throw new Error('URL inválida');
    folder = DriveApp.getFolderById(folderId[0]);
  } catch (e) {
    return jsonError_('Não foi possível acessar a pasta do Drive: ' + e.message, 'DRIVE_ERROR');
  }

  // Salva TCE
  try {
    var nomeTce  = sanitizarNomeArquivo_(arqTce.nome) || ('TCE_Assinado_' + idEstagio + '.pdf');
    var blobTce  = Utilities.newBlob(Utilities.base64Decode(arqTce.base64), 'application/pdf', nomeTce);
    var arqExistenteTce = folder.getFilesByName(nomeTce);
    while (arqExistenteTce.hasNext()) { arqExistenteTce.next().setTrashed(true); }
    folder.createFile(blobTce);
  } catch (e) {
    logErro_('enviarDocumentosAssinados_.saveTce', e);
    return jsonError_('Erro ao salvar TCE no Drive: ' + e.message, 'DRIVE_ERROR');
  }

  // Salva Solicitação de Ingresso (se enviada)
  if (arquivos.solicitacao && arquivos.solicitacao.base64) {
    try {
      var nomeSol  = sanitizarNomeArquivo_(arquivos.solicitacao.nome) || ('Solicitacao_Assinada_' + idEstagio + '.pdf');
      var blobSol  = Utilities.newBlob(Utilities.base64Decode(arquivos.solicitacao.base64), 'application/pdf', nomeSol);
      var arqExistenteSol = folder.getFilesByName(nomeSol);
      while (arqExistenteSol.hasNext()) { arqExistenteSol.next().setTrashed(true); }
      folder.createFile(blobSol);
    } catch (e) {
      logErro_('enviarDocumentosAssinados_.saveSol', e);
      // Não aborta — TCE já foi salvo; apenas registra
    }
  }

  // Atualiza planilha: status → "Docs Enviados", timestamp
  var rowNum = linhaIdx + 1;
  sheet.getRange(rowNum, COL_SOL.STATUS          + 1).setValue('Docs Enviados');
  sheet.getRange(rowNum, COL_SOL.DATA_DOC_ENVIADO+ 1).setValue(new Date());

  // Notifica o setor
  try {
    var nomeEstudante = String(dados[linhaIdx][COL_SOL.NOME_ESTUDANTE] || tokenInfo.email);
    enviarEmailDocsEnviados_({
      idEstagio:     idEstagio,
      nomeEstudante: nomeEstudante,
      emailEstudante:tokenInfo.email,
    });
  } catch (e) { logErro_('enviarDocumentosAssinados_.mail', e); }

  return jsonOk_({ mensagem: 'Documentos enviados com sucesso! O setor irá verificar e encaminhará ao Diretor Geral.' });
}

// ---------------------------------------------------------------------------
// POST — Enviar documento assinado pelo Diretor Geral
// ---------------------------------------------------------------------------

/**
 * Recebe o PDF assinado pelo DG em base64, salva na pasta do Drive do
 * estágio e muda o status para "Aguardando Validação Final".
 *
 * Body: {
 *   idEstagio : string,
 *   authToken : string,
 *   arquivo   : { nome: string, base64: string }
 * }
 */
function enviarDocumentoDG_(body) {
  // DG usa e-mail @riogrande.ifrs.edu.br (servidor)
  var tokenInfo;
  try {
    tokenInfo = validarTokenServidor_(body.authToken);
  } catch (e) {
    return jsonError_(e.message, 'AUTH_ERROR');
  }

  if (!checkRateLimit_('enviarDocumentoDG')) {
    return jsonError_('Muitas requisições. Aguarde um momento.', 'RATE_LIMIT');
  }

  var idEstagio = sanitizar_(body.idEstagio, 20).toUpperCase().trim();
  if (!idEstagio.match(/^RG\d{2}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)) {
    return jsonError_('ID do estágio inválido.', 'VALIDATION');
  }

  var arquivo = body.arquivo;
  if (!arquivo || !arquivo.base64 || !arquivo.nome) {
    return jsonError_('Arquivo PDF é obrigatório.', 'VALIDATION');
  }
  if (arquivo.base64.length > 14000000) {
    return jsonError_('Arquivo muito grande (máx. 10 MB).', 'VALIDATION');
  }

  // Localiza o registro
  var ss    = SpreadsheetApp.openById(CFG_SOL.SS_ID);
  var sheet = ss.getSheetByName(CFG_SOL.ABA_SOL);
  if (!sheet) return jsonError_('Planilha não encontrada.', 'INTERNAL');

  var dados    = sheet.getDataRange().getValues();
  var linhaIdx = -1;
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][COL_SOL.ID_ESTAGIO] || '').trim() === idEstagio) {
      linhaIdx = i;
      break;
    }
  }
  if (linhaIdx === -1) {
    return jsonError_('Estágio não encontrado: ' + idEstagio, 'NOT_FOUND');
  }

  var statusAtual = String(dados[linhaIdx][COL_SOL.STATUS] || '');
  if (statusAtual !== 'Aguardando DG') {
    return jsonError_(
      'Este estágio não está aguardando assinatura do DG (status atual: ' + statusAtual + ').',
      'INVALID_STATE'
    );
  }

  // Acessa a pasta do Drive
  var driveUrl = String(dados[linhaIdx][COL_SOL.DRIVE_URL] || '');
  var folder;
  try {
    var folderId = driveUrl.match(/[-\w]{25,}/);
    if (!folderId) throw new Error('URL da pasta inválida');
    folder = DriveApp.getFolderById(folderId[0]);
  } catch (e) {
    return jsonError_('Não foi possível acessar a pasta do Drive: ' + e.message, 'DRIVE_ERROR');
  }

  // Salva o PDF assinado pelo DG
  try {
    var nomeArq   = sanitizarNomeArquivo_(arquivo.nome) || ('TCE_Assinado_DG_' + idEstagio + '.pdf');
    var blob      = Utilities.newBlob(Utilities.base64Decode(arquivo.base64), 'application/pdf', nomeArq);
    var existentes = folder.getFilesByName(nomeArq);
    while (existentes.hasNext()) { existentes.next().setTrashed(true); }
    folder.createFile(blob);
  } catch (e) {
    logErro_('enviarDocumentoDG_.savePdf', e);
    return jsonError_('Erro ao salvar arquivo no Drive: ' + e.message, 'DRIVE_ERROR');
  }

  // Atualiza status → "Aguardando Validação Final"
  var rowNum = linhaIdx + 1;
  sheet.getRange(rowNum, COL_SOL.STATUS + 1).setValue('Aguardando Validação Final');

  // Notifica o setor
  try {
    var nomeEstudante = String(dados[linhaIdx][COL_SOL.NOME_ESTUDANTE] || '');
    enviarEmailDocDGRecebido_({
      idEstagio:      idEstagio,
      nomeEstudante:  nomeEstudante,
      nomeRemetente:  tokenInfo.name || tokenInfo.email,
    });
  } catch (e) { logErro_('enviarDocumentoDG_.mail', e); }

  return jsonOk_({ mensagem: 'Documento enviado com sucesso! O setor irá verificar e ativar o estágio.' });
}

// ---------------------------------------------------------------------------
// Helpers locais
// ---------------------------------------------------------------------------

/**
 * Sanitiza nome de arquivo: remove caracteres inválidos para Drive/SO.
 */
function sanitizarNomeArquivo_(nome) {
  if (!nome || typeof nome !== 'string') return '';
  return nome.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 200);
}

/**
 * Valida um arquivo de upload por whitelist de extensão E magic bytes.
 * Impede que o cliente envie, p.ex., um .html renomeado para .pdf.
 *
 * @param {object}   arq             { nome: string, base64: string }
 * @param {string[]} tiposPermitidos Ex.: ['pdf'] ou ['pdf','png','jpg','jpeg']
 * @returns {{ ok: boolean, mime: string, erro: string }}
 */
function validarArquivoUpload_(arq, tiposPermitidos) {
  if (!arq || !arq.nome || !arq.base64) {
    return { ok: false, mime: '', erro: 'Arquivo ausente ou incompleto.' };
  }

  // Whitelist de extensão (servidor decide — cliente não controla MIME)
  var ext = String(arq.nome).split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (tiposPermitidos.indexOf(ext) === -1) {
    return { ok: false, mime: '',
      erro: 'Formato não permitido: .' + ext + '. Aceitos: ' + tiposPermitidos.join(', ') + '.' };
  }

  // Remove prefixo data-URI se presente (data:application/pdf;base64,...)
  var b64 = String(arq.base64);
  var ci  = b64.indexOf(',');
  if (ci !== -1) b64 = b64.slice(ci + 1);

  // Verifica magic bytes decodificando apenas os primeiros bytes
  try {
    // 20 base64 chars → 15 bytes; 20 % 4 === 0 → sem padding necessário
    var amostra = b64.slice(0, 20);
    var bytes   = Utilities.base64Decode(amostra);

    if (ext === 'pdf') {
      // %PDF → 0x25 0x50 0x44 0x46
      if (bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
        return { ok: false, mime: '', erro: 'O arquivo enviado não é um PDF válido.' };
      }
      return { ok: true, mime: 'application/pdf', erro: '' };
    }
    if (ext === 'png') {
      // ‰PNG → 0x89 0x50 0x4E 0x47
      if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4E || bytes[3] !== 0x47) {
        return { ok: false, mime: '', erro: 'O arquivo enviado não é uma imagem PNG válida.' };
      }
      return { ok: true, mime: 'image/png', erro: '' };
    }
    if (ext === 'jpg' || ext === 'jpeg') {
      // JFIF/EXIF → 0xFF 0xD8 0xFF
      if (bytes[0] !== 0xFF || bytes[1] !== 0xD8 || bytes[2] !== 0xFF) {
        return { ok: false, mime: '', erro: 'O arquivo enviado não é uma imagem JPEG válida.' };
      }
      return { ok: true, mime: 'image/jpeg', erro: '' };
    }
  } catch (eV) {
    logErro_('validarArquivoUpload_', eV);
    return { ok: false, mime: '', erro: 'Não foi possível validar o arquivo.' };
  }
  return { ok: false, mime: '', erro: 'Formato interno não reconhecido.' };
}

/**
 * Envia e-mail ao setor quando o estudante envia os documentos assinados.
 */
function enviarEmailDocsEnviados_(dados) {
  var dest    = _obterEmailNotificacaoAdmin_();
  var assunto = '[SGE] Documentos enviados — ' + dados.idEstagio;
  var corpo   = 'O estudante ' + dados.nomeEstudante + ' (' + dados.emailEstudante + ') ' +
                'enviou os documentos assinados do estágio ' + dados.idEstagio + '.\n\n' +
                'Acesse o painel administrativo para verificar e encaminhar ao Diretor Geral.';
  MailApp.sendEmail({ to: dest, subject: assunto, body: corpo });
}

/**
 * Envia e-mail ao setor quando o DG envia o documento assinado.
 */
function enviarEmailDocDGRecebido_(dados) {
  var dest    = _obterEmailNotificacaoAdmin_();
  var assunto = '[SGE] Documento DG recebido — ' + dados.idEstagio;
  var corpo   = 'O Diretor Geral ' + dados.nomeRemetente + ' enviou o documento assinado ' +
                'do estágio ' + dados.idEstagio + ' (' + dados.nomeEstudante + ').\n\n' +
                'Acesse o painel administrativo para realizar a validação final e ativar o estágio.';
  MailApp.sendEmail({ to: dest, subject: assunto, body: corpo });
}

/**
 * Retorna o e-mail de notificação do setor.
 * Lê da chave NOTIFICATION_EMAIL no PropertiesService; fallback fixo.
 */
function _obterEmailNotificacaoAdmin_() {
  try {
    var prop = PropertiesService.getScriptProperties().getProperty('NOTIFICATION_EMAIL');
    if (prop && prop.trim()) return prop.trim();
  } catch (_) {}
  return 'estagios@riogrande.ifrs.edu.br';
}

// ---------------------------------------------------------------------------
// GET — Histórico completo de um estágio (relatórios, adendos, docs avulsos)
// ---------------------------------------------------------------------------

/**
 * Retorna relatórios parciais, relatório final, adendos e documentos avulsos
 * de um estágio. Aceita token de estudante (verifica propriedade) ou de
 * servidor/admin (acesso livre a qualquer estágio).
 *
 * Rota: GET ?action=listarHistoricoEstagio&idEstagio=RG25-XXXX-XXXX&authToken=...
 */
function listarHistoricoEstagio_(e) {
  var authToken = e.parameter && e.parameter.authToken;
  var idEstagio = sanitizar_((e.parameter && e.parameter.idEstagio) || '', 20).toUpperCase().trim();

  if (!idEstagio) return jsonError_('ID do estágio é obrigatório.', 'VALIDATION');

  // Detecta perfil pelo token
  var emailValidado, isAdmin = false;
  try {
    var infoEst = validarTokenEstudante_(authToken);
    emailValidado = resolverEmailPrimario_(infoEst.email.toLowerCase());
  } catch (e1) {
    try {
      var infoSrv = validarTokenServidor_(authToken);
      emailValidado = infoSrv.email.toLowerCase().trim();
      isAdmin = true;
    } catch (e2) {
      return jsonError_('Token inválido.', 'AUTH_ERROR');
    }
  }

  var ss = SpreadsheetApp.openById(CFG_SOL.SS_ID);

  // Verifica propriedade para estudante
  if (!isAdmin) {
    var sheetSolChk = ss.getSheetByName(CFG_SOL.ABA_SOL);
    var temAcesso = false;
    if (sheetSolChk) {
      var dSolChk = sheetSolChk.getDataRange().getValues();
      for (var i = 1; i < dSolChk.length; i++) {
        if (String(dSolChk[i][COL_SOL.ID_ESTAGIO] || '') === idEstagio &&
            String(dSolChk[i][COL_SOL.EMAIL_ESTUDANTE] || '').toLowerCase().trim() === emailValidado) {
          temAcesso = true; break;
        }
      }
    }
    if (!temAcesso) return jsonError_('Estágio não encontrado ou acesso negado.', 'FORBIDDEN');
  }

  // ── Adendos ──
  var adendos = [];
  var sheetAdendo = ss.getSheetByName(CFG_SOL.ABA_ADENDO);
  if (sheetAdendo) {
    var dAdendo = sheetAdendo.getDataRange().getValues();
    for (var l = 1; l < dAdendo.length; l++) {
      if (String(dAdendo[l][COL_ADENDO.ID_ESTAGIO] || '') !== idEstagio) continue;
      // Detecta coluna 'ID Adendo' dinamicamente no header
      var hdrAdendo   = dAdendo[0] || [];
      var colIdAdendo = hdrAdendo.indexOf('ID Adendo');
      var rowIdAdendo = colIdAdendo >= 0 ? String(dAdendo[l][colIdAdendo] || '') : '';

      adendos.push({
        data:          dAdendo[l][COL_ADENDO.TIMESTAMP]
                         ? Utilities.formatDate(new Date(dAdendo[l][COL_ADENDO.TIMESTAMP]),
                             Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm')
                         : '',
        tipoAdendo:    String(dAdendo[l][COL_ADENDO.TIPO_ADENDO]    || ''),
        justificativa: String(dAdendo[l][COL_ADENDO.JUSTIFICATIVA]  || ''),
        status:        String(dAdendo[l][COL_ADENDO.STATUS]         || 'Pendente'),
        idAdendo:      rowIdAdendo,
        idEstagio:     idEstagio,
      });
    }
  }

  // ── Documentos Avulsos ──
  var documentos = [];
  var sheetDoc = ss.getSheetByName(CFG_SOL.ABA_DOC);
  if (sheetDoc) {
    var dDoc = sheetDoc.getDataRange().getValues();
    for (var m = 1; m < dDoc.length; m++) {
      if (String(dDoc[m][COL_DOC.ID_ESTAGIO] || '') !== idEstagio) continue;
      documentos.push({
        data:          dDoc[m][COL_DOC.TIMESTAMP]
                         ? Utilities.formatDate(new Date(dDoc[m][COL_DOC.TIMESTAMP]),
                             Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm')
                         : '',
        emailUploader: String(dDoc[m][COL_DOC.EMAIL_UPLOADER] || ''),
        perfil:        String(dDoc[m][COL_DOC.PERFIL]         || ''),
        titulo:        String(dDoc[m][COL_DOC.TITULO]         || ''),
        linkDrive:     String(dDoc[m][COL_DOC.LINK_DRIVE]     || ''),
        nomeArquivo:   String(dDoc[m][COL_DOC.NOME_ARQUIVO]   || ''),
      });
    }
  }

  // ── Parecer Final (se existir e tiver PDF) ──
  var parecerFinalInfo = null;
  try {
    var pFinal = obterParecer_(idEstagio);
    if (pFinal && pFinal.pdfUrl) {
      parecerFinalInfo = {
        statusGeral: String(pFinal.statusGeral || ''),
        pdfUrl:      String(pFinal.pdfUrl      || ''),
        dataAprov:   pFinal.dataAprovacao
                       ? Utilities.formatDate(new Date(pFinal.dataAprovacao),
                           Session.getScriptTimeZone(), 'dd/MM/yyyy')
                       : '',
      };
    }
  } catch (_) {}

  return jsonOk_({
    adendos:            adendos,
    documentos:         documentos,
    parecerFinal:       parecerFinalInfo,
  });
}

// ---------------------------------------------------------------------------
// POST — Upload de documento avulso (estudante ou admin)
// ---------------------------------------------------------------------------

/**
 * Recebe um PDF em base64, salva na subpasta "Documentos Avulsos" dentro da
 * pasta do estágio no Drive e registra na aba Documentos da planilha.
 *
 * Body: { idEstagio, authToken, titulo, arquivo: { nome, base64 } }
 */
function uploadDocumentoEstagio_(body) {
  if (!checkRateLimit_('uploadDocumentoEstagio')) {
    return jsonError_('Muitas requisições. Aguarde um momento.', 'RATE_LIMIT');
  }

  // Detecta perfil pelo token
  var emailUploader, perfil;
  try {
    var infoEst2 = validarTokenEstudante_(body.authToken);
    emailUploader = resolverEmailPrimario_(infoEst2.email.toLowerCase());
    perfil = 'Estudante';
  } catch (e1) {
    try {
      var infoSrv2 = validarTokenServidor_(body.authToken);
      emailUploader = infoSrv2.email.toLowerCase().trim();
      perfil = 'Admin';
    } catch (e2) {
      return jsonError_('Token inválido.', 'AUTH_ERROR');
    }
  }

  var idEstagio = sanitizar_(body.idEstagio || '', 20).toUpperCase().trim();
  if (!idEstagio.match(/^RG\d{2}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)) {
    return jsonError_('ID do estágio inválido.', 'VALIDATION');
  }

  var titulo = sanitizar_(body.titulo || '', 200);
  if (!titulo) return jsonError_('Título do documento é obrigatório.', 'VALIDATION');

  var arquivo = body.arquivo;
  if (!arquivo || !arquivo.base64 || !arquivo.nome) {
    return jsonError_('Arquivo é obrigatório.', 'VALIDATION');
  }

  // Valida extensão + magic bytes antes de qualquer outra operação
  var valArq = validarArquivoUpload_(arquivo, ['pdf']);
  if (!valArq.ok) return jsonError_(valArq.erro, 'VALIDATION');

  var nomeArquivo = sanitizarNomeArquivo_(arquivo.nome);
  var b64 = String(arquivo.base64);
  // Remove prefixo data-URI se presente
  var ci64 = b64.indexOf(',');
  if (ci64 !== -1) b64 = b64.slice(ci64 + 1);
  // Limite de ~10 MB em bytes (base64 é ~33% maior)
  if (b64.length > 14000000) {
    return jsonError_('Arquivo muito grande. Máximo: 10 MB.', 'VALIDATION');
  }

  var ss2 = SpreadsheetApp.openById(CFG_SOL.SS_ID);

  // Busca Drive URL (e verifica propriedade para estudante)
  var driveUrlEstagio = '';
  var cpfParaPasta = 'SEM_CPF', matrParaPasta = 'SEM_MATRICULA', nomeParaPasta = '';
  var sheetSol2 = ss2.getSheetByName(CFG_SOL.ABA_SOL);
  var donoBloqueado = (perfil === 'Estudante');
  var rowIdxSol2 = -1;
  if (sheetSol2) {
    var dSol2 = sheetSol2.getDataRange().getValues();
    for (var ii = 1; ii < dSol2.length; ii++) {
      if (String(dSol2[ii][COL_SOL.ID_ESTAGIO] || '') !== idEstagio) continue;
      if (perfil === 'Estudante') {
        var emailEst2 = String(dSol2[ii][COL_SOL.EMAIL_ESTUDANTE] || '').toLowerCase().trim();
        if (emailEst2 !== emailUploader) continue;
      }
      driveUrlEstagio = String(dSol2[ii][COL_SOL.DRIVE_URL] || '');
      cpfParaPasta    = String(dSol2[ii][COL_SOL.CPF]           || 'SEM_CPF').replace(/\D/g, '') || 'SEM_CPF';
      matrParaPasta   = String(dSol2[ii][COL_SOL.MATRICULA]      || 'SEM_MATRICULA');
      nomeParaPasta   = String(dSol2[ii][COL_SOL.NOME_ESTUDANTE] || '');
      rowIdxSol2      = ii;
      donoBloqueado   = false;
      break;
    }
  }
  if (donoBloqueado) return jsonError_('Estágio não encontrado ou acesso negado.', 'FORBIDDEN');

  // Obtém pasta de destino no Drive
  // — Se o estágio já tem pasta registrada, usa ela.
  // — Caso contrário, cria em Estágios / [Ano] / [ID — Nome].
  var pastaEstagio = abrirPastaEstagio_(driveUrlEstagio);
  if (!pastaEstagio) {
    try {
      var driveResFb = criarPastaEstagio_(idEstagio, nomeParaPasta);
      pastaEstagio   = driveResFb.folder;
      // Persiste o URL na planilha para que próximas operações usem a pasta recém-criada
      if (sheetSol2 && rowIdxSol2 >= 0 && driveResFb.url) {
        sheetSol2.getRange(rowIdxSol2 + 1, COL_SOL.DRIVE_URL + 1).setValue(driveResFb.url);
      }
    } catch (eC) { logErro_('uploadDocumentoEstagio_.createFolder', eC); }
  }

  // Salva o arquivo na subpasta "Documentos Avulsos"
  var linkArquivo = '';
  if (pastaEstagio) {
    try {
      var subpasta = obterOuCriarPasta_(pastaEstagio, 'Documentos Avulsos');
      var bytes    = Utilities.base64Decode(b64);
      var blob     = Utilities.newBlob(bytes, valArq.mime, nomeArquivo);
      var file     = subpasta.createFile(blob);
      // DOMAIN_WITH_LINK: visível apenas dentro do domínio institucional (LGPD)
      file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
      linkArquivo  = file.getUrl();
    } catch (eU) { logErro_('uploadDocumentoEstagio_.upload', eU); }
  }

  // Registra na planilha (fonte de verdade — PropertiesService não é mais usado)
  var docId     = Utilities.getUuid();
  var sheetDoc2 = obterOuCriarAbaDocumentos_(ss2);
  var linhaDoc  = [];
  linhaDoc[COL_DOC.TIMESTAMP]      = new Date();
  linhaDoc[COL_DOC.ID_ESTAGIO]     = idEstagio;
  linhaDoc[COL_DOC.EMAIL_UPLOADER] = emailUploader;
  linhaDoc[COL_DOC.PERFIL]         = perfil;
  linhaDoc[COL_DOC.TITULO]         = titulo;
  linhaDoc[COL_DOC.LINK_DRIVE]     = linkArquivo;
  linhaDoc[COL_DOC.NOME_ARQUIVO]   = nomeArquivo;
  linhaDoc[COL_DOC.DOC_ID]         = docId;
  linhaDoc[COL_DOC.REVISADO_ADMIN] = '';
  linhaDoc[COL_DOC.OBS_ADMIN]      = '';
  sheetDoc2.appendRow(linhaDoc);

  return jsonOk_({ mensagem: 'Documento enviado com sucesso.', linkDrive: linkArquivo });
}

// ---------------------------------------------------------------------------
// Helper — obtém ou cria aba Documentos
// ---------------------------------------------------------------------------

function obterOuCriarAbaDocumentos_(ss) {
  var sheet = ss.getSheetByName(CFG_SOL.ABA_DOC);
  if (!sheet) {
    sheet = ss.insertSheet(CFG_SOL.ABA_DOC);
    var cab = [
      'Timestamp','ID Estágio','Email Uploader','Perfil','Título',
      'Link Drive','Nome Arquivo','Doc ID','Revisado Admin','Obs Admin'
    ];
    sheet.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ---------------------------------------------------------------------------
// listarDocumentosAvulsos_ — GET ?action=listarDocumentosAvulsos
// ---------------------------------------------------------------------------

/**
 * Retorna os documentos avulsos de um estágio com o status de revisão do admin.
 * Requer token de servidor/admin.
 *
 * Rota: GET ?action=listarDocumentosAvulsos&idEstagio=RG25-XXXX-XXXX&authToken=...
 */
function listarDocumentosAvulsos_(e) {
  var authToken = (e.parameter && e.parameter.authToken) || '';
  var idEstagio = (e.parameter && e.parameter.idEstagio) || '';

  try { validarTokenServidor_(authToken); }
  catch (err) { return jsonError_(err.message, 'AUTH_ERROR'); }

  idEstagio = String(idEstagio).toUpperCase().trim();
  if (!idEstagio.match(/^RG\d{2}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)) {
    return jsonError_('ID do estágio inválido.', 'VALIDATION');
  }

  try {
    // Planilha é a única fonte de verdade (PropertiesService foi abandonado)
    var ss3    = SpreadsheetApp.openById(CFG_SOL.SS_ID);
    var shtDoc = ss3.getSheetByName(CFG_SOL.ABA_DOC);
    var docs   = [];
    if (shtDoc) {
      var rows = shtDoc.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][COL_DOC.ID_ESTAGIO] || '') !== idEstagio) continue;
        // DOC_ID pode estar vazio em linhas antigas — usa índice como fallback estável
        var docId = String(rows[i][COL_DOC.DOC_ID] || '') || ('legacy_row_' + i);
        docs.push({
          id:            docId,
          titulo:        String(rows[i][COL_DOC.TITULO]         || ''),
          nomeArquivo:   String(rows[i][COL_DOC.NOME_ARQUIVO]   || ''),
          url:           String(rows[i][COL_DOC.LINK_DRIVE]     || ''),
          timestamp:     rows[i][COL_DOC.TIMESTAMP]
                           ? new Date(rows[i][COL_DOC.TIMESTAMP]).toISOString() : '',
          emailUploader: String(rows[i][COL_DOC.EMAIL_UPLOADER] || ''),
          perfil:        String(rows[i][COL_DOC.PERFIL]         || ''),
          revisadoAdmin: String(rows[i][COL_DOC.REVISADO_ADMIN] || '') === 'Sim',
          obsAdmin:      String(rows[i][COL_DOC.OBS_ADMIN]      || ''),
        });
      }
    }
    return jsonOk_({ documentos: docs });
  } catch (err) {
    logErro_('listarDocumentosAvulsos_', err);
    return jsonError_('Erro ao listar documentos.', 'INTERNAL');
  }
}

// ---------------------------------------------------------------------------
// marcarDocumentoRevisado_ — POST action=marcarDocumentoRevisado
// ---------------------------------------------------------------------------

/**
 * Marca (ou desmarca) um documento avulso como revisado pelo admin.
 * Requer token de administrador (lista ADMIN_EMAILS).
 *
 * Body: { authToken, idEstagio, docId, revisado: bool, obsAdmin?: string }
 */
function marcarDocumentoRevisado_(body) {
  try { validarTokenAdmin_(body.authToken); }
  catch (e) { return jsonError_(e.message, 'AUTH_ERROR'); }

  var idEstagio = sanitizar_(body.idEstagio || '', 20).toUpperCase().trim();
  if (!idEstagio.match(/^RG\d{2}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)) {
    return jsonError_('ID do estágio inválido.', 'VALIDATION');
  }

  var docId    = sanitizar_(String(body.docId || ''), 100).trim();
  if (!docId) return jsonError_('docId é obrigatório.', 'VALIDATION');

  var revisado = body.revisado === true || body.revisado === 'true';
  var obsAdmin = sanitizar_(String(body.obsAdmin || ''), 300);

  try {
    // Busca e atualiza diretamente na planilha (fonte de verdade)
    var ss4    = SpreadsheetApp.openById(CFG_SOL.SS_ID);
    var shtDoc = ss4.getSheetByName(CFG_SOL.ABA_DOC);
    if (!shtDoc) return jsonError_('Aba de documentos não encontrada.', 'INTERNAL');

    var rows = shtDoc.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var idNaLinha  = String(rows[i][COL_DOC.ID_ESTAGIO] || '');
      var docIdLinha = String(rows[i][COL_DOC.DOC_ID]     || '');
      // Aceita também ID legado no formato 'legacy_row_N'
      var isLegacy   = docId.indexOf('legacy_row_') === 0
                       && parseInt(docId.replace('legacy_row_', ''), 10) === i;
      if (idNaLinha !== idEstagio) continue;
      if (docIdLinha !== docId && !isLegacy) continue;

      var rowNum = i + 1; // base 1 para getRange
      shtDoc.getRange(rowNum, COL_DOC.REVISADO_ADMIN + 1).setValue(revisado ? 'Sim' : '');
      shtDoc.getRange(rowNum, COL_DOC.OBS_ADMIN      + 1).setValue(obsAdmin);
      return jsonOk_({ mensagem: 'Documento atualizado com sucesso.' });
    }
    return jsonError_('Documento não encontrado.', 'NOT_FOUND');
  } catch (err) {
    logErro_('marcarDocumentoRevisado_', err);
    return jsonError_('Erro ao atualizar documento.', 'INTERNAL');
  }
}

// ── Contador público de estágios ativos (sem autenticação) ────────────────────

/**
 * Retorna contagem de estágios ativos por tipo de estágio.
 * Endpoint público — não requer autenticação.
 *
 * @returns {{ obrigatorio: number, naoObrigatorio: number, total: number }}
 */
function contarEstagiosAtivos_() {
  try {
    var sheet = SpreadsheetApp.openById(SS_ID).getSheetByName('Solicitações');
    if (!sheet) return jsonOk_({ obrigatorio: 0, naoObrigatorio: 0, total: 0 });

    // Status que indicam estágio em andamento (não terminais)
    var statusAtivos = {
      'Em análise':               true,
      'Aguardando Documentos':    true,
      'Docs Enviados':            true,
      'Aguardando DG':            true,
      'Aguardando Validação Final': true,
      'Em Checklist':             true,
      'Em Assinaturas':           true,
      'Ativo':                    true,
      'Em execução':              true,
    };

    var dados = sheet.getDataRange().getValues();
    var obrig = 0, naoObrig = 0;

    for (var i = 1; i < dados.length; i++) {
      var status = String(dados[i][COL_SOL.STATUS] || '').trim();
      if (!statusAtivos[status]) continue;

      var tipo = String(dados[i][COL_SOL.TIPO_ESTAGIO] || '').toLowerCase().trim();
      if (tipo.indexOf('não') > -1 || tipo.indexOf('nao') > -1) {
        naoObrig++;
      } else if (tipo.indexOf('obrigat') > -1) {
        obrig++;
      }
    }

    return jsonOk_({ obrigatorio: obrig, naoObrigatorio: naoObrig, total: obrig + naoObrig });
  } catch (e) {
    logErro_('contarEstagiosAtivos_', e);
    return jsonOk_({ obrigatorio: 0, naoObrigatorio: 0, total: 0 });
  }
}

// ---------------------------------------------------------------------------
// enviarDocumentoPorEmail_ — POST action=enviarDocumentoPorEmail
// ---------------------------------------------------------------------------

/**
 * Envia um documento finalizado por e-mail para o próprio estudante autenticado.
 *
 * Segurança:
 *   - Requer token de estudante válido
 *   - Verifica que idEstagio pertence ao e-mail do token (nunca ao parâmetro)
 *   - Cooldown de 5 min por (email + tipoDoc + docRef) via PropertiesService
 *   - E-mail de destino sempre extraído do token — nunca de parâmetro externo (LGPD)
 *   - docRef validado cruzando com idEstagio no servidor
 *
 * Body: { authToken, idEstagio, tipoDoc, docRef? }
 * tipoDoc: 'admissao_matricula' | 'admissao_identidade' | 'admissao_boletim'
 *        | 'tce' | 'avaliacao' | 'parecer' | 'avulso'
 * docRef: avalId (avaliacao) | linkDrive (avulso) | '' para os demais
 */
function enviarDocumentoPorEmail_(body) {
  // ── 1. Autenticação ──────────────────────────────────────────────────────
  var tokenInfo;
  try { tokenInfo = validarTokenEstudante_(body.authToken); }
  catch (e) { return jsonError_('Não autorizado: ' + e.message, 'AUTH_ERROR'); }

  var emailEstudante = String(tokenInfo.email || '').toLowerCase().trim();
  var idEstagio      = String(body.idEstagio || '').trim();
  var tipoDoc        = String(body.tipoDoc   || '').trim();
  var docRef         = String(body.docRef    || '').trim();

  if (!emailEstudante || !idEstagio || !tipoDoc) {
    return jsonError_('Parâmetros obrigatórios ausentes.', 'INVALID_PARAMS');
  }

  // Whitelist de tipos válidos — rejeita qualquer outro valor
  var TIPOS_VALIDOS = {
    admissao_matricula:  true, admissao_identidade: true, admissao_boletim: true,
    tce: true, avaliacao: true, parecer: true, avulso: true, solicitacao: true,
  };
  if (!TIPOS_VALIDOS[tipoDoc]) {
    return jsonError_('Tipo de documento inválido.', 'INVALID_PARAMS');
  }

  // ── 2. Verifica propriedade do estágio ───────────────────────────────────
  var ss       = SpreadsheetApp.openById(CFG_SOL.SS_ID);
  var sheetSol = ss.getSheetByName(CFG_SOL.ABA_SOL);
  if (!sheetSol) return jsonError_('Dados não encontrados.', 'INTERNAL');

  var dados    = sheetSol.getDataRange().getValues();
  var linhaIdx = -1;
  for (var i = 1; i < dados.length; i++) {
    var eId  = String(dados[i][COL_SOL.ID_ESTAGIO]      || '').trim();
    var eEml = String(dados[i][COL_SOL.EMAIL_ESTUDANTE] || '').toLowerCase().trim();
    if (eId === idEstagio && eEml === emailEstudante) { linhaIdx = i; break; }
  }
  if (linhaIdx < 0) return jsonError_('Estágio não encontrado para este estudante.', 'NOT_FOUND');

  // ── 3. Cooldown — 5 min por (email + tipoDoc + docRef) ──────────────────
  var rateKey  = 'envDoc_' + Utilities.base64Encode(emailEstudante + '|' + tipoDoc + '|' + docRef).slice(0, 40);
  var props    = PropertiesService.getScriptProperties();
  var lastSent = parseInt(props.getProperty(rateKey) || '0', 10);
  var agora    = Date.now();
  if (agora - lastSent < 5 * 60 * 1000) {
    var restante = Math.ceil((5 * 60 * 1000 - (agora - lastSent)) / 60000);
    return jsonError_('Aguarde ' + restante + ' min antes de reenviar este documento.', 'RATE_LIMIT');
  }

  // ── 4. Obtém o blob do arquivo ───────────────────────────────────────────
  var blob, nomeArquivo, labelDoc;
  try {
    var resultado = _envDoc_obterBlob_(tipoDoc, docRef, idEstagio, dados, linhaIdx, ss);
    blob        = resultado.blob;
    nomeArquivo = resultado.nome;
    labelDoc    = resultado.label;
  } catch (eBlob) {
    logErro_('enviarDocumentoPorEmail_.blob', eBlob);
    return jsonError_('Documento não disponível: ' + eBlob.message, 'DOC_ERROR');
  }

  // ── 5. Envia o e-mail ────────────────────────────────────────────────────
  try {
    MailApp.sendEmail({
      to:          emailEstudante,
      subject:     'SGE IFRS — ' + labelDoc + ' (' + idEstagio + ')',
      body:        'Olá,\n\nSegue em anexo o documento solicitado do seu estágio.\n\n'
                 + 'Estágio: ' + idEstagio + '\n'
                 + 'Documento: ' + labelDoc + '\n\n'
                 + 'Este e-mail foi gerado automaticamente pela Central de Estágios IFRS.\n'
                 + 'Não responda a este e-mail.\n\n'
                 + 'Central de Estágios — IFRS Campus Rio Grande\n'
                 + 'estagios@riogrande.ifrs.edu.br',
      attachments: [blob.setName(nomeArquivo)],
      name:        'Central de Estágios IFRS',
      replyTo:     'estagios@riogrande.ifrs.edu.br',
    });
  } catch (eMail) {
    logErro_('enviarDocumentoPorEmail_.sendEmail', eMail);
    return jsonError_('Erro ao enviar o e-mail. Tente novamente.', 'MAIL_ERROR');
  }

  // ── 6. Registra cooldown ─────────────────────────────────────────────────
  try { props.setProperty(rateKey, String(agora)); } catch (_) {}

  return jsonOk_({ mensagem: 'Documento enviado para o seu e-mail institucional.' });
}

// ---------------------------------------------------------------------------
// Helpers internos — _envDoc_*
// ---------------------------------------------------------------------------

function _envDoc_obterBlob_(tipoDoc, docRef, idEstagio, dados, linhaIdx, ss) {
  switch (tipoDoc) {
    case 'admissao_matricula':
      return _envDoc_blobUrl_(
        String(dados[linhaIdx][COL_SOL.LINK_DOC_MAT] || ''),
        'Comprovante_Matricula_' + idEstagio + '.pdf',
        'Comprovante de Matrícula'
      );
    case 'admissao_identidade':
      return _envDoc_blobUrl_(
        String(dados[linhaIdx][COL_SOL.LINK_DOC_ID] || ''),
        'Documento_Identidade_' + idEstagio + '.pdf',
        'Documento de Identidade'
      );
    case 'admissao_boletim':
      return _envDoc_blobUrl_(
        String(dados[linhaIdx][COL_SOL.LINK_DOC_BOL] || ''),
        'Boletim_' + idEstagio + '.pdf',
        'Boletim / Histórico Escolar'
      );
    case 'tce':
      return _envDoc_blobTce_(idEstagio);
    case 'avaliacao':
      return _envDoc_blobAvaliacao_(docRef, idEstagio);
    case 'parecer':
      return _envDoc_blobParecer_(idEstagio);
    case 'avulso':
      return _envDoc_blobAvulso_(docRef, idEstagio, ss);
    case 'solicitacao':
      return _envDoc_blobSolicitacao_(idEstagio);
    default:
      throw new Error('Tipo desconhecido: ' + tipoDoc);
  }
}

/** Baixa um arquivo do Drive por URL e retorna o blob. */
function _envDoc_blobUrl_(driveUrl, nome, label) {
  if (!driveUrl) throw new Error('URL do documento não disponível.');
  var m = driveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) m = driveUrl.match(/id=([a-zA-Z0-9_-]+)/);
  if (!m) m = driveUrl.match(/[-\w]{25,}/);
  if (!m) throw new Error('URL do Drive inválida.');
  var file = DriveApp.getFileById(m[1] || m[0]);
  return { blob: file.getBlob(), nome: nome, label: label };
}

/** Obtém o PDF do TCE concluído a partir do fluxo de assinaturas. */
function _envDoc_blobTce_(idEstagio) {
  var fluxoStr = PropertiesService.getScriptProperties().getProperty('fluxo_' + idEstagio);
  if (!fluxoStr) throw new Error('Fluxo do TCE não encontrado.');
  var fluxo = JSON.parse(fluxoStr);
  if (fluxo.statusGeral !== 'concluido') throw new Error('TCE ainda não concluído.');
  // Última etapa com driveUrl = versão final assinada
  var urlFinal = '';
  var etapas = fluxo.etapas || [];
  for (var i = etapas.length - 1; i >= 0; i--) {
    if (etapas[i].driveUrl) { urlFinal = etapas[i].driveUrl; break; }
  }
  if (!urlFinal) throw new Error('PDF do TCE não encontrado no fluxo.');
  return _envDoc_blobUrl_(urlFinal, 'TCE_' + idEstagio + '.pdf', 'TCE — Termo de Compromisso de Estágio');
}

/** Obtém o PDF de uma avaliação concluída via PropertiesService. */
function _envDoc_blobAvaliacao_(avalId, idEstagio) {
  if (!avalId) throw new Error('Identificador da avaliação não informado.');
  var str = PropertiesService.getScriptProperties().getProperty('aval_' + avalId);
  if (!str) throw new Error('Avaliação não encontrada.');
  var fluxo = JSON.parse(str);
  // Valida que a avaliação pertence ao estágio do estudante autenticado
  if (String(fluxo.idEstagio || '') !== idEstagio) throw new Error('Avaliação não pertence a este estágio.');
  if (fluxo.statusGeral !== 'concluido' || !fluxo.pdfUrl) throw new Error('Avaliação não concluída ou sem PDF.');
  return _envDoc_blobUrl_(fluxo.pdfUrl, 'Avaliacao_' + avalId + '.pdf', 'Avaliação de Estágio');
}

/** Obtém o PDF do parecer final. */
function _envDoc_blobParecer_(idEstagio) {
  var parecer = obterParecer_(idEstagio);
  if (!parecer || !parecer.pdfUrl) throw new Error('Parecer final não disponível.');
  return _envDoc_blobUrl_(parecer.pdfUrl, 'Parecer_Final_' + idEstagio + '.pdf', 'Parecer Final de Estágio');
}

/**
 * Obtém o blob de um documento avulso identificado pelo linkDrive.
 * Valida que o linkDrive pertence ao idEstagio do estudante antes de servir.
 */
function _envDoc_blobAvulso_(linkDrive, idEstagio, ss) {
  if (!linkDrive) throw new Error('Link do documento não informado.');
  var sheetDoc = ss.getSheetByName(CFG_SOL.ABA_DOC);
  if (!sheetDoc) throw new Error('Aba de documentos não encontrada.');
  var rows = sheetDoc.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][COL_DOC.ID_ESTAGIO]  || '') === idEstagio &&
        String(rows[i][COL_DOC.LINK_DRIVE]   || '') === linkDrive) {
      var nome = String(rows[i][COL_DOC.NOME_ARQUIVO] || rows[i][COL_DOC.TITULO] || 'documento') + '.pdf';
      return _envDoc_blobUrl_(linkDrive, nome, String(rows[i][COL_DOC.TITULO] || 'Documento Avulso'));
    }
  }
  throw new Error('Documento não pertence a este estágio.');
}

/** Retorna o blob do PDF da solicitação (checklist assinado). */
function _envDoc_blobSolicitacao_(idEstagio) {
  var raw = PropertiesService.getScriptProperties().getProperty('checklist_' + idEstagio);
  if (!raw) throw new Error('PDF da solicitação não disponível.');
  var ck;
  try { ck = JSON.parse(raw); } catch(_) { throw new Error('Dados do checklist inválidos.'); }
  if (!ck.urlPdfChecklist) throw new Error('PDF da solicitação ainda não foi gerado.');
  return _envDoc_blobUrl_(ck.urlPdfChecklist, 'Solicitacao_Estagio_' + idEstagio + '.pdf', 'Solicitação de Estágio');
}
