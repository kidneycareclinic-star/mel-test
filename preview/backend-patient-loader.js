/* =========================================================================
 * PostgreSQL-backed synthetic census loader
 * Assigned synthetic patient states are read only after clinician sign-in.
 * ========================================================================= */
(function () {
  var ENDPOINT =
    "https://excqvjpsmdxzhujsbkmz.supabase.co/functions/v1/synthetic-census-gated";

  function setStatus(text, tone) {
    var el = document.getElementById("backendStatus");
    if (!el) return;
    el.textContent = text;
    el.classList.remove("chip-agent", "chip-warn");
    if (tone) el.classList.add(tone);
  }

  async function loadBackendCensus() {
    await window.CLINICIAN_AUTH.ready;
    setStatus("PostgreSQL · loading", "chip-agent");
    var payload = window.CLINICIAN_AUTH.initialCensus;
    if (!payload) {
      var response = await fetch(ENDPOINT, {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "Authorization": "Bearer " + window.CLINICIAN_AUTH.accessToken()
        },
        cache: "no-store"
      });
      if (!response.ok) throw new Error("Census load HTTP " + response.status);
      payload = await response.json();
    }
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
    console.warn("Authenticated census load failed.", error);
    window.BACKEND_PATIENT_ERROR = String(error && error.message ? error.message : error);
    window.PATIENTS.splice(0, window.PATIENTS.length);
    setStatus("census unavailable", "chip-warn");
    return null;
  });
})();
