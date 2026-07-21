/* Landing page interactions */

function animateCount(el) {
  const target = parseInt(el.dataset.count, 10);
  const suffix = el.dataset.suffix || '';
  const duration = 1400;
  const start = performance.now();
  function frame(now) {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(eased * target) + suffix;
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

document.addEventListener('DOMContentLoaded', () => {
  const stats = document.querySelectorAll('.stat-value[data-count]');
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        animateCount(entry.target);
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.4 });
  stats.forEach(el => obs.observe(el));

  // Subtle nav elevation on scroll
  const nav = document.querySelector('.nav');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 12) nav.style.boxShadow = '0 8px 30px -20px rgba(0,0,0,0.8)';
    else nav.style.boxShadow = 'none';
  });
});