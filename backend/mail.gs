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
    return '<p class="label">' + label + '</p><p class="value">' + (valor || '—') + '</p>';
  }

  function enviar_(para, assunto, htmlBody, cc) {
    var opts = { htmlBody: htmlBody, name: SISTEMA_NOME };
    if (cc) opts.cc = cc;
    try {
      GmailApp.sendEmail(para, assunto, '', opts);
    } catch (e) {
      // Fallback para MailApp se GmailApp falhar
      try { MailApp.sendEmail({ to: para, subject: assunto, htmlBody: htmlBody, name: SISTEMA_NOME }); } catch (e2) { /* silencioso */ }
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
    var corpoEstudante = '<p>Olá, <strong>' + dados.nomeEstudante + '</strong>!</p>'
      + '<p>Sua solicitação de estágio foi recebida e está em análise. Entraremos em contato assim que for processada.</p>'
      + campo_('ID da solicitação', dados.idEstagio)
      + campo_('Empresa', dados.nomeEmpresa)
      + campo_('Tipo de estágio', dados.tipoEstagio)
      + campo_('Início previsto', dados.dataInicio)
      + campo_('Término previsto', dados.dataTermino)
      + '<p style="color:#6b7280;font-size:13px;">Guarde este ID — ele será necessário para relatórios e adendos.</p>';
    enviar_(dados.emailEstudante, '[SGE] Solicitação de estágio recebida — ' + dados.idEstagio,
      htmlBase_('Solicitação Recebida', corpoEstudante));

    // Para o setor
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
      var corpoOrientador = '<p>Uma nova solicitação de estágio foi registrada com você como orientador.</p>'
        + campo_('ID', dados.idEstagio)
        + campo_('Estudante', dados.nomeEstudante)
        + campo_('Empresa', dados.nomeEmpresa)
        + campo_('Período', dados.dataInicio + ' a ' + dados.dataTermino)
        + '<p>Aguarde contato do setor de estágios para os próximos passos.</p>';
      enviar_(dados.emailOrientador, '[SGE] Novo estagiário sob sua orientação — ' + dados.idEstagio,
        htmlBase_('Nova Solicitação de Estágio', corpoOrientador));
    }
  }

  function enviarEmailSolicitacaoAprovada(dados) {
    var corpo = '<p>Olá, <strong>' + dados.nomeEstudante + '</strong>!</p>'
      + '<p>Sua solicitação de estágio foi <strong style="color:#16a34a;">aprovada</strong>! O Termo de Compromisso de Estágio (TCE) será encaminhado para assinatura.</p>'
      + campo_('ID do estágio', dados.idEstagio)
      + campo_('Empresa', dados.nomeEmpresa)
      + campo_('Início', dados.dataInicio)
      + campo_('Término', dados.dataTermino)
      + '<p>Fique atento ao seu e-mail para as instruções sobre a assinatura do TCE.</p>';
    enviar_(dados.emailEstudante, '[SGE] Estágio aprovado — ' + dados.idEstagio,
      htmlBase_('Estágio Aprovado! ✓', corpo));
  }

  function enviarEmailSolicitacaoReprovada(dados) {
    var corpo = '<p>Olá, <strong>' + dados.nomeEstudante + '</strong>.</p>'
      + '<p>Infelizmente, sua solicitação de estágio não foi aprovada neste momento.</p>'
      + campo_('ID da solicitação', dados.idEstagio)
      + campo_('Motivo', dados.motivo || 'Consulte o setor de estágios para mais informações.')
      + '<p>Em caso de dúvidas, entre em contato com o setor pelo e-mail '
      + '<a href="mailto:' + SETOR_EMAIL + '">' + SETOR_EMAIL + '</a>.</p>';
    enviar_(dados.emailEstudante, '[SGE] Solicitação não aprovada — ' + dados.idEstagio,
      htmlBase_('Resultado da Solicitação', corpo));
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
    var corpo = '<p>Uma solicitação de adendo ao TCE foi recebida.</p>'
      + campo_('ID do estágio', dados.idEstagio)
      + campo_('Tipo de alteração', dados.tipoAdendo)
      + campo_('Justificativa', dados.justificativa)
      + (dados.novaDataTermino ? campo_('Nova data de término', dados.novaDataTermino) : '')
      + (dados.novaCargaHoraria ? campo_('Nova carga horária', dados.novaCargaHoraria) : '')
      + (dados.novoHorario ? campo_('Novo horário', dados.novoHorario) : '');
    enviar_(SETOR_EMAIL, '[SGE] Adendo ao TCE — ' + dados.idEstagio,
      htmlBase_('[SGE] Adendo ao TCE', corpo));
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
    var corpo = '<p>Olá' + (dados.nome ? ', <strong>' + dados.nome + '</strong>' : '') + ',</p>'
      + '<p>Seu cadastro como <strong>' + tipoLabel + '</strong> não foi aprovado pelo setor de estágios do IFRS Campus Rio Grande.</p>'
      + (dados.obs ? '<p class="label">Motivo / Observações</p><p class="value" style="white-space:pre-wrap">' + dados.obs + '</p>' : '')
      + '<p>Você pode corrigir os dados e reenviar seu cadastro pelo portal:</p>'
      + '<p><a href="' + linkPerfil + '" style="color:#1d4ed8;">' + linkPerfil + '</a></p>'
      + '<p>Dúvidas: <a href="mailto:' + SETOR_EMAIL + '">' + SETOR_EMAIL + '</a></p>';
    var assunto = '[IFRS Estágios] Cadastro de ' + tipoLabel + ' não aprovado';
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
      + '<a href="' + BASE_URL + '/admin/" style="display:inline-block;background:#1d4ed8;color:#fff;'
      + 'padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Acessar Painel Admin</a></p>';
    enviar_(SETOR_EMAIL,
      '[SGE] Novo checklist aguardando revisão — ' + dados.idEstagio,
      htmlBase_('Checklist Pendente — Admin', corpo));
  }

  function enviarEmailChecklistAtor(dados) {
    // dados: { idEstagio, nomeEstudante, curso, nomeEmpresa, labelAtor, prazoVencimento, email }
    var urlChecklist = BASE_URL + '/checklist/?id=' + encodeURIComponent(dados.idEstagio);
    var corpo = '<p>Olá!</p>'
      + '<p>O checklist da solicitação de estágio abaixo foi liberado para sua análise. '
      + 'Por favor, acesse o sistema e responda até a data limite.</p>'
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
    enviar_(dados.email,
      '[SGE] Checklist de estágio aguardando sua resposta — ' + dados.idEstagio,
      htmlBase_('Checklist — ' + dados.labelAtor, corpo));
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
    // dados: { idEstagio, nomeEstudante, labelAtor, prazoVencimento, email }
    var urlChecklist = BASE_URL + '/checklist/?id=' + encodeURIComponent(dados.idEstagio);
    var corpo = '<p>Olá!</p>'
      + '<p>Este é um lembrete: o prazo para sua resposta no checklist de estágio vence em '
      + '<strong>2 dias úteis</strong>.</p>'
      + campo_('ID do estágio', dados.idEstagio)
      + campo_('Estudante', dados.nomeEstudante)
      + campo_('Seu papel', dados.labelAtor)
      + campo_('Prazo limite', dados.prazoVencimento)
      + '<p style="margin-top:24px;">'
      + '<a href="' + urlChecklist + '" style="display:inline-block;background:#d97706;color:#fff;'
      + 'padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Responder Agora</a></p>';
    enviar_(dados.email,
      '[SGE] Lembrete: prazo se encerrando — checklist ' + dados.idEstagio,
      htmlBase_('Lembrete de Prazo — Checklist', corpo));
  }

  // --------------------------------------------------------------------------
  // Assinaturas
  // --------------------------------------------------------------------------

  function enviarEmailAssinaturaGovBr(dados) {
    // dados: { idEstagio, nomeEstudante, labelAtor, prazoVencimento, email, driveUrl, numeroEtapa }
    var urlSistema = BASE_URL + '/assinaturas/?id=' + encodeURIComponent(dados.idEstagio);
    var pdfUrl     = dados.driveUrl || urlSistema;
    var corpo = '<p>Olá!</p>'
      + '<p>É a sua vez de assinar o Termo de Compromisso de Estágio (TCE) '
      + 'utilizando sua conta <strong>gov.br</strong>. Siga os passos abaixo:</p>'
      + '<ol style="line-height:2.2;padding-left:20px;">'
      + '<li>Baixe o TCE pelo link abaixo.</li>'
      + '<li>Acesse <a href="https://assinador.iti.br" style="color:#1d4ed8;">assinador.iti.br</a> '
      + 'e faça login com sua conta gov.br.</li>'
      + '<li>Carregue e assine o documento.</li>'
      + '<li>Volte ao sistema e envie o arquivo assinado.</li>'
      + '</ol>'
      + campo_('ID do estágio', dados.idEstagio)
      + campo_('Estudante', dados.nomeEstudante)
      + campo_('Sua etapa', 'Etapa ' + dados.numeroEtapa + '/8 — ' + dados.labelAtor)
      + campo_('Prazo limite', dados.prazoVencimento)
      + '<p style="margin-top:24px;">'
      + '<a href="' + pdfUrl + '" style="display:inline-block;background:#4b5563;color:#fff;'
      + 'padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;margin-right:8px;">⬇ Baixar TCE</a>'
      + '<a href="' + urlSistema + '" style="display:inline-block;background:#1d4ed8;color:#fff;'
      + 'padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">📤 Enviar Assinado</a>'
      + '</p>'
      + '<p style="font-size:13px;color:#6b7280;margin-top:16px;">'
      + 'Dúvidas sobre assinatura gov.br: '
      + '<a href="https://www.gov.br/governodigital/pt-br/assinatura-eletronica" style="color:#6b7280;">'
      + 'gov.br/assinatura-eletronica</a></p>';
    enviar_(dados.email,
      '[SGE] Assine o TCE (etapa ' + dados.numeroEtapa + '/8) — ' + dados.idEstagio,
      htmlBase_('Assinatura do TCE — ' + dados.labelAtor, corpo));
  }

  function enviarEmailAssinaturaInterno(dados) {
    // dados: { idEstagio, nomeEstudante, labelAtor, prazoVencimento, email, numeroEtapa }
    var urlSistema = BASE_URL + '/assinaturas/?id=' + encodeURIComponent(dados.idEstagio);
    var corpo = '<p>Olá!</p>'
      + '<p>O fluxo de assinaturas do TCE chegou à sua etapa. '
      + 'Por favor, revise o documento e registre sua decisão no sistema.</p>'
      + campo_('ID do estágio', dados.idEstagio)
      + campo_('Estudante', dados.nomeEstudante)
      + campo_('Sua etapa', 'Etapa ' + dados.numeroEtapa + '/8 — ' + dados.labelAtor)
      + campo_('Prazo limite', dados.prazoVencimento)
      + '<p style="margin-top:24px;">'
      + '<a href="' + urlSistema + '" style="display:inline-block;background:#1d4ed8;color:#fff;'
      + 'padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">'
      + 'Acessar Fluxo de Assinaturas</a></p>';
    enviar_(dados.email,
      '[SGE] Ação necessária — fluxo TCE etapa ' + dados.numeroEtapa + '/8 — ' + dados.idEstagio,
      htmlBase_('Fluxo TCE — ' + dados.labelAtor, corpo));
  }

  function enviarEmailLembreteAssinatura(dados) {
    // dados: { idEstagio, nomeEstudante, labelAtor, prazoVencimento, email, numeroEtapa, tipo }
    var urlSistema = BASE_URL + '/assinaturas/?id=' + encodeURIComponent(dados.idEstagio);
    var instrucao  = dados.tipo === 'govbr'
      ? 'Você ainda precisa baixar o TCE, assinar com gov.br e enviar o arquivo assinado.'
      : 'Você ainda precisa acessar o sistema, revisar e registrar sua decisão.';
    var corpo = '<p>Olá!</p>'
      + '<p>⚠️ O prazo para sua ação no fluxo de assinaturas vence em <strong>2 dias úteis</strong>. '
      + instrucao + '</p>'
      + campo_('ID do estágio', dados.idEstagio)
      + campo_('Estudante', dados.nomeEstudante)
      + campo_('Sua etapa', 'Etapa ' + dados.numeroEtapa + '/8 — ' + dados.labelAtor)
      + campo_('Prazo limite', dados.prazoVencimento)
      + '<p style="margin-top:24px;">'
      + '<a href="' + urlSistema + '" style="display:inline-block;background:#d97706;color:#fff;'
      + 'padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Agir Agora</a></p>';
    enviar_(dados.email,
      '[SGE] Lembrete: prazo se encerrando — assinatura TCE etapa ' + dados.numeroEtapa + ' — ' + dados.idEstagio,
      htmlBase_('Lembrete — Assinatura TCE', corpo));
  }

  function enviarEmailPdfFinalAssinaturas(dados) {
    // dados: { idEstagio, nomeEstudante, driveUrl, destinatarios: [{email, nome}] }
    var corpo = '<p>O processo de assinatura do Termo de Compromisso de Estágio foi concluído com sucesso! 🎉</p>'
      + '<p>O TCE está totalmente assinado e o estágio está oficialmente ativo.</p>'
      + campo_('ID do estágio', dados.idEstagio)
      + campo_('Estudante', dados.nomeEstudante)
      + '<p style="margin-top:24px;">'
      + '<a href="' + (dados.driveUrl || '#') + '" style="display:inline-block;background:#16a34a;color:#fff;'
      + 'padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">⬇ Acessar TCE Final</a></p>'
      + '<p style="font-size:13px;color:#6b7280;margin-top:16px;">'
      + 'Guarde este documento — ele é o comprovante oficial do seu estágio.</p>';
    var emails = (dados.destinatarios || []).map(function (d) { return d.email; }).filter(Boolean);
    if (!emails.length) return;
    enviar_(emails[0],
      '[SGE] TCE assinado — estágio ativo! — ' + dados.idEstagio,
      htmlBase_('TCE Concluído — Estágio Ativo ✓', corpo),
      emails.length > 1 ? emails.slice(1).join(',') : undefined);
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
    // Assinaturas
    enviarEmailAssinaturaGovBr:          enviarEmailAssinaturaGovBr,
    enviarEmailAssinaturaInterno:        enviarEmailAssinaturaInterno,
    enviarEmailLembreteAssinatura:       enviarEmailLembreteAssinatura,
    enviarEmailPdfFinalAssinaturas:      enviarEmailPdfFinalAssinaturas,
    // Aceite orientador
    enviarEmailAceiteOrientador:         enviarEmailAceiteOrientador,
    enviarEmailAguardandoAceiteEstudante:enviarEmailAguardandoAceiteEstudante,
    enviarEmailRespostaAceiteEstudante:  enviarEmailRespostaAceiteEstudante,
  };

  // --------------------------------------------------------------------------
  // Aceite de orientação
  // --------------------------------------------------------------------------

  /** E-mail para o ORIENTADOR com botões Aceitar / Recusar. */
  function enviarEmailAceiteOrientador(dados) {
    var BASE_URL = 'https://ifrs-riogrande.github.io/estagios/orientadores/aceite-orientacao.html';
    var linkAceite  = BASE_URL + '?token=' + dados.token + '&r=aceito';
    var linkRecusa  = BASE_URL + '?token=' + dados.token + '&r=recusado';

    var corpo =
      '<p>Olá, <strong>' + dados.nomeOrientador + '</strong>,</p>'
      + '<p>O(a) estudante <strong>' + dados.nomeEstudante + '</strong> selecionou você como orientador(a) de estágio. '
      + 'Por favor, confirme se você aceita assumir a orientação desta solicitação.</p>'

      + '<table style="border-collapse:collapse;width:100%;margin:16px 0;">'
      + '<tr><td style="padding:8px 0;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.04em;">Estudante</td>'
      +    '<td style="padding:8px 0;font-weight:600;">' + dados.nomeEstudante + ' — ' + dados.curso + (dados.turno ? ' (' + dados.turno + ')' : '') + '</td></tr>'
      + '<tr><td style="padding:8px 0;color:#6b7280;font-size:12px;text-transform:uppercase;">Empresa</td>'
      +    '<td style="padding:8px 0;font-weight:600;">' + dados.nomeEmpresa + '</td></tr>'
      + '<tr><td style="padding:8px 0;color:#6b7280;font-size:12px;text-transform:uppercase;">Tipo</td>'
      +    '<td style="padding:8px 0;">' + dados.tipoEstagio + '</td></tr>'
      + '<tr><td style="padding:8px 0;color:#6b7280;font-size:12px;text-transform:uppercase;">Período</td>'
      +    '<td style="padding:8px 0;">' + dados.dataInicio + ' a ' + dados.dataTermino + '</td></tr>'
      + '<tr><td style="padding:8px 0;color:#6b7280;font-size:12px;text-transform:uppercase;">Carga horária</td>'
      +    '<td style="padding:8px 0;">' + dados.cargaHoraria + '</td></tr>'
      + '</table>'

      + '<p style="color:#374151;"><strong>Plano de atividades:</strong><br>' + (dados.planoAtividades || '—') + '</p>'

      + '<p style="margin-top:28px;font-weight:600;">Clique em uma das opções abaixo:</p>'
      + '<table><tr>'
      + '<td style="padding-right:12px;">'
      +   '<a href="' + linkAceite + '" style="display:inline-block;padding:12px 24px;background:#16a34a;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:15px;">✓ Aceitar orientação</a>'
      + '</td>'
      + '<td>'
      +   '<a href="' + linkRecusa + '" style="display:inline-block;padding:12px 24px;background:#dc2626;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:15px;">✗ Recusar</a>'
      + '</td>'
      + '</tr></table>'

      + '<p style="margin-top:24px;font-size:13px;color:#6b7280;">Se os botões não funcionarem, copie e acesse o link:<br>'
      + '<a href="' + BASE_URL + '?token=' + dados.token + '" style="color:#1d4ed8;">' + BASE_URL + '?token=' + dados.token + '</a></p>';

    enviar_(dados.emailOrientador,
      '[IFRS Estágios] Solicitação de orientação — ' + dados.nomeEstudante + ' (' + dados.idEstagio + ')',
      htmlBase_('Solicitação de Orientação', corpo));
  }

  /** E-mail para o ESTUDANTE: solicitação enviada, aguardando aceite do orientador. */
  function enviarEmailAguardandoAceiteEstudante(dados) {
    var corpo =
      '<p>Olá, <strong>' + dados.nomeEstudante + '</strong>!</p>'
      + '<p>Sua solicitação de estágio foi recebida. Agora aguardamos o aceite do(a) orientador(a) escolhido(a).</p>'
      + campo_('ID da solicitação', dados.idEstagio)
      + campo_('Orientador(a)', dados.nomeOrientador)
      + campo_('Empresa', dados.nomeEmpresa)
      + campo_('Tipo', dados.tipoEstagio)
      + campo_('Período', dados.dataInicio + ' a ' + dados.dataTermino)
      + '<p style="background:#fef3c7;border-left:3px solid #f59e0b;padding:12px;border-radius:4px;margin-top:16px;">'
      + '⏳ <strong>Próximo passo:</strong> o(a) Prof(a). ' + dados.nomeOrientador
      + ' receberá um e-mail para confirmar a orientação. Você será notificado(a) assim que ele(a) responder.</p>'
      + '<p style="font-size:13px;color:#6b7280;">Guarde este ID — ele será necessário para relatórios e adendos.</p>';

    enviar_(dados.emailEstudante,
      '[IFRS Estágios] Solicitação enviada — aguardando orientador (' + dados.idEstagio + ')',
      htmlBase_('Solicitação Recebida', corpo));
  }

  /** E-mail para o ESTUDANTE após o orientador aceitar OU recusar. */
  function enviarEmailRespostaAceiteEstudante(dados) {
    var aceito = dados.resposta === 'aceito';
    var corpo;
    if (aceito) {
      corpo =
        '<p>Olá, <strong>' + dados.nomeEstudante + '</strong>!</p>'
        + '<p>Boa notícia! O(a) Prof(a). <strong>' + dados.nomeOrientador + '</strong> '
        + '<strong style="color:#16a34a;">aceitou</strong> orientar seu estágio. '
        + 'Sua solicitação avançou para o checklist de validação com todos os envolvidos.</p>'
        + campo_('ID do estágio', dados.idEstagio)
        + campo_('Empresa', dados.nomeEmpresa)
        + '<p>Acompanhe o andamento pelo seu portal de estágios. Em breve você receberá mais informações.</p>';
    } else {
      corpo =
        '<p>Olá, <strong>' + dados.nomeEstudante + '</strong>,</p>'
        + '<p>Infelizmente o(a) Prof(a). <strong>' + dados.nomeOrientador + '</strong> '
        + '<strong style="color:#dc2626;">não pôde aceitar</strong> a orientação do seu estágio neste momento.</p>'
        + campo_('ID do estágio', dados.idEstagio)
        + (dados.obs ? campo_('Motivo informado', dados.obs) : '')
        + '<p style="background:#fef3c7;border-left:3px solid #f59e0b;padding:12px;border-radius:4px;margin-top:16px;">'
        + '👉 <strong>O que fazer:</strong> acesse seu portal de estágios, localize esta solicitação e escolha outro(a) orientador(a) disponível.</p>'
        + '<p>Dúvidas? Entre em contato: <a href="mailto:' + SETOR_EMAIL + '">' + SETOR_EMAIL + '</a></p>';
    }

    enviar_(dados.emailEstudante,
      '[IFRS Estágios] ' + (aceito ? 'Orientador aceitou' : 'Orientador recusou') + ' — ' + dados.idEstagio,
      htmlBase_(aceito ? 'Orientação Aceita ✓' : 'Orientação Recusada', corpo));
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
// Aceite orientador
function enviarEmailAceiteOrientador_(d)              { return MAIL.enviarEmailAceiteOrientador(d); }
function enviarEmailAguardandoAceiteEstudante_(d)      { return MAIL.enviarEmailAguardandoAceiteEstudante(d); }
function enviarEmailRespostaAceiteEstudante_(d)        { return MAIL.enviarEmailRespostaAceiteEstudante(d); }
