/**
 * notifications-bell.js — Sino de notificações in-app do SGE
 *
 * Injeta um sino no header-user-area após autenticação.
 * Busca notificações ao carregar e ao clicar no sino.
 * Para admin: busca também alertas de pendências (empresas/supervisores).
 * Marca como lida ao clicar. Marca todas ao clicar em "Marcar todas".
 */

'use strict';

(function () {

  var _notifs      = [];   // notificações pessoais (Notificacoes sheet)
  var _alertas     = [];   // alertas de pendências admin (não persistidos, sempre atuais)
  var _loaded      = false;
  var _openFlag    = false;

  // ── CSS injetado uma única vez ─────────────────────────────────────────────

  function _injectStyles() {
    if (document.getElementById('sge-bell-styles')) return;
    var style = document.createElement('style');
    style.id  = 'sge-bell-styles';
    style.textContent = [
      '.sge-bell-wrap{position:relative;display:inline-flex;align-items:center;margin-right:4px}',
      '.sge-bell-btn{position:relative;background:none;border:none;cursor:pointer;padding:0 9px;border-radius:8px;color:var(--color-text-secondary,#6b7280);display:flex;align-items:center;justify-content:center;transition:background .15s,color .15s}',
      '.sge-bell-btn:hover{background:var(--color-surface,#f3f4f6);color:var(--color-text,#111827)}',
      '.sge-bell-btn svg{width:20px;height:20px;flex-shrink:0}',
      '.sge-bell-badge{position:absolute;top:2px;right:2px;min-width:16px;height:16px;background:#ef4444;color:#fff;border-radius:99px;font-size:10px;font-weight:700;line-height:16px;text-align:center;padding:0 4px;pointer-events:none;display:none}',
      '.sge-bell-badge.has-count{display:block}',
      '.sge-bell-drop{position:absolute;top:calc(100% + 8px);right:0;width:320px;background:#fff;border:1px solid var(--color-border,#e5e7eb);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:500;display:none;overflow:hidden}',
      '.sge-bell-drop.is-open{display:block}',
      '.sge-bell-drop-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--color-border,#e5e7eb)}',
      '.sge-bell-drop-title{font-size:.82rem;font-weight:700;color:var(--color-text,#111827);text-transform:uppercase;letter-spacing:.04em}',
      '.sge-bell-mark-all{background:none;border:none;cursor:pointer;font-size:.78rem;color:var(--color-primary,#2563eb);font-weight:500;padding:0}',
      '.sge-bell-mark-all:hover{text-decoration:underline}',
      '.sge-bell-list{max-height:340px;overflow-y:auto}',
      '.sge-bell-empty{text-align:center;padding:32px 16px;color:var(--color-text-muted,#9ca3af);font-size:.85rem}',
      '.sge-bell-item{display:flex;gap:10px;align-items:flex-start;padding:12px 16px;border-bottom:1px solid var(--color-border,#e5e7eb);cursor:pointer;transition:background .12s}',
      '.sge-bell-item:last-child{border-bottom:none}',
      '.sge-bell-item:hover{background:#f9fafb}',
      '.sge-bell-dot{width:8px;height:8px;border-radius:50%;background:var(--color-primary,#2563eb);flex-shrink:0;margin-top:5px}',
      '.sge-bell-dot--alert{background:#f59e0b}',
      '.sge-bell-item-body{flex:1;min-width:0}',
      '.sge-bell-item-msg{font-size:.82rem;color:var(--color-text,#111827);line-height:1.45;margin-bottom:2px}',
      '.sge-bell-item-meta{font-size:.72rem;color:var(--color-text-muted,#9ca3af)}',
      '.sge-bell-item-meta a{color:var(--color-primary,#2563eb);text-decoration:none}',
      '.sge-bell-item-meta a:hover{text-decoration:underline}',
      '.sge-bell-section{padding:6px 16px 2px;font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-muted,#9ca3af);background:#f9fafb;border-bottom:1px solid var(--color-border,#e5e7eb)}',
      '.sge-bell-loading{text-align:center;padding:20px;color:var(--color-text-muted,#9ca3af);font-size:.82rem}',
    ].join('');
    document.head.appendChild(style);
  }

  // ── HTML do sino ───────────────────────────────────────────────────────────

  function _buildBell() {
    var wrap = document.createElement('div');
    wrap.className = 'sge-bell-wrap';
    wrap.innerHTML =
      '<button class="sge-bell-btn" id="sge-bell-btn" aria-label="Notificações" aria-expanded="false" aria-haspopup="true">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
          '<path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"/>' +
        '</svg>' +
        '<span class="sge-bell-badge" id="sge-bell-badge"></span>' +
      '</button>' +
      '<div class="sge-bell-drop" id="sge-bell-drop" role="dialog" aria-label="Notificações">' +
        '<div class="sge-bell-drop-header">' +
          '<span class="sge-bell-drop-title">Notificações</span>' +
          '<button class="sge-bell-mark-all" id="sge-bell-mark-all" type="button">Marcar todas como lidas</button>' +
        '</div>' +
        '<div class="sge-bell-list" id="sge-bell-list"><div class="sge-bell-loading">Carregando…</div></div>' +
      '</div>';
    return wrap;
  }

  // ── Renderização da lista ──────────────────────────────────────────────────

  function _renderList() {
    var list = document.getElementById('sge-bell-list');
    if (!list) return;

    var totalItems = _alertas.length + _notifs.length;
    if (totalItems === 0) {
      list.innerHTML = '<div class="sge-bell-empty">Nenhuma notificação pendente.</div>';
      return;
    }

    var html = '';

    // Alertas admin (pendências) — aparecem primeiro, em amarelo
    if (_alertas.length > 0) {
      if (_notifs.length > 0) {
        html += '<div class="sge-bell-section">Pendências</div>';
      }
      html += _alertas.map(function (a) {
        var paginaAdmin = '/estagios/admin/' + (a.link || '');
        return '<div class="sge-bell-item sge-bell-item--alerta" data-link="' + _esc(a.link || '') + '">' +
          '<div class="sge-bell-dot sge-bell-dot--alert"></div>' +
          '<div class="sge-bell-item-body">' +
            '<div class="sge-bell-item-msg">' + _esc(a.mensagem) + '</div>' +
            '<div class="sge-bell-item-meta"><a href="' + _esc(a.link || '#') + '">Ver lista →</a></div>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    // Notificações pessoais
    if (_notifs.length > 0) {
      if (_alertas.length > 0) {
        html += '<div class="sge-bell-section">Notificações</div>';
      }
      html += _notifs.map(function (n) {
        var dt = '';
        try { dt = new Date(n.timestamp).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }); } catch (_) {}
        return '<div class="sge-bell-item" data-id="' + _esc(n.id) + '">' +
          '<div class="sge-bell-dot"></div>' +
          '<div class="sge-bell-item-body">' +
            '<div class="sge-bell-item-msg">' + _esc(n.mensagem) + '</div>' +
            '<div class="sge-bell-item-meta">' + (n.idEstagio ? _esc(n.idEstagio) + ' · ' : '') + dt + '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    list.innerHTML = html;

    // Clique em alerta → navega para página
    list.querySelectorAll('.sge-bell-item--alerta').forEach(function (el) {
      el.addEventListener('click', function () {
        var link = el.dataset.link;
        if (link) window.location.href = link;
      });
    });

    // Clique em notificação pessoal → marca como lida
    list.querySelectorAll('.sge-bell-item[data-id]').forEach(function (el) {
      if (el.classList.contains('sge-bell-item--alerta')) return;
      el.addEventListener('click', function () {
        _marcarLida(el.dataset.id);
      });
    });
  }

  function _updateBadge() {
    var badge = document.getElementById('sge-bell-badge');
    if (!badge) return;
    var count = _alertas.length + _notifs.length;
    badge.textContent = count > 9 ? '9+' : String(count);
    if (count > 0) badge.classList.add('has-count');
    else           badge.classList.remove('has-count');
  }

  // ── API calls ─────────────────────────────────────────────────────────────

  function _carregar() {
    var token = typeof getAccessToken === 'function' ? getAccessToken() : null;
    if (!token) return;
    var list = document.getElementById('sge-bell-list');
    if (list) list.innerHTML = '<div class="sge-bell-loading">Carregando…</div>';

    // Carrega notificações pessoais
    var pNotifs = API.get('listarNotificacoes', { authToken: token })
      .then(function (data) {
        _notifs = (data && data.notificacoes) || [];
      })
      .catch(function () {
        _notifs = [];
      });

    // Tenta carregar alertas admin — falha silenciosamente para não-admin
    var pAlertas = API.get('listarAlertasAdmin', { authToken: token })
      .then(function (data) {
        _alertas = (data && data.alertas) || [];
      })
      .catch(function () {
        _alertas = []; // não é admin — ignora
      });

    Promise.all([pNotifs, pAlertas]).then(function () {
      _loaded = true;
      _renderList();
      _updateBadge();
    });
  }

  function _marcarLida(id) {
    var token = typeof getAccessToken === 'function' ? getAccessToken() : null;
    if (!token || !id) return;
    API.post('marcarNotificacaoLida', { authToken: token, id: id })
      .catch(function () {});
    _notifs = _notifs.filter(function (n) { return n.id !== id; });
    _renderList();
    _updateBadge();
  }

  function _marcarTodas() {
    var token = typeof getAccessToken === 'function' ? getAccessToken() : null;
    if (!token) return;
    // Marca notificações pessoais
    if (_notifs.length > 0) {
      API.post('marcarTodasNotificacoesLidas', { authToken: token })
        .catch(function () {});
      _notifs = [];
    }
    // Alertas admin não são persistidos — apenas limpa da tela
    _alertas = [];
    _renderList();
    _updateBadge();
  }

  // ── Toggle dropdown ────────────────────────────────────────────────────────

  function _toggleDrop() {
    var drop = document.getElementById('sge-bell-drop');
    var btn  = document.getElementById('sge-bell-btn');
    if (!drop) return;
    _openFlag = !_openFlag;
    drop.classList.toggle('is-open', _openFlag);
    if (btn) btn.setAttribute('aria-expanded', String(_openFlag));
    if (_openFlag && !_loaded) _carregar();
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    _injectStyles();
    var area = document.getElementById('header-user-area');
    if (!area) return;

    var wrap = _buildBell();
    area.parentNode.insertBefore(wrap, area);


    // Eventos
    document.getElementById('sge-bell-btn').addEventListener('click', function (e) {
      e.stopPropagation();
      _toggleDrop();
    });
    document.getElementById('sge-bell-mark-all').addEventListener('click', function (e) {
      e.stopPropagation();
      _marcarTodas();
    });
    document.addEventListener('click', function (e) {
      var drop = document.getElementById('sge-bell-drop');
      var wrap2 = drop && drop.closest('.sge-bell-wrap');
      if (drop && _openFlag && wrap2 && !wrap2.contains(e.target)) {
        _openFlag = false;
        drop.classList.remove('is-open');
        var btn = document.getElementById('sge-bell-btn');
        if (btn) btn.setAttribute('aria-expanded', 'false');
      }
    });

    // Carrega ao iniciar
    _carregar();
  }

  // ── Escape helper ─────────────────────────────────────────────────────────
  function _esc(str) {
    return String(str || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  // ── Exporta para uso em auth.js ───────────────────────────────────────────
  window.SGE_BELL = { init: init };

})();
