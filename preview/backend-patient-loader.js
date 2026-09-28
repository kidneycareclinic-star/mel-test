/* =========================================================================
 * PostgreSQL-backed synthetic census loader
 * All 24 synthetic patient states are read from Supabase through a read-only
 * Edge Function. Browser fixtures remain only as local demo scaffolding and
 * are replaced before the first render when the backend is available.
 * ========================================================================= */
(function () {
  var ENDPOINT =
    "https://excqvjpsmdxzhujsbkmz.supabase.co/functions/v1/synthetic-census";
  var ANON_JWT =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV4Y3F2anBzbWR4emh1anNia216Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1NjE1NDAsImV4cCI6MjEwNjEzNzU0MH0.qjhZBxmU2odQ2U2eEISxZNrHQp4EUkqCsfcD5ZceE5U";

  function setStatus(text, tone) {
    var el = document.getElementById("backendStatus");
    if (!el) return;
    el.textContent = text;
    el.classList.remove("chip-agent", "chip-warn");
    if (tone) el.classList.add(tone);
  }

  async function loadBackendCensus() {
    setStatus("PostgreSQL · loading", "chip-agent");

    var response = await fetch(ENDPOINT, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "Authorization": "Bearer " + ANON_JWT
      },
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("Census load HTTP " + response.status + ": " + await response.text());
    }

    var payload = await response.json();
    if (!payload || !Array.isArray(payload.patients) || !payload.patients.length) {
      throw new Error("Backend census returned no patients");
    }

    var backendPatients = payload.patients.map(function (entry) {
      var patient = entry.patient;
      patient.backendSource = {
        type: "supabase-postgresql",
        stateVersion: entry.stateVersion,
        generatedAt: entry.generatedAt,
        engineVersion: entry.engineVersion
      };
      return patient;
    });

    backendPatients.sort(function (a, b) {
      return String(a.id).localeCompare(String(b.id));
    });

    window.PATIENTS.splice(0, window.PATIENTS.length);
    Array.prototype.push.apply(window.PATIENTS, backendPatients);
    window.BACKEND_CENSUS_PAYLOAD = payload;
    window.BACKEND_PATIENT = backendPatients[0] || null;

    setStatus("PostgreSQL · " + backendPatients.length + " patients", "chip-agent");
    return backendPatients;
  }

  window.BACKEND_PATIENT_READY = loadBackendCensus().catch(function (error) {
    console.warn("Backend census load failed; browser fixtures remain available.", error);
    window.BACKEND_PATIENT_ERROR = String(error && error.message ? error.message : error);
    setStatus("backend fallback", "chip-warn");
    return null;
  });
})();