/* =========================================================================
 * Nephrology Agentic Harness — iPhone/mobile pane navigation
 * ========================================================================= */

(function () {
  const MOBILE_BREAKPOINT = 760;
  const layout = document.getElementById("mainLayout");
  const nav = document.getElementById("mobilePaneNav");

  if (!layout || !nav) return;

  function isMobile() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
  }

  function showPane(name) {
    layout.classList.remove("mobile-pane-census", "mobile-pane-patient", "mobile-pane-agent");
    layout.classList.add("mobile-pane-" + name);

    nav.querySelectorAll("[data-mobile-pane]").forEach(function (button) {
      button.classList.toggle("active", button.dataset.mobilePane === name);
    });

    try {
      sessionStorage.setItem("nephrology-mobile-pane", name);
    } catch (_) {}
  }

  nav.querySelectorAll("[data-mobile-pane]").forEach(function (button) {
    button.addEventListener("click", function () {
      showPane(button.dataset.mobilePane);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  document.addEventListener("click", function (event) {
    if (!isMobile()) return;
    const patientTile = event.target.closest(".patient-tile");
    if (!patientTile) return;

    if (
      event.target.closest(".tile-close") ||
      event.target.closest(".patient-tile-detail")
    ) return;

    window.setTimeout(function () {
      showPane("patient");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 0);
  });

  window.MOBILE_PANE_UI = { show: showPane };

  var saved = null;
  try {
    saved = sessionStorage.getItem("nephrology-mobile-pane");
  } catch (_) {}

  showPane(saved === "census" || saved === "agent" ? saved : "patient");
})();
