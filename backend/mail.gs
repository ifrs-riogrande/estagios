/**
 * mail.gs — Templates de e-mail para notificações do SGE
 * SGE — Sistema de Gestão de Estágios · IFRS Campus Rio Grande
 *
 * Funções exportadas:
 *   enviarEmailNovaEmpresa_(dados)
 *   enviarEmailNovoSupervisor_(dados)
 *   enviarEmailSolicitacaoRecebida_(dados)
 *   enviarEmailSolicitacaoAprovada_(dados)
 *   enviarEmailSolicitacaoReprovada_(dados)
 *   enviarEmailRelatorioParcialRecebido_(dados)
 *   enviarEmailRelatorioFinalRecebido_(dados)
 *   enviarEmailAdendoRecebido_(dados)
 *   enviarEmailNovoOrientador_(dados)
 *   enviarEmailNovoAgente_(dados)
 */

'use strict';

var MAIL = (function () {

  var SETOR_EMAIL = 'estagios@riogrande.ifrs.edu.br';
  var SETOR_NOME  = 'Setor de Estágios — IFRS Campus Rio Grande';
  var SISTEMA_NOME = 'Central de Estágios IFRS';

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  function htmlBase_(titulo, corpo) {
    return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">'
      + '<style>body{font-family:Arial,sans-serif;font-size:14px;color:#374151;margin:0;padding:0;background:#f9fafb;}'
      + '.wrapper{max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;}'
      + '.header{background:#1d4ed8;padding:24px 32px;} .header h1{color:#fff;margin:0;font-size:20px;}'
      + '.body{padding:32px;} .body p{margin:0 0 16px;line-height:1.6;}'
      + '.label{font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px;}'
      + '.value{font-weight:600;color:#111827;margin-bottom:12px;}'
      + '.footer{background:#f3f4f6;padding:16px 32px;font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;}'
      + '</style></head><body>'
      + '<div class="wrapper">'
      + '<div class="header"><h1>' + titulo + '</h1></div>'
      + '<div class="body">' + corpo + '</div>'
      + '<div class="footer">' + SISTEMA_NOME + ' · IFRS Campus Rio Grande · '
      + '<a href="mailto:' + SETOR_EMAIL + '" style="color:#6b7280;">' + SETOR_EMAIL + '</a></div>'
      + '</div></body></html>';
  }

  function campo_(label, valor) {
    return '<p class="label">' + label + '</p><p class="value">'
      + escapeHtmlMail_(String(valor || '—')) + '</p>';
  }

  /**
   * Gera um botão de e-mail compatível com Gmail (usa bgcolor no <td> e display:block no <a>).
   */
  function botaoEmail_(url, texto) {
    var u = escapeHtmlMail_(url);
    return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px;">'
      + '<tr><td bgcolor="#1d4ed8" style="border-radius:6px;background:#1d4ed8;">'
      + '<a href="' + u + '" target="_blank"'
      + ' style="display:block;padding:14px 28px;font-family:Arial,sans-serif;font-size:15px;'
      + 'font-weight:700;color:#ffffff !important;text-decoration:none;border-radius:6px;mso-padding-alt:14px 28px;">'
      + '<span style="color:#ffffff;">' + escapeHtmlMail_(texto) + '</span>'
      + '</a></td></tr></table>';
  }

  function formatarDataBR_(valor) {
    if (!valor) return valor || '';
    var s = String(valor);
    // ISO: YYYY-MM-DD → DD/MM/YYYY
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[3] + '/' + m[2] + '/' + m[1];
    return s;
  }

  function escapeHtmlMail_(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Converte pares surrogados UTF-16 (emojis e chars fora do BMP) em entidades
   * HTML numéricas (&#NNNNN;), evitando corrupção no envio via GmailApp.
   */
  function encodeEmoji_(s) {
    if (!s) return '';
    return String(s).replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, function (par) {
      var cp = (par.charCodeAt(0) - 0xD800) * 0x400 + par.charCodeAt(1) - 0xDC00 + 0x10000;
      return '&#' + cp + ';';
    });
  }

  // --------------------------------------------------------------------------
  // Helpers de template editável
  // --------------------------------------------------------------------------

  /** Lê override de template do PropertiesService. Retorna {} se não há override. */
  function _tmpl_(key) {
    try {
      var raw = PropertiesService.getScriptProperties().getProperty('tmpl_' + key);
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }

  /**
   * Converte texto plano com {{var}} em HTML.
   * Cada linha vira um <p>. Escapa HTML e interpola variáveis de dados.
   */
  function _paraHtml_(texto, dados) {
    if (!texto) return '';
    var interpolado = String(texto).replace(/\{\{(\w+)\}\}/g, function (_, k) {
      return dados && dados[k] !== undefined ? escapeHtmlMail_(String(dados[k])) : '{{' + k + '}}';
    });
    return interpolado.split(/\n+/).filter(function (l) { return l.trim(); })
      .map(function (l) { return '<p>' + l.trim() + '</p>'; }).join('');
  }

  /** Interpola {{var}} no assunto (sem escapar HTML). */
  function _assuntoTmpl_(texto, dados) {
    if (!texto) return '';
    return String(texto).replace(/\{\{(\w+)\}\}/g, function (_, k) {
      return dados && dados[k] !== undefined ? String(dados[k]) : '{{' + k + '}}';
    });
  }

  // --------------------------------------------------------------------------
  // Meta-dados de templates (usados pela UI de admin)
  // --------------------------------------------------------------------------

  function obterMetaTemplates() {
    return [
      // ── Solicitação ───────────────────────────────────────────────────────
      { key:'solicitacaoEstudante',   grupo:'solicitacao', grupoLabel:'Solicitação de Estágio',
        label:'Solicitação Recebida — Estudante', destinatario:'Estudante',
        assuntoDefault:'[SGE] Solicitação de estágio recebida — {{idEstagio}}',
        aberturaDefault:'Olá, {{nomeEstudante}}!\n\nSua solicitação de estágio foi recebida e está em análise. Entraremos em contato assim que for processada.',
        encerramentoDefault:'Guarde este ID — ele será necessário para relatórios e adendos.',
        vars:['nomeEstudante','idEstagio','nomeEmpresa','tipoEstagio','dataInicio','dataTermino'],
        camposFixos:['ID da solicitação','Empresa','Tipo de estágio','Início previsto','Término previsto'] },

      { key:'solicitacaoOrientador', grupo:'solicitacao', grupoLabel:'Solicitação de Estágio',
        label:'Solicitação Recebida — Orientador', destinatario:'Orientador',
        assuntoDefault:'[SGE] Novo estagiário sob sua orientação — {{idEstagio}}',
        aberturaDefault:'Uma nova solicitação de estágio foi registrada com você como orientador.',
        encerramentoDefault:'Aguarde contato do setor de estágios para os próximos passos.',
        vars:['idEstagio','nomeEstudante','nomeEmpresa','dataInicio','dataTermino'],
        camposFixos:['ID','Estudante','Empresa','Período'] },

      { key:'solicitacaoAprovada',   grupo:'solicitacao', grupoLabel:'Solicitação de Estágio',
        label:'Solicitação Aprovada', destinatario:'Estudante',
        assuntoDefault:'[SGE] Estágio aprovado — {{idEstagio}}',
        aberturaDefault:'Olá, {{nomeEstudante}}!\n\nSua solicitação de estágio foi aprovada! O Termo de Compromisso de Estágio (TCE) será encaminhado para assinatura.',
        encerramentoDefault:'Fique atento ao seu e-mail para as instruções sobre a assinatura do TCE.',
        vars:['nomeEstudante','idEstagio','nomeEmpresa','dataInicio','dataTermino'],
        camposFixos:['ID do estágio','Empresa','Início','Término'] },

      { key:'solicitacaoReprovada',  grupo:'solicitacao', grupoLabel:'Solicitação de Estágio',
        label:'Solicitação Não Aprovada', destinatario:'Estudante',
        assuntoDefault:'[SGE] Solicitação não aprovada — {{idEstagio}}',
        aberturaDefault:'Olá, {{nomeEstudante}}.\n\nInfelizmente, sua solicitação de estágio não foi aprovada neste momento.',
        encerramentoDefault:'Em caso de dúvidas, entre em contato com o setor pelo e-mail estagios@riogrande.ifrs.edu.br.',
        vars:['nomeEstudante','idEstagio','motivo'],
        camposFixos:['ID da solicitação','Motivo'] },

      { key:'devolucaoAluno',        grupo:'solicitacao', grupoLabel:'Solicitação de Estágio',
        label:'Devolução para Correção', destinatario:'Estudante',
        assuntoDefault:'[SGE] Solicitação devolvida para correção — {{idEstagio}}',
        aberturaDefault:'Olá, {{nomeEstudante}}.\n\nO Setor de Estágios devolveu sua solicitação de estágio para que você realize as correções necessárias e reenvie.',
        encerramentoDefault:'Em caso de dúvidas, entre em contato pelo e-mail estagios@riogrande.ifrs.edu.br.',
        vars:['nomeEstudante','idEstagio','motivo'],
        camposFixos:['ID da solicitação','Motivo / Orientação do setor','Botão: Acessar minha solicitação'] },

      // ── Checklist ─────────────────────────────────────────────────────────
      { key:'checklistOrientador',   grupo:'checklist', grupoLabel:'Checklist',
        label:'Checklist — Orientador (detalhado)', destinatario:'Orientador',
        assuntoDefault:'[IFRS Estágios] Checklist de orientação aguardando sua resposta — {{nomeEstudante}} ({{idEstagio}})',
        aberturaDefault:'Olá, {{nomeOrientador}},\n\nO(a) estudante {{nomeEstudante}} selecionou você como orientador(a) de estágio. Por favor, acesse o link abaixo para revisar as informações e responder o checklist de orientação.',
        encerramentoDefault:'Dúvidas: estagios@riogrande.ifrs.edu.br',
        vars:['nomeOrientador','nomeEstudante','idEstagio','curso','nomeEmpresa','tipoEstagio','dataInicio','dataTermino','prazoVencimento'],
        camposFixos:['Tabela: Estudante, Empresa, Tipo, Período, Carga horária, Prazo','Botão: Revisar e responder checklist'] },

      { key:'checklistAtor',         grupo:'checklist', grupoLabel:'Checklist',
        label:'Checklist — Ator Convocado', destinatario:'Orientador / Supervisor / Coordenador',
        assuntoDefault:'[SGE] Checklist de estágio aguardando sua resposta — {{idEstagio}}',
        aberturaDefault:'Olá!\n\nO checklist da solicitação de estágio abaixo foi liberado para sua análise. Por favor, acesse o sistema e responda até a data limite.',
        encerramentoDefault:'',
        vars:['idEstagio','nomeEstudante','curso','nomeEmpresa','labelAtor','prazoVencimento'],
        camposFixos:['ID do estágio','Estudante','Curso','Empresa','Seu papel','Prazo limite','Botão: Responder Checklist'] },

      { key:'lembreteChecklist',     grupo:'checklist', grupoLabel:'Checklist',
        label:'Lembrete de Prazo — Checklist', destinatario:'Ator ativo',
        assuntoDefault:'[SGE] Lembrete: prazo se encerrando — checklist {{idEstagio}}',
        aberturaDefault:'Olá!\n\nEste é um lembrete: o prazo para sua resposta no checklist de estágio vence em {{diasAntes}} dias úteis.',
        encerramentoDefault:'',
        vars:['idEstagio','nomeEstudante','labelAtor','prazoVencimento','diasAntes'],
        camposFixos:['ID do estágio','Estudante','Seu papel','Prazo limite','Botão: Responder Agora'] },

      { key:'aguardandoAceite',      grupo:'checklist', grupoLabel:'Checklist',
        label:'Aguardando Aceite do Orientador', destinatario:'Estudante',
        assuntoDefault:'[IFRS Estágios] Solicitação enviada — aguardando orientador ({{idEstagio}})',
        aberturaDefault:'Olá, {{nomeEstudante}}!\n\nSua solicitação de estágio foi recebida. Agora aguardamos o aceite do(a) orientador(a) escolhido(a).',
        encerramentoDefault:'Guarde este ID — ele será necessário para relatórios e adendos.',
        vars:['nomeEstudante','idEstagio','nomeOrientador','nomeEmpresa','tipoEstagio','dataInicio','dataTermino'],
        camposFixos:['ID da solicitação','Orientador(a)','Empresa','Tipo','Período'] },

      { key:'aceiteOrientadorAceito',   grupo:'checklist', grupoLabel:'Checklist',
        label:'Resposta do Orientador — Aceito', destinatario:'Estudante',
        assuntoDefault:'[IFRS Estágios] Orientador aceitou — {{idEstagio}}',
        aberturaDefault:'Olá, {{nomeEstudante}}!\n\nBoa notícia! O(a) Prof(a). {{nomeOrientador}} aceitou orientar seu estágio. Sua solicitação avançou para o checklist de validação com todos os envolvidos.',
        encerramentoDefault:'Acompanhe o andamento pelo seu portal de estágios. Em breve você receberá mais informações.',
        vars:['nomeEstudante','idEstagio','nomeOrientador','nomeEmpresa'],
        camposFixos:['ID do estágio','Empresa'] },

      { key:'aceiteOrientadorRecusado', grupo:'checklist', grupoLabel:'Checklist',
        label:'Resposta do Orientador — Recusado', destinatario:'Estudante',
        assuntoDefault:'[IFRS Estágios] Orientador recusou — {{idEstagio}}',
        aberturaDefault:'Olá, {{nomeEstudante}},\n\nInfelizmente o(a) Prof(a). {{nomeOrientador}} não pôde aceitar a orientação do seu estágio neste momento.',
        encerramentoDefault:'Dúvidas? Entre em contato: estagios@riogrande.ifrs.edu.br',
        vars:['nomeEstudante','idEstagio','nomeOrientador','obs'],
        camposFixos:['ID do estágio','Motivo informado (opcional)'] },

      // ── Assinaturas TCE ───────────────────────────────────────────────────
      { key:'assinaturaGovBr',       grupo:'assinaturas', grupoLabel:'Assinaturas TCE',
        label:'Assinar via Gov.br', destinatario:'Signatário externo',
        assuntoDefault:'[SGE] Assine o TCE (etapa {{numeroEtapa}}/5) — {{idEstagio}}',
        aberturaDefault:'Olá!\n\nÉ a sua vez de assinar o Termo de Compromisso de Estágio (TCE). Acesse a página pelo botão abaixo para visualizar, baixar e enviar o documento assinado.',
        encerramentoDefault:'',
        vars:['idEstagio','nomeEstudante','labelAtor','numeroEtapa','prazoVencimento'],
        camposFixos:['ID do estágio','Estudante','Sua etapa','Prazo limite','Botão: Acessar e Assinar TCE'] },

      { key:'assinaturaInterno',     grupo:'assinaturas', grupoLabel:'Assinaturas TCE',
        label:'Aprovação Interna do TCE', destinatario:'Central / Direção',
        assuntoDefault:'[SGE] Ação necessária — fluxo TCE etapa {{numeroEtapa}}/5 — {{idEstagio}}',
        aberturaDefault:'Olá!\n\nO fluxo de assinaturas do TCE chegou à sua etapa. Por favor, revise o documento e registre sua decisão no sistema.',
        encerramentoDefault:'',
        vars:['idEstagio','nomeEstudante','labelAtor','numeroEtapa','prazoVencimento'],
        camposFixos:['ID do estágio','Estudante','Sua etapa','Prazo limite','Botão: Acessar Fluxo de Assinaturas'] },

      { key:'lembreteAssinatura',    grupo:'assinaturas', grupoLabel:'Assinaturas TCE',
        label:'Lembrete de Prazo — Assinatura', destinatario:'Signatário ativo',
        assuntoDefault:'[SGE] Lembrete: prazo se encerrando — assinatura TCE etapa {{numeroEtapa}} — {{idEstagio}}',
        aberturaDefault:'Olá!\n\nO prazo para sua ação no fluxo de assinaturas vence em {{diasAntes}} dias úteis.',
        encerramentoDefault:'',
        vars:['idEstagio','nomeEstudante','labelAtor','numeroEtapa','prazoVencimento','diasAntes'],
        camposFixos:['ID do estágio','Estudante','Sua etapa','Prazo limite','Botão: Agir Agora'] },

      { key:'pdfFinalAssinaturas',   grupo:'assinaturas', grupoLabel:'Assinaturas TCE',
        label:'TCE Finalizado — PDF Assinado', destinatario:'Todos os envolvidos',
        assuntoDefault:'[SGE] TCE assinado — Estágio {{idEstagio}} — {{nomeEstudante}}',
        aberturaDefault:'Olá, {{nome}}!\n\nO processo de assinatura do Termo de Compromisso de Estágio foi concluído com sucesso!',
        encerramentoDefault:'O documento pode ser baixado diretamente na página acima.',
        vars:['nome','idEstagio','nomeEstudante'],
        camposFixos:['ID do estágio','Estudante','Botão: Acessar TCE Assinado'] },

      // ── Adendo ────────────────────────────────────────────────────────────
      { key:'adendoGovBr',           grupo:'adendo', grupoLabel:'Adendo / Aditamento',
        label:'Assinar Aditamento via Gov.br', destinatario:'Signatário externo',
        assuntoDefault:'[SGE] Assine o Aditamento ao TCE (etapa {{numeroEtapa}}/5) — {{idEstagio}}',
        aberturaDefault:'Olá!\n\nÉ a sua vez de assinar o Aditamento ao Termo de Compromisso de Estágio. Acesse a página pelo botão abaixo, baixe o documento, assine com gov.br e envie a versão assinada.',
        encerramentoDefault:'',
        vars:['idEstagio','nomeEstudante','tipoAdendo','labelAtor','numeroEtapa','prazoVencimento'],
        camposFixos:['ID do estágio','Estudante','Tipo de aditamento','Sua etapa','Prazo limite','Botão: Acessar e Assinar Aditamento'] },

      { key:'adendoInterno',         grupo:'adendo', grupoLabel:'Adendo / Aditamento',
        label:'Aprovação Interna do Aditamento', destinatario:'Central / Direção',
        assuntoDefault:'[SGE] Ação necessária — Aditamento TCE etapa {{numeroEtapa}}/5 — {{idEstagio}}',
        aberturaDefault:'Olá!\n\nO fluxo de assinaturas do Aditamento ao TCE chegou à sua etapa. Por favor, revise o documento e registre sua decisão no sistema.',
        encerramentoDefault:'',
        vars:['idEstagio','nomeEstudante','tipoAdendo','labelAtor','numeroEtapa','prazoVencimento'],
        camposFixos:['ID do estágio','Estudante','Tipo de aditamento','Sua etapa','Prazo limite','Botão: Acessar Fluxo de Assinaturas'] },

      { key:'adendoAprovado',        grupo:'adendo', grupoLabel:'Adendo / Aditamento',
        label:'Adendo Aprovado', destinatario:'Estudante',
        assuntoDefault:'[SGE] Adendo ao TCE aprovado',
        aberturaDefault:'Seu pedido de adendo ao TCE foi aprovado pelo Setor de Estágios.',
        encerramentoDefault:'',
        vars:['idEstagio'],
        camposFixos:['Estágio','Botão: Ver meu estágio no SGE'] },

      { key:'adendoReprovado',       grupo:'adendo', grupoLabel:'Adendo / Aditamento',
        label:'Adendo Reprovado', destinatario:'Estudante',
        assuntoDefault:'[SGE] Adendo ao TCE reprovado',
        aberturaDefault:'Seu pedido de adendo ao TCE foi reprovado pelo Setor de Estágios.',
        encerramentoDefault:'',
        vars:['idEstagio','motivoRejeicao'],
        camposFixos:['Estágio','Motivo (opcional)','Botão: Ver meu estágio no SGE'] },

      { key:'pdfFinalAdendo',        grupo:'adendo', grupoLabel:'Adendo / Aditamento',
        label:'Aditamento Finalizado — PDF Assinado', destinatario:'Todos os envolvidos',
        assuntoDefault:'[SGE] Aditamento ao TCE assinado — Estágio {{idEstagio}} — {{nomeEstudante}}',
        aberturaDefault:'Olá, {{nome}}!\n\nO processo de assinatura do Aditamento ao Termo de Compromisso de Estágio foi concluído com sucesso!',
        encerramentoDefault:'O documento pode ser baixado diretamente na página acima.',
        vars:['nome','idEstagio','nomeEstudante','tipoAdendo'],
        camposFixos:['ID do estágio','Estudante','Tipo de aditamento','Botão: Acessar Aditamento Assinado'] },

      // ── Servidores ────────────────────────────────────────────────────────
      { key:'rejeicaoServidor',      grupo:'servidores', grupoLabel:'Servidores',
        label:'Cadastro de Servidor Rejeitado', destinatario:'Orientador / Coordenador',
        assuntoDefault:'[IFRS Estágios] Cadastro de {{tipoLabel}} não aprovado',
        aberturaDefault:'Olá, {{nome}},\n\nSeu cadastro como {{tipoLabel}} não foi aprovado pelo setor de estágios do IFRS Campus Rio Grande.',
        encerramentoDefault:'Dúvidas: estagios@riogrande.ifrs.edu.br',
        vars:['nome','tipoLabel','obs'],
        camposFixos:['Motivo / Observações (opcional)','Link para reenvio do cadastro'] },
    ];
  }

  function enviar_(para, assunto, htmlBody, cc) {
    var corpo = encodeEmoji_(htmlBody);
    var opts  = { htmlBody: corpo, name: SISTEMA_NOME };
    if (cc) opts.cc = cc;
    try {
      GmailApp.sendEmail(para, assunto, '', opts);
    } catch (e) {
      // Fallback para MailApp se GmailApp falhar
      try { MailApp.sendEmail({ to: para, subject: assunto, htmlBody: corpo, name: SISTEMA_NOME }); } catch (e2) { /* silencioso */ }
    }
  }

  // --------------------------------------------------------------------------
  // Empresas
  // --------------------------------------------------------------------------

  function enviarEmailNovaEmpresa(dados) {
    var assunto = '[SGE] Nova empresa cadastrada: ' + (dados.nomeFantasia || dados.razaoSocial);
    var corpo = '<p>Uma nova empresa foi cadastrada no sistema e aguarda validação.</p>'
      + campo_('Razão Social', dados.razaoSocial)
      + campo_('Nome Fantasia', dados.nomeFantasia)
      + campo_('CNPJ', dados.cnpj)
      + campo_('Ramo de atividade', dados.ramoAtividade)
      + campo_('Responsável', dados.nomeResponsavel + ' (' + dados.emailResponsavel + ')')
      + campo_('Município/UF', (dados.municipio || '') + '/' + (dados.uf || ''))
      + '<p style="margin-top:24px;">Acesse a planilha para validar o cadastro.</p>';
    enviar_(SETOR_EMAIL, assunto, htmlBase_('[SGE] Nova Empresa', corpo));
  }

  function enviarEmailNovoSupervisor(dados) {
    var assunto = '[SGE] Novo supervisor cadastrado: ' + dados.nomeSupervisor;
    var corpo = '<p>Um novo supervisor foi cadastrado e aguarda validação.</p>'
      + campo_('Nome', dados.nomeSupervisor)
      + campo_('CPF', dados.cpfSupervisor)
      + campo_('Empresa', dados.empresaVinculo)
      + campo_('Cargo', dados.cargoSupervisor)
      + campo_('E-mail', dados.emailSupervisor);
    enviar_(SETOR_EMAIL, assunto, htmlBase_('[SGE] Novo Supervisor', corpo));
  }

  // --------------------------------------------------------------------------
  // Solicitações de estágio
  // --------------------------------------------------------------------------

  function enviarEmailSolicitacaoRecebida(dados) {
    // Para o estudante
    var tEst = _tmpl_('solicitacaoEstudante');
    var assuntoEst    = tEst.assunto    ? _assuntoTmpl_(tEst.assunto, dados)    : '[SGE] Solicitação de estágio recebida — ' + dados.idEstagio;
    var aberturaEst   = tEst.abertura   ? _paraHtml_(tEst.abertura, dados)
      : '<p>Olá, <strong>' + escapeHtmlMail_(dados.nomeEstudante) + '</strong>!</p>'
        + '<p>Sua solicitação de estágio foi recebida e está em análise. Entraremos em contato assim que for processada.</p>';
    var encerrEst = tEst.encerramento ? _paraHtml_(tEst.encerramento, dados)
      : '<p style="color:#6b7280;font-size:13px;">Guarde este ID — ele será necessário para relatórios e adendos.</p>';
    var corpoEstudante = aberturaEst
      + campo_('ID da solicitação', dados.idEstagio)
      + campo_('Empresa', dados.nomeEmpresa)
      + campo_('Tipo de estágio', dados.tipoEstagio)
      + campo_('Início previsto', dados.dataInicio)
      + campo_('Término previsto', dados.dataTermino)
      + encerrEst;
    enviar_(dados.emailEstudante, assuntoEst, htmlBase_('Solicitação Recebida', corpoEstudante));

    // Para o setor (sem override — e-mail interno)
    var corpoSetor = '<p>Nova solicitação de estágio recebida.</p>'
      + campo_('ID', dados.idEstagio)
      + campo_('Estudante', dados.nomeEstudante + ' (' + dados.emailEstudante + ')')
      + campo_('Matrícula', dados.matricula)
      + campo_('Curso', dados.curso)
      + campo_('Empresa', dados.nomeEmpresa)
      + campo_('Supervisor', dados.nomeSupervisor)
      + campo_('Orientador', dados.nomeOrientador)
      + campo_('Tipo', dados.tipoEstagio)
      + campo_('Período', dados.dataInicio + ' a ' + dados.dataTermino);
    enviar_(SETOR_EMAIL, '[SGE] Nova solicitação: ' + dados.idEstagio,
      htmlBase_('[SGE] Nova Solicitação', corpoSetor));

    // Para o orientador
    if (dados.emailOrientador) {
      var tOri = _tmpl_('solicitacaoOrientador');
      var assuntoOri  = tOri.assunto  ? _assuntoTmpl_(tOri.assunto, dados)  : '[SGE] Novo estagiário sob sua orientação — ' + dados.idEstagio;
      var aberturaOri = tOri.abertura ? _paraHtml_(tOri.abertura, dados)     : '<p>Uma nova solicitação de estágio foi registrada com você como orientador.</p>';
      var encerrOri   = tOri.encerramento ? _paraHtml_(tOri.encerramento, dados) : '<p>Aguarde contato do setor de estágios para os próximos passos.</p>';
      var corpoOrientador = aberturaOri
        + campo_('ID', dados.idEstagio)
        + campo_('Estudante', dados.nomeEstudante)
        + campo_('Empresa', dados.nomeEmpresa)
        + campo_('Período', dados.dataInicio + ' a ' + dados.dataTermino)
        + encerrOri;
      enviar_(dados.emailOrientador, assuntoOri, htmlBase_('Nova Solicitação de Estágio', corpoOrientador));
    }
  }

  function enviarEmailSolicitacaoAprovada(dados) {
    var t = _tmpl_('solicitacaoAprovada');
    var assunto = t.assunto ? _assuntoTmpl_(t.assunto, dados) : '[SGE] Estágio aprovado — ' + dados.idEstagio;
    var abertura = t.abertura ? _paraHtml_(t.abertura, dados)
      : '<p>Olá, <strong>' + escapeHtmlMail_(dados.nomeEstudante) + '</strong>!</p>'
        + '<p>Sua solicitação de estágio foi <strong style="color:#16a34a;">aprovada</strong>! O Termo de Compromisso de Estágio (TCE) será encaminhado para assinatura.</p>';
    var encerramento = t.encerramento ? _paraHtml_(t.encerramento, dados)
      : '<p>Fique atento ao seu e-mail para as instruções sobre a assinatura do TCE.</p>';
    var corpo = abertura
      + campo_('ID do estágio', dados.idEstagio)
      + campo_('Empresa', dados.nomeEmpresa)
      + campo_('Início', dados.dataInicio)
      + campo_('Término', dados.dataTermino)
      + encerramento;
    enviar_(dados.emailEstudante, assunto, htmlBase_('Estágio Aprovado! ✓', corpo));
  }

  function enviarEmailSolicitacaoReprovada(dados) {
    var t = _tmpl_('solicitacaoReprovada');
    var assunto = t.assunto ? _assuntoTmpl_(t.assunto, dados) : '[SGE] Solicitação não aprovada — ' + dados.idEstagio;
    var abertura = t.abertura ? _paraHtml_(t.abertura, dados)
      : '<p>Olá, <strong>' + escapeHtmlMail_(dados.nomeEstudante) + '</strong>.</p>'
        + '<p>Infelizmente, sua solicitação de estágio não foi aprovada neste momento.</p>';
    var encerramento = t.encerramento ? _paraHtml_(t.encerramento, dados)
      : '<p>Em caso de dúvidas, entre em contato com o setor pelo e-mail '
        + '<a href="mailto:' + SETOR_EMAIL + '">' + SETOR_EMAIL + '</a>.</p>';
    var corpo = abertura
      + campo_('ID da solicitação', dados.idEstagio)
      + campo_('Motivo', dados.motivo || 'Consulte o setor de estágios para mais informações.')
      + encerramento;
    enviar_(dados.emailEstudante, assunto, htmlBase_('Resultado da Solicitação', corpo));
  }

  // --------------------------------------------------------------------------
  // Relatórios
  // --------------------------------------------------------------------------

  function enviarEmailRelatorioParcialRecebido(dados) {
    var corpo = '<p>O relatório parcial do estágio <strong>' + dados.idEstagio + '</strong> foi recebido.</p>'
      + campo_('Estudante', dados.nomeEstudante || dados.emailEstudante)
      + campo_('Período de referência', dados.periodoRef)
      + campo_('Avaliação geral', dados.avaliacaoEstagio)
      + '<p>O orientador receberá uma cópia para análise.</p>';
    enviar_(SETOR_EMAIL, '[SGE] Relatório parcial recebido — ' + dados.idEstagio,
      htmlBase_('[SGE] Relatório Parcial', corpo));
    if (dados.emailOrientador) {
      var corpoOri = '<p>O estudante sob sua orientação enviou o relatório parcial do semestre.</p>'
        + campo_('ID do estágio', dados.idEstagio)
        + campo_('Período', dados.periodoRef)
        + campo_('Avaliação do estágio', dados.avaliacaoEstagio);
      enviar_(dados.emailOrientador, '[SGE] Relatório parcial do seu estagiário — ' + dados.idEstagio,
        htmlBase_('Relatório Parcial', corpoOri));
    }
  }

  function enviarEmailRelatorioFinalRecebido(dados) {
    var corpo = '<p>O relatório final do estágio <strong>' + dados.idEstagio + '</strong> foi recebido.</p>'
      + campo_('Estudante', dados.nomeEstudante || dados.emailEstudante)
      + campo_('Data de encerramento', dados.dataEncerramento)
      + campo_('Avaliação da concedente', dados.avaliacaoConcedente)
      + campo_('Avaliação do orientador', dados.avaliacaoOrientador)
      + campo_('Recomendaria a empresa', dados.recomendaria)
      + '<p>O processo de encerramento do estágio será finalizado pelo setor.</p>';
    enviar_(SETOR_EMAIL, '[SGE] Relatório final recebido — ' + dados.idEstagio,
      htmlBase_('[SGE] Relatório Final', corpo));
    if (dados.emailOrientador) {
      var corpoOri = '<p>O estudante sob sua orientação concluiu o estágio e enviou o relatório final.</p>'
        + campo_('ID do estágio', dados.idEstagio)
        + campo_('Encerramento', dados.dataEncerramento);
      enviar_(dados.emailOrientador, '[SGE] Relatório final do seu estagiário — ' + dados.idEstagio,
        htmlBase_('Relatório Final', corpoOri));
    }
  }

  // --------------------------------------------------------------------------
  // Adendo
  // --------------------------------------------------------------------------

  function enviarEmailAdendoRecebido(dados) {
    var urlAdmin = BASE_URL + '/admin/estagio.html?id=' + encodeURIComponent(dados.idEstagio);
    var corpo = '<p>Uma solicitação de adendo ao TCE foi recebida e aguarda sua análise.</p>'
      + campo_('ID do estágio', dados.idEstagio)
      + campo_('Estudante', dados.nomeEstudante || dados.emailEstudante || '')
      + campo_('Tipo de alteração', dados.tipoAdendo)
      + (dados.justificativa ? campo_('Justificativa', dados.justificativa) : '')
      + (dados.novaDataTermino ? campo_('Nova data de término', dados.novaDataTermino) : '')
      + (dados.novaCargaHoraria ? campo_('Nova carga horária', dados.novaCargaHoraria) : '')
      + (dados.novoHorario ? campo_('Novo horário', dados.novoHorario) : '')
      + botaoEmail_(urlAdmin, 'Analisar e aprovar adendo')
      + '<p style="font-size:13px;color:#6b7280;margin:4px 0 16px;">'
      + 'Ou acesse diretamente: <a href="' + urlAdmin + '" style="color:#1d4ed8;">' + urlAdmin + '</a></p>';
    enviar_(SETOR_EMAIL, '[SGE] Adendo ao TCE recebido — ' + dados.idEstagio,
      htmlBase_('[SGE] Adendo ao TCE', corpo));
  }

  function enviarEmailAdendoProcessado(dados) {
    var decisao   = dados.decisao;   // 'Aprovado' ou 'Reprovado'
    var aprovado  = decisao === 'Aprovado';
    var urlAluno  = BASE_URL + '/estudantes/acompanhamento.html';
    var titulo    = aprovado ? '[SGE] Adendo ao TCE aprovado' : '[SGE] Adendo ao TCE reprovado';
    var tmplKey   = aprovado ? 'adendoAprovado' : 'adendoReprovado';
    var t = _tmpl_(tmplKey);
    var assunto = t.assunto ? _assuntoTmpl_(t.assunto, dados) : titulo;
    var intro = t.abertura ? _paraHtml_(t.abertura, dados)
      : (aprovado
          ? '<p>Seu pedido de adendo ao TCE foi <strong>aprovado</strong> pelo Setor de Estágios.</p>'
          : '<p>Seu pedido de adendo ao TCE foi <strong>reprovado</strong> pelo Setor de Estágios.</p>');
    var corpo = intro
      + campo_('Estágio', dados.idEstagio)
      + (dados.motivoRejeicao ? campo_('Motivo', dados.motivoRejeicao) : '')
      + botaoEmail_(urlAluno, 'Ver meu estágio no SGE')
      + '<p style="font-size:13px;color:#6b7280;margin:4px 0 16px;">'
      + 'Ou acesse: <a href="' + urlAluno + '" style="color:#1d4ed8;">' + urlAluno + '</a></p>';
    enviar_(dados.emailAluno, assunto, htmlBase_(titulo, corpo));
  }

  // --------------------------------------------------------------------------
  // Servidores e agentes
  // --------------------------------------------------------------------------

  function enviarEmailNovoOrientador(dados) {
    var assunto = '[SGE] Novo orientador cadastrado: ' + dados.nomeOrientador;
    var corpo = '<p>Um novo orientador de estágio foi cadastrado no sistema.</p>'
      + campo_('Nome', dados.nomeOrientador)
      + campo_('CPF', dados.cpfOrientador)
      + campo_('SIAPE', dados.siape)
      + campo_('E-mail', dados.emailInst)
      + campo_('Vínculo', dados.tipoVinculo)
      + campo_('Titulação', dados.titulacao)
      + campo_('Cursos', dados.cursos);
    enviar_(SETOR_EMAIL, assunto, htmlBase_('[SGE] Novo Orientador', corpo));
  }

  function enviarEmailNovoCoordenador(dados) {
    var assunto = '[SGE] Novo coordenador cadastrado: ' + dados.nome + ' (' + dados.curso + ')';
    var corpo = '<p>Um novo coordenador de curso foi cadastrado e aguarda aprovação.</p>'
      + campo_('Nome', dados.nome)
      + campo_('E-mail', dados.email)
      + campo_('SIAPE', dados.siape)
      + campo_('Curso', dados.curso)
      + '<p style="margin-top:24px;">Acesse o painel administrativo para aprovar ou reprovar o cadastro.</p>';
    enviar_(SETOR_EMAIL, assunto, htmlBase_('[SGE] Novo Coordenador', corpo));
  }

  /**
   * Notifica servidor (orientador ou coordenador) sobre rejeição do cadastro.
   * Tenta GmailApp; se falhar, tenta MailApp.
   * Lança erro se ambos falharem (para surface do erro na chamada).
   * dados: { email, nome, tipo ('orientador'|'coordenador'), obs }
   */
  function enviarEmailRejeicaoServidor(dados) {
    var tipoLabel  = dados.tipo === 'coordenador' ? 'coordenador de curso' : 'orientador de estágio';
    var linkPerfil = dados.tipo === 'coordenador'
      ? 'https://ifrs-riogrande.github.io/estagios/servidores/perfil-coordenador.html'
      : 'https://ifrs-riogrande.github.io/estagios/servidores/perfil-orientador.html';
    var t = _tmpl_('rejeicaoServidor');
    var dadosT = Object.assign({}, dados, { tipoLabel: tipoLabel, nome: dados.nome || '' });
    var assunto = t.assunto ? _assuntoTmpl_(t.assunto, dadosT) : '[IFRS Estágios] Cadastro de ' + tipoLabel + ' não aprovado';
    var abertura = t.abertura ? _paraHtml_(t.abertura, dadosT)
      : '<p>Olá' + (dados.nome ? ', <strong>' + dados.nome + '</strong>' : '') + ',</p>'
        + '<p>Seu cadastro como <strong>' + tipoLabel + '</strong> não foi aprovado pelo setor de estágios do IFRS Campus Rio Grande.</p>';
    var encerramento = t.encerramento ? _paraHtml_(t.encerramento, dadosT)
      : '<p>Dúvidas: <a href="mailto:' + SETOR_EMAIL + '">' + SETOR_EMAIL + '</a></p>';
    var corpo = abertura
      + (dados.obs ? '<p class="label">Motivo / Observações</p><p class="value" style="white-space:pre-wrap">' + dados.obs + '</p>' : '')
      + '<p>Você pode corrigir os dados e reenviar seu cadastro pelo portal:</p>'
      + '<p><a href="' + linkPerfil + '" style="color:#1d4ed8;">' + linkPerfil + '</a></p>'
      + encerramento;
    var html = htmlBase_(assunto, corpo);
    var err1 = null, err2 = null;
    // Tentativa 1: GmailApp
    try {
      GmailApp.sendEmail(dados.email, assunto, '', { htmlBody: html, name: SISTEMA_NOME, replyTo: SETOR_EMAIL });
      return; // sucesso
    } catch (e1) { err1 = e1.message || String(e1); }
    // Tentativa 2: MailApp (fallback)
    try {
      MailApp.sendEmail({ to: dados.email, subject: assunto, htmlBody: html, name: SISTEMA_NOME, replyTo: SETOR_EMAIL });
      return; // sucesso
    } catch (e2) { err2 = e2.message || String(e2); }
    // Ambos falharam — lança para que o chamador capture e informe o admin
    throw new Error('GmailApp: ' + err1 + ' | MailApp: ' + err2);
  }

  function enviarEmailAtualizacaoServidor(dados) {
    var tipo  = dados.tipo === 'coordenador' ? 'coordenador de curso' : 'orientador de estágio';
    var extra = dados.curso ? ' — ' + dados.curso : '';
    var assunto = '[SGE] Cadastro atualizado (' + tipo + '): ' + dados.nome;
    var corpo = '<p>Um servidor atualizou seus dados de ' + tipo + ' e aguarda aprovação.</p>'
      + campo_('Nome', dados.nome)
      + campo_('E-mail', dados.email)
      + (dados.curso ? campo_('Curso', dados.curso + extra) : '')
      + '<p style="margin-top:24px;">Acesse o painel administrativo para revisar e aprovar.</p>';
    enviar_(SETOR_EMAIL, assunto, htmlBase_('[SGE] Atualização de Cadastro', corpo));
  }

  function enviarEmailNovoAgente(dados) {
    var assunto = '[SGE] Novo agente de integração cadastrado: ' + (dados.siglaAgente || dados.nomeAgente);
    var corpo = '<p>Um novo agente de integração foi cadastrado e aguarda ativação.</p>'
      + campo_('Nome / Razão social', dados.nomeAgente)
      + campo_('Sigla', dados.siglaAgente)
      + campo_('CNPJ', dados.cnpjAgente)
      + campo_('Tipo', dados.tipoAgente)
      + campo_('Edital', dados.numEdital)
      + campo_('Vigência', dados.periodoConvenio);
    enviar_(SETOR_EMAIL, assunto, htmlBase_('[SGE] Novo Agente de Integração', corpo));
  }

  // --------------------------------------------------------------------------
  // Checklist
  // --------------------------------------------------------------------------

  var BASE_URL = 'https://ifrs-riogrande.github.io/estagios';

  function enviarEmailChecklistNovoAdmin(dados) {
    // dados: { idEstagio, nomeEstudante, emailEstudante, curso, nomeEmpresa, prazoAdmin }
    var corpo = '<p>Uma nova solicitação de estágio foi recebida e aguarda sua revisão no checklist.</p>'
      + campo_('ID do estágio', dados.idEstagio)
      + campo_('Estudante', (dados.nomeEstudante || '') + (dados.emailEstudante ? ' (' + dados.emailEstudante + ')' : ''))
      + campo_('Curso', dados.curso)
      + campo_('Empresa', dados.nomeEmpresa)
      + campo_('Prazo para revisão', dados.prazoAdmin)
      + '<p style="margin-top:24px;">'
      + '<a href="' + BASE_URL + '/admin/estagio.html?id=' + encodeURIComponent(dados.idEstagio) + '" style="display:inline-block;background:#1d4ed8;color:#fff;'
      + 'padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Ver Estágio no Admin</a></p>';
    enviar_(SETOR_EMAIL,
      '[SGE] Novo checklist aguardando revisão — ' + dados.idEstagio,
      htmlBase_('Checklist Pendente — Admin', corpo));
  }

  function enviarEmailChecklistAtor(dados) {
    // dados: { idEstagio, nomeEstudante, curso, nomeEmpresa, labelAtor, prazoVencimento, email,
    //          urlChecklist (opcional — já inclui token para supervisor via magic-link) }
    var urlChecklist = dados.urlChecklist
                     || (BASE_URL + '/checklist/?id=' + encodeURIComponent(dados.idEstagio));
    var t = _tmpl_('checklistAtor');
    var assunto = t.assunto ? _assuntoTmpl_(t.assunto, dados) : '[SGE] Checklist de estágio aguardando sua resposta — ' + dados.idEstagio;
    var abertura = t.abertura ? _paraHtml_(t.abertura, dados)
      : '<p>Olá!</p>'
        + '<p>O checklist da solicitação de estágio abaixo foi liberado para sua análise. '
        + 'Por favor, acesse o sistema e responda até a data limite.</p>';
    var corpo = abertura
      + campo_('ID do estágio', dados.idEstagio)
      + campo_('Estudante', dados.nomeEstudante)
      + campo_('Curso', dados.curso)
      + campo_('Empresa', dados.nomeEmpresa)
      + campo_('Seu papel', dados.labelAtor)
      + campo_('Prazo limite', dados.prazoVencimento)
      + '<p style="margin-top:24px;">'
      + '<a href="' + urlChecklist + '" style="display:inline-block;background:#1d4ed8;color:#fff;'
      + 'padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Responder Checklist</a></p>'
      + '<p style="font-size:13px;color:#6b7280;margin-top:12px;">Se o botão não funcionar, acesse:<br>'
      + '<a href="' + urlChecklist + '" style="color:#6b7280;">' + urlChecklist + '</a></p>';
    enviar_(dados.email, assunto, htmlBase_('Checklist — ' + dados.labelAtor, corpo));
  }

  function enviarEmailChecklistAjuste(dados) {
    // dados: { idEstagio, nomeEstudante, labelAtor, obs }
    var corpo = '<p>Um participante do checklist sinalizou a necessidade de ajuste na solicitação de estágio.</p>'
      + campo_('ID do estágio', dados.idEstagio)
      + campo_('Estudante', dados.nomeEstudante)
      + campo_('Ator', dados.labelAtor)
      + campo_('Observação', dados.obs || 'Nenhuma observação registrada.')
      + '<p style="margin-top:24px;">Acesse o painel administrativo para verificar e orientar os próximos passos.</p>'
      + '<p><a href="' + BASE_URL + '/admin/" style="display:inline-block;background:#d97706;color:#fff;'
      + 'padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Ver no Admin</a></p>';
    enviar_(SETOR_EMAIL,
      '[SGE] Ajuste solicitado no checklist — ' + dados.idEstagio,
      htmlBase_('Checklist — Ajuste Solicitado', corpo));
  }

  function enviarEmailLembreteChecklist(dados) {
    // dados: { idEstagio, nomeEstudante, labelAtor, prazoVencimento, email,
    //          urlChecklist (opcional — inclui token para supervisor), diasAntes }
    var urlChecklist = dados.urlChecklist
                     || (BASE_URL + '/checklist/?id=' + encodeURIComponent(dados.idEstagio));
    var diasAntes = dados.diasAntes || 2;
    var t = _tmpl_('lembreteChecklist');
    var assunto = t.assunto ? _assuntoTmpl_(t.assunto, dados) : '[SGE] Lembrete: prazo se encerrando — checklist ' + dados.idEstagio;
    var abertura = t.abertura ? _paraHtml_(t.abertura, Object.assign({}, dados, { diasAntes: diasAntes }))
      : '<p>Olá!</p>'
        + '<p>Este é um lembrete: o prazo para sua resposta no checklist de estágio vence em '
        + '<strong>' + diasAntes + ' dias úteis</strong>.</p>';
    var corpo = abertura
      + campo_('ID do estágio', dados.idEstagio)
      + campo_('Estudante', dados.nomeEstudante)
      + campo_('Seu papel', dados.labelAtor)
      + campo_('Prazo limite', dados.prazoVencimento)
      + '<p style="margin-top:24px;">'
      + '<a href="' + urlChecklist + '" style="display:inline-block;background:#d97706;color:#fff;'
      + 'padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Responder Agora</a></p>';
    enviar_(dados.email, assunto, htmlBase_('Lembrete de Prazo — Checklist', corpo));
  }

  // --------------------------------------------------------------------------
  // Assinaturas
  // --------------------------------------------------------------------------

  function enviarEmailAssinaturaGovBr(dados) {
    // dados: { idEstagio, nomeEstudante, labelAtor, prazoVencimento, email, pageUrl, numeroEtapa, motivoRejeicao? }
    var pageUrl = dados.pageUrl || (BASE_URL + '/assinaturas/?id=' + encodeURIComponent(dados.idEstagio));
    var blocoRejeicao = dados.motivoRejeicao
      ? '<div style="background:#fef2f2;border-left:4px solid #ef4444;padding:12px 16px;border-radius:4px;margin-bottom:16px;">'
        + '<p style="margin:0 0 4px;font-weight:600;color:#dc2626;">⚠️ Sua etapa foi devolvida para correção</p>'
        + '<p style="margin:0;font-size:13px;color:#374151;"><strong>Motivo:</strong> ' + escapeHtmlMail_(dados.motivoRejeicao) + '</p>'
        + '</div>'
      : '';
    var t = _tmpl_('assinaturaGovBr');
    var assunto = t.assunto ? _assuntoTmpl_(t.assunto, dados) : '[SGE] Assine o TCE (etapa ' + dados.numeroEtapa + '/5) — ' + dados.idEstagio;
    var abertura;
    if (t.abertura) {
      abertura = blocoRejeicao + _paraHtml_(t.abertura, dados);
    } else {
      abertura = '<p>Olá!</p>'
        + (dados.motivoRejeicao
            ? '<p>Sua etapa no fluxo de assinaturas do TCE foi <strong>devolvida para correção</strong>. Acesse a página, verifique o motivo e reenvie o documento corrigido.</p>'
            : '<p>É a sua vez de assinar o Termo de Compromisso de Estágio (TCE). Acesse a página pelo botão abaixo para visualizar, baixar e enviar o documento assinado.</p>')
        + blocoRejeicao;
    }
    var corpo = abertura
      + campo_('ID do estágio', dados.idEstagio)
      + campo_('Estudante', dados.nomeEstudante)
      + campo_('Sua etapa', 'Etapa ' + dados.numeroEtapa + '/5 — ' + dados.labelAtor)
      + campo_('Prazo limite', dados.prazoVencimento)
      + '<p style="margin-top:24px;">'
      + '<a href="' + pageUrl + '" style="display:inline-block;background:#1d4ed8;color:#fff;'
      + 'padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">🖊 Acessar e Assinar TCE</a>'
      + '</p>'
      + '<p style="font-size:13px;color:#6b7280;margin-top:12px;">'
      + 'Se o botão não funcionar, acesse: <a href="' + pageUrl + '" style="color:#6b7280;">' + pageUrl + '</a></p>';
    enviar_(dados.email, assunto, htmlBase_('Assinatura do TCE — ' + dados.labelAtor, corpo));
  }

  function enviarEmailAssinaturaInterno(dados) {
    // dados: { idEstagio, nomeEstudante, labelAtor, prazoVencimento, email, pageUrl, numeroEtapa, motivoRejeicao? }
    var pageUrl = dados.pageUrl || (BASE_URL + '/assinaturas/?id=' + encodeURIComponent(dados.idEstagio));
    var blocoRejeicao = dados.motivoRejeicao
      ? '<div style="background:#fef2f2;border-left:4px solid #ef4444;padding:12px 16px;border-radius:4px;margin-bottom:16px;">'
        + '<p style="margin:0 0 4px;font-weight:600;color:#dc2626;">⚠️ Etapa devolvida para correção</p>'
        + '<p style="margin:0;font-size:13px;color:#374151;"><strong>Motivo:</strong> ' + escapeHtmlMail_(dados.motivoRejeicao) + '</p>'
        + '</div>'
      : '';
    var t = _tmpl_('assinaturaInterno');
    var assunto = t.assunto ? _assuntoTmpl_(t.assunto, dados) : '[SGE] Ação necessária — fluxo TCE etapa ' + dados.numeroEtapa + '/5 — ' + dados.idEstagio;
    var abertura;
    if (t.abertura) {
      abertura = blocoRejeicao + _paraHtml_(t.abertura, dados);
    } else {
      abertura = '<p>Olá!</p>'
        + (dados.motivoRejeicao
            ? '<p>A etapa do fluxo de assinaturas foi <strong>devolvida para correção</strong>. Por favor acesse o sistema e tome a devida providência.</p>'
            : '<p>O fluxo de assinaturas do TCE chegou à sua etapa. Por favor, revise o documento e registre sua decisão no sistema.</p>')
        + blocoRejeicao;
    }
    var corpo = abertura
      + campo_('ID do estágio', dados.idEstagio)
      + campo_('Estudante', dados.nomeEstudante)
      + campo_('Sua etapa', 'Etapa ' + dados.numeroEtapa + '/5 — ' + dados.labelAtor)
      + campo_('Prazo limite', dados.prazoVencimento)
      + '<p style="margin-top:24px;">'
      + '<a href="' + pageUrl + '" style="display:inline-block;background:#1d4ed8;color:#fff;'
      + 'padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">'
      + 'Acessar Fluxo de Assinaturas</a></p>';
    enviar_(dados.email, assunto, htmlBase_('Fluxo TCE — ' + dados.labelAtor, corpo));
  }

  function enviarEmailLembreteAssinatura(dados) {
    // dados: { idEstagio, nomeEstudante, labelAtor, prazoVencimento, email, numeroEtapa, tipo, diasAntes }
    var urlSistema = BASE_URL + '/assinaturas/?id=' + encodeURIComponent(dados.idEstagio);
    var diasAntes  = dados.diasAntes || 2;
    var instrucao  = dados.tipo === 'govbr'
      ? 'Você ainda precisa baixar o TCE, assinar com gov.br e enviar o arquivo assinado.'
      : 'Você ainda precisa acessar o sistema, revisar e registrar sua decisão.';
    var t = _tmpl_('lembreteAssinatura');
    var assunto = t.assunto ? _assuntoTmpl_(t.assunto, dados) : '[SGE] Lembrete: prazo se encerrando — assinatura TCE etapa ' + dados.numeroEtapa + ' — ' + dados.idEstagio;
    var abertura = t.abertura ? _paraHtml_(t.abertura, Object.assign({}, dados, { diasAntes: diasAntes }))
      : '<p>Olá!</p>'
        + '<p>⚠️ O prazo para sua ação no fluxo de assinaturas vence em <strong>' + diasAntes + ' dias úteis</strong>. '
        + instrucao + '</p>';
    var corpo = abertura
      + campo_('ID do estágio', dados.idEstagio)
      + campo_('Estudante', dados.nomeEstudante)
      + campo_('Sua etapa', 'Etapa ' + dados.numeroEtapa + '/5 — ' + dados.labelAtor)
      + campo_('Prazo limite', dados.prazoVencimento)
      + '<p style="margin-top:24px;">'
      + '<a href="' + urlSistema + '" style="display:inline-block;background:#d97706;color:#fff;'
      + 'padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Agir Agora</a></p>';
    enviar_(dados.email, assunto, htmlBase_('Lembrete — Assinatura TCE', corpo));
  }

  function enviarEmailPdfFinalAssinaturas(dados) {
    // dados: { idEstagio, nomeEstudante, tokenPorAtor, destinatarios: [{email, nome, ator}] }
    var baseUrl = BASE_URL + '/assinaturas/?id=' + encodeURIComponent(dados.idEstagio);
    var t = _tmpl_('pdfFinalAssinaturas');
    dados.destinatarios.forEach(function(dest) {
      var pageUrl = dest.ator && dados.tokenPorAtor && dados.tokenPorAtor[dest.ator]
        ? baseUrl + '&token=' + encodeURIComponent(dados.tokenPorAtor[dest.ator])
        : baseUrl;
      var dadosDest = Object.assign({}, dados, { nome: dest.nome });
      var abertura = t.abertura ? _paraHtml_(t.abertura, dadosDest)
        : '<p>Olá, ' + escapeHtmlMail_(dest.nome) + '!</p>'
          + '<p>O processo de assinatura do Termo de Compromisso de Estágio foi concluído com sucesso! 🎉</p>'
          + '<p>O TCE está totalmente assinado e o estágio está oficialmente ativo.</p>';
      var encerramento = t.encerramento ? _paraHtml_(t.encerramento, dadosDest)
        : '<p style="font-size:13px;color:#6b7280;margin-top:16px;">O documento pode ser baixado diretamente na página acima.</p>';
      var assunto = t.assunto ? _assuntoTmpl_(t.assunto, dadosDest) : '[SGE] TCE assinado — Estágio ' + dados.idEstagio + ' — ' + escapeHtmlMail_(dados.nomeEstudante);
      var corpo = abertura
        + campo_('ID do estágio', dados.idEstagio)
        + campo_('Estudante', dados.nomeEstudante)
        + '<p style="margin-top:24px;">'
        + '<a href="' + pageUrl + '" style="display:inline-block;background:#16a34a;color:#fff;'
        + 'padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">'
        + '📄 Acessar TCE Assinado</a></p>'
        + encerramento;
      enviar_(dest.email, assunto, htmlBase_('TCE Concluído — Estágio Ativo', corpo));
    });
  }

  // --------------------------------------------------------------------------
  // Assinaturas — Adendo
  // --------------------------------------------------------------------------

  function enviarEmailAssinaturaAdendoGovBr(dados) {
    // dados: { idEstagio, nomeEstudante, tipoAdendo, labelAtor, prazoVencimento, email, pageUrl, numeroEtapa, motivoRejeicao? }
    var pageUrl = dados.pageUrl || (BASE_URL + '/assinaturas/adendo.html?id=' + encodeURIComponent(dados.idEstagio));
    var blocoRejeicao = dados.motivoRejeicao
      ? '<div style="background:#fef2f2;border-left:4px solid #ef4444;padding:12px 16px;border-radius:4px;margin-bottom:16px;">'
        + '<p style="margin:0 0 4px;font-weight:600;color:#dc2626;">⚠️ Sua etapa foi devolvida para correção</p>'
        + '<p style="margin:0;font-size:13px;color:#374151;"><strong>Motivo:</strong> ' + escapeHtmlMail_(dados.motivoRejeicao) + '</p>'
        + '</div>'
      : '';
    var t = _tmpl_('adendoGovBr');
    var assunto = t.assunto ? _assuntoTmpl_(t.assunto, dados) : '[SGE] Assine o Aditamento ao TCE (etapa ' + dados.numeroEtapa + '/5) — ' + dados.idEstagio;
    var abertura;
    if (t.abertura) {
      abertura = blocoRejeicao + _paraHtml_(t.abertura, dados);
    } else {
      abertura = '<p>Olá!</p>'
        + (dados.motivoRejeicao
            ? '<p>Sua etapa no fluxo de assinaturas do <strong>Aditamento ao TCE</strong> foi <strong>devolvida para correção</strong>. Acesse a página pelo link abaixo, verifique o motivo e reenvie o documento corrigido.</p>'
            : '<p>É a sua vez de assinar o <strong>Aditamento ao Termo de Compromisso de Estágio</strong>. Acesse a página pelo botão abaixo, baixe o documento, assine com gov.br e envie a versão assinada.</p>')
        + blocoRejeicao;
    }
    var corpo = abertura
      + campo_('ID do estágio', dados.idEstagio)
      + campo_('Estudante', dados.nomeEstudante)
      + campo_('Tipo de aditamento', dados.tipoAdendo || '—')
      + campo_('Sua etapa', 'Etapa ' + dados.numeroEtapa + '/5 — ' + dados.labelAtor)
      + campo_('Prazo limite', dados.prazoVencimento || '—')
      + botaoEmail_(pageUrl, '🖊 Acessar e Assinar Aditamento')
      + '<p style="font-size:13px;color:#6b7280;margin-top:12px;">'
      + 'Se o botão não funcionar, acesse: <a href="' + pageUrl + '" style="color:#6b7280;">' + pageUrl + '</a></p>';
    enviar_(dados.email, assunto, htmlBase_('Assinatura do Aditamento — ' + dados.labelAtor, corpo));
  }

  function enviarEmailAssinaturaAdendoInterno(dados) {
    // dados: { idEstagio, nomeEstudante, tipoAdendo, labelAtor, prazoVencimento, email, pageUrl, numeroEtapa, motivoRejeicao? }
    var pageUrl = dados.pageUrl || (BASE_URL + '/assinaturas/adendo.html?id=' + encodeURIComponent(dados.idEstagio));
    var blocoRejeicao = dados.motivoRejeicao
      ? '<div style="background:#fef2f2;border-left:4px solid #ef4444;padding:12px 16px;border-radius:4px;margin-bottom:16px;">'
        + '<p style="margin:0 0 4px;font-weight:600;color:#dc2626;">⚠️ Etapa devolvida para correção</p>'
        + '<p style="margin:0;font-size:13px;color:#374151;"><strong>Motivo:</strong> ' + escapeHtmlMail_(dados.motivoRejeicao) + '</p>'
        + '</div>'
      : '';
    var t = _tmpl_('adendoInterno');
    var assunto = t.assunto ? _assuntoTmpl_(t.assunto, dados) : '[SGE] Ação necessária — Aditamento TCE etapa ' + dados.numeroEtapa + '/5 — ' + dados.idEstagio;
    var abertura;
    if (t.abertura) {
      abertura = blocoRejeicao + _paraHtml_(t.abertura, dados);
    } else {
      abertura = '<p>Olá!</p>'
        + (dados.motivoRejeicao
            ? '<p>Uma etapa do fluxo de assinaturas do Aditamento ao TCE foi <strong>devolvida para correção</strong>. Por favor acesse o sistema e tome a devida providência.</p>'
            : '<p>O fluxo de assinaturas do Aditamento ao TCE chegou à sua etapa. Por favor, revise o documento e registre sua decisão no sistema.</p>')
        + blocoRejeicao;
    }
    var corpo = abertura
      + campo_('ID do estágio', dados.idEstagio)
      + campo_('Estudante', dados.nomeEstudante)
      + campo_('Tipo de aditamento', dados.tipoAdendo || '—')
      + campo_('Sua etapa', 'Etapa ' + dados.numeroEtapa + '/5 — ' + dados.labelAtor)
      + campo_('Prazo limite', dados.prazoVencimento || '—')
      + botaoEmail_(pageUrl, 'Acessar Fluxo de Assinaturas')
      + '<p style="font-size:13px;color:#6b7280;margin-top:12px;">'
      + 'Ou acesse: <a href="' + pageUrl + '" style="color:#6b7280;">' + pageUrl + '</a></p>';
    enviar_(dados.email, assunto, htmlBase_('Aditamento TCE — ' + dados.labelAtor, corpo));
  }

  function enviarEmailPdfFinalAdendo(dados) {
    // dados: { idEstagio, idAdendo, nomeEstudante, tipoAdendo, tokenPorAtor, destinatarios: [{email, nome, ator}] }
    var baseUrl = BASE_URL + '/assinaturas/adendo.html'
                + '?id='     + encodeURIComponent(dados.idEstagio)
                + '&adendo=' + encodeURIComponent(dados.idAdendo || '');
    var t = _tmpl_('pdfFinalAdendo');
    dados.destinatarios.forEach(function(dest) {
      var pageUrl = dest.ator && dados.tokenPorAtor && dados.tokenPorAtor[dest.ator]
        ? baseUrl + '&token=' + encodeURIComponent(dados.tokenPorAtor[dest.ator])
        : baseUrl;
      var dadosDest = Object.assign({}, dados, { nome: dest.nome });
      var abertura = t.abertura ? _paraHtml_(t.abertura, dadosDest)
        : '<p>Olá, ' + escapeHtmlMail_(dest.nome) + '!</p>'
          + '<p>O processo de assinatura do <strong>Aditamento ao Termo de Compromisso de Estágio</strong> foi concluído com sucesso! 🎉</p>';
      var encerramento = t.encerramento ? _paraHtml_(t.encerramento, dadosDest)
        : '<p style="font-size:13px;color:#6b7280;margin-top:16px;">O documento pode ser baixado diretamente na página acima.</p>';
      var assunto = t.assunto ? _assuntoTmpl_(t.assunto, dadosDest) : '[SGE] Aditamento ao TCE assinado — Estágio ' + dados.idEstagio + ' — ' + escapeHtmlMail_(dados.nomeEstudante);
      var corpo = abertura
        + campo_('ID do estágio', dados.idEstagio)
        + campo_('Estudante', dados.nomeEstudante)
        + campo_('Tipo de aditamento', dados.tipoAdendo || '—')
        + botaoEmail_(pageUrl, '📄 Acessar Aditamento Assinado')
        + encerramento;
      enviar_(dest.email, assunto, htmlBase_('Aditamento Concluído', corpo));
    });
  }

  // --------------------------------------------------------------------------
  // API pública
  // --------------------------------------------------------------------------
  return {
    enviarEmailNovaEmpresa:              enviarEmailNovaEmpresa,
    enviarEmailNovoSupervisor:           enviarEmailNovoSupervisor,
    enviarEmailSolicitacaoRecebida:      enviarEmailSolicitacaoRecebida,
    enviarEmailSolicitacaoAprovada:      enviarEmailSolicitacaoAprovada,
    enviarEmailSolicitacaoReprovada:     enviarEmailSolicitacaoReprovada,
    enviarEmailRelatorioParcialRecebido: enviarEmailRelatorioParcialRecebido,
    enviarEmailRelatorioFinalRecebido:   enviarEmailRelatorioFinalRecebido,
    enviarEmailAdendoRecebido:           enviarEmailAdendoRecebido,
    enviarEmailAdendoProcessado:         enviarEmailAdendoProcessado,
    enviarEmailNovoOrientador:           enviarEmailNovoOrientador,
    enviarEmailNovoCoordenador:          enviarEmailNovoCoordenador,
    enviarEmailRejeicaoServidor:         enviarEmailRejeicaoServidor,
    enviarEmailAtualizacaoServidor:      enviarEmailAtualizacaoServidor,
    enviarEmailNovoAgente:               enviarEmailNovoAgente,
    // Checklist
    enviarEmailChecklistNovoAdmin:       enviarEmailChecklistNovoAdmin,
    enviarEmailChecklistAtor:            enviarEmailChecklistAtor,
    enviarEmailChecklistAjuste:          enviarEmailChecklistAjuste,
    enviarEmailLembreteChecklist:        enviarEmailLembreteChecklist,
    // Assinaturas TCE
    enviarEmailAssinaturaGovBr:          enviarEmailAssinaturaGovBr,
    enviarEmailAssinaturaInterno:        enviarEmailAssinaturaInterno,
    enviarEmailLembreteAssinatura:       enviarEmailLembreteAssinatura,
    enviarEmailPdfFinalAssinaturas:      enviarEmailPdfFinalAssinaturas,
    // Assinaturas Adendo
    enviarEmailAssinaturaAdendoGovBr:    enviarEmailAssinaturaAdendoGovBr,
    enviarEmailAssinaturaAdendoInterno:  enviarEmailAssinaturaAdendoInterno,
    enviarEmailPdfFinalAdendo:           enviarEmailPdfFinalAdendo,
    // Checklist orientador (novo fluxo) + compatibilidade aceite antigo
    enviarEmailChecklistOrientador:      enviarEmailChecklistOrientador,
    enviarEmailAceiteOrientador:         enviarEmailAceiteOrientador,
    enviarEmailAguardandoAceiteEstudante:enviarEmailAguardandoAceiteEstudante,
    enviarEmailRespostaAceiteEstudante:  enviarEmailRespostaAceiteEstudante,
    // Devolução ao aluno
    enviarEmailDevolucaoChecklistAluno:  enviarEmailDevolucaoChecklistAluno,
    // Meta-dados para UI de templates
    obterMetaTemplates:                  obterMetaTemplates,
  };

  // --------------------------------------------------------------------------
  // Devolução ao aluno
  // --------------------------------------------------------------------------

  function enviarEmailDevolucaoChecklistAluno(dados) {
    // dados: { nomeEstudante, emailEstudante, idEstagio, motivo, urlSolicitacao }
    var t = _tmpl_('devolucaoAluno');
    var assunto = t.assunto ? _assuntoTmpl_(t.assunto, dados) : '[SGE] Solicitação devolvida para correção — ' + dados.idEstagio;
    var abertura = t.abertura ? _paraHtml_(t.abertura, dados)
      : '<p>Olá, <strong>' + escapeHtmlMail_(dados.nomeEstudante) + '</strong>.</p>'
        + '<p>O Setor de Estágios devolveu sua solicitação de estágio para que você realize as correções necessárias e reenvie.</p>';
    var encerramento = t.encerramento ? _paraHtml_(t.encerramento, dados)
      : '<p style="font-size:13px;color:#6b7280;margin-top:12px;">Em caso de dúvidas, entre em contato pelo e-mail '
        + '<a href="mailto:' + SETOR_EMAIL + '" style="color:#6b7280;">' + SETOR_EMAIL + '</a>.</p>';
    var corpo = abertura
      + campo_('ID da solicitação', dados.idEstagio)
      + campo_('Motivo / Orientação do setor', dados.motivo)
      + '<p>Acesse o sistema pelo botão abaixo para corrigir as informações e reenviar sua solicitação:</p>'
      + botaoEmail_(dados.urlSolicitacao, 'Acessar minha solicitação')
      + encerramento;
    enviar_(dados.emailEstudante, assunto, htmlBase_('Solicitação devolvida para correção', corpo));
  }

  // --------------------------------------------------------------------------
  // Aceite de orientação
  // --------------------------------------------------------------------------

  /**
   * E-mail para o ORIENTADOR com link único para revisão e checklist.
   * NÃO contém botões diretos de aceite/recusa — o orientador deve acessar
   * a página, revisar as informações e responder pelo checklist.
   *
   * dados: { idEstagio, nomeOrientador, emailOrientador, nomeEstudante,
   *          curso, turno, semestre, nomeEmpresa, tipoEstagio,
   *          dataInicio, dataTermino, cargaHoraria, horario,
   *          planoAtividades, objetivos, urlChecklist, prazoVencimento }
   */
  function enviarEmailChecklistOrientador(dados) {
    var urlChecklist = dados.urlChecklist || '';
    var t = _tmpl_('checklistOrientador');
    var assunto = t.assunto ? _assuntoTmpl_(t.assunto, dados)
      : '[IFRS Estágios] Checklist de orientação aguardando sua resposta — ' + dados.nomeEstudante + ' (' + dados.idEstagio + ')';
    var aberturaCustom = t.abertura ? _paraHtml_(t.abertura, dados) : null;
    var encerramentoCustom = t.encerramento ? _paraHtml_(t.encerramento, dados) : null;

    var corpo = (aberturaCustom ||
      ('<p>Olá, <strong>' + escapeHtmlMail_(dados.nomeOrientador) + '</strong>,</p>'
      + '<p>O(a) estudante <strong>' + escapeHtmlMail_(dados.nomeEstudante) + '</strong> selecionou você como orientador(a) '
      + 'de estágio. Por favor, acesse o link abaixo para <strong>revisar as informações</strong> '
      + 'e responder o checklist de orientação.</p>'))

      + '<table style="border-collapse:collapse;width:100%;margin:16px 0;">'
      + '<tr><td style="padding:8px 0;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.04em;width:140px;">Estudante</td>'
      +    '<td style="padding:8px 0;font-weight:600;">' + dados.nomeEstudante + ' — ' + dados.curso + (dados.turno ? ' (' + dados.turno + ')' : '') + '</td></tr>'
      + '<tr><td style="padding:8px 0;color:#6b7280;font-size:12px;text-transform:uppercase;">Empresa</td>'
      +    '<td style="padding:8px 0;font-weight:600;">' + dados.nomeEmpresa + '</td></tr>'
      + '<tr><td style="padding:8px 0;color:#6b7280;font-size:12px;text-transform:uppercase;">Tipo</td>'
      +    '<td style="padding:8px 0;">' + dados.tipoEstagio + '</td></tr>'
      + '<tr><td style="padding:8px 0;color:#6b7280;font-size:12px;text-transform:uppercase;">Período</td>'
      +    '<td style="padding:8px 0;">' + formatarDataBR_(dados.dataInicio) + ' a ' + formatarDataBR_(dados.dataTermino) + '</td></tr>'
      + '<tr><td style="padding:8px 0;color:#6b7280;font-size:12px;text-transform:uppercase;">Carga horária</td>'
      +    '<td style="padding:8px 0;">' + dados.cargaHoraria + '</td></tr>'
      + (dados.prazoVencimento ? '<tr><td style="padding:8px 0;color:#6b7280;font-size:12px;text-transform:uppercase;">Prazo limite</td>'
      +    '<td style="padding:8px 0;color:#dc2626;font-weight:600;">' + formatarDataBR_(dados.prazoVencimento) + '</td></tr>' : '')
      + '</table>'

      + '<p style="margin-top:28px;">'
      + '<a href="' + urlChecklist + '" style="display:inline-block;padding:14px 28px;background:#1d4ed8;'
      + 'color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:15px;">'
      + 'Revisar e responder checklist →</a></p>'

      + '<p style="margin-top:16px;font-size:13px;color:#6b7280;">'
      + 'Se o botão não funcionar, copie e acesse o link:<br>'
      + '<a href="' + urlChecklist + '" style="color:#6b7280;">' + urlChecklist + '</a></p>'

      + (encerramentoCustom ||
          ('<p style="margin-top:16px;font-size:13px;color:#6b7280;">'
          + 'Dúvidas: <a href="mailto:' + SETOR_EMAIL + '">' + SETOR_EMAIL + '</a></p>'));

    enviar_(dados.emailOrientador, assunto, htmlBase_('Checklist de Orientação', corpo));
  }

  // Mantido para compatibilidade com chamadas antigas (não mais usado no novo fluxo)
  function enviarEmailAceiteOrientador(dados) {
    enviarEmailChecklistOrientador(Object.assign({}, dados, {
      urlChecklist: 'https://ifrs-riogrande.github.io/estagios/orientadores/aceite-orientacao.html'
                  + '?token=' + (dados.token || '') + '&id=' + (dados.idEstagio || ''),
    }));
  }

  /** E-mail para o ESTUDANTE: solicitação enviada, aguardando aceite do orientador. */
  function enviarEmailAguardandoAceiteEstudante(dados) {
    var t = _tmpl_('aguardandoAceite');
    var assunto = t.assunto ? _assuntoTmpl_(t.assunto, dados) : '[IFRS Estágios] Solicitação enviada — aguardando orientador (' + dados.idEstagio + ')';
    var abertura = t.abertura ? _paraHtml_(t.abertura, dados)
      : '<p>Olá, <strong>' + escapeHtmlMail_(dados.nomeEstudante) + '</strong>!</p>'
        + '<p>Sua solicitação de estágio foi recebida. Agora aguardamos o aceite do(a) orientador(a) escolhido(a).</p>';
    var encerramento = t.encerramento ? _paraHtml_(t.encerramento, dados)
      : '<p style="background:#fef3c7;border-left:3px solid #f59e0b;padding:12px;border-radius:4px;margin-top:16px;">'
        + '⏳ <strong>Próximo passo:</strong> o(a) Prof(a). ' + escapeHtmlMail_(dados.nomeOrientador)
        + ' receberá um e-mail para confirmar a orientação. Você será notificado(a) assim que ele(a) responder.</p>'
        + '<p style="font-size:13px;color:#6b7280;">Guarde este ID — ele será necessário para relatórios e adendos.</p>';
    var corpo = abertura
      + campo_('ID da solicitação', dados.idEstagio)
      + campo_('Orientador(a)', dados.nomeOrientador)
      + campo_('Empresa', dados.nomeEmpresa)
      + campo_('Tipo', dados.tipoEstagio)
      + campo_('Período', dados.dataInicio + ' a ' + dados.dataTermino)
      + encerramento;
    enviar_(dados.emailEstudante, assunto, htmlBase_('Solicitação Recebida', corpo));
  }

  /** E-mail para o ESTUDANTE após o orientador aceitar OU recusar. */
  function enviarEmailRespostaAceiteEstudante(dados) {
    var aceito = dados.resposta === 'aceito';
    var tmplKey = aceito ? 'aceiteOrientadorAceito' : 'aceiteOrientadorRecusado';
    var t = _tmpl_(tmplKey);
    var assunto = t.assunto ? _assuntoTmpl_(t.assunto, dados)
      : '[IFRS Estágios] ' + (aceito ? 'Orientador aceitou' : 'Orientador recusou') + ' — ' + dados.idEstagio;
    var corpo;
    if (aceito) {
      var abertura = t.abertura ? _paraHtml_(t.abertura, dados)
        : '<p>Olá, <strong>' + escapeHtmlMail_(dados.nomeEstudante) + '</strong>!</p>'
          + '<p>Boa notícia! O(a) Prof(a). <strong>' + escapeHtmlMail_(dados.nomeOrientador) + '</strong> '
          + '<strong style="color:#16a34a;">aceitou</strong> orientar seu estágio. '
          + 'Sua solicitação avançou para o checklist de validação com todos os envolvidos.</p>';
      var encerramento = t.encerramento ? _paraHtml_(t.encerramento, dados)
        : '<p>Acompanhe o andamento pelo seu portal de estágios. Em breve você receberá mais informações.</p>';
      corpo = abertura + campo_('ID do estágio', dados.idEstagio) + campo_('Empresa', dados.nomeEmpresa) + encerramento;
    } else {
      var abertura = t.abertura ? _paraHtml_(t.abertura, dados)
        : '<p>Olá, <strong>' + escapeHtmlMail_(dados.nomeEstudante) + '</strong>,</p>'
          + '<p>Infelizmente o(a) Prof(a). <strong>' + escapeHtmlMail_(dados.nomeOrientador) + '</strong> '
          + '<strong style="color:#dc2626;">não pôde aceitar</strong> a orientação do seu estágio neste momento.</p>';
      var encerramento = t.encerramento ? _paraHtml_(t.encerramento, dados)
        : '<p style="background:#fef3c7;border-left:3px solid #f59e0b;padding:12px;border-radius:4px;margin-top:16px;">'
          + '👉 <strong>O que fazer:</strong> acesse seu portal de estágios, localize esta solicitação e escolha outro(a) orientador(a) disponível.</p>'
          + '<p>Dúvidas? Entre em contato: <a href="mailto:' + SETOR_EMAIL + '">' + SETOR_EMAIL + '</a></p>';
      corpo = abertura
        + campo_('ID do estágio', dados.idEstagio)
        + (dados.obs ? campo_('Motivo informado', dados.obs) : '')
        + encerramento;
    }
    enviar_(dados.emailEstudante, assunto, htmlBase_(aceito ? 'Orientação Aceita ✓' : 'Orientação Recusada', corpo));
  }

})();

// Aliases globais
function enviarEmailNovaEmpresa_(d)              { return MAIL.enviarEmailNovaEmpresa(d); }
function enviarEmailNovoSupervisor_(d)           { return MAIL.enviarEmailNovoSupervisor(d); }
function enviarEmailSolicitacaoRecebida_(d)      { return MAIL.enviarEmailSolicitacaoRecebida(d); }
function enviarEmailSolicitacaoAprovada_(d)      { return MAIL.enviarEmailSolicitacaoAprovada(d); }
function enviarEmailSolicitacaoReprovada_(d)     { return MAIL.enviarEmailSolicitacaoReprovada(d); }
function enviarEmailRelatorioParcialRecebido_(d) { return MAIL.enviarEmailRelatorioParcialRecebido(d); }
function enviarEmailRelatorioFinalRecebido_(d)   { return MAIL.enviarEmailRelatorioFinalRecebido(d); }
function enviarEmailAdendoRecebido_(d)           { return MAIL.enviarEmailAdendoRecebido(d); }
function enviarEmailAdendoProcessado_(d)         { return MAIL.enviarEmailAdendoProcessado(d); }
function enviarEmailNovoOrientador_(d)           { return MAIL.enviarEmailNovoOrientador(d); }
function enviarEmailNovoCoordenador_(d)          { return MAIL.enviarEmailNovoCoordenador(d); }
function enviarEmailRejeicaoServidor_(d)         { return MAIL.enviarEmailRejeicaoServidor(d); }
function enviarEmailAtualizacaoServidor_(d)      { return MAIL.enviarEmailAtualizacaoServidor(d); }
function enviarEmailNovoAgente_(d)               { return MAIL.enviarEmailNovoAgente(d); }
// Checklist
function enviarEmailChecklistNovoAdmin_(d)       { return MAIL.enviarEmailChecklistNovoAdmin(d); }
function enviarEmailChecklistAtor_(d)            { return MAIL.enviarEmailChecklistAtor(d); }
function enviarEmailChecklistAjuste_(d)          { return MAIL.enviarEmailChecklistAjuste(d); }
function enviarEmailLembreteChecklist_(d)        { return MAIL.enviarEmailLembreteChecklist(d); }
// Assinaturas
function enviarEmailAssinaturaGovBr_(d)          { return MAIL.enviarEmailAssinaturaGovBr(d); }
function enviarEmailAssinaturaInterno_(d)        { return MAIL.enviarEmailAssinaturaInterno(d); }
function enviarEmailLembreteAssinatura_(d)       { return MAIL.enviarEmailLembreteAssinatura(d); }
function enviarEmailPdfFinalAssinaturas_(d)      { return MAIL.enviarEmailPdfFinalAssinaturas(d); }
function enviarEmailAssinaturaAdendoGovBr_(d)   { return MAIL.enviarEmailAssinaturaAdendoGovBr(d); }
function enviarEmailAssinaturaAdendoInterno_(d) { return MAIL.enviarEmailAssinaturaAdendoInterno(d); }
function enviarEmailPdfFinalAdendo_(d)          { return MAIL.enviarEmailPdfFinalAdendo(d); }
// Checklist orientador + aceite (compatibilidade)
function enviarEmailChecklistOrientador_(d)            { return MAIL.enviarEmailChecklistOrientador(d); }
function enviarEmailAceiteOrientador_(d)               { return MAIL.enviarEmailAceiteOrientador(d); }
function enviarEmailAguardandoAceiteEstudante_(d)      { return MAIL.enviarEmailAguardandoAceiteEstudante(d); }
function enviarEmailRespostaAceiteEstudante_(d)        { return MAIL.enviarEmailRespostaAceiteEstudante(d); }
function enviarEmailDevolucaoChecklistAluno_(d)        { return MAIL.enviarEmailDevolucaoChecklistAluno(d); }
