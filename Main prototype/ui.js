/* Shared UI helpers: toasts + scroll reveal */

function ensureToastStack() {
  let stack = document.querySelector('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  return stack;
}

function toast(message, type = 'default', duration = 3800) {
  const stack = ensureToastStack();
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'default' ? '' : type);
  const icon = type === 'success' ? '✓' : type === 'error' ? '!' : '•';
  el.innerHTML = `<span style="color:${type==='success'?'var(--success)':type==='error'?'var(--danger)':'var(--accent-cyan)'};font-weight:700">${icon}</span><span>${message}</span>`;
  stack.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 300);
  }, duration);
}

function initScrollReveal() {
  const items = document.querySelectorAll('.reveal');
  if (!items.length) return;
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });
  items.forEach(el => obs.observe(el));
}

document.addEventListener('DOMContentLoaded', initScrollReveal);
