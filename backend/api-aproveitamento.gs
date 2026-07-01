'use strict';

/**
 * api-aproveitamento.gs — Aproveitamento de Experiência Profissional
 * SGE — Sistema de Gestão de Estágios · IFRS Campus Rio Grande
 *
 * Fluxo: Estudante → Coordenador → Admin → DEN → Conclusão
 *
 * Status possíveis:
 *   Rascunho | Aguardando Coordenador | Aguardando Admin |
 *   Aguardando DEN | Devolvido | Deferido | Indeferido
 *
 * Segurança:
 *   - CPF e RG mascarados em todas as respostas
 *   - Arquivos no Drive com acesso restrito ao domínio institucional
 *   - Cada endpoint valida o papel do chamador antes de qualquer operação
 *   - Estudante só acessa a própria solicitação
 *   - Coordenador só acessa solicitações do próprio curso
 */

// ── Configuração ─────────────────────────────────────────────────────────────

var CFG_APROV = {
  SS_ID:    '1zVyseifVC6xeMpNjqwYd6jCq9HTJ2NS8BlN1dtM4s7Y', // mesma planilha consolidada
  ABA:      'Aproveitamento',
  // Pasta Drive criada manualmente pelo admin (subpasta de Estágios ou própria)
  // ID configurado em PropertiesService: 'APROVEITAMENTO_FOLDER_ID'
};

// Mapa de colunas da aba Aproveitamento (base 0)
var COL_APROV = {
  ID:                   0,   // ID único (APROV-RG26-XXXX)
  TIMESTAMP:            1,   // data/hora de criação
  STATUS:               2,   // Rascunho | Aguardando Coordenador | ...
  // Dados do estudante (puxados do perfil)
  EMAIL_ESTUDANTE:      3,
  NOME_ESTUDANTE:       4,
  MATRICULA:            5,
  CURSO:                6,
  CPF:                  7,   // armazenado completo; mascarado nas respostas
  RG:                   8,   // armazenado completo; mascarado nas respostas
  TELEFONE:             9,   // mascarado nas respostas
  ENDERECO:             10,
  BAIRRO:               11,
  CIDADE:               12,
  ESTADO:               13,
  DATA_NASCIMENTO:      14,
  FORMANDO:             15,
  // Dados da solicitação
  TIPO_VINCULO:         16,  // CLT | Autonomo | Empresario
  EMPRESAS_JSON:        17,  // JSON: [{nome,cnpj,cargo,periodoInicio,periodoFim,horas}]
  TOTAL_HORAS:          18,
  DECLARACAO_VERACIDADE:19,  // 'Sim'
  ASSINATURA_ESTUDANTE: 20,  // hash interno
  DATA_ASSINATURA_EST:  21,
  // Relatório (seções preenchidas digitalmente)
  RELATORIO_JSON:       22,  // JSON: {introducao, empresa, atividades, conclusao}
  // Documentos (URLs do Drive)
  DOC_MATRICULA_URL:    23,
  DOC_CTPS_ID_URL:      24,  // carteira de trabalho — identificação
  DOC_CTPS_REG_URL:     25,  // carteira de trabalho — registros
  DOC_DECLARACAO_URL:   26,  // declaração da empresa (condicional)
  DOC_AUTONOMO_URL:     27,  // docs de autônomo/empresário (condicional)
  DRIVE_URL:            28,  // URL da pasta do estágio no Drive
  // Etapa coordenador
  EMAIL_COORDENADOR:    29,
  PARECER_COORD_JSON:   30,  // JSON: {compativel,justificativa,horasReconhecidas,decisao,obs}
  ASSINATURA_COORD:     31,
  DATA_ASSINATURA_COORD:32,
  // Etapa admin
  OBS_ADMIN:            33,
  DATA_ENCAMINHAMENTO:  34,
  // Etapa DEN
  PARECER_DEN_JSON:     35,  // JSON: {decisao,justificativa,horasHomologadas}
  ASSINATURA_DEN:       36,
  DATA_ASSINATURA_DEN:  37,
  CARGA_HOMOLOGADA:     38,
  // Devolução
  OBS_DEVOLUCAO:        39,
  DEVOLVIDO_POR:        40,  // 'coordenador' | 'admin'
  DATA_DEVOLUCAO:       41,
  SEMESTRE_ATUAL:       42,  // período/semestre que está cursando
  DOC_EXTRA_URL:        43,  // demais documentos (opcional)
};

var APROV_STATUS = {
  RASCUNHO:             'Rascunho',
  AG_COORDENADOR:       'Aguardando Coordenador',
  AG_ADMIN:             'Aguardando Admin',
  AG_DEN:               'Aguardando DEN',
  DEVOLVIDO:            'Devolvido',
  DEFERIDO:             'Deferido',
  INDEFERIDO:           'Indeferido',
};

// ── Helpers internos ─────────────────────────────────────────────────────────

function _abrirAbaAprov_() {
  return abrirAba_(CFG_APROV.SS_ID, CFG_APROV.ABA);
}

function _gerarIdAprov_() {
  var ano  = new Date().getFullYear().toString().slice(-2);
  var rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return 'APROV-RG' + ano + '-' + rand;
}

function _obterPastaAproveitamento_() {
  var folderId = PropertiesService.getScriptProperties()
                   .getProperty('APROVEITAMENTO_FOLDER_ID');
  if (!folderId) throw new Error('Pasta de Aproveitamento não configurada. Configure APROVEITAMENTO_FOLDER_ID em PropertiesService.');
  return DriveApp.getFolderById(folderId);
}

function _criarPastaAprov_(idAprov, nomeEstudante) {
  try {
    var raiz  = _obterPastaAproveitamento_();
    var ano   = new Date().getFullYear().toString();
    var pastaAno  = DRIVE.obterOuCriarPasta(raiz, ano);
    var nomePasta = idAprov + (nomeEstudante ? ' — ' + nomeEstudante.replace(/[\/\\:*?"<>|]/g, '-').slice(0, 80) : '');
    var pasta = DRIVE.obterOuCriarPasta(pastaAno, nomePasta);
    return { folder: pasta, url: pasta.getUrl() };
  } catch (e) {
    logErro_('_criarPastaAprov_', e);
    return { folder: null, url: '' };
  }
}

/**
 * Salva um arquivo PDF na pasta do aproveitamento.
 * Valida extensão + magic bytes antes de salvar.
 * Acesso restrito ao domínio institucional (LGPD).
 */
function _salvarArquivoAprov_(pasta, arq, nomeBase) {
  if (!arq || !arq.base64 || !arq.nome) return '';
  try {
    var val = validarArquivoUpload_(arq, ['pdf']);
    if (!val.ok) { logErro_('_salvarArquivoAprov_', new Error(val.erro)); return ''; }
    var b64 = String(arq.base64);
    var ci  = b64.indexOf(',');
    if (ci !== -1) b64 = b64.slice(ci + 1);
    if (b64.length > 14000000) { logErro_('_salvarArquivoAprov_', new Error('Arquivo muito grande.')); return ''; }
    var bytes = Utilities.base64Decode(b64);
    var nome  = sanitizarNomeArquivo_(nomeBase || arq.nome);
    var blob  = Utilities.newBlob(bytes, 'application/pdf', nome);
    var file  = pasta.createFile(blob);
    // Restrito ao domínio institucional — não público
    file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  } catch (e) {
    logErro_('_salvarArquivoAprov_', e);
    return '';
  }
}

/** Retorna linha pelo ID da solicitação. null se não encontrado. */
function _buscarAprovPorId_(idAprov) {
  var sheet = _abrirAbaAprov_();
  var dados = sheet.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][COL_APROV.ID] || '') === idAprov) {
      return { sheet: sheet, linha: dados[i], rowIdx: i + 1 };
    }
  }
  return null;
}

/** Retorna linha da solicitação do estudante (e-mail). null se não encontrada. */
function _buscarAprovPorEmail_(email) {
  var sheet = _abrirAbaAprov_();
  var dados = sheet.getDataRange().getValues();
  // Retorna a solicitação mais recente (última linha) do estudante
  var resultado = null;
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][COL_APROV.EMAIL_ESTUDANTE] || '').toLowerCase() === email) {
      resultado = { sheet: sheet, linha: dados[i], rowIdx: i + 1 };
    }
  }
  return resultado;
}

/** Constrói o objeto de resposta seguro para o estudante (PII mascarada). */
function _buildRespostaEstudante_(linha) {
  return {
    id:                   String(linha[COL_APROV.ID]             || ''),
    status:               String(linha[COL_APROV.STATUS]         || ''),
    nomeEstudante:        String(linha[COL_APROV.NOME_ESTUDANTE] || ''),
    matricula:            String(linha[COL_APROV.MATRICULA]      || ''),
    curso:                String(linha[COL_APROV.CURSO]          || ''),
    cpf:                  mascararCPF_(String(linha[COL_APROV.CPF] || '')),
    rg:                   _mascararRG_(String(linha[COL_APROV.RG]  || '')),
    telefone:             mascararTelefone_(String(linha[COL_APROV.TELEFONE] || '')),
    endereco:             String(linha[COL_APROV.ENDERECO]       || ''),
    bairro:               String(linha[COL_APROV.BAIRRO]         || ''),
    cidade:               String(linha[COL_APROV.CIDADE]         || ''),
    estado:               String(linha[COL_APROV.ESTADO]         || ''),
    dataNascimento:       normalizarDataISO_(linha[COL_APROV.DATA_NASCIMENTO]),
    formando:             String(linha[COL_APROV.FORMANDO]       || ''),
    tipoVinculo:          String(linha[COL_APROV.TIPO_VINCULO]   || ''),
    empresas:             _parseJson_(linha[COL_APROV.EMPRESAS_JSON], []),
    totalHoras:           String(linha[COL_APROV.TOTAL_HORAS]    || ''),
    declaracaoVeracidade: String(linha[COL_APROV.DECLARACAO_VERACIDADE] || ''),
    dataAssinaturaEst:    normalizarDataISO_(linha[COL_APROV.DATA_ASSINATURA_EST]),
    relatorio:            _parseJson_(linha[COL_APROV.RELATORIO_JSON], {}),
    docMatriculaUrl:      String(linha[COL_APROV.DOC_MATRICULA_URL] || ''),
    docCtpsIdUrl:         String(linha[COL_APROV.DOC_CTPS_ID_URL]  || ''),
    docCtpsRegUrl:        String(linha[COL_APROV.DOC_CTPS_REG_URL] || ''),
    docDeclaracaoUrl:     String(linha[COL_APROV.DOC_DECLARACAO_URL] || ''),
    docAutonomoUrl:       String(linha[COL_APROV.DOC_AUTONOMO_URL]  || ''),
    parecerCoord:         _parseJson_(linha[COL_APROV.PARECER_COORD_JSON], null),
    dataAssinaturaCoord:  normalizarDataISO_(linha[COL_APROV.DATA_ASSINATURA_COORD]),
    parecerDen:           _parseJson_(linha[COL_APROV.PARECER_DEN_JSON], null),
    cargaHomologada:      String(linha[COL_APROV.CARGA_HOMOLOGADA] || ''),
    obsDevolucao:         String(linha[COL_APROV.OBS_DEVOLUCAO]    || ''),
    devolvidoPor:         String(linha[COL_APROV.DEVOLVIDO_POR]    || ''),
    dataDevolucao:        normalizarDataISO_(linha[COL_APROV.DATA_DEVOLUCAO]),
    semestreAtual:        String(linha[COL_APROV.SEMESTRE_ATUAL]   || ''),
    docExtraUrl:          String(linha[COL_APROV.DOC_EXTRA_URL]    || ''),
  };
}

/** Constrói resposta para coordenador/admin/den (sem PII completa). */
function _buildRespostaStaff_(linha) {
  var base = _buildRespostaEstudante_(linha);
  // Staff pode ver e-mail do estudante (necessário para comunicação)
  base.emailEstudante = String(linha[COL_APROV.EMAIL_ESTUDANTE] || '');
  base.emailCoordenador = String(linha[COL_APROV.EMAIL_COORDENADOR] || '');
  base.obsAdmin = String(linha[COL_APROV.OBS_ADMIN] || '');
  base.dataEncaminhamento = normalizarDataISO_(linha[COL_APROV.DATA_ENCAMINHAMENTO]);
  return base;
}

function _parseJson_(valor, fallback) {
  if (!valor) return fallback;
  try { return JSON.parse(String(valor)); } catch (_) { return fallback; }
}

function _mascararRG_(rg) {
  if (!rg) return '';
  var limpo = rg.replace(/\D/g, '');
  if (limpo.length < 4) return '***';
  return '***' + limpo.slice(-4);
}

// ── Validação de papel ───────────────────────────────────────────────────────

/** Valida estudante e retorna email. */
function _validarEstudanteAprov_(authToken) {
  var info  = AUTH.validarTokenEstudante(authToken);
  return info.email.toLowerCase().trim();
}

/** Valida coordenador ativo e retorna {email, curso}. */
function _validarCoordenadorAprov_(authToken) {
  var info  = AUTH.validarToken(authToken);
  var email = info.email.toLowerCase().trim();
  // Verifica cadastro ativo na aba Coordenadores
  var ss    = SpreadsheetApp.openById(CFG_APROV.SS_ID);
  var sheet = ss.getSheetByName('Coordenadores');
  if (!sheet) throw new ErroAutenticacao('Aba Coordenadores não encontrada.');
  var dados = sheet.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    var ec = String(dados[i][COL_COORD.EMAIL]  || '').toLowerCase().trim();
    var st = String(dados[i][COL_COORD.STATUS] || '').trim();
    if (ec === email && st === 'Ativo') {
      return { email: email, curso: String(dados[i][COL_COORD.CURSO] || '') };
    }
  }
  // Verifica também e-mail fixo de coordenação cadastrado em cursos
  var cursos = obterListaCursos_();
  for (var c = 0; c < cursos.length; c++) {
    var ef = String(cursos[c].emailCoordenacao || '').trim().toLowerCase();
    if (ef === email && cursos[c].status === 'Ativo') {
      return { email: email, curso: cursos[c].nome };
    }
  }
  throw new ErroAutenticacao('Acesso restrito a coordenadores cadastrados e aprovados.');
}

/** Valida DEN e retorna email. */
function _validarDenAprov_(authToken) {
  var info     = AUTH.validarToken(authToken);
  var email    = info.email.toLowerCase().trim();
  var cfgDen   = _obterDiretoriaAdmin_('DEN');
  var emailDen = (cfgDen.email || '').toLowerCase().trim();
  if (!emailDen) throw new ErroAutenticacao('E-mail da DEN não configurado.');
  if (email !== emailDen) throw new ErroAutenticacao('Acesso restrito ao responsável da DEN.');
  return email;
}

// ── Handlers GET ─────────────────────────────────────────────────────────────

function doGetAproveitamento(e) {
  try {
    var action    = (e.parameter && e.parameter.action) || '';
    var authToken = (e.parameter && e.parameter.authToken) || '';

    switch (action) {

      // Estudante: carrega a própria solicitação (rascunho ou qualquer status)
      case 'obterMeuAproveitamento': {
        var emailEst = _validarEstudanteAprov_(authToken);
        var rec = _buscarAprovPorEmail_(emailEst);
        if (!rec) return jsonOk_(null);
        return jsonOk_(_buildRespostaEstudante_(rec.linha));
      }

      // Coordenador: lista solicitações do próprio curso aguardando ou devolvidas
      case 'listarAproveitamentosCoordenador': {
        var coord = _validarCoordenadorAprov_(authToken);
        var sheet = _abrirAbaAprov_();
        var dados = sheet.getDataRange().getValues();
        var lista = [];
        var cursosCoord = coord.curso.split(',').map(function(c) { return c.trim().toLowerCase(); });
        for (var i = 1; i < dados.length; i++) {
          var cursol = String(dados[i][COL_APROV.CURSO] || '').toLowerCase().trim();
          var statusl = String(dados[i][COL_APROV.STATUS] || '');
          if (!cursosCoord.some(function(cc) { return cursol.indexOf(cc) !== -1 || cc.indexOf(cursol) !== -1; })) continue;
          if (statusl === APROV_STATUS.RASCUNHO) continue; // rascunho invisível ao coordenador
          lista.push(_buildRespostaStaff_(dados[i]));
        }
        return jsonOk_(lista);
      }

      // Admin: lista todas as solicitações
      case 'listarAproveitamentosAdmin': {
        validarTokenAdmin_(authToken);
        var sheet = _abrirAbaAprov_();
        var dados = sheet.getDataRange().getValues();
        var lista = [];
        for (var i = 1; i < dados.length; i++) {
          if (!dados[i][COL_APROV.ID]) continue;
          lista.push(_buildRespostaStaff_(dados[i]));
        }
        lista.reverse();
        return jsonOk_(lista);
      }

      // Admin ou coordenador ou DEN: obtém detalhes completos de uma solicitação
      case 'obterAproveitamento': {
        var idAprov = sanitizar_(e.parameter && e.parameter.id, 50);
        if (!idAprov) return jsonError_('Parâmetro id obrigatório.', 'MISSING_PARAM');
        var rec = _buscarAprovPorId_(idAprov);
        if (!rec) return jsonError_('Solicitação não encontrada.', 'NOT_FOUND');
        // Valida acesso: admin, coordenador do curso, ou DEN (se status AG_DEN/Deferido/Indeferido)
        var isAdmin = false;
        try { validarTokenAdmin_(authToken); isAdmin = true; } catch (_) {}
        if (!isAdmin) {
          // Tenta coordenador
          var isCoord = false;
          try {
            var coord = _validarCoordenadorAprov_(authToken);
            var cursosCoord = coord.curso.split(',').map(function(c) { return c.trim().toLowerCase(); });
            var cursol = String(rec.linha[COL_APROV.CURSO] || '').toLowerCase();
            isCoord = cursosCoord.some(function(cc) { return cursol.indexOf(cc) !== -1 || cc.indexOf(cursol) !== -1; });
          } catch (_) {}
          if (!isCoord) {
            // Tenta DEN
            try { _validarDenAprov_(authToken); } catch (_) {
              return jsonError_('Não autorizado.', 'AUTH_ERROR');
            }
          }
        }
        return jsonOk_(_buildRespostaStaff_(rec.linha));
      }

      // DEN: lista solicitações encaminhadas
      case 'listarAproveitamentosDEN': {
        _validarDenAprov_(authToken);
        var sheet = _abrirAbaAprov_();
        var dados = sheet.getDataRange().getValues();
        var lista = [];
        for (var i = 1; i < dados.length; i++) {
          var st = String(dados[i][COL_APROV.STATUS] || '');
          if (st !== APROV_STATUS.AG_DEN && st !== APROV_STATUS.DEFERIDO && st !== APROV_STATUS.INDEFERIDO) continue;
          lista.push(_buildRespostaStaff_(dados[i]));
        }
        lista.reverse();
        return jsonOk_(lista);
      }

      default:
        return jsonError_('Ação GET desconhecida em aproveitamento: ' + action, 'UNKNOWN_ACTION');
    }
  } catch (err) {
    if (err instanceof ErroAutenticacao) return jsonError_(err.message, 'AUTH_ERROR');
    logErro_('api-aproveitamento.doGetAproveitamento', err);
    return jsonError_('Erro interno.', 'INTERNAL');
  }
}

// ── Handlers POST ────────────────────────────────────────────────────────────

function doPostAproveitamento(e) {
  try {
    var body      = e._body || {};
    var action    = body.action || '';
    var authToken = body.authToken || '';

    switch (action) {

      // Estudante: inicia ou salva rascunho
      case 'salvarRascunhoAproveitamento': {
        var emailEst = _validarEstudanteAprov_(authToken);
        return _salvarRascunho_(emailEst, body);
      }

      // Estudante: envia para o coordenador
      case 'enviarAproveitamento': {
        var emailEst = _validarEstudanteAprov_(authToken);
        return _enviarSolicitacao_(emailEst, body);
      }

      // Coordenador: responde com parecer
      case 'responderAproveitamentoCoordenador': {
        var coord = _validarCoordenadorAprov_(authToken);
        return _responderCoordenador_(coord, body);
      }

      // Coordenador ou Admin: devolve ao estudante
      case 'devolverAproveitamento': {
        // Tenta admin primeiro
        var isAdmin = false;
        try { validarTokenAdmin_(authToken); isAdmin = true; } catch (_) {}
        var devolvidoPor = isAdmin ? 'admin' : 'coordenador';
        if (!isAdmin) {
          // Valida como coordenador
          _validarCoordenadorAprov_(authToken);
        }
        return _devolverSolicitacao_(body, devolvidoPor);
      }

      // Admin: encaminha para DEN
      case 'encaminharAproveitamentoDEN': {
        validarTokenAdmin_(authToken);
        return _encaminharDEN_(body);
      }

      // DEN: emite parecer final
      case 'responderAproveitamentoDEN': {
        var emailDen = _validarDenAprov_(authToken);
        return _responderDEN_(emailDen, body);
      }

      default:
        return jsonError_('Ação POST desconhecida em aproveitamento: ' + action, 'UNKNOWN_ACTION');
    }
  } catch (err) {
    if (err instanceof ErroAutenticacao) return jsonError_(err.message, 'AUTH_ERROR');
    logErro_('api-aproveitamento.doPostAproveitamento', err);
    return jsonError_('Erro interno.', 'INTERNAL');
  }
}

// ── Operações ────────────────────────────────────────────────────────────────

function _salvarRascunho_(emailEst, body) {
  var sheet = _abrirAbaAprov_();
  var dados = sheet.getDataRange().getValues();

  // Busca rascunho existente deste estudante
  var rowIdx = -1;
  for (var i = 1; i < dados.length; i++) {
    var emailL  = String(dados[i][COL_APROV.EMAIL_ESTUDANTE] || '').toLowerCase();
    var statusL = String(dados[i][COL_APROV.STATUS] || '');
    if (emailL === emailEst && statusL === APROV_STATUS.RASCUNHO) {
      rowIdx = i + 1;
      break;
    }
  }

  var agora = new Date().toISOString();
  var empresas = body.empresas;
  if (typeof empresas !== 'string') empresas = JSON.stringify(empresas || []);
  var relatorio = body.relatorio;
  if (typeof relatorio !== 'string') relatorio = JSON.stringify(relatorio || {});

  if (rowIdx === -1) {
    // Cria nova linha
    var idAprov = _gerarIdAprov_();
    var novaLinha = new Array(42).fill('');
    novaLinha[COL_APROV.ID]              = idAprov;
    novaLinha[COL_APROV.TIMESTAMP]       = agora;
    novaLinha[COL_APROV.STATUS]          = APROV_STATUS.RASCUNHO;
    novaLinha[COL_APROV.EMAIL_ESTUDANTE] = sanitizar_(body.emailEstudante || emailEst, 200);
    novaLinha[COL_APROV.NOME_ESTUDANTE]  = sanitizar_(body.nomeEstudante  || '', 200);
    novaLinha[COL_APROV.MATRICULA]       = sanitizar_(body.matricula      || '', 30);
    novaLinha[COL_APROV.CURSO]           = sanitizar_(body.curso          || '', 200);
    novaLinha[COL_APROV.CPF]             = sanitizar_(body.cpf            || '', 20);
    novaLinha[COL_APROV.RG]              = sanitizar_(body.rg             || '', 30);
    novaLinha[COL_APROV.TELEFONE]        = sanitizar_(body.telefone       || '', 30);
    novaLinha[COL_APROV.ENDERECO]        = sanitizar_(body.endereco       || '', 300);
    novaLinha[COL_APROV.BAIRRO]          = sanitizar_(body.bairro         || '', 100);
    novaLinha[COL_APROV.CIDADE]          = sanitizar_(body.cidade         || '', 100);
    novaLinha[COL_APROV.ESTADO]          = sanitizar_(body.estado         || '', 2);
    novaLinha[COL_APROV.DATA_NASCIMENTO] = sanitizar_(body.dataNascimento || '', 30);
    novaLinha[COL_APROV.FORMANDO]        = sanitizar_(body.formando       || '', 10);
    novaLinha[COL_APROV.SEMESTRE_ATUAL]  = sanitizar_(body.semestreAtual  || '', 30);
    novaLinha[COL_APROV.TIPO_VINCULO]    = sanitizar_(body.tipoVinculo    || '', 30);
    novaLinha[COL_APROV.EMPRESAS_JSON]   = empresas;
    novaLinha[COL_APROV.TOTAL_HORAS]     = sanitizar_(String(body.totalHoras || ''), 10);
    novaLinha[COL_APROV.RELATORIO_JSON]  = relatorio;
    sheet.appendRow(novaLinha);
    return jsonOk_({ id: idAprov, status: APROV_STATUS.RASCUNHO });
  }

  // Atualiza rascunho existente (só campos editáveis)
  var row = sheet.getRange(rowIdx, 1, 1, 44).getValues()[0];
  row[COL_APROV.TIPO_VINCULO]   = sanitizar_(body.tipoVinculo    || '', 30);
  row[COL_APROV.SEMESTRE_ATUAL] = sanitizar_(body.semestreAtual  || '', 30);
  row[COL_APROV.FORMANDO]       = sanitizar_(body.formando       || '', 10);
  row[COL_APROV.EMPRESAS_JSON]  = empresas;
  row[COL_APROV.TOTAL_HORAS]    = sanitizar_(String(body.totalHoras || ''), 10);
  row[COL_APROV.RELATORIO_JSON] = relatorio;
  sheet.getRange(rowIdx, 1, 1, 44).setValues([row]);
  return jsonOk_({ id: row[COL_APROV.ID], status: APROV_STATUS.RASCUNHO });
}

function _enviarSolicitacao_(emailEst, body) {
  checkRateLimit_('enviarAproveitamento', 3);

  var rec = _buscarAprovPorEmail_(emailEst);
  // Aceita envio tanto de rascunho quanto de devolvido
  if (!rec) return jsonError_('Nenhuma solicitação encontrada para este estudante.', 'NOT_FOUND');
  var statusAtual = String(rec.linha[COL_APROV.STATUS] || '');
  if (statusAtual !== APROV_STATUS.RASCUNHO && statusAtual !== APROV_STATUS.DEVOLVIDO) {
    return jsonError_('A solicitação não pode ser enviada no status atual: ' + statusAtual, 'INVALID_STATE');
  }

  // Valida campos obrigatórios
  var tipoVinculo = sanitizar_(body.tipoVinculo || '', 30);
  if (!tipoVinculo) return jsonError_('Tipo de vínculo obrigatório.', 'VALIDATION');
  if (!body.declaracaoVeracidade) return jsonError_('Declaração de veracidade obrigatória.', 'VALIDATION');
  var relatorio = _parseJson_(typeof body.relatorio === 'string' ? body.relatorio : JSON.stringify(body.relatorio || {}), {});
  if (!relatorio.introducao || !relatorio.empresa || !relatorio.atividades || !relatorio.conclusao) {
    return jsonError_('Todas as seções do relatório são obrigatórias.', 'VALIDATION');
  }

  var idAprov      = String(rec.linha[COL_APROV.ID]);
  var nomeEstudante = String(rec.linha[COL_APROV.NOME_ESTUDANTE] || '');

  // Cria/recupera pasta no Drive
  var driveInfo = _criarPastaAprov_(idAprov, nomeEstudante);
  var pasta = driveInfo.folder;

  // Processa uploads (apenas PDF, validação por magic bytes no servidor)
  var docMatUrl  = pasta ? _salvarArquivoAprov_(pasta, body.docMatricula,  idAprov + '_Matricula.pdf')    : '';
  var docCtpsId  = pasta ? _salvarArquivoAprov_(pasta, body.docCtpsId,     idAprov + '_CTPS_ID.pdf')      : '';
  var docCtpsReg = pasta ? _salvarArquivoAprov_(pasta, body.docCtpsReg,    idAprov + '_CTPS_Reg.pdf')     : '';
  var docDecl    = pasta ? _salvarArquivoAprov_(pasta, body.docDeclaracao,  idAprov + '_Declaracao.pdf')  : '';
  var docAut     = pasta ? _salvarArquivoAprov_(pasta, body.docAutonomo,    idAprov + '_Autonomo.pdf')    : '';

  // Documentos obrigatórios
  var docMatExistente = docMatUrl || String(rec.linha[COL_APROV.DOC_MATRICULA_URL] || '');
  var docCtpsIdEx     = docCtpsId || String(rec.linha[COL_APROV.DOC_CTPS_ID_URL]  || '');
  var docCtpsRegEx    = docCtpsReg || String(rec.linha[COL_APROV.DOC_CTPS_REG_URL] || '');
  if (!docMatExistente) return jsonError_('Atestado de matrícula obrigatório.', 'VALIDATION');
  if (!docCtpsIdEx)     return jsonError_('Carteira de trabalho (identificação) obrigatória.', 'VALIDATION');
  if (!docCtpsRegEx)    return jsonError_('Carteira de trabalho (registros) obrigatória.', 'VALIDATION');

  // Obtém e-mail do coordenador do curso
  var curso          = String(rec.linha[COL_APROV.CURSO] || '');
  var emailCoordenador = _ckObterEmailCoordenador_(curso) || '';

  var agora = new Date().toISOString();
  var assinaturaHash = Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    emailEst + idAprov + agora
  ).map(function(b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');

  var empresas = body.empresas;
  if (typeof empresas !== 'string') empresas = JSON.stringify(empresas || []);
  var relatorioStr = typeof body.relatorio === 'string' ? body.relatorio : JSON.stringify(body.relatorio || {});

  var row = sheet.getRange ? rec.sheet.getRange(rec.rowIdx, 1, 1, 44).getValues()[0] : rec.linha;
  var sheet = rec.sheet;
  row = sheet.getRange(rec.rowIdx, 1, 1, 44).getValues()[0];

  row[COL_APROV.STATUS]               = APROV_STATUS.AG_COORDENADOR;
  row[COL_APROV.TIPO_VINCULO]         = tipoVinculo;
  row[COL_APROV.EMPRESAS_JSON]        = empresas;
  row[COL_APROV.TOTAL_HORAS]          = sanitizar_(String(body.totalHoras || ''), 10);
  row[COL_APROV.DECLARACAO_VERACIDADE]= 'Sim';
  row[COL_APROV.ASSINATURA_ESTUDANTE] = assinaturaHash;
  row[COL_APROV.DATA_ASSINATURA_EST]  = agora;
  row[COL_APROV.RELATORIO_JSON]       = relatorioStr;
  row[COL_APROV.DOC_MATRICULA_URL]    = docMatExistente;
  row[COL_APROV.DOC_CTPS_ID_URL]      = docCtpsIdEx;
  row[COL_APROV.DOC_CTPS_REG_URL]     = docCtpsRegEx;
  if (docDecl)    row[COL_APROV.DOC_DECLARACAO_URL] = docDecl;
  if (docAut)     row[COL_APROV.DOC_AUTONOMO_URL]   = docAut;
  if (driveInfo.url) row[COL_APROV.DRIVE_URL]       = driveInfo.url;
  row[COL_APROV.SEMESTRE_ATUAL] = sanitizar_(body.semestreAtual || '', 30);
  row[COL_APROV.FORMANDO]       = sanitizar_(body.formando      || '', 10);
  var docExtra = body.docExtra ? _salvarArquivoAprov_(pasta, body.docExtra, 'DocExtra_' + idAprov + '.pdf') : '';
  if (docExtra) row[COL_APROV.DOC_EXTRA_URL] = docExtra;
  row[COL_APROV.EMAIL_COORDENADOR]    = emailCoordenador;
  // Limpa campos de devolução ao reenviar
  row[COL_APROV.OBS_DEVOLUCAO]        = '';
  row[COL_APROV.DEVOLVIDO_POR]        = '';
  row[COL_APROV.DATA_DEVOLUCAO]       = '';

  sheet.getRange(rec.rowIdx, 1, 1, 44).setValues([row]);

  // Notifica coordenador por e-mail
  if (emailCoordenador) {
    try {
      var urlChecklist = 'https://ifrs-riogrande.github.io/estagios/servidores/estagios-curso.html';
      MailApp.sendEmail({
        to: emailCoordenador,
        subject: '[SGE] Nova solicitação de Aproveitamento de Experiência Profissional — ' + nomeEstudante,
        body: 'Olá,\n\nO(a) estudante ' + nomeEstudante + ' (matrícula ' + String(rec.linha[COL_APROV.MATRICULA] || '') + ') do curso de ' + curso + ' submeteu uma solicitação de Aproveitamento de Experiência Profissional aguardando sua análise.\n\nAcesse o sistema para analisar e emitir o parecer:\n' + urlChecklist + '\n\nAtenciosamente,\nCentral de Estágios IFRS Campus Rio Grande',
      });
    } catch (eMail) { logErro_('_enviarSolicitacao_.mail', eMail); }
  }

  return jsonOk_({ id: idAprov, status: APROV_STATUS.AG_COORDENADOR });
}

function _responderCoordenador_(coord, body) {
  var idAprov = sanitizar_(body.id || '', 50);
  if (!idAprov) return jsonError_('Parâmetro id obrigatório.', 'MISSING_PARAM');

  var rec = _buscarAprovPorId_(idAprov);
  if (!rec) return jsonError_('Solicitação não encontrada.', 'NOT_FOUND');
  if (String(rec.linha[COL_APROV.STATUS]) !== APROV_STATUS.AG_COORDENADOR) {
    return jsonError_('Solicitação não está aguardando o coordenador.', 'INVALID_STATE');
  }

  // Verifica que o coordenador é do curso da solicitação
  var cursol = String(rec.linha[COL_APROV.CURSO] || '').toLowerCase();
  var cursosCoord = coord.curso.split(',').map(function(c) { return c.trim().toLowerCase(); });
  if (!cursosCoord.some(function(cc) { return cursol.indexOf(cc) !== -1 || cc.indexOf(cursol) !== -1; })) {
    return jsonError_('Você não é coordenador do curso desta solicitação.', 'AUTH_ERROR');
  }

  var decisao = sanitizar_(body.decisao || '', 30);
  if (decisao !== 'Favoravel' && decisao !== 'Desfavoravel') {
    return jsonError_('Decisão deve ser Favoravel ou Desfavoravel.', 'VALIDATION');
  }

  var parecer = {
    compativel:       body.compativel === true || body.compativel === 'true',
    justificativa:    sanitizar_(body.justificativa   || '', 2000),
    horasReconhecidas:sanitizar_(String(body.horasReconhecidas || ''), 10),
    decisao:          decisao,
    obs:              sanitizar_(body.obs || '', 1000),
  };

  var agora = new Date().toISOString();
  var hash  = Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    coord.email + idAprov + agora
  ).map(function(b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');

  var sheet = rec.sheet;
  var row   = sheet.getRange(rec.rowIdx, 1, 1, 44).getValues()[0];
  row[COL_APROV.STATUS]              = APROV_STATUS.AG_ADMIN;
  row[COL_APROV.PARECER_COORD_JSON]  = JSON.stringify(parecer);
  row[COL_APROV.ASSINATURA_COORD]    = hash;
  row[COL_APROV.DATA_ASSINATURA_COORD] = agora;
  sheet.getRange(rec.rowIdx, 1, 1, 44).setValues([row]);

  // Notifica admin
  try {
    var admins = (PropertiesService.getScriptProperties().getProperty('ADMIN_EMAILS') || '')
                   .split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    if (admins.length === 0) admins = CFG_ADMIN.ADMIN_EMAILS || [];
    if (admins.length > 0) {
      MailApp.sendEmail({
        to: admins.join(','),
        subject: '[SGE] Aproveitamento aguardando verificação — ' + String(rec.linha[COL_APROV.NOME_ESTUDANTE] || ''),
        body: 'O coordenador ' + coord.email + ' emitiu parecer na solicitação ' + idAprov + '.\n\nDecisão do coordenador: ' + decisao + '\n\nAcesse o sistema administrativo para verificar e encaminhar à DEN.',
      });
    }
  } catch (eMail) { logErro_('_responderCoordenador_.mail', eMail); }

  return jsonOk_({ id: idAprov, status: APROV_STATUS.AG_ADMIN });
}

function _devolverSolicitacao_(body, devolvidoPor) {
  var idAprov = sanitizar_(body.id || '', 50);
  if (!idAprov) return jsonError_('Parâmetro id obrigatório.', 'MISSING_PARAM');
  var obs = sanitizar_(body.obs || '', 1000);
  if (!obs) return jsonError_('Observação obrigatória ao devolver.', 'VALIDATION');

  var rec = _buscarAprovPorId_(idAprov);
  if (!rec) return jsonError_('Solicitação não encontrada.', 'NOT_FOUND');
  var statusAtual = String(rec.linha[COL_APROV.STATUS]);
  var statusPermitidos = devolvidoPor === 'admin'
    ? [APROV_STATUS.AG_ADMIN]
    : [APROV_STATUS.AG_COORDENADOR];
  if (statusPermitidos.indexOf(statusAtual) === -1) {
    return jsonError_('Solicitação não pode ser devolvida no status atual: ' + statusAtual, 'INVALID_STATE');
  }

  var agora = new Date().toISOString();
  var sheet = rec.sheet;
  var row   = sheet.getRange(rec.rowIdx, 1, 1, 44).getValues()[0];
  row[COL_APROV.STATUS]        = APROV_STATUS.DEVOLVIDO;
  row[COL_APROV.OBS_DEVOLUCAO] = obs;
  row[COL_APROV.DEVOLVIDO_POR] = devolvidoPor;
  row[COL_APROV.DATA_DEVOLUCAO]= agora;
  sheet.getRange(rec.rowIdx, 1, 1, 44).setValues([row]);

  // Notifica estudante
  try {
    var emailEst = String(rec.linha[COL_APROV.EMAIL_ESTUDANTE] || '');
    if (emailEst) {
      MailApp.sendEmail({
        to: emailEst,
        subject: '[SGE] Solicitação de Aproveitamento devolvida para ajuste — ' + idAprov,
        body: 'Olá ' + String(rec.linha[COL_APROV.NOME_ESTUDANTE] || '') + ',\n\nSua solicitação de Aproveitamento de Experiência Profissional foi devolvida para ajuste.\n\nMotivo: ' + obs + '\n\nAcesse o sistema para corrigir e reenviar:\nhttps://ifrs-riogrande.github.io/estagios/estudantes/aproveitamento.html\n\nAtenciosamente,\nCentral de Estágios IFRS Campus Rio Grande',
      });
    }
  } catch (eMail) { logErro_('_devolverSolicitacao_.mail', eMail); }

  return jsonOk_({ id: idAprov, status: APROV_STATUS.DEVOLVIDO });
}

function _encaminharDEN_(body) {
  var idAprov = sanitizar_(body.id || '', 50);
  if (!idAprov) return jsonError_('Parâmetro id obrigatório.', 'MISSING_PARAM');

  var rec = _buscarAprovPorId_(idAprov);
  if (!rec) return jsonError_('Solicitação não encontrada.', 'NOT_FOUND');
  if (String(rec.linha[COL_APROV.STATUS]) !== APROV_STATUS.AG_ADMIN) {
    return jsonError_('Solicitação não está aguardando o admin.', 'INVALID_STATE');
  }

  var agora = new Date().toISOString();
  var sheet = rec.sheet;
  var row   = sheet.getRange(rec.rowIdx, 1, 1, 44).getValues()[0];
  row[COL_APROV.STATUS]            = APROV_STATUS.AG_DEN;
  row[COL_APROV.OBS_ADMIN]         = sanitizar_(body.obs || '', 1000);
  row[COL_APROV.DATA_ENCAMINHAMENTO] = agora;
  sheet.getRange(rec.rowIdx, 1, 1, 44).setValues([row]);

  // Notifica DEN
  try {
    var cfgDen = _obterDiretoriaAdmin_('DEN');
    if (cfgDen.email) {
      MailApp.sendEmail({
        to: cfgDen.email,
        subject: '[SGE] Aproveitamento de Experiência Profissional aguardando parecer DEN — ' + String(rec.linha[COL_APROV.NOME_ESTUDANTE] || ''),
        body: 'Uma solicitação de Aproveitamento de Experiência Profissional foi encaminhada para análise da DEN.\n\nEstudante: ' + String(rec.linha[COL_APROV.NOME_ESTUDANTE] || '') + '\nCurso: ' + String(rec.linha[COL_APROV.CURSO] || '') + '\n\nAcesse o sistema:\nhttps://ifrs-riogrande.github.io/estagios/den/index.html\n\nAtenciosamente,\nSetor de Estágios IFRS Campus Rio Grande',
      });
    }
  } catch (eMail) { logErro_('_encaminharDEN_.mail', eMail); }

  return jsonOk_({ id: idAprov, status: APROV_STATUS.AG_DEN });
}

function _responderDEN_(emailDen, body) {
  var idAprov = sanitizar_(body.id || '', 50);
  if (!idAprov) return jsonError_('Parâmetro id obrigatório.', 'MISSING_PARAM');

  var rec = _buscarAprovPorId_(idAprov);
  if (!rec) return jsonError_('Solicitação não encontrada.', 'NOT_FOUND');
  if (String(rec.linha[COL_APROV.STATUS]) !== APROV_STATUS.AG_DEN) {
    return jsonError_('Solicitação não está aguardando a DEN.', 'INVALID_STATE');
  }

  var decisao = sanitizar_(body.decisao || '', 20);
  if (decisao !== 'Deferido' && decisao !== 'Indeferido') {
    return jsonError_('Decisão deve ser Deferido ou Indeferido.', 'VALIDATION');
  }

  var horasHomologadas = sanitizar_(String(body.horasHomologadas || ''), 10);
  if (decisao === 'Deferido' && !horasHomologadas) {
    return jsonError_('Carga horária homologada obrigatória para deferimento.', 'VALIDATION');
  }

  var parecer = {
    decisao:          decisao,
    justificativa:    sanitizar_(body.justificativa || '', 2000),
    horasHomologadas: horasHomologadas,
  };

  var agora = new Date().toISOString();
  var hash  = Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    emailDen + idAprov + agora
  ).map(function(b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');

  var sheet = rec.sheet;
  var row   = sheet.getRange(rec.rowIdx, 1, 1, 44).getValues()[0];
  row[COL_APROV.STATUS]           = decisao === 'Deferido' ? APROV_STATUS.DEFERIDO : APROV_STATUS.INDEFERIDO;
  row[COL_APROV.PARECER_DEN_JSON] = JSON.stringify(parecer);
  row[COL_APROV.ASSINATURA_DEN]   = hash;
  row[COL_APROV.DATA_ASSINATURA_DEN] = agora;
  row[COL_APROV.CARGA_HOMOLOGADA] = horasHomologadas;
  sheet.getRange(rec.rowIdx, 1, 1, 44).setValues([row]);

  // Se deferido: registra na aba de estágios como estágio obrigatório cumprido
  if (decisao === 'Deferido') {
    try {
      _registrarAproveitamentoComoEstagio_(rec.linha, horasHomologadas, agora);
    } catch (eReg) { logErro_('_responderDEN_.registrar', eReg); }
  }

  // Notifica estudante
  try {
    var emailEst = String(rec.linha[COL_APROV.EMAIL_ESTUDANTE] || '');
    if (emailEst) {
      var msg = decisao === 'Deferido'
        ? 'Parabéns! Sua solicitação de Aproveitamento de Experiência Profissional foi DEFERIDA.\n\nCarga horária homologada: ' + horasHomologadas + ' horas.\n\nO aproveitamento foi registrado como estágio obrigatório cumprido em seu histórico.'
        : 'Sua solicitação de Aproveitamento de Experiência Profissional foi INDEFERIDA.\n\nJustificativa: ' + (parecer.justificativa || 'Não informada') + '\n\nPara mais informações, entre em contato com o setor de estágios.';
      MailApp.sendEmail({
        to: emailEst,
        subject: '[SGE] Resultado do Aproveitamento de Experiência Profissional — ' + idAprov,
        body: 'Olá ' + String(rec.linha[COL_APROV.NOME_ESTUDANTE] || '') + ',\n\n' + msg + '\n\nAtenciosamente,\nCentral de Estágios IFRS Campus Rio Grande',
      });
    }
  } catch (eMail) { logErro_('_responderDEN_.mail', eMail); }

  return jsonOk_({ id: idAprov, status: row[COL_APROV.STATUS] });
}

/**
 * Registra o aproveitamento deferido como estágio obrigatório cumprido.
 * Insere uma entrada na aba Solicitações com status "Concluído (Aproveitamento)".
 */
function _registrarAproveitamentoComoEstagio_(linha, horasHomologadas, dataConc) {
  var ss         = SpreadsheetApp.openById(CFG_APROV.SS_ID);
  var sheetSol   = ss.getSheetByName('Solicitações');
  if (!sheetSol) return;

  // Gera um ID de estágio para o registro histórico
  var idEstagio  = gerarIdEstagio_();
  var novaLinha  = new Array(60).fill('');

  novaLinha[COL_SOL.ID_ESTAGIO]       = idEstagio;
  novaLinha[COL_SOL.STATUS]           = 'Concluído (Aproveitamento)';
  novaLinha[COL_SOL.NOME_ESTUDANTE]   = String(linha[COL_APROV.NOME_ESTUDANTE]  || '');
  novaLinha[COL_SOL.EMAIL_ESTUDANTE]  = String(linha[COL_APROV.EMAIL_ESTUDANTE] || '');
  novaLinha[COL_SOL.MATRICULA]        = String(linha[COL_APROV.MATRICULA]        || '');
  novaLinha[COL_SOL.CURSO]            = String(linha[COL_APROV.CURSO]            || '');
  novaLinha[COL_SOL.TIPO_ESTAGIO]     = 'Obrigatório';
  novaLinha[COL_SOL.CARGA_HOR]        = horasHomologadas;
  novaLinha[COL_SOL.DATA_INICIO]      = dataConc;
  novaLinha[COL_SOL.DATA_TERMINO]     = dataConc;
  novaLinha[COL_SOL.OBS_SETOR]        = 'Aproveitamento de Experiência Profissional — ' + String(linha[COL_APROV.ID] || '');

  sheetSol.appendRow(novaLinha);
}
