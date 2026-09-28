/* =========================================================================
 * Physician-facing Activity / Audit drawer
 * Read-only causal view of PostgreSQL event, provenance, observation and
 * Patient State records for the active synthetic patient.
 * ========================================================================= */
(function () {
  var openBtn = document.getElementById("openActivityAuditBtn");
  if (!openBtn) return;

  if (!document.getElementById("activityAuditDrawer")) {
    var backdropNode = document.createElement("div");
    backdropNode.id = "activityAuditBackdrop";
    backdropNode.className = "activity-audit-backdrop hidden";

    var drawerNode = document.createElement("aside");
    drawerNode.id = "activityAuditDrawer";
    drawerNode.className = "activity-audit-drawer hidden";
    drawerNode.setAttribute("aria-hidden", "true");
    drawerNode.setAttribute("aria-label", "Patient activity and audit trail");
    drawerNode.innerHTML =
      "<div class='audit-drawer-head'>" +
        "<div><span class='eyebrow'>PHYSICIAN ACTIVITY / AUDIT</span>" +
          "<h2 id='activityAuditTitle'>Activity / Audit</h2>" +
          "<div id='activityAuditMeta' class='micro'>PostgreSQL event/provenance trail</div></div>" +
        "<div class='audit-drawer-head-actions'>" +
          "<span id='activityAuditStateBadge' class='chip chip-agent'>state —</span>" +
          "<button id='refreshActivityAuditBtn' class='small-btn' type='button'>Refresh</button>" +
          "<button id='closeActivityAuditBtn' class='icon-btn' type='button' aria-label='Close activity audit'>×</button>" +
        "</div>" +
      "</div>" +
      "<div class='audit-drawer-summary'>" +
        "<div class='audit-summary-copy'>Shows what the agent heard, extracted, persisted, and what Patient State version resulted.</div>" +
        "<span id='activityAuditCount' class='chip'>0 events</span>" +
      "</div>" +
      "<div id='activityAuditList' class='activity-audit-list'></div>";

    document.body.appendChild(backdropNode);
    document.body.appendChild(drawerNode);
  }

  var closeBtn = document.getElementById("closeActivityAuditBtn");
  var refreshBtn = document.getElementById("refreshActivityAuditBtn");
  var backdrop = document.getElementById("activityAuditBackdrop");
  var drawer = document.getElementById("activityAuditDrawer");
  var title = document.getElementById("activityAuditTitle");
  var meta = document.getElementById("activityAuditMeta");
  var list = document.getElementById("activityAuditList");
  var count = document.getElementById("activityAuditCount");
  var stateBadge = document.getElementById("activityAuditStateBadge");

  var requestSeq = 0;

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function activePatientSafe() {
    try { return currentPatient || null; } catch (_) { return null; }
  }

  function config() {
    return window.SUPABASE_DEMO_BACKEND || null;
  }

  function fmtTime(value) {
    if (!value) return "time not recorded";
    var d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString([], {
      month:"short", day:"numeric", hour:"numeric", minute:"2-digit", second:"2-digit"
    });
  }

  function shortId(value) {
    var s = String(value || "");
    return s.length > 13 ? s.slice(0, 8) + "…" + s.slice(-4) : s || "—";
  }

  function observationValue(obs) {
    if (obs.valueJson && obs.field === "bloodPressure") {
      return obs.valueJson.systolic + "/" + obs.valueJson.diastolic + (obs.unit ? " " + obs.unit : "");
    }
    if (obs.valueJson && obs.field === "weight") {
      return obs.valueJson.amount + " " + (obs.valueJson.reportedUnit || obs.unit || "");
    }
    if (obs.valueNumeric != null) return obs.valueNumeric + (obs.unit ? " " + obs.unit : "");
    if (obs.valueText != null) return obs.valueText + (obs.unit ? " " + obs.unit : "");
    if (obs.valueJson != null) return JSON.stringify(obs.valueJson);
    return "—";
  }

  function eventLabel(event) {
    var labels = {
      SCRIBE_EXTRACTION_APPLIED:"Ambient scribe applied",
      SYNTHETIC_PATIENT_IMPORTED:"Synthetic patient imported",
      OBSERVATION_RECORDED:"Observation recorded",
      OPEN_LOOP_CREATED:"Open loop created",
      OPEN_LOOP_COMPLETED:"Open loop completed",
      AGENT_RUN_STARTED:"Agent run started",
      AGENT_RUN_COMPLETED:"Agent run completed",
      TOOL_ACTION_PREPARED:"Tool action prepared",
      PHYSICIAN_APPROVAL_GRANTED:"Physician approval granted",
      TOOL_ACTION_EXECUTED:"Tool action executed"
    };
    return labels[event.eventType] || String(event.eventType || "Event").replace(/_/g, " ").toLowerCase();
  }

  function tone(event) {
    if (event.eventType === "SCRIBE_EXTRACTION_APPLIED") return "scribe";
    if (event.eventType === "SYNTHETIC_PATIENT_IMPORTED") return "import";
    if (String(event.status).toLowerCase() === "failed") return "error";
    return "default";
  }

  function heardSection(event) {
    var raw = event.heard && event.heard.rawTranscript;
    var reviewed = event.heard && event.heard.reviewedTranscript;
    if (!raw && !reviewed) {
      return "<div class='audit-empty-inline'>No transcript attached to this event.</div>";
    }
    return "<div class='audit-heard-grid'>" +
      "<div class='audit-heard-card'><span>Raw transcript</span><p>" + esc(raw || "—") + "</p></div>" +
      "<div class='audit-heard-card reviewed'><span>Reviewed transcript</span><p>" + esc(reviewed || "—") + "</p></div>" +
    "</div>";
  }

  function observationsSection(event) {
    var rows = event.acceptedObservations || [];
    if (!rows.length) {
      return "<div class='audit-empty-inline'>No structured observation rows linked to this event.</div>";
    }
    return "<div class='audit-observation-list'>" + rows.map(function(obs) {
      return "<div class='audit-observation-row'>" +
        "<div><strong>" + esc(obs.display || obs.field) + "</strong>" +
          "<small>" + esc(obs.clientRecordId ? "idempotency " + shortId(obs.clientRecordId) : "database observation") + "</small></div>" +
        "<div class='audit-observation-value'>" + esc(observationValue(obs)) +
          "<small>" + esc(obs.status || "recorded") + " · " + esc(fmtTime(obs.recordedAt || obs.observedAt)) + "</small></div>" +
      "</div>";
    }).join("") + "</div>";
  }

  function statesSection(event) {
    var states = event.resultingStates || [];
    if (!states.length) {
      return "<div class='audit-empty-inline'>No Patient State version was created by this event.</div>";
    }
    return states.map(function(state) {
      return "<div class='audit-state-result'>" +
        "<div><span>Resulting Patient State</span><strong>v" + esc(state.stateVersion) + "</strong></div>" +
        "<div><span>Engine</span><strong>" + esc(state.engineVersion || "—") + "</strong></div>" +
        "<div><span>Generated</span><strong>" + esc(fmtTime(state.generatedAt)) + "</strong></div>" +
      "</div>";
    }).join("");
  }

  function provenanceSection(event) {
    var p = event.provenance;
    if (!p) return "<div class='audit-empty-inline'>No provenance record linked.</div>";
    return "<div class='audit-kv-grid'>" +
      "<div><span>Provenance ID</span><strong title='" + esc(p.provenanceId) + "'>" + esc(shortId(p.provenanceId)) + "</strong></div>" +
      "<div><span>Source kind</span><strong>" + esc(p.sourceKind || "—") + "</strong></div>" +
      "<div><span>Source label</span><strong>" + esc(p.sourceLabel || "—") + "</strong></div>" +
      "<div><span>Certainty</span><strong>" + esc(p.certainty || "—") + "</strong></div>" +
      "<div><span>Actor</span><strong>" + esc(p.actorType || "—") + "</strong></div>" +
      "<div><span>Recorded</span><strong>" + esc(fmtTime(p.recordedAt)) + "</strong></div>" +
    "</div>";
  }

  function harnessSection(event) {
    var parts = [];

    if (event.agentRun) {
      parts.push(
        "<div class='audit-harness-card'><span>Agent run</span><strong>" +
        esc(event.agentRun.agentName || "agent") + " · " + esc(event.agentRun.status || "—") +
        "</strong><small>run " + esc(shortId(event.agentRun.runId)) +
        " · " + esc(event.agentRun.modelName || event.agentRun.modelProvider || "deterministic") + "</small></div>"
      );
    }

    (event.toolCalls || []).forEach(function(tool) {
      parts.push(
        "<div class='audit-harness-card'><span>Tool proposal</span><strong>" +
        esc(tool.toolName) + " · " + esc(tool.status) +
        "</strong><small>risk " + esc(tool.riskLevel || "—") +
        " · approval " + esc(tool.requiresApproval ? "required" : "not required") + "</small></div>"
      );
    });

    (event.approvals || []).forEach(function(approval) {
      parts.push(
        "<div class='audit-harness-card'><span>Physician decision</span><strong>" +
        esc(approval.decision) +
        "</strong><small>tool " + esc(shortId(approval.toolCallId)) +
        " · " + esc(fmtTime(approval.decidedAt)) + "</small></div>"
      );
    });

    (event.openLoops || []).forEach(function(loop) {
      parts.push(
        "<div class='audit-harness-card'><span>Open loop</span><strong>" +
        esc(loop.label) + " · " + esc(loop.status) +
        "</strong><small>" + esc(loop.workspace || "shared") +
        " · " + esc(shortId(loop.openLoopId)) + "</small></div>"
      );
    });

    if (!parts.length) return "";
    return "<section><div class='audit-section-label'>6 · Harness action</div><div class='audit-harness-grid'>" +
      parts.join("") + "</div></section>";
  }

  function eventCard(event, index) {
    var isScribe = event.eventType === "SCRIBE_EXTRACTION_APPLIED";
    var openAttr = isScribe && index < 3 ? " open" : "";
    var accepted = (event.acceptedObservations || []).length;
    var states = (event.resultingStates || []).map(function(x){ return "v" + x.stateVersion; }).join(", ");
    return "<details class='audit-event audit-tone-" + tone(event) + "'" + openAttr + ">" +
      "<summary>" +
        "<div class='audit-event-marker'></div>" +
        "<div class='audit-event-summary-main'>" +
          "<strong>" + esc(eventLabel(event)) + "</strong>" +
          "<span>" + esc(fmtTime(event.createdAt)) + " · " + esc(event.actorType || "system") + "</span>" +
        "</div>" +
        "<div class='audit-event-summary-meta'>" +
          (accepted ? "<span class='audit-count-pill'>" + accepted + " accepted</span>" : "") +
          (states ? "<span class='audit-state-pill'>" + esc(states) + "</span>" : "") +
        "</div>" +
      "</summary>" +
      "<div class='audit-event-body'>" +
        "<section><div class='audit-section-label'>1 · What the agent heard</div>" + heardSection(event) + "</section>" +
        "<section><div class='audit-section-label'>2 · What PostgreSQL accepted</div>" + observationsSection(event) + "</section>" +
        "<section><div class='audit-section-label'>3 · Event record</div>" +
          "<div class='audit-kv-grid'>" +
            "<div><span>Event type</span><strong>" + esc(event.eventType || "—") + "</strong></div>" +
            "<div><span>Event ID</span><strong title='" + esc(event.eventId) + "'>" + esc(shortId(event.eventId)) + "</strong></div>" +
            "<div><span>Status</span><strong>" + esc(event.status || "—") + "</strong></div>" +
            "<div><span>Source</span><strong>" + esc(event.source || "—") + "</strong></div>" +
          "</div>" +
        "</section>" +
        "<section><div class='audit-section-label'>4 · Provenance</div>" + provenanceSection(event) + "</section>" +
        "<section><div class='audit-section-label'>5 · Resulting patient state</div>" + statesSection(event) + "</section>" +
        harnessSection(event) +
      "</div>" +
    "</details>";
  }

  function render(payload) {
    var events = payload && Array.isArray(payload.events) ? payload.events : [];
    title.textContent = payload && payload.patient
      ? payload.patient.displayName + " · Activity / Audit"
      : "Activity / Audit";
    meta.textContent = payload && payload.patient
      ? payload.patient.externalId + " · PostgreSQL event/provenance trail"
      : "PostgreSQL event/provenance trail";
    count.textContent = events.length + (events.length === 1 ? " event" : " events");
    stateBadge.textContent = payload && payload.latestState
      ? "Patient State v" + payload.latestState.stateVersion
      : "no state";

    if (!events.length) {
      list.innerHTML = "<div class='audit-empty'>No persisted events for this patient.</div>";
      return;
    }
    list.innerHTML = events.map(eventCard).join("");
  }

  async function loadAudit() {
    var patient = activePatientSafe();
    var cfg = config();
    if (!patient) return;
    if (!cfg || !cfg.baseUrl || !cfg.anonJwt) {
      list.innerHTML = "<div class='audit-empty'>Backend configuration unavailable.</div>";
      return;
    }

    var seq = ++requestSeq;
    title.textContent = patient.name + " · Activity / Audit";
    meta.textContent = patient.id + " · loading persisted event trail";
    count.textContent = "loading";
    stateBadge.textContent = patient.backendSource && patient.backendSource.stateVersion
      ? "Patient State v" + patient.backendSource.stateVersion
      : "state —";
    list.innerHTML = "<div class='audit-loading'>Loading PostgreSQL activity…</div>";

    var endpoint = cfg.baseUrl + "/functions/v1/patient-activity-audit?patient_id=" +
      encodeURIComponent(patient.id) + "&limit=75";
    try {
      var response = await fetch(endpoint, {
        method:"GET",
        headers:{ "Accept":"application/json", "Authorization":"Bearer " + cfg.anonJwt },
        cache:"no-store"
      });
      var payload = await response.json().catch(function(){ return {}; });
      if (!response.ok) throw new Error(payload.error || ("Audit HTTP " + response.status));
      if (seq !== requestSeq) return;
      render(payload);
    } catch (error) {
      if (seq !== requestSeq) return;
      list.innerHTML = "<div class='audit-empty audit-error'>Unable to load audit trail: " +
        esc(error && error.message ? error.message : error) + "</div>";
      count.textContent = "error";
    }
  }

  function openAudit() {
    drawer.classList.remove("hidden");
    backdrop.classList.remove("hidden");
    drawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("audit-drawer-open");
    loadAudit();
  }

  function closeAudit() {
    drawer.classList.add("hidden");
    backdrop.classList.add("hidden");
    drawer.setAttribute("aria-hidden", "true");
    document.body.classList.remove("audit-drawer-open");
  }

  openBtn.addEventListener("click", openAudit);
  closeBtn.addEventListener("click", closeAudit);
  backdrop.addEventListener("click", closeAudit);
  if (refreshBtn) refreshBtn.addEventListener("click", loadAudit);

  document.addEventListener("keydown", function(event) {
    if (event.key === "Escape" && !drawer.classList.contains("hidden")) closeAudit();
  });

  window.addEventListener("patient-audit-updated", function() {
    if (!drawer.classList.contains("hidden")) loadAudit();
  });

  var patientNameNode = document.getElementById("ptName");
  if (patientNameNode && window.MutationObserver) {
    new MutationObserver(function() {
      if (!drawer.classList.contains("hidden")) loadAudit();
    }).observe(patientNameNode, { childList:true, subtree:true, characterData:true });
  }

  window.PATIENT_AUDIT_UI = { open:openAudit, close:closeAudit, refresh:loadAudit };
})();