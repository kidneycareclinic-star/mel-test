/* Synthetic encounter: persist pre-chart sources, review discrete values, then sign. */
(function () {
  var drafts = new Map();
  var busy = false;
  var panel = document.querySelector(".prechart-note-editor-card .prechart-section-head");
  if (!panel) return;
  var actions = document.createElement("div");
  actions.className = "encounter-workflow-actions";
  actions.innerHTML =
    '<button id="encounterSaveBtn" class="small-btn" type="button">Save encounter draft</button>' +
    '<button id="encounterSignBtn" class="small-btn" type="button">Sign reviewed encounter</button>' +
    '<button id="encounterRefreshBtn" class="small-btn" type="button">Refresh encounter</button>';
  panel.parentNode.insertBefore(actions, panel.nextSibling);
  var status = document.createElement("p");
  status.id = "encounterWorkflowStatus";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.textContent = "Add a synthetic pre-chart source, then save a draft before recording observations.";
  actions.parentNode.insertBefore(status, actions.nextSibling);
  var lastSigned = document.createElement("details");
  lastSigned.id = "encounterLastSigned";
  lastSigned.hidden = true;
  lastSigned.innerHTML = "<summary>Last signed encounter note</summary><pre></pre>";
  status.parentNode.insertBefore(lastSigned, status.nextSibling);

  function activePatient() {
    try { return currentPatient || null; } catch (_) { return window.currentPatient || null; }
  }
  function setStatus(message, error) {
    status.textContent = message;
    status.classList.toggle("is-error", !!error);
  }
  function currentId(patientId) { return drafts.get(patientId)?.id || null; }
  function config() { return window.SUPABASE_DEMO_BACKEND || null; }
  async function request(method, patientId, body) {
    var cfg = config();
    if (!cfg || !cfg.anonJwt) throw new Error("Sign in as a clinician first.");
    var url = cfg.baseUrl + "/functions/v1/synthetic-encounter-gated" +
      (method === "GET" ? "?patient_id=" + encodeURIComponent(patientId) : "");
    var result = await fetch(url, {
      method: method,
      headers: { "Authorization": "Bearer " + cfg.anonJwt, "Accept": "application/json",
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store"
    });
    var payload = await result.json().catch(function () { return {}; });
    if (!result.ok) throw new Error(payload.error || "Encounter request failed (HTTP " + result.status + ").");
    return payload;
  }
  async function refresh() {
    var patient = activePatient();
    if (!patient) return;
    var id = patient.id;
    try {
      var result = await request("GET", id);
      if (activePatient()?.id !== id) return;
      lastSigned.hidden = !result.lastSigned;
      if (result.lastSigned) lastSigned.querySelector("pre").textContent = result.lastSigned.note_text || "";
      if (result.draft) {
        drafts.set(id, { id: result.draft.id, version: result.draft.version });
        if (window.PRECHART_WORKSPACE_API?.hydrateEncounterDraft) {
          PRECHART_WORKSPACE_API.hydrateEncounterDraft(id, result.draft);
        }
        setStatus("Draft v" + result.draft.version + " saved. Review proposed observations before signing.");
      } else {
        drafts.delete(id);
        setStatus(result.lastSigned ? "Last encounter signed at Patient State v" + result.lastSigned.final_state_version + ". Add a new source to begin another." :
          "Add a synthetic pre-chart source, then save a draft before recording observations.");
      }
      if (window.SCRIBE_REVIEW_UI?.refresh) SCRIBE_REVIEW_UI.refresh();
    } catch (error) { setStatus("Encounter load failed: " + error.message, true); }
  }
  async function saveDraft(patientId) {
    var local = window.PRECHART_WORKSPACE_API?.getPatientState(patientId);
    if (!local || !local.sources.length) throw new Error("Add at least one pre-chart source before saving.");
    var prior = drafts.get(patientId);
    var result = await request("POST", patientId, {
      action: "save-draft", patientId: patientId,
      encounterId: prior?.id || null, expectedVersion: prior?.version || null,
      noteText: local.note || "", sources: local.sources
    });
    drafts.set(patientId, { id: result.encounterId, version: result.version });
    setStatus("Encounter draft v" + result.version + " saved. Structured observations now link to this encounter.");
    if (window.SCRIBE_REVIEW_UI?.refresh) SCRIBE_REVIEW_UI.refresh();
    return result;
  }
  async function withBusy(action) {
    if (busy) return;
    var patient = activePatient();
    if (!patient) return;
    busy = true;
    actions.querySelectorAll("button").forEach(function (button) { button.disabled = true; });
    try { await action(patient.id); }
    catch (error) { setStatus(error?.message || "Encounter unavailable.", true); }
    finally { busy = false; actions.querySelectorAll("button").forEach(function (button) { button.disabled = false; }); }
  }
  document.getElementById("encounterSaveBtn").addEventListener("click", function () {
    withBusy(saveDraft);
  });
  document.getElementById("encounterSignBtn").addEventListener("click", function () {
    withBusy(async function (patientId) {
      var saved = await saveDraft(patientId);
      var result = await request("POST", patientId, {
        action: "sign", patientId: patientId,
        encounterId: saved.encounterId, expectedVersion: saved.version
      });
      drafts.delete(patientId);
      var local = window.PRECHART_WORKSPACE_API?.getPatientState(patientId);
      lastSigned.hidden = false;
      lastSigned.querySelector("pre").textContent = local?.note || "";
      setStatus("Signed synthetic encounter · " + result.acceptedCount + " reviewed observation(s) · Patient State v" + result.stateVersion + " · audit event recorded.");
      if (window.PATIENT_AUDIT_UI?.refresh) PATIENT_AUDIT_UI.refresh();
    });
  });
  document.getElementById("encounterRefreshBtn").addEventListener("click", function () { withBusy(refresh); });
  var open = document.getElementById("openPrechartWorkspaceBtn");
  if (open) open.addEventListener("click", function () { window.setTimeout(refresh, 0); });
  window.ENCOUNTER_WORKFLOW_UI = { currentId: currentId, refresh: refresh };
})();
