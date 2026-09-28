/* =========================================================================
 * Synthetic backend patient loader
 * PT-001 is loaded from Supabase PostgreSQL through a narrow read-only
 * Edge Function. Other synthetic patients remain browser fixtures while the
 * backend migration is validated.
 * ========================================================================= */
(function () {
  var ENDPOINT =
    "https://excqvjpsmdxzhujsbkmz.supabase.co/functions/v1/synthetic-patient?external_id=PT-001";

  function setStatus(text, tone) {
    var el = document.getElementById("backendStatus");
    if (!el) return;
    el.textContent = text;
    el.classList.remove("chip-agent", "chip-warn");
    if (tone) el.classList.add(tone);
  }

  window.BACKEND_PATIENT_READY = fetch(ENDPOINT, {
    method: "GET",
    headers: { "Accept": "application/json" },
    cache: "no-store"
  })
    .then(function (response) {
      if (!response.ok) throw new Error("Backend HTTP " + response.status);
      return response.json();
    })
    .then(function (payload) {
      if (!payload || !payload.patient || payload.patient.id !== "PT-001") {
        throw new Error("Unexpected backend patient payload");
      }

      var index = window.PATIENTS.findIndex(function (patient) {
        return patient.id === "PT-001";
      });

      if (index < 0) throw new Error("PT-001 browser fixture not found");

      payload.patient.backendSource = {
        type: "supabase-postgresql",
        stateVersion: payload.stateVersion,
        generatedAt: payload.generatedAt,
        engineVersion: payload.engineVersion
      };

      window.PATIENTS[index] = payload.patient;
      window.BACKEND_PATIENT = payload.patient;
      window.BACKEND_PATIENT_PAYLOAD = payload;
      setStatus("PostgreSQL · PT-001", "chip-agent");
      return payload.patient;
    })
    .catch(function (error) {
      console.warn("PT-001 backend load failed; using browser fixture.", error);
      window.BACKEND_PATIENT_ERROR = String(error && error.message ? error.message : error);
      setStatus("backend fallback", "chip-warn");
      return null;
    });
})();