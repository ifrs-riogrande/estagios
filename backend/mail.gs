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
    enviarEmailAtualizacaoServidor:      enviarEmailAtualizacaoServidor,
    enviarEmailNovoAgente:               enviarEmailNovoAgente,
  };
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
function enviarEmailAtualizacaoServidor_(d)      { return MAIL.enviarEmailAtualizacaoServidor(d); }
function enviarEmailNovoAgente_(d)               { return MAIL.enviarEmailNovoAgente(d); }
