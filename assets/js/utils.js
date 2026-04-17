/* ============================================================
   IFRS CAMPUS RIO GRANDE — CENTRAL DE ESTÁGIOS
   utils.js — funções utilitárias compartilhadas
   ============================================================ */

'use strict';

// ─────────────────────────────────────────
//  FORMATAÇÃO DE CAMPOS
// ─────────────────────────────────────────

/**
 * Formata CPF: 123.456.789-09
 * Aplicado via input event — remove chars não numéricos, então aplica máscara.
 */
function formatCPF(value) {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0,3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6)}`;
  return `${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6,9)}-${digits.slice(9)}`;
}

/**
 * Formata CNPJ: 12.345.678/0001-95
 */
function formatCNPJ(value) {
  const digits = value.replace(/\D/g, '').slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0,2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5,8)}/${digits.slice(8)}`;
  return `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5,8)}/${digits.slice(8,12)}-${digits.slice(12)}`;
}

/**
 * Formata telefone: (53)999999999 ou (53)32321234
 * Não inclui espaços ou traços — conforme instrução dos forms.
 */
function formatPhone(value) {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits.length ? `(${digits}` : digits;
  if (digits.length <= 6) return `(${digits.slice(0,2)})${digits.slice(2)}`;
  return `(${digits.slice(0,2)})${digits.slice(2)}`;
}

/**
 * Formata CEP: 99999-999
 */
function formatCEP(value) {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0,5)}-${digits.slice(5)}`;
}

/**
 * Formata moeda BRL: R$ 1.234,56
 */
function formatCurrency(value) {
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return '';
  const num = parseInt(digits, 10) / 100;
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Formata data para exibição: DD/MM/AAAA
 */
function formatDate(value) {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0,2)}/${digits.slice(2)}`;
  return `${digits.slice(0,2)}/${digits.slice(2,4)}/${digits.slice(4)}`;
}

// ─────────────────────────────────────────
//  VALIDAÇÃO
// ─────────────────────────────────────────

/**
 * Valida CPF (algoritmo oficial).
 * Aceita formato com ou sem pontuação.
 */
function validateCPF(cpf) {
  const digits = cpf.replace(/\D/g, '');
  if (digits.length !== 11) return false;
  if (/^(\d)\1+$/.test(digits)) return false; // todos iguais

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(digits[i]) * (10 - i);
  let rest = (sum * 10) % 11;
  if (rest === 10 || rest === 11) rest = 0;
  if (rest !== parseInt(digits[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(digits[i]) * (11 - i);
  rest = (sum * 10) % 11;
  if (rest === 10 || rest === 11) rest = 0;
  return rest === parseInt(digits[10]);
}

/**
 * Valida CNPJ (algoritmo oficial).
 */
function validateCNPJ(cnpj) {
  const digits = cnpj.replace(/\D/g, '');
  if (digits.length !== 14) return false;
  if (/^(\d)\1+$/.test(digits)) return false;

  let length = digits.length - 2;
  let numbers = digits.substring(0, length);
  const checks = digits.substring(length);
  let sum = 0;
  let pos = length - 7;

  for (let i = length; i >= 1; i--) {
    sum += parseInt(numbers.charAt(length - i)) * pos--;
    if (pos < 2) pos = 9;
  }
  let result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  if (result !== parseInt(checks.charAt(0))) return false;

  length++;
  numbers = digits.substring(0, length);
  sum = 0;
  pos = length - 7;
  for (let i = length; i >= 1; i--) {
    sum += parseInt(numbers.charAt(length - i)) * pos--;
    if (pos < 2) pos = 9;
  }
  result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  return result === parseInt(checks.charAt(1));
}

/**
 * Valida e-mail (RFC 5322 simplificado).
 */
function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Verifica se o e-mail é do domínio de alunos do IFRS.
 */
function isStudentEmail(email) {
  return email.trim().toLowerCase().endsWith('@aluno.riogrande.ifrs.edu.br');
}

/**
 * Verifica se o e-mail é do domínio de servidores do IFRS.
 */
function isStaffEmail(email) {
  return email.trim().toLowerCase().endsWith('@riogrande.ifrs.edu.br');
}

/**
 * Valida data mínima (n dias a partir de hoje).
 * @param {string} dateValue - Valor do input date (YYYY-MM-DD)
 * @param {number} minDays - Mínimo de dias a partir de hoje
 */
function validateMinDate(dateValue, minDays = 0) {
  const date = new Date(dateValue + 'T00:00:00');
  const minDate = new Date();
  minDate.setHours(0, 0, 0, 0);
  minDate.setDate(minDate.getDate() + minDays);
  return date >= minDate;
}

/**
 * Retorna a data mínima formatada para o atributo min do input date.
 * @param {number} addDays
 */
function getMinDateString(addDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + addDays);
  return d.toISOString().split('T')[0];
}

// ─────────────────────────────────────────
//  FEEDBACK DE VALIDAÇÃO NOS CAMPOS
// ─────────────────────────────────────────

/**
 * Exibe mensagem de erro abaixo de um campo.
 * O elemento de erro deve ter id = fieldId + '-error'.
 */
function showFieldError(fieldId, message) {
  const field = document.getElementById(fieldId);
  const errorEl = document.getElementById(fieldId + '-error');
  if (field) {
    field.classList.add('is-invalid');
    field.setAttribute('aria-invalid', 'true');
  }
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
  }
}

/**
 * Remove mensagem de erro de um campo.
 */
function clearFieldError(fieldId) {
  const field = document.getElementById(fieldId);
  const errorEl = document.getElementById(fieldId + '-error');
  if (field) {
    field.classList.remove('is-invalid');
    field.setAttribute('aria-invalid', 'false');
  }
  if (errorEl) {
    errorEl.textContent = '';
    errorEl.classList.add('hidden');
  }
}

/**
 * Marca campo como válido visualmente.
 */
function markFieldValid(fieldId) {
  const field = document.getElementById(fieldId);
  if (field) {
    field.classList.remove('is-invalid');
    field.classList.add('is-valid');
    field.setAttribute('aria-invalid', 'false');
  }
}

/**
 * Remove classes de validação de um campo.
 */
function resetFieldState(fieldId) {
  const field = document.getElementById(fieldId);
  if (field) {
    field.classList.remove('is-invalid', 'is-valid');
    field.removeAttribute('aria-invalid');
  }
  clearFieldError(fieldId);
}

// ─────────────────────────────────────────
//  FEEDBACK DE FORMULÁRIO (sucesso / erro global)
// ─────────────────────────────────────────

/**
 * Exibe o bloco de feedback do formulário.
 * @param {string} containerId - ID do elemento .form-feedback
 * @param {'success'|'error'|'warning'|'info'} type
 * @param {string} title
 * @param {string} message
 */
function showFormFeedback(containerId, type, title, message) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const icons = {
    success: `<svg class="alert-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>`,
    error:   `<svg class="alert-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>`,
    warning: `<svg class="alert-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>`,
    info:    `<svg class="alert-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>`,
  };

  container.innerHTML = `
    <div class="alert alert-${type}">
      ${icons[type] || ''}
      <div class="alert-content">
        ${title ? `<div class="alert-title">${escapeHtml(title)}</div>` : ''}
        <div>${escapeHtml(message)}</div>
      </div>
    </div>
  `;
  container.classList.add('is-visible');
  container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Esconde o bloco de feedback.
 */
function hideFormFeedback(containerId) {
  const container = document.getElementById(containerId);
  if (container) {
    container.classList.remove('is-visible');
    container.innerHTML = '';
  }
}

// ─────────────────────────────────────────
//  APLICAÇÃO DE MÁSCARAS EM INPUTS
// ─────────────────────────────────────────

/**
 * Aplica máscara automaticamente baseado no atributo data-mask.
 * Valores aceitos: cpf, cnpj, phone, cep
 * Uso: <input data-mask="cpf" ...>
 */
function applyMasks() {
  document.querySelectorAll('[data-mask]').forEach(input => {
    input.addEventListener('input', function () {
      const mask = this.getAttribute('data-mask');
      const pos = this.selectionStart;
      const prevLen = this.value.length;

      switch (mask) {
        case 'cpf':   this.value = formatCPF(this.value);   break;
        case 'cnpj':  this.value = formatCNPJ(this.value);  break;
        case 'phone': this.value = formatPhone(this.value); break;
        case 'cep':   this.value = formatCEP(this.value);   break;
        case 'date':  this.value = formatDate(this.value);  break;
      }

      // Mantém a posição do cursor após a formatação
      const diff = this.value.length - prevLen;
      if (this.setSelectionRange) {
        this.setSelectionRange(pos + diff, pos + diff);
      }
    });
  });
}

// ─────────────────────────────────────────
//  SHOW / HIDE CONDICIONAL
// ─────────────────────────────────────────

/**
 * Mostra ou esconde um elemento de acordo com a condição.
 * Também habilita/desabilita campos dentro do elemento.
 */
function toggleSection(sectionId, show) {
  const el = document.getElementById(sectionId);
  if (!el) return;
  if (show) {
    el.classList.remove('hidden');
    el.querySelectorAll('input, select, textarea').forEach(f => f.disabled = false);
  } else {
    el.classList.add('hidden');
    el.querySelectorAll('input, select, textarea').forEach(f => {
      f.disabled = true;
      f.value = '';
    });
  }
}

/**
 * Popula um elemento <select> com um array de objetos.
 * @param {string} selectId
 * @param {Array<{value: string, label: string}>} options
 * @param {string} placeholder - Texto da opção vazia
 */
function populateSelect(selectId, options, placeholder = 'Selecione...') {
  const select = document.getElementById(selectId);
  if (!select) return;

  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>`;
  options.forEach(opt => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    select.appendChild(option);
  });
}

/**
 * Desabilita select e mostra mensagem de carregamento.
 */
function setSelectLoading(selectId, loading) {
  const select = document.getElementById(selectId);
  if (!select) return;
  if (loading) {
    select.disabled = true;
    const currentFirst = select.options[0];
    if (currentFirst) currentFirst.textContent = 'Carregando...';
  } else {
    select.disabled = false;
    const currentFirst = select.options[0];
    if (currentFirst && currentFirst.textContent === 'Carregando...') {
      currentFirst.textContent = 'Selecione...';
    }
  }
}

// ─────────────────────────────────────────
//  SEGURANÇA — escape HTML
// ─────────────────────────────────────────

/**
 * Escapa HTML para evitar XSS ao inserir texto dinâmico no DOM.
 * Use sempre que inserir dado do usuário ou da API via innerHTML.
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(String(text ?? '')));
  return div.innerHTML;
}

// ─────────────────────────────────────────
//  DATA / HORA
// ─────────────────────────────────────────

/**
 * Formata uma string ISO ou Date para exibição em pt-BR.
 */
function formatDateBR(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString('pt-BR');
}

/**
 * Retorna o ano e semestre letivo atual como string.
 * Ex: "2025/1"
 */
function getCurrentSemester() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  return `${year}/${month <= 6 ? 1 : 2}`;
}

// ─────────────────────────────────────────
//  INICIALIZAÇÃO AUTOMÁTICA
//  Chamada ao carregar o DOM em qualquer página.
// ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  applyMasks();
});
