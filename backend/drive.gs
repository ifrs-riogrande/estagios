/**
 * drive.gs — Gestão de pastas e arquivos no Google Drive
 * SGE — Sistema de Gestão de Estágios · IFRS Campus Rio Grande
 *
 * ── Hierarquia de pastas ────────────────────────────────────────────────────
 *
 *   📁 Estágios  (CFG_DRIVE.ESTAGIOS_ID)
 *     └── 📁 2026
 *         └── 📁 RG26-XXXX-XXXX — João da Silva
 *             ├── 📁 Admissão           ← docs da solicitação (matrícula, identidade, boletim)
 *             ├── 📁 Documentos Avulsos ← uploads avulsos do setor e do estudante
 *             ├── Checklist — João da Silva.pdf   (+ Google Doc)
 *             ├── TCE_RG26-..._v0_original.pdf    (+ Google Doc)
 *             └── TCE_RG26-..._v1_estudante.pdf   (etc.)
 *
 *   📁 Cadastros  (CFG_DRIVE.CADASTROS_ID)
 *     └── (reservado para documentos de cadastro de empresas, supervisores, etc.)
 *
 * ── Funções públicas (aliases globais no final) ─────────────────────────────
 *   criarPastaEstagio_(idEstagio, nomeEstudante)  → { folder, folderId, url }
 *   abrirPastaEstagio_(driveUrl)                  → Folder | null
 *   obterOuCriarPasta_(pai, nome)                 → Folder
 */

'use strict';

// ── Configuração das pastas raiz ──────────────────────────────────────────────

var CFG_DRIVE = {
  /** Pasta raiz de estágios — todos os TCEs e documentos do processo */
  ESTAGIOS_ID:  '15y4xP1y3A3Lu5kbsjitr7jWqOIPgVqr6',
  /** Pasta raiz de cadastros — documentos de entidades (empresas, supervisores…) */
  CADASTROS_ID: '1ofES-nxEB2yI3Gj3DxsDkmreph3_xVUP',
};

// ── Módulo DRIVE ──────────────────────────────────────────────────────────────

var DRIVE = (function () {

  /**
   * Obtém ou cria uma subpasta pelo nome dentro de `pai`.
   * @param {GoogleAppsScript.Drive.Folder|null} pai  null = raiz pessoal do Drive (evitar)
   * @param {string} nome
   * @returns {GoogleAppsScript.Drive.Folder}
   */
  function obterOuCriarPasta(pai, nome) {
    // pai é obrigatório — nunca criar pasta solta na raiz do Drive pessoal
    if (!pai) throw new Error('drive.obterOuCriarPasta: pasta pai obrigatória');
    var iter = pai.getFoldersByName(nome);
    if (iter.hasNext()) return iter.next();
    return pai.createFolder(nome);
  }

  /**
   * Cria (ou retorna existente) a hierarquia de pastas de um estágio:
   *   [Estágios] / [Ano] / [ID — Nome]
   *
   * O ano é derivado do próprio ID do estágio (RG26-… → 2026).
   *
   * @param {string} idEstagio      Ex.: RG26-LD9B-DNN5
   * @param {string} nomeEstudante  Ex.: João da Silva
   * @returns {{ folder: Folder, folderId: string, url: string }}
   */
  function criarPastaEstagio(idEstagio, nomeEstudante) {
    try {
      var ano       = _anoDeId_(idEstagio);
      var raiz      = DriveApp.getFolderById(CFG_DRIVE.ESTAGIOS_ID);
      var pastaAno  = obterOuCriarPasta(raiz, String(ano));
      var nomePasta = idEstagio + (nomeEstudante ? ' — ' + _sanitizarNome_(nomeEstudante) : '');
      var pasta     = obterOuCriarPasta(pastaAno, nomePasta);
      return { folder: pasta, folderId: pasta.getId(), url: pasta.getUrl() };
    } catch (e) {
      logErro_('drive.criarPastaEstagio', e);
      return { folder: null, folderId: '', url: '' };
    }
  }

  /**
   * Abre a pasta de um estágio a partir da URL armazenada na planilha.
   * Extrai o ID do folder da URL do Drive.
   * @param {string} driveUrl
   * @returns {GoogleAppsScript.Drive.Folder|null}
   */
  function abrirPastaEstagio(driveUrl) {
    try {
      if (!driveUrl) return null;
      // Extrai o ID apenas do padrão canônico /folders/<id> — não usa fallback
      // permissivo que poderia capturar partes erradas da URL.
      var m = String(driveUrl).match(/\/folders\/([a-zA-Z0-9_-]+)/);
      if (!m) return null;
      return DriveApp.getFolderById(m[1]);
    } catch (e) { return null; }
  }

  /**
   * Extrai o ano de um ID de estágio.
   * RG26-XXXX-XXXX → 2026.  Fallback: ano corrente.
   */
  function _anoDeId_(idEstagio) {
    var m = String(idEstagio || '').match(/^RG(\d{2})-/);
    if (m) return 2000 + parseInt(m[1], 10);
    return new Date().getFullYear();
  }

  /**
   * Remove caracteres inválidos de nomes de pasta no Drive.
   */
  function _sanitizarNome_(nome) {
    return String(nome || 'Sem nome')
      .replace(/[\/\\:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
  }

  return {
    criarPastaEstagio: criarPastaEstagio,
    abrirPastaEstagio: abrirPastaEstagio,
    obterOuCriarPasta: obterOuCriarPasta,
  };

})();

// ── Aliases globais ──────────────────────────────────────────────────────────

/**
 * Cria (ou retorna) a pasta do estágio em:
 *   Estágios / [Ano] / [ID — Nome]
 */
function criarPastaEstagio_(idEstagio, nomeEstudante) {
  return DRIVE.criarPastaEstagio(idEstagio, nomeEstudante);
}

/**
 * Abre a pasta de um estágio a partir da URL do Drive.
 */
function abrirPastaEstagio_(driveUrl) {
  return DRIVE.abrirPastaEstagio(driveUrl);
}

/**
 * Obtém ou cria uma subpasta pelo nome dentro de `pai`.
 */
function obterOuCriarPasta_(pai, nome) {
  return DRIVE.obterOuCriarPasta(pai, nome);
}
