/**
 * utils.gs — Utilitários compartilhados entre os scripts GAS
 * SGE — Sistema de Gestão de Estágios · IFRS Campus Rio Grande
 */

'use strict';

// ---------------------------------------------------------------------------
// Respostas JSON padronizadas
// ---------------------------------------------------------------------------

function jsonOk_(data) {
  var payload = JSON.stringify({ ok: true, data: data !== undefined ? data : null });
  return ContentService
    .createTextOutput(payload)
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonError_(mensagem, code) {
  var payload = JSON.stringify({ ok: false, error: mensagem, code: code || 'ERROR' });
  return ContentService
    .createTextOutput(payload)
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// Sanitização e validação
// ---------------------------------------------------------------------------

/**
 * Remove tags HTML, normaliza espaços e limita comprimento.
 * @param {*} valor  Valor a sanitizar
 * @param {number} [maxLen=2000]
 * @returns {string}
 */
function sanitizar_(valor, maxLen) {
  if (valor === null || valor === undefined) return '';
  var s = String(valor)
    .replace(/<[^>]*>/g, '')          // strip HTML
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // ctrl chars
    .trim();
  return s.slice(0, maxLen || 2000);
}

/**
 * Valida CPF (11 dígitos, dígitos verificadores).
 * @param {string} cpf  Apenas dígitos
 */
function validarCPF_(cpf) {
  if (!cpf || !/^\d{11}$/.test(cpf)) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  var soma = 0, resto;
  for (var i = 1; i <= 9; i++) soma += parseInt(cpf[i - 1]) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(cpf[9])) return false;
  soma = 0;
  for (var i = 1; i <= 10; i++) soma += parseInt(cpf[i - 1]) * (12 - i);
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  return resto === parseInt(cpf[10]);
}

/**
 * Valida CNPJ (14 dígitos, dígitos verificadores).
 * @param {string} cnpj  Apenas dígitos
 */
function validarCNPJ_(cnpj) {
  if (!cnpj || !/^\d{14}$/.test(cnpj)) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  var tamanho = cnpj.length - 2;
  var numeros = cnpj.substring(0, tamanho);
  var digitos = cnpj.substring(tamanho);
  var soma = 0, pos = tamanho - 7;
  for (var i = tamanho; i >= 1; i--) {
    soma += parseInt(numeros[tamanho - i]) * pos--;
    if (pos < 2) pos = 9;
  }
  var resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
  if (resultado !== parseInt(digitos[0])) return false;
  tamanho++;
  numeros = cnpj.substring(0, tamanho);
  soma = 0; pos = tamanho - 7;
  for (var i = tamanho; i >= 1; i--) {
    soma += parseInt(numeros[tamanho - i]) * pos--;
    if (pos < 2) pos = 9;
  }
  resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
  return resultado === parseInt(digitos[1]);
}

/**
 * Valida formato básico de e-mail.
 * @param {string} email
 */
function validarEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || '').trim());
}

// ---------------------------------------------------------------------------
// Rate limiting simples via PropertiesService
// ---------------------------------------------------------------------------

/**
 * Verifica limite de taxa: máx `maxReqs` requisições por ação por minuto.
 * Usa PropertiesService (script-level) com chave "rl_<action>_<minuto>".
 * Em caso de erro no PropertiesService, permite a requisição (fail-open).
 *
 * @param {string} action  Nome da ação (ex.: 'cadastrarEmpresa')
 * @param {number} [maxReqs=15]
 * @returns {boolean}  true se dentro do limite, false se excedido
 */
function checkRateLimit_(action, maxReqs) {
  var max = maxReqs || 15;
  try {
    var props = PropertiesService.getScriptProperties();
    var minuto = Math.floor(Date.now() / 60000);
    var key    = 'rl_' + action + '_' + minuto;
    var count  = parseInt(props.getProperty(key) || '0', 10);
    if (count >= max) return false;
    props.setProperty(key, String(count + 1));
    return true;
  } catch (e) {
    return true; // fail-open: não bloqueia se PropertiesService falhar
  }
}

// ---------------------------------------------------------------------------
// Geração de IDs de estágio
// ---------------------------------------------------------------------------

/**
 * Gera ID único no formato RG<ano>-<4 alnum>-<4 alnum>.
 * Ex.: RG25-A3BX-9K2F
 */
function gerarIdEstagio_() {
  var ano  = String(new Date().getFullYear()).slice(-2);
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  function bloco() {
    var s = '';
    for (var i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }
  return 'RG' + ano + '-' + bloco() + '-' + bloco();
}

// ---------------------------------------------------------------------------
// Datas e formatação
// ---------------------------------------------------------------------------

/**
 * Formata Date ou string ISO para DD/MM/AAAA.
 * @param {Date|string} data
 * @returns {string}
 */
function formatarData_(data) {
  if (!data) return '';
  var d = data instanceof Date ? data : new Date(data);
  if (isNaN(d.getTime())) return String(data);
  var dd = String(d.getDate()).padStart(2, '0');
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  return dd + '/' + mm + '/' + d.getFullYear();
}

/**
 * Retorna a data atual como string ISO (AAAA-MM-DD) no fuso de Brasília.
 */
function hojeISO_() {
  var d = new Date();
  // UTC-3
  d.setHours(d.getHours() - 3);
  return d.toISOString().split('T')[0];
}

// ---------------------------------------------------------------------------
// Log de erros por e-mail
// ---------------------------------------------------------------------------

/**
 * Envia e-mail de erro para o responsável técnico.
 * @param {string} contexto  Nome do script/função
 * @param {Error|*} erro
 */
function logErro_(contexto, erro) {
  try {
    var dest  = 'estagios@riogrande.ifrs.edu.br';
    var assunto = '[SGE] Erro em ' + contexto + ' — ' + hojeISO_();
    var corpo   = 'Contexto: ' + contexto + '\n\n'
      + 'Mensagem: ' + (erro && erro.message ? erro.message : String(erro)) + '\n\n'
      + 'Stack: ' + (erro && erro.stack ? erro.stack : '(não disponível)') + '\n\n'
      + 'Horário: ' + new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    MailApp.sendEmail(dest, assunto, corpo);
  } catch (e) {
    // Se o e-mail falhar, não propaga — evita loop
  }
}

// ---------------------------------------------------------------------------
// Busca em planilha
// ---------------------------------------------------------------------------

/**
 * Localiza a primeira linha em que a coluna `colIndex` (base 0) contém `valor`.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} colIndex  Índice de coluna (base 0)
 * @param {string} valor     Valor a buscar (normalizado para string)
 * @returns {number}  Índice de linha base 0 nos dados (sem cabeçalho), ou -1
 */
function buscarNaColuna_(sheet, colIndex, valor) {
  var dados = sheet.getDataRange().getValues();
  var busca = String(valor || '').trim().toUpperCase();
  for (var i = 1; i < dados.length; i++) { // i=1 pula cabeçalho
    if (String(dados[i][colIndex] || '').trim().toUpperCase() === busca) return i;
  }
  return -1;
}

/**
 * Abre uma planilha pelo ID e retorna a aba de nome `nomAba` (ou a primeira se omitido).
 * Lança erro se não encontrar.
 */
function abrirAba_(spreadsheetId, nomeAba) {
  var ss   = SpreadsheetApp.openById(spreadsheetId);
  var sheet = nomeAba ? ss.getSheetByName(nomeAba) : ss.getSheets()[0];
  if (!sheet) throw new Error('Aba "' + nomeAba + '" não encontrada na planilha ' + spreadsheetId);
  return sheet;
}
