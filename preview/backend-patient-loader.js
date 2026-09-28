/* =========================================================================
 * Synthetic backend census loader
 * Remaining browser fixtures are bootstrap material only. Missing synthetic
 * patients are imported to Supabase in small batches, then the active census
 * is replaced with PostgreSQL-backed Patient State snapshots.
 * ========================================================================= */
(function () {
  var ENDPOINT =
    "https://excqvjpsmdxzhujsbkmz.supabase.co/functions/v1/synthetic-census";
  var ANON_JWT =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV4Y3F2anBzbWR4emh1anNia216Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1NjE1NDAsImV4cCI6MjEwNjEzNzU0MH0.qjhZBxmU2odQ2U2eEISxZNrHQp4EUkqCsfcD5ZceE5U";
  var BATCH_SIZE = 3;

  function headers(extra) {
    return Object.assign({
      "Accept": "application/json",
      "Authorization": "Bearer " + ANON_JWT
    }, extra || {});
  }

  function setStatus(text, tone) {
    var el = document.getElementById("backendStatus");
    if (!el) return;
    el.textContent = text;
    el.classList.remove("chip-agent", "chip-warn");
    if (tone) el.classList.add(tone);
  }

  async function importBatch(batch) {
    var response = await fetch(ENDPOINT, {
      method: "POST",
      headers: headers({
        "Content-Type": "application/json",
        "x-synthetic-seed": "nephrology-harness-v1"
      }),
      body: JSON.stringify({ patients: batch }),
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error("Synthetic import HTTP " + response.status + ": " + await response.text());
    }
    return response.json();
  }

  async function loadCensus() {
    var response = await fetch(ENDPOINT, {
      method: "GET",
      headers: headers(),
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error("Census load HTTP " + response.status + ": " + await response.text());
    }
    return response.json();
  }

  async function syncBackendCensus() {
    var bootstrapPatients = Array.isArray(window.PATIENTS)
      ? window.PATIENTS.slice()
      : [];

    setStatus("PostgreSQL · syncing", "chip-agent");

    for (var offset = 0; offset < bootstrapPatients.length; offset += BATCH_SIZE) {
      var batch = bootstrapPatients.slice(offset, offset + BATCH_SIZE);
      await importBatch(batch);
    }

    var payload = await loadCensus();
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

  window.BACKEND_PATIENT_READY = syncBackendCensus().catch(function (error) {
    console.warn("Backend census sync failed; remaining browser fixtures stay available.", error);
    window.BACKEND_PATIENT_ERROR = String(error && error.message ? error.message : error);
    setStatus("backend fallback", "chip-warn");
    return null;
  });
})();