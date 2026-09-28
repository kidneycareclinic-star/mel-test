/* =========================================================================
 * Nephrology Agentic Harness — persistent theme controller
 * ========================================================================= */

(function () {
  const STORAGE_KEY = "nephrology-harness-theme";
  const root = document.documentElement;

  function getSavedTheme() {
    try {
      return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
    } catch (_) {
      return "dark";
    }
  }

  function saveTheme(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (_) {}
  }

  function applyTheme(theme) {
    root.dataset.theme = theme;
    const button = document.getElementById("themeToggle");
    if (button) {
      const light = theme === "light";
      button.textContent = light ? "🌙 Dark" : "☀ Light";
      button.setAttribute("aria-pressed", light ? "true" : "false");
      button.title = light ? "Switch to dark mode" : "Switch to light mode";
    }
  }

  applyTheme(getSavedTheme());

  document.addEventListener("DOMContentLoaded", function () {
    applyTheme(getSavedTheme());

    const button = document.getElementById("themeToggle");
    if (!button) return;

    button.addEventListener("click", function () {
      const next = root.dataset.theme === "light" ? "dark" : "light";
      saveTheme(next);
      applyTheme(next);
    });
  });
})();