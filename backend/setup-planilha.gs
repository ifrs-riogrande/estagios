/**
 * setup-planilha.gs — Inicialização da planilha consolidada do SGE
 * SGE — Sistema de Gestão de Estágios · IFRS Campus Rio Grande
 *
 * Execute UMA VEZ pelo editor do Apps Script:
 *   Selecione a função "configurarPlanilha" e clique em Executar (▶)
 *
 * O que faz:
 *   1. Apaga todas as abas existentes (exceto as vinculadas a formulários)
 *   2. Cria todas as abas do SGE com cabeçalhos
 */

function configurarPlanilha() {
  var ss = SpreadsheetApp.openById('1zVyseifVC6xeMpNjqwYd6jCq9HTJ2NS8BlN1dtM4s7Y');

  // ── 1. Define as abas e seus cabeçalhos ────────────────────────────
  var abas = [

    {
      nome: 'Solicitações',
      cabecalho: [
        'Timestamp', 'ID Estágio', 'E-mail Estudante', 'Nome Estudante',
        'Matrícula', 'Curso', 'CPF', 'Data Nasc.', 'Telefone',
        'Tipo Estágio', 'Nome Empresa', 'CNPJ Empresa',
        'Nome Supervisor', 'E-mail Supervisor', 'Nome Agente',
        'Nome Orientador', 'E-mail Orientador',
        'Data Início', 'Data Término', 'Carga Horária',
        'Horário', 'Remunerado', 'Valor Bolsa', 'Valor Transporte',
        'Plano de Atividades', 'Link Doc. Matrícula', 'Link Doc. Identidade',
        'Link Doc. Boletim', 'Status', 'Obs. Setor', 'Motivo Reprovação',
        'Drive URL', 'Data Aprovação', 'Data Doc. Enviado', 'Data Ativação',
        'Objetivos', 'Formando',
        'Turno', 'Semestre', 'E-mail Inst. Estágio',
        'Nome Responsável', 'CPF Responsável', 'Tel. Responsável',
        'NEE',
        'Token Aceite Orientador', // 44 TOKEN_ACEITE_ORI — UUID de uso único, apagado após resposta
      ],
    },

    {
      nome: 'Estudantes',
      cabecalho: [
        'Timestamp', 'Nome', 'E-mail Institucional', 'E-mail Pessoal',
        'Matrícula', 'Curso', 'Turno', 'Semestre', 'CPF', 'Data Nasc.',
        'Telefone', 'Endereço', 'Maior de Idade',
        'Nome Responsável', 'CPF Responsável', 'Tel. Responsável',
        'E-mail Responsável', 'Doc. Responsável',
        'Status', 'Código Acesso', 'Expira Código',
        'Modalidade', 'Bairro', 'CEP', 'Cidade', 'UF',
        'Cursos JSON', 'NEE',
      ],
    },

    {
      nome: 'Empresas',
      cabecalho: [
        'Timestamp', 'E-mail Form.', 'Tipo', 'Razão Social', 'Nome Fantasia',
        'CNPJ/CPF', 'Ramo', 'Endereço', 'Bairro', 'Município', 'UF', 'CEP',
        'Telefone', 'E-mail', 'Site',
        'Nome Representante', 'Cargo Representante', 'E-mail Representante',
        'CPF Representante', 'Status', 'Código de Acesso', 'Drive Documentos',
      ],
    },

    {
      nome: 'Supervisores',
      // 24 colunas — espelhando COL_SUP em api-empresas.gs (índices 0–23)
      cabecalho: [
        'Timestamp',          // 0  TIMESTAMP
        'E-mail Form.',       // 1  EMAIL_FORM
        'Tipo',               // 2  TIPO
        'Nome Empresa',       // 3  EMPRESA
        'Setor',              // 4  SETOR
        'Endereço Setor',     // 5  ENDERECO_SETOR
        'E-mail Setor',       // 6  EMAIL_SETOR_SUP
        'Tel. Setor',         // 7  TEL_SETOR
        'Nome',               // 8  NOME
        'CPF',                // 9  CPF
        'Cargo',              // 10 CARGO
        'Telefone',           // 11 TEL_SUP
        'E-mail',             // 12 EMAIL_SUP
        'Nível Formação',     // 13 NIVEL_FORMACAO
        'Área Formação',      // 14 AREA_FORMACAO
        'Instituição',        // 15 INSTITUICAO
        'Tempo Experiência',  // 16 TEMPO_EXP
        'Descrição Experiência', // 17 DESC_EXP
        'Declaração',         // 18 DECLARACAO
        'Status',             // 19 STATUS
        'Validado Por',       // 20 VALIDADO_POR
        'Data Validação',     // 21 DATA_VALIDACAO
        'Observações',        // 22 OBSERVACOES
        'Data Ult. Atualização', // 23 DATA_ULT_ATZ
        'Código de Acesso',  // 24 CODIGO_ACESSO
      ],
    },

    {
      nome: 'Orientadores',
      cabecalho: [
        'Timestamp', 'Tipo Vínculo', 'Início Contrato', 'Fim Contrato',
        'Nome', 'CPF', 'SIAPE', 'Telefone',
        'E-mail', 'Titulação', 'Área de Formação', 'Cursos', 'Status', 'Obs. Rejeição',
      ],
    },

    {
      nome: 'Coordenadores',
      cabecalho: [
        'CPF', 'Matrícula SIAPE', 'Nome', 'E-mail',
        'Telefone', 'Titulação', 'Curso', 'Timestamp', 'Status', 'Portaria',
      ],
    },

    {
      nome: 'Agentes',
      // 14 colunas — espelhando COL_AGT em api-agentes.gs (índices 0–13)
      cabecalho: [
        'Timestamp',        // 0  TIMESTAMP
        'Tipo',             // 1  TIPO
        'Nome',             // 2  NOME
        'Sigla',            // 3  SIGLA
        'CNPJ',             // 4  CNPJ
        'Site',             // 5  SITE
        'Telefone',         // 6  TEL
        'E-mail',           // 7  EMAIL
        'Nº Edital',        // 8  NUM_EDITAL
        'Período Vigência', // 9  PERIODO
        'Link Edital',      // 10 LINK_EDITAL
        'Observações',      // 11 OBS
        'Status',           // 12 STATUS
        'Cadastrado Por',   // 13 CADASTRADO_POR
      ],
    },

    {
      nome: 'Relatórios Parciais',
      cabecalho: [
        'Timestamp', 'ID Estágio', 'E-mail Estudante', 'Período Ref.',
        'Atividades Realizadas', 'Aprendizagens', 'Relação com o Curso',
        'Avaliação Geral', 'Dificuldades', 'Sugestões',
      ],
    },

    {
      nome: 'Relatórios Finais',
      cabecalho: [
        'Timestamp', 'ID Estágio', 'E-mail Estudante', 'Data Encerramento',
        'Resumo Atividades', 'Competências', 'Contribuição Formação',
        'Aval. Concedente', 'Aval. Orientador', 'Recomendaria', 'Considerações',
      ],
    },

    {
      nome: 'Adendos',
      cabecalho: [
        'Timestamp', 'ID Estágio', 'E-mail Estudante', 'Tipo de Adendo',
        'Nova Data Término', 'Nova Carga Horária', 'Novo Horário',
        'Justificativa', 'Observações', 'Status',
      ],
    },

    {
      nome: 'Diretor Geral',
      cabecalho: ['Nome', 'SIAPE', 'CPF', 'E-mail', 'Status'],
    },

    {
      nome: 'Oportunidades',
      cabecalho: [
        'Timestamp', 'Título', 'Empresa', 'CNPJ', 'Área', 'Curso',
        'Tipo Estágio', 'Descrição', 'Requisitos', 'Carga Horária',
        'Valor Bolsa', 'Benefícios', 'Contato', 'Status',
      ],
    },

    // ── Log de Alterações ─────────────────────────────────────────────────
    {
      nome: 'Log de Alterações',
      // 8 colunas — usadas por registrarLog_() em api-empresas.gs
      cabecalho: [
        'Timestamp', 'CNPJ', 'Razão Social', 'Tipo',
        'Campo', 'Valor Anterior', 'Valor Novo', 'Alterado Por',
      ],
    },

    // ── Fluxo de Checklist ─────────────────────────────────────────────────
    {
      nome: 'Checklists',
      cabecalho: [
        'ID Estágio', 'Status Geral', 'Etapa Ativa',
        'Admin Status', 'Admin Data', 'Admin Obs',
        'Orientador Status', 'Orientador Data', 'Orientador Obs',
        'Coordenador Status', 'Coordenador Data', 'Coordenador Obs',
        'Empresa Status', 'Empresa Data', 'Empresa Obs',
        'Supervisor Status', 'Supervisor Data', 'Supervisor Obs',
        'Prazo Admin', 'Prazo Orientador', 'Prazo Coordenador',
        'Prazo Empresa', 'Prazo Supervisor',
        'Ts Criação', 'Ts Conclusão',
      ],
    },

    // ── Fluxo de Assinaturas ───────────────────────────────────────────────
    {
      nome: 'Fluxo TCE',
      cabecalho: [
        'ID Estágio', 'Status Geral', 'Etapa Atual', 'Drive Pasta ID',
        'E1 Estudante Status',      'E1 Data', 'E1 Drive URL',
        'E2 Empresa Status',        'E2 Data', 'E2 Drive URL',
        'E3 Supervisor Status',     'E3 Data', 'E3 Drive URL',
        'E4 Orientador Status',     'E4 Data', 'E4 Drive URL',
        'E5 Coordenador Status',    'E5 Data', 'E5 Drive URL',
        'E6 Central Revisão Status','E6 Data', 'E6 Drive URL',
        'E7 Direção Status',        'E7 Data', 'E7 Drive URL',
        'E8 Central Final Status',  'E8 Data', 'E8 Drive URL',
        'Ts Criação', 'Ts Conclusão',
      ],
    },

  ];

  // ── 2. Usa a primeira aba como âncora (renomeia com timestamp único) ─
  //    Nunca deleta a última aba — o Google não permite
  var sheets       = ss.getSheets();
  var anchorName   = 'SGE_SETUP_' + Date.now();
  var anchor       = sheets[0];
  anchor.setName(anchorName);

  // ── 3. Deleta todas as outras abas existentes ───────────────────────
  var ignoradas = [];
  for (var i = 1; i < sheets.length; i++) {
    try {
      ss.deleteSheet(sheets[i]);
    } catch (e) {
      // Aba vinculada a formulário — limpa e renomeia
      ignoradas.push(sheets[i].getName());
      sheets[i].clearContents();
      sheets[i].clearFormats();
      sheets[i].setName('_legado_' + i);
    }
  }

  // ── 4. Cria cada aba do SGE com cabeçalho formatado ─────────────────
  abas.forEach(function (aba) {
    // Se já existe uma aba com esse nome (de execução parcial anterior), remove primeiro
    var existente = ss.getSheetByName(aba.nome);
    if (existente) {
      try { ss.deleteSheet(existente); } catch (e) { /* ignora */ }
    }

    var sheet = ss.insertSheet(aba.nome);
    var range = sheet.getRange(1, 1, 1, aba.cabecalho.length);
    range.setValues([aba.cabecalho]);
    range.setFontWeight('bold');
    range.setBackground('#1a73e8');
    range.setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 160);
  });

  // ── 5. Remove a aba âncora ──────────────────────────────────────────
  var anchorSheet = ss.getSheetByName(anchorName);
  if (anchorSheet) ss.deleteSheet(anchorSheet);

  // ── 6. Mensagem de confirmação ──────────────────────────────────────
  var aviso = ignoradas.length > 0
    ? '\n⚠️ Abas vinculadas a formulários (não deletadas, apenas esvaziadas):\n' +
      ignoradas.map(function (n) { return '  • ' + n; }).join('\n')
    : '';

  Logger.log(
    '✅ Planilha configurada com sucesso!\n' +
    abas.length + ' abas criadas:\n' +
    abas.map(function (a) { return '  • ' + a.nome; }).join('\n') +
    aviso +
    '\nPróximo passo: preencha a aba "Diretor Geral" com os dados do DG.'
  );
}

/**
 * Adiciona a coluna "Portaria" (col 10) à aba Coordenadores na planilha existente,
 * sem apagar dados. Execute manualmente: Executar → corrigirCabecalhoCoordenadores
 */
function corrigirCabecalhoCoordenadores() {
  var ss    = SpreadsheetApp.openById('1zVyseifVC6xeMpNjqwYd6jCq9HTJ2NS8BlN1dtM4s7Y');
  var sheet = ss.getSheetByName('Coordenadores');
  if (!sheet) { Logger.log('❌ Aba Coordenadores não encontrada.'); return; }

  var cabecalho = [
    'CPF', 'Matrícula SIAPE', 'Nome', 'E-mail',
    'Telefone', 'Titulação', 'Curso', 'Timestamp', 'Status', 'Portaria',
  ];

  var range = sheet.getRange(1, 1, 1, cabecalho.length);
  range.setValues([cabecalho]);
  range.setFontWeight('bold');
  range.setBackground('#1a73e8');
  range.setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  // Garante que a col 10 existe
  if (sheet.getMaxColumns() < 10) sheet.insertColumnsAfter(sheet.getMaxColumns(), 10 - sheet.getMaxColumns());
  Logger.log('✅ Cabeçalho da aba Coordenadores atualizado com coluna Portaria.');
}

/**
 * Corrige apenas o cabeçalho da aba Orientadores na planilha existente.
 * Execute manualmente no editor GAS: Executar → corrigirCabecalhoOrientadores
 */
function corrigirCabecalhoOrientadores_() {
  var ss    = SpreadsheetApp.openById('1zVyseifVC6xeMpNjqwYd6jCq9HTJ2NS8BlN1dtM4s7Y');
  var sheet = ss.getSheetByName('Orientadores');
  if (!sheet) return jsonError_('Aba Orientadores não encontrada.', 'NOT_FOUND');

  var cabecalho = [
    'Timestamp', 'Tipo Vínculo', 'Início Contrato', 'Fim Contrato',
    'Nome', 'CPF', 'SIAPE', 'Telefone',
    'E-mail', 'Titulação', 'Área de Formação', 'Cursos', 'Status',
  ];

  var range = sheet.getRange(1, 1, 1, cabecalho.length);
  range.setValues([cabecalho]);
  range.setFontWeight('bold');
  range.setBackground('#1a73e8');
  range.setFontColor('#ffffff');
  sheet.setFrozenRows(1);

  return jsonOk_({ mensagem: 'Cabeçalho corrigido.' });
}

/**
 * Corrige/atualiza o cabeçalho da aba Solicitações para incluir as colunas
 * Turno (37), Semestre (38), E-mail Inst. Estágio (39),
 * Nome Responsável (40), CPF Responsável (41), Tel. Responsável (42).
 * Execute via rota GET temporária ou manualmente no editor GAS.
 */
function corrigirCabecalhoSolicitacoes_() {
  var ss    = SpreadsheetApp.openById('1zVyseifVC6xeMpNjqwYd6jCq9HTJ2NS8BlN1dtM4s7Y');
  var sheet = ss.getSheetByName('Solicitações');
  if (!sheet) return jsonError_('Aba Solicitações não encontrada.', 'NOT_FOUND');

  var cabecalho = [
    'Timestamp', 'ID Estágio', 'E-mail Estudante', 'Nome Estudante',
    'Matrícula', 'Curso', 'CPF', 'Data Nasc.', 'Telefone',
    'Tipo Estágio', 'Nome Empresa', 'CNPJ Empresa',
    'Nome Supervisor', 'E-mail Supervisor', 'Nome Agente',
    'Nome Orientador', 'E-mail Orientador',
    'Data Início', 'Data Término', 'Carga Horária',
    'Horário', 'Remunerado', 'Valor Bolsa', 'Valor Transporte',
    'Plano de Atividades', 'Link Doc. Matrícula', 'Link Doc. Identidade',
    'Link Doc. Boletim', 'Status', 'Obs. Setor', 'Motivo Reprovação',
    'Drive URL', 'Data Aprovação', 'Data Doc. Enviado', 'Data Ativação',
    'Objetivos', 'Formando',
    'Turno', 'Semestre', 'E-mail Inst. Estágio',
    'Nome Responsável', 'CPF Responsável', 'Tel. Responsável',
    'NEE',
  ];

  var range = sheet.getRange(1, 1, 1, cabecalho.length);
  range.setValues([cabecalho]);
  range.setFontWeight('bold');
  range.setBackground('#1a73e8');
  range.setFontColor('#ffffff');
  sheet.setFrozenRows(1);

  return jsonOk_({ mensagem: 'Cabeçalho de Solicitações corrigido com sucesso.' });
}

/**
 * Adiciona as colunas novas à planilha existente SEM apagar dados.
 * - Estudantes: col 27 = Cursos JSON (se ausente), col 28 = NEE (se ausente)
 * - Solicitações: col 44 = NEE (se ausente)
 *
 * Execute manualmente no editor GAS: Executar → adicionarColunasNEE
 */
function adicionarColunasNEE() {
  var ss = SpreadsheetApp.openById('1zVyseifVC6xeMpNjqwYd6jCq9HTJ2NS8BlN1dtM4s7Y');

  // ── Estudantes ──────────────────────────────────────────────────────
  var shEst = ss.getSheetByName('Estudantes');
  if (shEst) {
    var cabEst = shEst.getRange(1, 1, 1, shEst.getLastColumn()).getValues()[0];

    // col 27 = índice 26 = Cursos JSON
    if (cabEst[26] !== 'Cursos JSON') {
      shEst.getRange(1, 27).setValue('Cursos JSON');
      _formatarCelulaCabecalho_(shEst, 27);
    }
    // col 28 = índice 27 = NEE
    if (cabEst[27] !== 'NEE') {
      shEst.getRange(1, 28).setValue('NEE');
      _formatarCelulaCabecalho_(shEst, 28);
    }
  }

  // ── Solicitações ────────────────────────────────────────────────────
  var shSol = ss.getSheetByName('Solicitações');
  if (shSol) {
    var cabSol = shSol.getRange(1, 1, 1, shSol.getLastColumn()).getValues()[0];

    // col 44 = índice 43 = NEE
    if (cabSol[43] !== 'NEE') {
      shSol.getRange(1, 44).setValue('NEE');
      _formatarCelulaCabecalho_(shSol, 44);
    }
  }

  Logger.log('✅ Colunas adicionadas! • Estudantes: Cursos JSON (col 27) e NEE (col 28) • Solicitações: NEE (col 44)');
}

/**
 * Adiciona a aba "Avaliações" à planilha existente SEM apagar dados.
 * Execute manualmente no editor GAS: Executar → adicionarAbaAvaliacoes
 */
function adicionarAbaAvaliacoes() {
  var ss    = SpreadsheetApp.openById('1zVyseifVC6xeMpNjqwYd6jCq9HTJ2NS8BlN1dtM4s7Y');
  var nome  = 'Avaliações';

  if (ss.getSheetByName(nome)) {
    Logger.log('⚠️ Aba "' + nome + '" já existe — ignorada.');
    return;
  }

  var cabecalho = [
    'Timestamp',          // 0  TIMESTAMP
    'Aval ID',            // 1  AVAL_ID
    'ID Estágio',         // 2  ID_ESTAGIO
    'Tipo',               // 3  TIPO
    'Período',            // 4  PERIODO
    'Período Ref.',       // 5  PERIODO_REF
    'Status',             // 6  STATUS
    'E-mail Preenchedor', // 7  EMAIL_PREENCHEDOR
    'E-mail Revisor',     // 8  EMAIL_REVISOR
    'Dados Formulário',   // 9  DADOS_FORM   (JSON)
    'PDF Gerado URL',     // 10 PDF_GERADO_URL
    'PDF Assinado 1 URL', // 11 PDF_ASSINADO_1_URL
    'PDF Assinado 2 URL', // 12 PDF_ASSINADO_2_URL
    'Drive Pasta ID',     // 13 DRIVE_PASTA_ID
    'Ts Início',          // 14 TS_INICIO
    'Ts Preenchimento',   // 15 TS_PREENCHIMENTO
    'Ts Assinatura 1',    // 16 TS_ASSINATURA_1
    'Ts Assinatura 2',    // 17 TS_ASSINATURA_2
    'Ts Conclusão',       // 18 TS_CONCLUSAO
  ];

  var sheet = ss.insertSheet(nome);
  var range = sheet.getRange(1, 1, 1, cabecalho.length);
  range.setValues([cabecalho]);
  range.setFontWeight('bold');
  range.setBackground('#1a73e8');
  range.setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 160);  // Timestamp
  sheet.setColumnWidth(2, 220);  // Aval ID
  sheet.setColumnWidth(3, 160);  // ID Estágio

  Logger.log('✅ Aba "' + nome + '" criada com ' + cabecalho.length + ' colunas.');
  Logger.log('Execute adicionarAbaAvaliacoes apenas uma vez.');
}

function _formatarCelulaCabecalho_(sheet, col) {
  var cell = sheet.getRange(1, col);
  cell.setFontWeight('bold');
  cell.setBackground('#1a73e8');
  cell.setFontColor('#ffffff');
}

/**
 * Adiciona as colunas novas à aba Empresas SEM apagar dados existentes.
 * - col 25 = Registro Profissional (se ausente)
 * - col 26 = Bloco de Produtor    (se ausente)
 *
 * Renomeia também a coluna CNPJ → CNPJ/CPF para refletir suporte a CPF.
 *
 * Execute manualmente no editor GAS: Executar → adicionarColunasEmpresa
 */
function adicionarColunasEmpresa() {
  var ss = SpreadsheetApp.openById('1zVyseifVC6xeMpNjqwYd6jCq9HTJ2NS8BlN1dtM4s7Y');
  var sh = ss.getSheetByName('Empresas');
  if (!sh) { Logger.log('❌ Aba Empresas não encontrada.'); return; }

  var cab = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];

  // Renomeia col 6 (CNPJ → CNPJ/CPF) se ainda for 'CNPJ'
  if (cab[5] === 'CNPJ') {
    sh.getRange(1, 6).setValue('CNPJ/CPF');
    _formatarCelulaCabecalho_(sh, 6);
  }

  // col 25 = índice 24 = Registro Profissional
  if (cab[24] !== 'Registro Profissional') {
    sh.getRange(1, 25).setValue('Registro Profissional');
    _formatarCelulaCabecalho_(sh, 25);
  }

  // col 26 = índice 25 = Bloco de Produtor
  if (cab[25] !== 'Bloco de Produtor') {
    sh.getRange(1, 26).setValue('Bloco de Produtor');
    _formatarCelulaCabecalho_(sh, 26);
  }

  Logger.log('✅ Colunas Empresas atualizadas! • CNPJ→CNPJ/CPF (col 6) • Registro Profissional (col 25) • Bloco de Produtor (col 26)');
}

/**
 * Adiciona as abas "Checklists" e "Fluxo TCE" à planilha existente SEM apagar dados.
 * Execute manualmente no editor GAS: Executar → adicionarAbasFluxo
 */
function adicionarAbasFluxo() {
  var ss = SpreadsheetApp.openById('1zVyseifVC6xeMpNjqwYd6jCq9HTJ2NS8BlN1dtM4s7Y');

  var novasAbas = [
    {
      nome: 'Checklists',
      cabecalho: [
        'ID Estágio', 'Status Geral', 'Etapa Ativa',
        'Admin Status', 'Admin Data', 'Admin Obs',
        'Orientador Status', 'Orientador Data', 'Orientador Obs',
        'Coordenador Status', 'Coordenador Data', 'Coordenador Obs',
        'Empresa Status', 'Empresa Data', 'Empresa Obs',
        'Supervisor Status', 'Supervisor Data', 'Supervisor Obs',
        'Prazo Admin', 'Prazo Orientador', 'Prazo Coordenador',
        'Prazo Empresa', 'Prazo Supervisor',
        'Ts Criação', 'Ts Conclusão',
      ],
    },
    {
      nome: 'Fluxo TCE',
      cabecalho: [
        'ID Estágio', 'Status Geral', 'Etapa Atual', 'Drive Pasta ID',
        'E1 Estudante Status',       'E1 Data', 'E1 Drive URL',
        'E2 Empresa Status',         'E2 Data', 'E2 Drive URL',
        'E3 Supervisor Status',      'E3 Data', 'E3 Drive URL',
        'E4 Orientador Status',      'E4 Data', 'E4 Drive URL',
        'E5 Coordenador Status',     'E5 Data', 'E5 Drive URL',
        'E6 Central Revisão Status', 'E6 Data', 'E6 Drive URL',
        'E7 Direção Status',         'E7 Data', 'E7 Drive URL',
        'E8 Central Final Status',   'E8 Data', 'E8 Drive URL',
        'Ts Criação', 'Ts Conclusão',
      ],
    },
  ];

  novasAbas.forEach(function (aba) {
    if (ss.getSheetByName(aba.nome)) {
      Logger.log('⚠️ Aba "' + aba.nome + '" já existe — ignorada.');
      return;
    }
    var sheet = ss.insertSheet(aba.nome);
    var range = sheet.getRange(1, 1, 1, aba.cabecalho.length);
    range.setValues([aba.cabecalho]);
    range.setFontWeight('bold');
    range.setBackground('#1a73e8');
    range.setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 160);
    Logger.log('✅ Aba "' + aba.nome + '" criada com ' + aba.cabecalho.length + ' colunas.');
  });

  Logger.log('Concluído. Execute adicionarAbasFluxo apenas uma vez.');
}

/**
 * Adiciona a coluna "Token Aceite Orientador" (col 45, índice 44) à aba Solicitações
 * SEM apagar dados existentes.
 * Execute manualmente no editor GAS: Executar → adicionarColunaTokenAceite
 */
function adicionarColunaTokenAceite() {
  var ss    = SpreadsheetApp.openById('1zVyseifVC6xeMpNjqwYd6jCq9HTJ2NS8BlN1dtM4s7Y');
  var sheet = ss.getSheetByName('Solicitações');
  if (!sheet) { Logger.log('❌ Aba Solicitações não encontrada.'); return; }

  var cab = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (cab[44] === 'Token Aceite Orientador') {
    Logger.log('✅ Coluna já existe na posição 45.');
    return;
  }

  sheet.getRange(1, 45).setValue('Token Aceite Orientador');
  _formatarCelulaCabecalho_(sheet, 45);
  Logger.log('✅ Coluna "Token Aceite Orientador" adicionada na col 45 da aba Solicitações.');
}

/**
 * Cria a aba "Pareceres" na planilha.
 * Execute manualmente no editor GAS: Executar → adicionarAbaPareceres
 */
/**
 * Cria a aba "Aproveitamento" e configura APROVEITAMENTO_FOLDER_ID.
 * Execute UMA VEZ pelo editor do Apps Script.
 * Antes de executar, substitua o valor de FOLDER_ID abaixo pelo ID real da pasta no Drive.
 */
function setupAproveitamento() {
  var SS_ID     = '1zVyseifVC6xeMpNjqwYd6jCq9HTJ2NS8BlN1dtM4s7Y';
  var FOLDER_ID = '1b2lD0Br77kyfUDKY1WJG65bhZbAWXmGX';

  // 1. Cria a aba Aproveitamento
  var ss   = SpreadsheetApp.openById(SS_ID);
  var nome = 'Aproveitamento';
  var sheet = ss.getSheetByName(nome);
  if (sheet) {
    Logger.log('⚠️  Aba "' + nome + '" já existe — cabeçalho não reescrito.');
  } else {
    sheet = ss.insertSheet(nome);
    var cab = [
      'ID','Timestamp','Status',
      'E-mail Estudante','Nome Estudante','Matrícula','Curso','CPF','RG',
      'Telefone','Endereço','Bairro','Cidade','Estado','Data Nasc.','Formando',
      'Tipo Vínculo','Empresas JSON','Total Horas','Declaração Veracidade',
      'Assinatura Estudante','Data Assinatura Est.',
      'Relatório JSON',
      'Doc Matrícula URL','Doc CTPS-ID URL','Doc CTPS-Reg URL',
      'Doc Declaração URL','Doc Autônomo URL','Drive URL',
      'E-mail Coordenador','Parecer Coord. JSON','Assinatura Coord.','Data Assinatura Coord.',
      'Obs Admin','Data Encaminhamento',
      'Parecer DEN JSON','Assinatura DEN','Data Assinatura DEN','Carga Homologada',
      'Obs Devolução','Devolvido Por','Data Devolução',
    ];
    sheet.getRange(1, 1, 1, cab.length).setValues([cab]);
    cab.forEach(function(_, i) { _formatarCelulaCabecalho_(sheet, i + 1); });
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 160);
    Logger.log('✅ Aba "' + nome + '" criada com ' + cab.length + ' colunas.');
  }

  // 2. Configura APROVEITAMENTO_FOLDER_ID no PropertiesService
  if (!FOLDER_ID) {
    Logger.log('⚠️  FOLDER_ID não configurado.');
    return;
  }
  PropertiesService.getScriptProperties().setProperty('APROVEITAMENTO_FOLDER_ID', FOLDER_ID);
  Logger.log('✅ APROVEITAMENTO_FOLDER_ID configurado: ' + FOLDER_ID);
  Logger.log('🎉 Setup de Aproveitamento concluído!');
}

function adicionarAbaPareceres() {
  var ss   = SpreadsheetApp.openById('1zVyseifVC6xeMpNjqwYd6jCq9HTJ2NS8BlN1dtM4s7Y');
  var nome = 'Pareceres';
  if (ss.getSheetByName(nome)) { Logger.log('⚠️ Aba "' + nome + '" já existe.'); return; }
  var sheet = ss.insertSheet(nome);
  var cab   = [
    'Timestamp','Parecer ID','ID Estágio','Status','Tipo Diretoria','Ciclo',
    'Aluno','Curso','Total Horas','Modalidade',
    'E-mail Coordenador','E-mail Diretoria',
    'Parecer Coordenador','Parecer Diretoria',
    'PDF URL','Ts Início','Ts Coord.','Ts Diretoria','Ts Conclusão'
  ];
  sheet.getRange(1, 1, 1, cab.length).setValues([cab]);
  cab.forEach(function(_, i) { _formatarCelulaCabecalho_(sheet, i + 1); });
  sheet.setFrozenRows(1);
  Logger.log('✅ Aba "' + nome + '" criada com ' + cab.length + ' colunas.');
}
