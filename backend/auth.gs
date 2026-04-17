/**
 * auth.gs — Validação de tokens Google OAuth 2.0
 * SGE — Sistema de Gestão de Estágios · IFRS Campus Rio Grande
 *
 * Funções exportadas (chamadas pelos demais scripts):
 *   validarToken_(token)              → { ok, email, name } ou lança erro
 *   validarTokenEstudante_(token)     → idem, exige domínio @aluno.riogrande.ifrs.edu.br
 *   validarTokenServidor_(token)      → idem, exige domínio @riogrande.ifrs.edu.br
 */

'use strict';

var AUTH = (function () {

  var STUDENT_DOMAIN = 'aluno.riogrande.ifrs.edu.br';
  var STAFF_DOMAIN   = 'riogrande.ifrs.edu.br';

  /** Cache TTL para tokeninfo: 4 minutos (tokens expiram em 60 min). */
  var CACHE_TTL_SECONDS = 240;

  /**
   * Valida o token junto à API do Google e retorna { email, name }.
   * Usa o CacheService para evitar chamadas repetidas no mesmo token.
   * Lança ErroAutenticacao se inválido/expirado.
   */
  function validarToken(token) {
    if (!token || typeof token !== 'string' || token.length < 20) {
      throw new ErroAutenticacao('Token ausente ou malformado.');
    }

    // Tenta o cache primeiro
    var cache = CacheService.getScriptCache();
    var cacheKey = 'tok_' + token.slice(-32); // evita chave muito longa
    var cached   = cache.get(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch (e) { /* ignora cache corrompido */ }
    }

    // Chama tokeninfo do Google
    var url  = 'https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + encodeURIComponent(token);
    var resp;
    try {
      resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    } catch (e) {
      throw new ErroAutenticacao('Não foi possível contactar o servidor de autenticação: ' + e.message);
    }

    var code = resp.getResponseCode();
    if (code !== 200) {
      throw new ErroAutenticacao('Token inválido ou expirado (HTTP ' + code + ').');
    }

    var data;
    try { data = JSON.parse(resp.getContentText()); } catch (e) {
      throw new ErroAutenticacao('Resposta inesperada do servidor de autenticação.');
    }

    if (data.error || !data.email) {
      throw new ErroAutenticacao('Token rejeitado pelo Google: ' + (data.error_description || data.error || 'sem e-mail.'));
    }

    var info = { email: data.email.toLowerCase(), name: data.name || '' };

    // Armazena no cache
    try { cache.put(cacheKey, JSON.stringify(info), CACHE_TTL_SECONDS); } catch (e) { /* ignora */ }

    return info;
  }

  /** Valida e exige domínio de estudante. */
  function validarTokenEstudante(token) {
    var info = validarToken(token);
    if (!info.email.endsWith('@' + STUDENT_DOMAIN)) {
      throw new ErroAutenticacao('Acesso restrito a e-mails @' + STUDENT_DOMAIN + '.');
    }
    return info;
  }

  /** Valida e exige domínio de servidor. */
  function validarTokenServidor(token) {
    var info = validarToken(token);
    if (!info.email.endsWith('@' + STAFF_DOMAIN)) {
      throw new ErroAutenticacao('Acesso restrito a e-mails @' + STAFF_DOMAIN + '.');
    }
    return info;
  }

  return {
    validarToken:           validarToken,
    validarTokenEstudante:  validarTokenEstudante,
    validarTokenServidor:   validarTokenServidor,
  };
})();

// Aliases globais para compatibilidade de chamada entre arquivos GAS
function validarToken_(token)          { return AUTH.validarToken(token); }
function validarTokenEstudante_(token) { return AUTH.validarTokenEstudante(token); }
function validarTokenServidor_(token)  { return AUTH.validarTokenServidor(token); }

// ---------------------------------------------------------------------------
// Classe de erro de autenticação
// ---------------------------------------------------------------------------
function ErroAutenticacao(mensagem) {
  this.message = mensagem;
  this.name    = 'ErroAutenticacao';
  this.code    = 'AUTH_ERROR';
}
ErroAutenticacao.prototype = Object.create(Error.prototype);
