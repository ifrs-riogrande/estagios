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
  var ss = SpreadsheetApp.getActiveSpreadsheet();

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
      ],
    },

    {
      nome: 'Empresas',
      cabecalho: [
        'Timestamp', 'E-mail Form.', 'Tipo', 'Razão Social', 'Nome Fantasia',
        'CNPJ', 'Ramo', 'Endereço', 'Município', 'UF', 'CEP',
        'Telefone', 'E-mail', 'Site',
        'Nome Representante', 'Cargo Representante', 'E-mail Representante',
        'CPF Representante', 'Status',
      ],
    },

    {
      nome: 'Supervisores',
      cabecalho: [
        'Timestamp', 'E-mail Form.', 'CNPJ Empresa', 'Nome Empresa',
        'Setor', 'Cargo', 'Formação', 'Área de Formação',
        'Nome', 'Registro Prof.', 'Tipo Vínculo',
        'Telefone', 'E-mail', 'Nível Formação', 'Área Formação', 'Status',
      ],
    },

    {
      nome: 'Orientadores',
      cabecalho: [
        'Timestamp', 'Tipo Vínculo', 'Início Contrato', 'Fim Contrato',
        'Nome', 'CPF', 'SIAPE', 'Telefone',
        'E-mail', 'Titulação', 'Área de Formação', 'Cursos', 'Status',
      ],
    },

    {
      nome: 'Coordenadores',
      cabecalho: [
        'CPF', 'Matrícula SIAPE', 'Nome', 'E-mail',
        'Telefone', 'Titulação', 'Curso', 'Timestamp', 'Status',
      ],
    },

    {
      nome: 'Agentes',
      cabecalho: [
        'CNPJ', 'Nome Agente', 'Nome Responsável', 'Cargo Responsável',
        'E-mail', 'Telefone', 'Endereço', 'Status',
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
    ? '\n\n⚠️ Abas vinculadas a formulários (não deletadas, apenas esvaziadas):\n' +
      ignoradas.map(function (n) { return '• ' + n; }).join('\n')
    : '';

  SpreadsheetApp.getUi().alert(
    '✅ Planilha configurada com sucesso!\n\n' +
    abas.length + ' abas criadas:\n' +
    abas.map(function (a) { return '• ' + a.nome; }).join('\n') +
    aviso +
    '\n\nPróximo passo: preencha a aba "Diretor Geral" com os dados do DG.'
  );
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
  ];

  var range = sheet.getRange(1, 1, 1, cabecalho.length);
  range.setValues([cabecalho]);
  range.setFontWeight('bold');
  range.setBackground('#1a73e8');
  range.setFontColor('#ffffff');
  sheet.setFrozenRows(1);

  return jsonOk_({ mensagem: 'Cabeçalho de Solicitações corrigido com sucesso.' });
}
