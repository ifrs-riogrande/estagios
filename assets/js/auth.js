/* ============================================================
   IFRS CAMPUS RIO GRANDE — CENTRAL DE ESTÁGIOS
   auth.js — autenticação Google OAuth
   ============================================================
   Decisão: usa o fluxo OAuth 2.0 implícito via Google Identity
   Services (GIS), que é o método atual recomendado pelo Google
   para SPAs estáticas sem backend próprio.

   O token obtido é usado apenas para:
   1. Identificar o e-mail do usuário (domínio @ifrs.edu.br)
   2. Ser enviado ao GAS que valida o token server-side via
      Google's tokeninfo endpoint antes de processar qualquer
      dado sensível.

   Nunca armazenamos o token em localStorage — apenas em
   sessionStorage para duração da sessão.
   ============================================================ */

'use strict';

// ─────────────────────────────────────────
//  CONFIGURAÇÃO
//  CLIENT_ID: ID OAuth da aplicação registrada no Google Cloud
//  Console. Precisa ser configurado após criar o projeto OAuth.
//  Escopos solicitados: apenas e-mail e perfil básico.
// ─────────────────────────────────────────
const AUTH_CONFIG = {
  // Substitua pelo Client ID real do Google Cloud Console
  // Tipo: "Aplicativo da Web" com origins do GitHub Pages
  CLIENT_ID: '913495304278-opds2dsajahcl5khbs1qsqae1dmg4ggg.apps.googleusercontent.com',
  SCOPES: 'openid email profile',

  // Domínios permitidos para cada tipo de acesso
  STUDENT_DOMAIN: '@aluno.riogrande.ifrs.edu.br',
  STAFF_DOMAIN: '@riogrande.ifrs.edu.br',

  // E-mails com acesso ao Admin (setor de estágios)
  ADMIN_EMAILS: [
    'estagios@riogrande.ifrs.edu.br',
    'dex@riogrande.ifrs.edu.br',
    'den@riogrande.ifrs.edu.br',
  ],
};

// Chave de armazenamento na sessionStorage
const SESSION_KEY = 'sge_session';

// ─────────────────────────────────────────
//  ESTADO DA SESSÃO
// ─────────────────────────────────────────

/**
 * Salva os dados da sessão (token + info do usuário).
 * @param {Object} data - { token, email, name, picture, expires_at }
 */
function saveSession(data) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch (e) {
    // sessionStorage pode estar bloqueado (modo privado restrito)
    console.warn('Não foi possível salvar sessão:', e.message);
  }
}

/**
 * Recupera os dados da sessão atual.
 * @returns {Object|null}
 */
function getSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    // Verifica expiração
    if (session.expires_at && Date.now() > session.expires_at) {
      clearSession();
      return null;
    }
    return session;
  } catch (e) {
    return null;
  }
}

/**
 * Limpa a sessão.
 */
function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
}

/**
 * Retorna se há uma sessão ativa válida.
 */
function isLoggedIn() {
  return getSession() !== null;
}

/**
 * Retorna o e-mail do usuário logado ou null.
 */
function getCurrentUserEmail() {
  const session = getSession();
  return session ? session.email : null;
}

/**
 * Retorna o nome do usuário logado ou null.
 */
function getCurrentUserName() {
  const session = getSession();
  return session ? session.name : null;
}

/**
 * Retorna o token de acesso atual ou null.
 */
function getAccessToken() {
  const session = getSession();
  return session ? session.token : null;
}

// ─────────────────────────────────────────
//  FLUXO DE LOGIN
// ─────────────────────────────────────────

/**
 * Inicializa o Google Identity Services e solicita login.
 * Chama onSuccess(session) ou onError(message) ao concluir.
 *
 * @param {Function} onSuccess - cb(session: {email, name, token})
 * @param {Function} onError   - cb(message: string)
 */
function requestLogin(onSuccess, onError) {
  // Verifica se a biblioteca GIS está carregada
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
    onError('A biblioteca de autenticação do Google não foi carregada. Verifique sua conexão.');
    return;
  }

  const client = google.accounts.oauth2.initTokenClient({
    client_id: AUTH_CONFIG.CLIENT_ID,
    scope: AUTH_CONFIG.SCOPES,
    callback: (tokenResponse) => {
      if (tokenResponse.error) {
        onError('Falha na autenticação: ' + (tokenResponse.error_description || tokenResponse.error));
        return;
      }
      // Busca informações do usuário com o token obtido
      fetchUserInfo(tokenResponse.access_token)
        .then(userInfo => {
          const session = {
            token: tokenResponse.access_token,
            email: userInfo.email,
            name: userInfo.name,
            picture: userInfo.picture,
            // Token dura 1h — armazena tempo de expiração
            expires_at: Date.now() + (tokenResponse.expires_in || 3600) * 1000,
          };
          saveSession(session);
          onSuccess(session);
        })
        .catch(err => {
          onError('Não foi possível obter informações do usuário. Tente novamente.');
          console.error('fetchUserInfo error:', err);
        });
    },
  });

  client.requestAccessToken();
}

/**
 * Busca informações do perfil Google com o token de acesso.
 * Usa o endpoint padrão do Google — não expõe dados sensíveis.
 */
async function fetchUserInfo(accessToken) {
  const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) throw new Error('userinfo request failed: ' + resp.status);
  return resp.json();
}

/**
 * Faz logout — limpa sessão e revoga token no Google.
 */
function logout(redirectTo = '/') {
  const session = getSession();
  if (session && session.token && typeof google !== 'undefined') {
    try {
      google.accounts.oauth2.revoke(session.token, () => {});
    } catch (e) {}
  }
  clearSession();
  window.location.href = redirectTo;
}

// ─────────────────────────────────────────
//  GUARDS DE ACESSO
//  Chamados no topo de páginas restritas.
//  Se o usuário não tiver acesso, renderiza a tela de login.
// ─────────────────────────────────────────

/**
 * Exige que o usuário esteja logado com e-mail de estudante.
 * Se não estiver, renderiza a tela de autenticação no lugar do conteúdo.
 *
 * Uso em páginas de estudantes:
 *   requireStudentAuth();
 *
 * @param {string} [redirectAfter] - URL para redirecionar após login (padrão: página atual)
 */
function requireStudentAuth(redirectAfter) {
  const session = getSession();
  if (session && session.email && session.email.endsWith(AUTH_CONFIG.STUDENT_DOMAIN)) {
    // Acesso permitido — atualiza UI com dados do usuário
    updateHeaderUser(session);
    return true;
  }
  renderAuthGate(
    'Acesso restrito a estudantes',
    `Esta página é exclusiva para estudantes com e-mail institucional <strong>${AUTH_CONFIG.STUDENT_DOMAIN}</strong>.`,
    redirectAfter || window.location.href,
    'student'
  );
  return false;
}

/**
 * Exige que o usuário esteja logado com e-mail de servidor.
 */
function requireStaffAuth(redirectAfter) {
  const session = getSession();
  if (session && session.email && session.email.endsWith(AUTH_CONFIG.STAFF_DOMAIN)) {
    updateHeaderUser(session);
    return true;
  }
  renderAuthGate(
    'Acesso restrito a servidores',
    `Esta página é exclusiva para servidores com e-mail institucional <strong>${AUTH_CONFIG.STAFF_DOMAIN}</strong>.`,
    redirectAfter || window.location.href,
    'staff'
  );
  return false;
}

/**
 * Verifica se o e-mail logado pertence ao Admin do setor de estágios.
 * @returns {boolean}
 */
function isAdmin() {
  const session = getSession();
  if (!session || !session.email) return false;
  return AUTH_CONFIG.ADMIN_EMAILS.includes(session.email.toLowerCase());
}

/**
 * Exige acesso Admin (lista de e-mails específicos do setor).
 * Bloqueia qualquer outro e-mail mesmo que seja @riogrande.ifrs.edu.br.
 */
function requireAdminAuth(redirectAfter) {
  const session = getSession();
  if (session && session.email && isAdmin()) {
    updateHeaderUser(session);
    return true;
  }
  // Usuário logado mas sem permissão de Admin
  if (session && session.email) {
    const main = document.querySelector('main') || document.body;
    main.innerHTML = `
      <div class="auth-gate">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round"
            d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/>
        </svg>
        <h2>Acesso não autorizado</h2>
        <p>O e-mail <strong>${escapeHtml(session.email)}</strong> não tem permissão para acessar o Admin.</p>
        <button onclick="logout('../')" class="btn btn-ghost">Sair e usar outra conta</button>
      </div>
    `;
    return false;
  }
  renderAuthGate(
    'Acesso restrito — Setor de Estágios',
    'Esta área é exclusiva para o setor de estágios do IFRS Campus Rio Grande.',
    redirectAfter || window.location.href,
    'staff'
  );
  return false;
}

/**
 * Verifica se o usuário logado é o Diretor Geral (perfil cadastrado no sistema).
 * A validação final é server-side no GAS.
 */
function requireDiretorGeralAuth(redirectAfter) {
  const session = getSession();
  if (session && session.email && session.email.endsWith(AUTH_CONFIG.STAFF_DOMAIN)) {
    updateHeaderUser(session);
    return true;
  }
  renderAuthGate(
    'Acesso restrito — Diretor Geral',
    'Esta área é exclusiva para o Diretor Geral do IFRS Campus Rio Grande.',
    redirectAfter || window.location.href,
    'staff'
  );
  return false;
}

/**
 * Renderiza a tela de "faça login" no elemento <main>.
 * O conteúdo original não é exibido.
 */
function renderAuthGate(title, desc, redirectAfter, domain) {
  const main = document.querySelector('main') || document.body;
  main.innerHTML = `
    <div class="auth-gate">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round"
          d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/>
      </svg>
      <h2>${escapeHtml(title)}</h2>
      <p>${desc}</p>
      <button id="btn-google-login" class="btn btn-primary btn-lg">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
        Entrar com Google
      </button>
      <p class="text-xs text-muted mt-4">
        Use seu e-mail institucional IFRS para continuar.
      </p>
    </div>
  `;

  document.getElementById('btn-google-login')?.addEventListener('click', () => {
    const btn = document.getElementById('btn-google-login');
    btn.classList.add('is-loading');
    btn.disabled = true;

    requestLogin(
      (session) => {
        const requiredDomain = domain === 'student' ? AUTH_CONFIG.STUDENT_DOMAIN : AUTH_CONFIG.STAFF_DOMAIN;
        if (!session.email.endsWith(requiredDomain)) {
          clearSession();
          renderAuthGate(
            title,
            `E-mail <strong>${escapeHtml(session.email)}</strong> não é do domínio permitido. Use ${requiredDomain}.`,
            redirectAfter,
            domain
          );
          return;
        }
        window.location.reload();
      },
      (errorMsg) => {
        if (btn) {
          btn.classList.remove('is-loading');
          btn.disabled = false;
        }
        // Exibe erro abaixo do botão
        const errEl = document.createElement('p');
        errEl.className = 'text-sm text-error mt-4';
        errEl.textContent = errorMsg;
        btn.parentNode.insertBefore(errEl, btn.nextSibling);
      }
    );
  });
}

// ─────────────────────────────────────────
//  ATUALIZAÇÃO DO HEADER
// ─────────────────────────────────────────

/**
 * Atualiza o badge de usuário no header com o nome/e-mail logado.
 * E adiciona botão de logout se houver um elemento #header-user-area.
 */
function updateHeaderUser(session) {
  const area = document.getElementById('header-user-area');
  if (!area || !session) return;

  area.innerHTML = `
    <span class="header-user">
      <svg viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-6-3a2 2 0 11-4 0 2 2 0 014 0zm-2 4a5 5 0 00-4.546 2.916A5.986 5.986 0 0010 16a5.986 5.986 0 004.546-2.084A5 5 0 0010 11z" clip-rule="evenodd"/>
      </svg>
      ${escapeHtml(session.name || session.email)}
    </span>
    <button onclick="logout('../')" class="btn btn-ghost btn-sm" title="Sair">
      <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clip-rule="evenodd"/>
      </svg>
    </button>
  `;
}
