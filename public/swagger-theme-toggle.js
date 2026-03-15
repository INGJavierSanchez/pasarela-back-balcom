(function () {
  const storageKey = 'swagger-theme';
  const darkClass = 'swagger-dark';

  const applyTheme = (theme) => {
    const isDark = theme === 'dark';
    document.body.classList.toggle(darkClass, isDark);
    localStorage.setItem(storageKey, isDark ? 'dark' : 'light');
    const btn = document.getElementById('swagger-theme-toggle');
    if (btn) btn.textContent = isDark ? 'Tema claro' : 'Tema oscuro';
  };

  const createButton = () => {
    const wrapper = document.querySelector('.swagger-ui .topbar .download-url-wrapper');
    if (!wrapper) return;
    const btn = document.createElement('button');
    btn.id = 'swagger-theme-toggle';
    btn.textContent = 'Tema oscuro';
    btn.style.marginLeft = '8px';
    btn.style.padding = '6px 12px';
    btn.style.borderRadius = '6px';
    btn.style.border = '1px solid #ccc';
    btn.style.cursor = 'pointer';
    btn.onclick = () => {
      const nextTheme = document.body.classList.contains(darkClass) ? 'light' : 'dark';
      applyTheme(nextTheme);
    };
    wrapper.appendChild(btn);
  };

  const init = () => {
    createButton();
    const stored = localStorage.getItem(storageKey) || 'light';
    applyTheme(stored === 'dark' ? 'dark' : 'light');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
