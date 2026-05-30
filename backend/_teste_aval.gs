/**
 * _teste_aval.gs — Helpers de teste para Avaliações e Parecer Final.
 * DELETE após testar.
 */

var _TESTE_ID   = 'RG26-3Y7V-1UO2';
var _TESTE_BASE = 'https://ifrs-riogrande.github.io/estagios';

// ══════════════════════════════════════════════════════════
//  AVALIAÇÕES
// ══════════════════════════════════════════════════════════

/** Apaga as avaliações antigas e cria do zero, loga todos os links */
function resetTestarAvaliacoes() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('avaliacao_' + _TESTE_ID + '_concedente_final');
  props.deleteProperty('avaliacao_' + _TESTE_ID + '_aluno_final');
  Logger.log('Avaliações apagadas. Recriando...');

  var resC = iniciarAvaliacao_(_TESTE_ID, 'concedente', 'final', '01/01/2025 a 31/12/2025', 'teste');
  var resA = iniciarAvaliacao_(_TESTE_ID, 'aluno',      'final', '01/01/2025 a 31/12/2025', 'teste');

  Logger.log('Concedente: ' + JSON.stringify(resC));
  Logger.log('Aluno: '      + JSON.stringify(resA));

  lerLinksAvaliacoes();
}

/** Só lê os links das avaliações sem recriar */
function lerLinksAvaliacoes() {
  ['concedente', 'aluno'].forEach(function(tipo) {
    var avalId = _TESTE_ID + '_' + tipo + '_final';
    var f = obterFluxoAvaliacao_(avalId);
    if (!f) { Logger.log('Não encontrado: ' + avalId); return; }

    Logger.log('\n─── AVALIAÇÃO ' + tipo.toUpperCase() + ' (status: ' + f.statusGeral + ') ───');
    Logger.log('1ª Assinatura — Preenchedor (' + (f.nomePreenchedor || '?') + '):');
    Logger.log(_TESTE_BASE + '/avaliacoes/?aval=' + avalId + '&token=' + f.tokenPreenchedor);
    Logger.log('2ª Assinatura — Revisor 1 ('   + (f.nomeRevisor1   || '?') + '):');
    Logger.log(_TESTE_BASE + '/avaliacoes/?aval=' + avalId + '&token=' + f.tokenRevisor1);
    Logger.log('3ª Assinatura — Revisor 2 ('   + (f.nomeRevisor2   || '?') + '):');
    Logger.log(_TESTE_BASE + '/avaliacoes/?aval=' + avalId + '&token=' + f.tokenRevisor2);
  });
}

// ══════════════════════════════════════════════════════════
//  PARECER FINAL
// ══════════════════════════════════════════════════════════

/**
 * Apaga o parecer anterior (se houver), inicia um novo e loga os links.
 * Pré-requisito: avaliações devem estar concluídas OU use forcarInicio=true.
 */
function resetTestarParecer() {
  var props = PropertiesService.getScriptProperties();

  // Remove parecer anterior
  props.deleteProperty('parecer_' + _TESTE_ID);
  Logger.log('Parecer anterior apagado.');

  // Forçar avaliações como concluídas para não bloquear (simula todas prontas)
  _simularAvaliacoesConcluidas_();

  // Inicia o parecer com token de admin de teste
  var adminToken = validarTokenAdmin_ ? null : null; // só usamos a função diretamente
  var res = iniciarParecerFinal_(_TESTE_ID, _obterAdminTokenTeste_());
  Logger.log('Resultado iniciarParecer: ' + JSON.stringify(res));

  lerLinksParecer();
}

/** Só lê os links do parecer sem recriar */
function lerLinksParecer() {
  var p = obterParecer_(_TESTE_ID);
  if (!p) { Logger.log('Parecer não encontrado para: ' + _TESTE_ID); return; }

  Logger.log('\n─── PARECER FINAL (status: ' + p.statusGeral + ', ciclo: ' + p.ciclo + ') ───');
  Logger.log('Tipo Diretoria: ' + p.tipoDiretoria);
  Logger.log('Coordenador (' + (p.nomeCoordenador || '?') + ' / ' + (p.emailCoordenador || '?') + '):');
  Logger.log(_TESTE_BASE + '/parecer/?id=' + _TESTE_ID + '&token=' + p.tokenCoordenador);
  Logger.log('Diretoria (' + (p.nomeDiretoria || '?') + ' / ' + (p.emailDiretoria || '?') + '):');
  Logger.log(_TESTE_BASE + '/parecer/?id=' + _TESTE_ID + '&token=' + p.tokenDiretoria);
  Logger.log('Admin (aba Parecer Final):');
  Logger.log(_TESTE_BASE + '/admin/estagio.html?id=' + _TESTE_ID);
}

/** Simula envio do parecer do coordenador e loga link da diretoria */
function simularParecerCoordenador() {
  var p = obterParecer_(_TESTE_ID);
  if (!p) { Logger.log('Parecer não encontrado. Execute resetTestarParecer() primeiro.'); return; }
  if (p.statusGeral !== PARECER_ST.AGUARDANDO_COORDENADOR) {
    Logger.log('Status atual: ' + p.statusGeral + '. Esperado: aguardando_coordenador'); return;
  }

  var res = salvarParecerCoordenador_(_TESTE_ID, p.tokenCoordenador, {
    resultado:   'aprovado',
    texto:       'O(a) aluno(a) demonstrou bom desempenho e aproveitamento durante o estágio. Aprovado.',
    totalHoras:  p.totalHoras || 120,
  });
  Logger.log('Parecer coordenador: ' + JSON.stringify(res));
  lerLinksParecer();
}

/** Simula envio do parecer da diretoria e loga situação para o admin */
function simularParecerDiretoria() {
  var p = obterParecer_(_TESTE_ID);
  if (!p) { Logger.log('Parecer não encontrado.'); return; }
  if (p.statusGeral !== PARECER_ST.AGUARDANDO_DIRETORIA) {
    Logger.log('Status atual: ' + p.statusGeral + '. Esperado: aguardando_diretoria'); return;
  }

  var res = salvarParecerDiretoria_(_TESTE_ID, p.tokenDiretoria, {
    resultado: 'aprovado',
    texto:     'Documentação regular. Estágio aprovado pela ' + p.tipoDiretoria + '.',
  });
  Logger.log('Parecer diretoria: ' + JSON.stringify(res));
  lerLinksParecer();
}

// ══════════════════════════════════════════════════════════
//  HELPERS INTERNOS
// ══════════════════════════════════════════════════════════

/** Simula avaliações concluídas no PropertiesService para desbloquer o parecer */
function _simularAvaliacoesConcluidas_() {
  var props  = PropertiesService.getScriptProperties();
  var sol    = _obterDadosSolicitacaoCompleto_(_TESTE_ID);
  if (!sol) { Logger.log('Estágio não encontrado.'); return; }

  var periodos = [];
  try {
    periodos = _calcularPeriodosAvaliacao_(
      new Date(normalizarDataISO_(sol.dataInicio)),
      new Date(normalizarDataISO_(sol.dataTermino))
    );
  } catch (_) {
    periodos = [{ tipo: 'final' }];
  }

  periodos.forEach(function(per) {
    ['concedente','aluno'].forEach(function(tipo) {
      var key = 'avaliacao_' + _TESTE_ID + '_' + tipo + '_' + per.tipo;
      var existente = props.getProperty(key);
      if (!existente) {
        // Cria um fluxo mínimo simulado como concluído
        var fluxoFake = {
          avalId: _TESTE_ID + '_' + tipo + '_' + per.tipo,
          idEstagio: _TESTE_ID,
          tipo: tipo,
          periodo: per.tipo,
          statusGeral: AVAL_ST.CONCLUIDO,
          dadosFormulario: { horasNoPeriodo: 120 },
          assinaturaPreenchedor: { nome:'Teste', cpf:'', email:'teste@teste.com', dataHora: new Date().toISOString() },
          assinaturaRevisor1:    { nome:'Teste', cpf:'', email:'teste@teste.com', dataHora: new Date().toISOString() },
          assinaturaRevisor2:    { nome:'Teste', cpf:'', email:'teste@teste.com', dataHora: new Date().toISOString() },
        };
        props.setProperty(key, JSON.stringify(fluxoFake));
        Logger.log('Simulado como concluído: ' + key);
      } else {
        // Só atualiza o status
        try {
          var f = JSON.parse(existente);
          if (f.statusGeral !== AVAL_ST.CONCLUIDO) {
            f.statusGeral = AVAL_ST.CONCLUIDO;
            props.setProperty(key, JSON.stringify(f));
            Logger.log('Status atualizado para concluído: ' + key);
          }
        } catch (_) {}
      }
    });
  });
}

/** Obtém um token de admin válido do PropertiesService */
function _obterAdminTokenTeste_() {
  var props = PropertiesService.getScriptProperties();
  var all   = props.getProperties();
  // Reutiliza token de admin existente (qualquer um com email @riogrande.ifrs.edu.br)
  for (var k in all) {
    if (k.indexOf('admin_token_') === 0) {
      var email = all[k];
      if (String(email).indexOf('@riogrande.ifrs.edu.br') > 0) return k.replace('admin_token_', '');
    }
  }
  // Fallback: cria token temporário
  var token = Utilities.getUuid();
  props.setProperty('admin_token_' + token, 'estagios@riogrande.ifrs.edu.br');
  return token;
}

/**
 * Mostra as configurações atuais de DEN e DEX cadastradas na planilha.
 * Útil para verificar antes de testar o parecer.
 */
function verConfigDiretoriasDenDex() {
  var den = _obterDiretoriaAdmin_('DEN');
  var dex = _obterDiretoriaAdmin_('DEX');
  Logger.log('DEN configurada: ' + JSON.stringify(den));
  Logger.log('DEX configurada: ' + JSON.stringify(dex));
  if (!den.email) Logger.log('⚠️  DEN sem e-mail — configure em admin/diretoria-den.html');
  if (!dex.email) Logger.log('⚠️  DEX sem e-mail — configure em admin/diretoria-dex.html');
}
