/**
 * drive.gs — Gestão de pastas e arquivos no Google Drive
 * SGE — Sistema de Gestão de Estágios · IFRS Campus Rio Grande
 *
 * Estrutura de pastas criada automaticamente:
 *   Estágios SGE/
 *     <Ano>/
 *       <Curso>/
 *         <ID>—<Matrícula>—<Nome>/
 *           (documentos enviados via e-mail/link ficam aqui)
 *
 * Funções exportadas:
 *   criarPastaEstagio_(idEstagio, ano, curso, matricula, nomeEstudante)
 *     → retorna URL da pasta criada
 *   obterOuCriarPasta_(pastaRaiz, nomePasta)
 *     → retorna objeto Folder
 */

'use strict';

var DRIVE = (function () {

  /** Nome da pasta raiz do SGE no Drive do usuário que executa o script. */
  var PASTA_RAIZ = 'Estágios SGE';

  /**
   * Obtém ou cria uma subpasta com o nome dado dentro de `pastaRaiz`.
   * @param {GoogleAppsScript.Drive.Folder} pastaRaiz
   * @param {string} nomePasta
   * @returns {GoogleAppsScript.Drive.Folder}
   */
  function obterOuCriarPasta(pastaRaiz, nomePasta) {
    var iter = pastaRaiz.getFoldersByName(nomePasta);
    if (iter.hasNext()) return iter.next();
    return pastaRaiz.createFolder(nomePasta);
  }

  /**
   * Cria (ou retorna existente) a hierarquia de pastas para um estágio:
   *   Estágios SGE / <Ano> / <Curso> / <ID>—<Matrícula>—<Nome>
   *
   * @param {string} idEstagio     Ex.: RG25-A3BX-9K2F
   * @param {string} ano           Ex.: 2025
   * @param {string} curso         Ex.: Análise e Desenvolvimento de Sistemas
   * @param {string} matricula     Ex.: 202300123
   * @param {string} nomeEstudante Ex.: João da Silva
   * @returns {string}  URL de acesso à pasta criada
   */
  function criarPastaEstagio(idEstagio, ano, curso, matricula, nomeEstudante) {
    try {
      var raiz = obterOuCriarPasta(DriveApp.getRootFolder(), PASTA_RAIZ);
      var pastaAno   = obterOuCriarPasta(raiz, String(ano));
      var pastaCurso = obterOuCriarPasta(pastaAno, sanitizarNomePasta_(curso));

      // Nome da pasta do estagiário: "RG25-XXXX-XXXX — 202300123 — João da Silva"
      var nomePasta = idEstagio + ' — ' + String(matricula) + ' — ' + sanitizarNomePasta_(nomeEstudante);
      var pastaEstag = obterOuCriarPasta(pastaCurso, nomePasta);

      return pastaEstag.getUrl();
    } catch (e) {
      logErro_('drive.criarPastaEstagio', e);
      return ''; // não bloqueia o fluxo principal se o Drive falhar
    }
  }

  /**
   * Remove caracteres inválidos para nomes de pasta no Drive.
   * @param {string} nome
   * @returns {string}
   */
  function sanitizarNomePasta_(nome) {
    return String(nome || 'Sem nome')
      .replace(/[\/\\:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
  }

  return {
    criarPastaEstagio:    criarPastaEstagio,
    obterOuCriarPasta:    obterOuCriarPasta,
  };
})();

// Aliases globais
function criarPastaEstagio_(idEstagio, ano, curso, matricula, nomeEstudante) {
  return DRIVE.criarPastaEstagio(idEstagio, ano, curso, matricula, nomeEstudante);
}
function obterOuCriarPasta_(pastaRaiz, nomePasta) {
  return DRIVE.obterOuCriarPasta(pastaRaiz, nomePasta);
}
