/**
 * setup-planilha.gs — Inicialização da planilha consolidada do SGE
 * SGE — Sistema de Gestão de Estágios · IFRS Campus Rio Grande
 *
 * Execute UMA VEZ pelo editor do Apps Script:
 *   Selecione a função "configurarPlanilha" e clique em Executar (▶)
 *
 * O que faz:
 *   1. Apaga todas as abas existentes
 *   2. Cria todas as abas do SGE com cabeçalhos
 */

function configurarPlanilha() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // ── 1. Remove todas as abas existentes ─────────────────────────────
  var sheets = ss.getSheets();
  // Precisa manter ao menos uma aba para poder deletar as demais
  var nova = ss.insertSheet('__temp__');
  sheets.forEach(function(s) { ss.deleteSheet(s); });

  // ── 2. Definição das abas e seus cabeçalhos ─────────────────────────
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
        'Timestamp', 'Tipo Vínculo', 'Regime', 'Fim Contrato',
        'Nome', 'Matrícula SIAPE', 'SIAPE', 'Área',
        'E-mail', 'Titulação', 'Cursos', 'Telefone', 'Status',
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

  // ── 3. Cria cada aba com cabeçalho formatado ────────────────────────
  abas.forEach(function(aba) {
    var sheet = ss.insertSheet(aba.nome);
    var range = sheet.getRange(1, 1, 1, aba.cabecalho.length);
    range.setValues([aba.cabecalho]);
    range.setFontWeight('bold');
    range.setBackground('#1a73e8');
    range.setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 160);
  });

  // ── 4. Remove aba temporária ────────────────────────────────────────
  ss.deleteSheet(ss.getSheetByName('__temp__'));

  // ── 5. Mensagem de confirmação ──────────────────────────────────────
  SpreadsheetApp.getUi().alert(
    '✅ Planilha configurada com sucesso!\n\n' +
    abas.length + ' abas criadas:\n' +
    abas.map(function(a) { return '• ' + a.nome; }).join('\n') +
    '\n\nPróximo passo: preencha a aba "Diretor Geral" com os dados do DG atual.'
  );
}
