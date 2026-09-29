/* =========================================================================
 * Pre-charting workspace
 * Source collection + bounded organizational agents for the synthetic demo.
 * No autonomous diagnosis, prescribing, or binary-document parsing.
 * ========================================================================= */

(function () {
  var workspace = document.getElementById("prechartWorkspace");
  var openBtn = document.getElementById("openPrechartWorkspaceBtn");
  var closeBtn = document.getElementById("closePrechartWorkspaceBtn");
  if (!workspace || !openBtn || !closeBtn) return;

  var patientStore = new Map();
  var fileUrlStore = new Map();
  var sourceSequence = 0;

  var ambientInput = document.getElementById("ambientTranscriptInput");
  var ambientStatus = document.getElementById("ambientStatus");
  var ambientReviewedInput = document.getElementById("ambientReviewedInput");
  var ambientReviewStatus = document.getElementById("ambientReviewStatus");
  var reviewAmbientBtn = document.getElementById("reviewAmbientBtn");
  var startAmbientDemoBtn = document.getElementById("startAmbientDemoBtn");
  var addAmbientSourceBtn = document.getElementById("addAmbientSourceBtn");
  var dictationInput = document.getElementById("physicianDictationInput");
  var dictationStatus = document.getElementById("dictationStatus");
  var startDictationBtn = document.getElementById("startDictationBtn");
  var addDictationSourceBtn = document.getElementById("addDictationSourceBtn");
  var clearDictationBtn = document.getElementById("clearDictationBtn");
  var ambientMicSupport = document.getElementById("ambientMicSupport");
  var ambientModeBtn = document.getElementById("ambientModeBtn");
  var dictationModeBtn = document.getElementById("dictationModeBtn");
  var voiceRuntimeStatus = document.getElementById("voiceRuntimeStatus");
  var ambientCaptureCard = document.getElementById("ambientCaptureCard");
  var dictationCaptureCard = document.getElementById("dictationCaptureCard");
  var typedInput = document.getElementById("typedPrechartInput");
  var typedSourceType = document.getElementById("typedSourceType");
  var addTypedSourceBtn = document.getElementById("addTypedSourceBtn");
  var fileInput = document.getElementById("prechartFileInput");
  var dropzone = document.querySelector(".prechart-dropzone");
  var attachmentList = document.getElementById("prechartAttachmentList");
  var sourceLedger = document.getElementById("prechartSourceLedger");
  var sourceCount = document.getElementById("prechartSourceCount");
  var intakeSummary = document.getElementById("intakeAgentSummary");
  var organizerSummary = document.getElementById("organizerAgentSummary");
  var noteEditor = document.getElementById("prechartWorkspaceNote");
  var organizeBtn = document.getElementById("organizePrechartBtn");
  var copyBtn = document.getElementById("copyPrechartBtn");
  var scribeExtractionList = document.getElementById("scribeExtractionList");
  var scribeExtractionCount = document.getElementById("scribeExtractionCount");
  var scribeWriteQueue = Promise.resolve();

  function scribeBackendConfig() {
    return window.SUPABASE_DEMO_BACKEND || null;
  }

  function stableHash(text) {
    var hash = 2166136261;
    for (var i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function scribeRecordId(patient, field, value, sourceText, observedDate) {
    var encounterId = window.ENCOUNTER_WORKFLOW_UI && ENCOUNTER_WORKFLOW_UI.currentId(patient.id);
    return [
      "scribe",
      patient.id,
      encounterId || "unsaved",
      observedDate,
      field,
      stableHash(JSON.stringify(value) + "|" + String(sourceText || "").toLowerCase())
    ].join("-");
  }

  function replacePatientFromBackend(patientId, payload) {
    if (!payload || !payload.patient) return null;
    var patient = payload.patient;
    patient.backendSource = {
      type:"supabase-postgresql",
      stateVersion:payload.stateVersion,
      generatedAt:new Date().toISOString(),
      engineVersion:"ambient-scribe-state-v1"
    };

    var index = window.PATIENTS.findIndex(function(item) {
      return item.id === patientId;
    });
    if (index >= 0) window.PATIENTS[index] = patient;

    if (currentPatient && currentPatient.id === patientId) {
      renderPatient(patient, false);
      renderScribeExtractions(patient);
      if (window.PRECHART_WORKSPACE_API && PRECHART_WORKSPACE_API.refresh) {
        window.setTimeout(function(){ PRECHART_WORKSPACE_API.refresh(); }, 0);
      }
    }
    return patient;
  }

  function persistAmbientExtractions(patient, records, rawTranscript, reviewedTranscript) {
    if (!patient || !records || !records.length) return Promise.resolve(null);
    var cfg = scribeBackendConfig();
    if (!cfg || !cfg.baseUrl || !cfg.anonJwt) {
      setRuntimeStatus("Structured observations are pending: backend configuration unavailable.", "warn");
      return Promise.resolve(null);
    }

    var encounterId = window.ENCOUNTER_WORKFLOW_UI && ENCOUNTER_WORKFLOW_UI.currentId(patient.id);
    if (!encounterId) {
      setRuntimeStatus("Save an encounter draft before submitting proposed observations.", "warn");
      return Promise.resolve(null);
    }

    var patientId = patient.id;
    var endpoint = cfg.baseUrl + "/functions/v1/ambient-scribe-write-gated";
    setRuntimeStatus("Sending structured observations for physician review…", "warn");

    scribeWriteQueue = scribeWriteQueue.then(function() {
      return fetch(endpoint, {
        method:"POST",
        headers:{
          "Accept":"application/json",
          "Content-Type":"application/json",
          "Authorization":"Bearer " + cfg.anonJwt
        },
        cache:"no-store",
        body:JSON.stringify({
          patientId:patientId,
          encounterId:encounterId,
          records:records,
          rawTranscript:rawTranscript || "",
          reviewedTranscript:reviewedTranscript || ""
        })
      }).then(async function(response) {
        var payload = await response.json().catch(function(){ return {}; });
        if (!response.ok) {
          var writerSuffix = payload.writerVersion ? " [writer v" + payload.writerVersion + "]" : "";
          throw new Error((payload.error || ("Ambient scribe write HTTP " + response.status)) + writerSuffix);
        }
        var writerLabel = payload.writerVersion ? " · writer " + payload.writerVersion : "";
        setRuntimeStatus(
          "Proposed " + (payload.proposed || (payload.proposals ? payload.proposals.length : 0)) +
          " structured observation" + ((payload.proposed || 0) === 1 ? "" : "s") +
          " for physician review" + writerLabel,
          "ok"
        );
        if (window.SCRIBE_REVIEW_UI && SCRIBE_REVIEW_UI.refresh) {
          SCRIBE_REVIEW_UI.refresh();
        }
        return payload;
      });
    }).catch(function(error) {
      console.error("Ambient scribe PostgreSQL write failed.", error);
      setRuntimeStatus("Structured observation save failed: " + (error && error.message ? error.message : error), "error");
      return null;
    });

    return scribeWriteQueue;
  }

  function activePatient() {
    return window.currentPatient || currentPatient || null;
  }

  function activePatientId() {
    var p = activePatient();
    return p ? p.id : null;
  }

  function newId(prefix) {
    sourceSequence += 1;
    return prefix + "-" + Date.now() + "-" + sourceSequence;
  }

  function getState(patientId) {
    if (!patientStore.has(patientId)) {
      patientStore.set(patientId, {
        sources: [],
        note: "",
        createdAt: new Date().toISOString()
      });
    }
    return patientStore.get(patientId);
  }

  function safeText(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function humanBytes(bytes) {
    if (!Number.isFinite(bytes)) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function fileKind(file) {
    var type = (file.type || "").toLowerCase();
    var name = (file.name || "").toLowerCase();
    if (type.indexOf("pdf") >= 0 || name.endsWith(".pdf")) return "PDF";
    if (type.indexOf("image/") === 0) return "IMAGE";
    if (type.indexOf("text/") === 0 || /\.(txt|rtf|csv|tsv|xml|json|html?)$/.test(name)) return "TEXT";
    if (/\.(doc|docx)$/.test(name)) return "WORD";
    if (/\.(xls|xlsx)$/.test(name)) return "SHEET";
    return "FILE";
  }

  function sourceLabel(kind) {
    var labels = {
      "ambient-transcript": "Ambient transcript",
      "physician-dictation": "Physician dictation",
      "typed-note": "Typed note",
      "outside-note": "Outside note",
      "referral": "Referral",
      "patient-message": "Patient message",
      "other": "Other text",
      "attachment": "Attachment",
      "lab-trend": "Lab trend"
    };
    return labels[kind] || kind;
  }

  function ensureLabSources(patient) {
    if (!patient || !window.PRECHART_LABS_API) return;
    var state = getState(patient.id);
    var entries = PRECHART_LABS_API.getEntries(patient.id) || [];

    entries.forEach(function (entry) {
      var key = "lab-" + entry.name;
      var existing = state.sources.find(function (source) {
        return source.externalKey === key;
      });
      if (existing) {
        existing.text = entry.summary;
        existing.title = entry.name + " trend";
        existing.status = "ready";
        return;
      }

      state.sources.push({
        id: newId("lab"),
        externalKey: key,
        kind: "lab-trend",
        title: entry.name + " trend",
        text: entry.summary,
        status: "ready",
        provenance: "Source Data · longitudinal lab tile",
        createdAt: new Date().toISOString()
      });
    });
  }

  function addTextSource(kind, title, text, provenance) {
    var patient = activePatient();
    if (!patient || !text || !text.trim()) return false;

    getState(patient.id).sources.push({
      id: newId("text"),
      kind: kind,
      title: title,
      text: text.trim(),
      status: "ready",
      provenance: provenance,
      createdAt: new Date().toISOString()
    });

    renderWorkspace();
    return true;
  }

  function addFiles(files) {
    var patient = activePatient();
    if (!patient || !files || !files.length) return;

    var state = getState(patient.id);

    Array.from(files).forEach(function (file) {
      var id = newId("file");
      var objectUrl = null;

      try {
        objectUrl = URL.createObjectURL(file);
        fileUrlStore.set(id, objectUrl);
      } catch (_) {}

      state.sources.push({
        id: id,
        kind: "attachment",
        title: file.name || "Attached document",
        text: "",
        status: "attached",
        provenance: "Local browser attachment",
        createdAt: new Date().toISOString(),
        file: {
          name: file.name || "unnamed",
          size: file.size,
          type: file.type || "unknown",
          label: fileKind(file),
          objectUrl: objectUrl
        }
      });
    });

    fileInput.value = "";
    renderWorkspace();
  }

  function removeSource(sourceId) {
    var patientId = activePatientId();
    if (!patientId) return;

    var state = getState(patientId);
    var source = state.sources.find(function (item) { return item.id === sourceId; });

    if (source && fileUrlStore.has(sourceId)) {
      try { URL.revokeObjectURL(fileUrlStore.get(sourceId)); } catch (_) {}
      fileUrlStore.delete(sourceId);
    }

    state.sources = state.sources.filter(function (item) {
      return item.id !== sourceId;
    });

    renderWorkspace();
  }

  function sourcePreview(source) {
    if (source.kind === "attachment" && source.file) {
      return source.file.label + " · " + humanBytes(source.file.size) +
        " · attached locally; contents not parsed in this prototype";
    }

    var text = source.text || "";
    return text.length > 210 ? text.slice(0, 210) + "…" : text;
  }

  function renderAttachments(state) {
    var attachments = state.sources.filter(function (source) {
      return source.kind === "attachment";
    });

    if (!attachments.length) {
      attachmentList.innerHTML =
        "<div class='prechart-ledger-empty'>No documents attached.</div>";
      return;
    }

    attachmentList.innerHTML = attachments.map(function (source) {
      var open = source.file && source.file.objectUrl
        ? "<button type='button' class='small-btn prechart-open-file' data-source-id='" + safeText(source.id) + "'>Open</button>"
        : "";

      return "<div class='prechart-attachment'>" +
        "<div class='prechart-attachment-icon'>" + safeText(source.file.label) + "</div>" +
        "<div>" +
          "<div class='prechart-attachment-name'>" + safeText(source.file.name) + "</div>" +
          "<div class='prechart-attachment-meta'>" + safeText(humanBytes(source.file.size)) +
          " · attached · not yet parsed</div>" +
        "</div>" +
        "<div class='prechart-inline-actions'>" + open +
          "<button type='button' class='prechart-remove-source' data-source-id='" + safeText(source.id) + "' aria-label='Remove attachment'>×</button>" +
        "</div>" +
      "</div>";
    }).join("");
  }

  function renderLedger(state) {
    if (!state.sources.length) {
      sourceLedger.innerHTML =
        "<div class='prechart-ledger-empty'>No pre-chart source material added yet.</div>";
      sourceCount.textContent = "0 sources";
      return;
    }

    sourceCount.textContent = state.sources.length + (state.sources.length === 1 ? " source" : " sources");

    sourceLedger.innerHTML = state.sources.map(function (source) {
      var statusClass = source.status === "ready" ? "ready" : "attached";

      return "<div class='prechart-ledger-item'>" +
        "<div class='prechart-ledger-kind'>" + safeText(sourceLabel(source.kind)) + "</div>" +
        "<div>" +
          "<div class='prechart-ledger-title'>" + safeText(source.title) + "</div>" +
          "<div class='prechart-ledger-preview'>" + safeText(sourcePreview(source)) + "</div>" +
          "<div class='prechart-ledger-preview'>Source: " + safeText(source.provenance || "not specified") + "</div>" +
        "</div>" +
        "<div>" +
          "<div class='prechart-ledger-status " + statusClass + "'>" +
            (source.status === "ready" ? "ready to organize" : "attached · awaiting processing") +
          "</div>" +
          "<button type='button' class='prechart-remove-source' data-source-id='" + safeText(source.id) + "' aria-label='Remove source'>×</button>" +
        "</div>" +
      "</div>";
    }).join("");
  }

  function renderAgentSummaries(state) {
    var ready = state.sources.filter(function (source) { return source.status === "ready"; }).length;
    var attached = state.sources.filter(function (source) { return source.status === "attached"; }).length;
    var kinds = Array.from(new Set(state.sources.map(function (source) {
      return sourceLabel(source.kind);
    })));

    intakeSummary.textContent = state.sources.length
      ? state.sources.length + " source(s) registered across " + kinds.length +
        " source type(s). " + ready + " ready to organize; " + attached +
        " attachment(s) preserved as source metadata pending document processing."
      : "No source material added yet.";

    organizerSummary.textContent = ready
      ? ready + " text/lab source(s) can be organized into the editable pre-charting note. " +
        "Attachments remain listed separately until their contents are processed or reviewed."
      : "Waiting for text, transcript, or lab-trend source material.";
  }

  function buildOrganizedNote(patient, state) {
    var lines = [];
    var textSources = state.sources.filter(function (source) {
      return source.status === "ready" && source.kind !== "lab-trend";
    });
    var labs = state.sources.filter(function (source) {
      return source.status === "ready" && source.kind === "lab-trend";
    });
    var attachments = state.sources.filter(function (source) {
      return source.kind === "attachment";
    });

    lines.push("PRE-CHARTING WORKSPACE");
    lines.push(patient.name + " · " + patient.id);
    lines.push("");

    lines.push("SOURCE MATERIAL");
    if (!state.sources.length) {
      lines.push("- No source material added.");
    } else {
      state.sources.forEach(function (source) {
        var status = source.status === "ready" ? "reviewable" : "attached / not parsed";
        lines.push("- " + sourceLabel(source.kind) + ": " + source.title + " [" + status + "]");
      });
    }

    lines.push("");
    lines.push("TEXT / TRANSCRIPT MATERIAL");
    if (!textSources.length) {
      lines.push("- None added.");
    } else {
      textSources.forEach(function (source) {
        lines.push("");
        lines.push(source.title.toUpperCase());
        lines.push(source.text);
      });
    }

    lines.push("");
    lines.push("LAB TRENDS REVIEWED");
    if (!labs.length) {
      lines.push("- No lab trend tiles opened.");
    } else {
      labs.forEach(function (source) {
        lines.push("- " + source.text);
      });
    }

    lines.push("");
    lines.push("STRUCTURED AMBIENT OBSERVATIONS");
    var structured = patient.scribeObservations ? Object.keys(patient.scribeObservations).map(function(key) {
      return patient.scribeObservations[key];
    }) : [];
    if (!structured.length) {
      lines.push("- None extracted.");
    } else {
      structured.forEach(function(record) {
        lines.push("- " + record.displayLabel + ": " + extractionValueText(record) +
          " [ambient scribe · synthetic auto-applied]");
      });
    }

    lines.push("");
    lines.push("ATTACHMENTS");
    if (!attachments.length) {
      lines.push("- None.");
    } else {
      attachments.forEach(function (source) {
        lines.push("- " + source.file.name + " · " + source.file.label +
          " · " + humanBytes(source.file.size) + " · attached; contents not parsed");
      });
    }

    lines.push("");
    lines.push("PHYSICIAN REVIEW");
    lines.push("- Verify source accuracy, reconcile conflicts, and edit this organizational draft before using it in clinical documentation.");
    lines.push("- Treatment decisions remain physician-controlled.");

    return lines.join("\n");
  }

  function organize() {
    var patient = activePatient();
    if (!patient) return;

    ensureLabSources(patient);
    var state = getState(patient.id);
    state.note = buildOrganizedNote(patient, state);
    noteEditor.value = state.note;
    renderAgentSummaries(state);
  }

  function renderWorkspace() {
    var patient = activePatient();
    if (!patient) return;

    ensureLabSources(patient);
    var state = getState(patient.id);

    document.getElementById("prechartWorkspaceTitle").textContent =
      patient.name + " · Pre-charting";
    document.getElementById("prechartWorkspaceMeta").textContent =
      patient.id + " · " + patient.diagnosis +
      " · organizational workspace for source review before the encounter";

    renderAttachments(state);
    renderLedger(state);
    renderAgentSummaries(state);
    renderScribeExtractions(patient);

    if (!state.note && state.sources.some(function (source) { return source.status === "ready"; })) {
      state.note = buildOrganizedNote(patient, state);
    }
    noteEditor.value = state.note || "";
  }

  function openWorkspace() {
    var patient = activePatient();
    if (!patient) return;
    renderWorkspace();
    workspace.classList.remove("hidden");
    workspace.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeWorkspace() {
    if (activeRecognition) stopVoiceCapture();
    var patientId = activePatientId();
    if (patientId) {
      getState(patientId).note = noteEditor.value;
    }
    workspace.classList.add("hidden");
    workspace.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  openBtn.addEventListener("click", openWorkspace);
  closeBtn.addEventListener("click", closeWorkspace);

  workspace.addEventListener("click", function (event) {
    if (event.target === workspace) closeWorkspace();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !workspace.classList.contains("hidden")) {
      closeWorkspace();
    }
  });


  function todayIsoDate() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function ensureScribeStores(patient) {
    if (!patient.scribeObservations) patient.scribeObservations = {};
    if (!patient.scribeExtractionLog) patient.scribeExtractionLog = [];
    if (!patient.scribeVitals) patient.scribeVitals = {};
  }

  function labFlag(lab, value) {
    if (!lab || !Array.isArray(lab.ref) || lab.ref.length < 2) return lab && lab.flag ? lab.flag : "normal";
    var lo = Number(lab.ref[0]);
    var hi = Number(lab.ref[1]);
    if (Number.isFinite(lo) && value < lo) return "low";
    if (Number.isFinite(hi) && value > hi) return "high";
    return "normal";
  }

  function albuminuriaCategory(value) {
    if (value < 30) return { code:"A1", label:"normal to mildly increased" };
    if (value < 300) return { code:"A2", label:"moderately increased" };
    return { code:"A3", label:"severely increased" };
  }

  function gfrCategory(value) {
    if (value >= 90) return "G1";
    if (value >= 60) return "G2";
    if (value >= 45) return "G3a";
    if (value >= 30) return "G3b";
    if (value >= 15) return "G4";
    return "G5";
  }

  function appendOrUpdateDatedValue(history, value, date, extra) {
    if (!Array.isArray(history)) return;
    var payload = Object.assign({ date:date, value:value }, extra || {});
    if (!history.length) {
      history.push(payload);
      return;
    }
    var last = history[history.length - 1];
    if (typeof last === "object" && last !== null && last.date === date) {
      history[history.length - 1] = Object.assign({}, last, payload);
      return;
    }
    history.push(payload);
  }

  function appendOrUpdateBloodPressure(history, value, date, source) {
    if (!Array.isArray(history)) return;
    var payload = {
      date:date,
      systolic:value.systolic,
      diastolic:value.diastolic,
      source:source || "ambient scribe extraction"
    };
    if (!history.length) {
      history.push(payload);
      return;
    }
    var last = history[history.length - 1];
    if (last && last.date === date) {
      history[history.length - 1] = Object.assign({}, last, payload);
      return;
    }
    history.push(payload);
  }

  function applyLabExtraction(patient, labName, value, record) {
    if (!patient.labs || !patient.labs[labName]) return;
    patient.labs[labName].value = value;
    patient.labs[labName].flag = labFlag(patient.labs[labName], value);

    if (patient.labHistory && patient.labHistory[labName]) {
      appendOrUpdateDatedValue(patient.labHistory[labName].values, value, record.observedDate, { source:"ambient-scribe-extraction" });
      patient.labHistory[labName].currentFlag = patient.labs[labName].flag;
    }

    if (!patient.longitudinal) return;

    if (labName === "eGFR" && patient.longitudinal.kidney) {
      patient.longitudinal.kidney.currentEgfr = value;
      appendOrUpdateDatedValue(patient.longitudinal.kidney.trajectory, value, record.observedDate, { source:"ambient-scribe-extraction" });
      if (patient.combinedCkdProgression) {
        patient.combinedCkdProgression.gCategory = gfrCategory(value);
        patient.combinedCkdProgression.cgaLabel =
          patient.combinedCkdProgression.gCategory + (patient.combinedCkdProgression.aCategory || "");
      }
    }

    if (labName === "UPCR" && patient.longitudinal.proteinuria) {
      patient.longitudinal.proteinuria.current = value;
    }

    if (labName === "UACR" && patient.longitudinal.proteinuria) {
      var a = albuminuriaCategory(value);
      patient.longitudinal.proteinuria.currentUacr = value;
      patient.longitudinal.proteinuria.albuminuriaCategory = a.code;
      appendOrUpdateDatedValue(patient.longitudinal.proteinuria.uacrTrajectory, value, record.observedDate, { source:"ambient-scribe-extraction" });

      if (patient.albuminuriaProgression) {
        patient.albuminuriaProgression.current = value;
        patient.albuminuriaProgression.category = a.code;
        patient.albuminuriaProgression.categoryLabel = a.label;
        appendOrUpdateDatedValue(patient.albuminuriaProgression.history, value, record.observedDate, { source:"ambient-scribe-extraction" });
      }
      if (patient.combinedCkdProgression) {
        patient.combinedCkdProgression.aCategory = a.code;
        patient.combinedCkdProgression.cgaLabel =
          (patient.combinedCkdProgression.gCategory || gfrCategory(patient.labs.eGFR.value)) + a.code;
      }
    }

    if (labName === "Potassium" && patient.longitudinal.electrolytes) {
      patient.longitudinal.electrolytes.potassium = value;
    }
    if (labName === "Bicarbonate" && patient.longitudinal.electrolytes) {
      patient.longitudinal.electrolytes.bicarbonate = value;
    }
    if (labName === "Hemoglobin" && patient.longitudinal.anemia) {
      patient.longitudinal.anemia.hemoglobin = value;
    }
    if (labName === "Phosphate" && patient.longitudinal.ckdMbd) {
      patient.longitudinal.ckdMbd.phosphate = value;
    }
  }

  function applyVitalExtraction(patient, key, value, record) {
    patient.scribeVitals[key] = {
      value:value,
      unit:record.unit,
      observedAt:record.observedAt,
      observedDate:record.observedDate,
      sourceText:record.sourceText,
      source:"ambient-scribe-extraction"
    };

    if (!patient.longitudinal) return;
    if (key === "bloodPressure" && patient.longitudinal.bpVolume) {
      patient.longitudinal.bpVolume.latestBp = value.systolic + "/" + value.diastolic;
      appendOrUpdateBloodPressure(
        patient.longitudinal.bpVolume.history,
        value,
        record.observedDate,
        "ambient scribe extraction"
      );
      if (patient.kidneyProtectionTimeline) {
        appendOrUpdateBloodPressure(
          patient.kidneyProtectionTimeline.bpHistory,
          value,
          record.observedDate,
          "ambient scribe extraction"
        );
      }
    }
  }

  function recordExtraction(patient, field, displayLabel, value, unit, sourceText, type) {
    ensureScribeStores(patient);
    var observedAt = new Date().toISOString();
    var observedDate = todayIsoDate();
    var record = {
      id:scribeRecordId(patient, field, value, sourceText, observedDate),
      field:field,
      displayLabel:displayLabel,
      value:value,
      unit:unit || "",
      sourceText:sourceText,
      observedAt:observedAt,
      observedDate:observedDate,
      source:"ambient-scribe-extraction",
      sourceLabel:"Ambient scribe · extracted from spoken transcript",
      confidence:"pattern-match-demo",
      status:"pending-backend",
      type:type
    };
    return record;
  }

  function spokenNumberValue(phrase) {
    var ones = {
      zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9,
      ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16,
      seventeen:17, eighteen:18, nineteen:19
    };
    var tens = {
      twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90
    };
    var tokens = String(phrase || "").toLowerCase().replace(/-/g, " ").split(/\s+/).filter(Boolean)
      .filter(function(token){ return token !== "and"; });
    if (!tokens.length) return null;

    var pointIndex = tokens.indexOf("point");
    var integerTokens = pointIndex >= 0 ? tokens.slice(0, pointIndex) : tokens.slice();
    var decimalTokens = pointIndex >= 0 ? tokens.slice(pointIndex + 1) : [];

    function parseInteger(parts) {
      if (!parts.length) return 0;

      if (parts.length === 2 && ones[parts[0]] >= 1 && ones[parts[0]] <= 9 && tens[parts[1]] != null) {
        return ones[parts[0]] * 100 + tens[parts[1]];
      }
      if (parts.length === 3 && ones[parts[0]] >= 1 && ones[parts[0]] <= 9 &&
          tens[parts[1]] != null && ones[parts[2]] != null && ones[parts[2]] < 10) {
        return ones[parts[0]] * 100 + tens[parts[1]] + ones[parts[2]];
      }

      var total = 0;
      var current = 0;
      for (var i = 0; i < parts.length; i += 1) {
        var token = parts[i];
        if (ones[token] != null) current += ones[token];
        else if (tens[token] != null) current += tens[token];
        else if (token === "hundred") {
          current = (current || 1) * 100;
        } else {
          return null;
        }
      }
      return total + current;
    }

    var integer = parseInteger(integerTokens);
    if (integer == null) return null;
    if (pointIndex < 0) return integer;

    if (!decimalTokens.length) return null;
    var digits = "";
    for (var j = 0; j < decimalTokens.length; j += 1) {
      var d = ones[decimalTokens[j]];
      if (d == null || d > 9) return null;
      digits += String(d);
    }
    return Number(String(integer) + "." + digits);
  }

  function normalizeSpokenNumbers(text) {
    var numberWord =
      "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|point|and)";
    var re = new RegExp("\\b" + numberWord + "(?:[\\s-]+" + numberWord + ")*\\b", "gi");
    return String(text || "").replace(re, function(match) {
      var value = spokenNumberValue(match);
      return value == null ? match : String(value);
    });
  }

  function normalizeClinicalTranscript(raw) {
    var text = String(raw || "");
    if (!text.trim()) return "";

    text = text
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/\s+/g, " ")
      .trim();

    text = text
      .replace(/\be\s*[- ]?\s*g\s*f\s*r\b/gi, "eGFR")
      .replace(/\bestimated\s+g\s*f\s*r\b/gi, "eGFR")
      .replace(/\bu\s*a\s*c\s*r\b/gi, "UACR")
      .replace(/\bu\s*p\s*c\s*r\b/gi, "UPCR")
      .replace(/\bh\s*c\s*o\s*3\b/gi, "bicarbonate")
      .replace(/\bbicarb(?:onate)?\b/gi, "bicarbonate")
      .replace(/\bh\s*g\s*b\b/gi, "hemoglobin")
      .replace(/\bphos(?:phorus|phate)?\b/gi, "phosphate")
      .replace(/\bo\s*(?:two|2)\s*sat(?:uration)?\b/gi, "oxygen saturation")
      .replace(/\bspo\s*2\b/gi, "oxygen saturation")
      .replace(/\bheart\s*rate\b/gi, "heart rate")
      .replace(/\bblood\s*pressure\b/gi, "blood pressure");

    text = normalizeSpokenNumbers(text);

    text = text
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/([,.;:!?])(?=[A-Za-z0-9])/g, "$1 ")
      .replace(/\s{2,}/g, " ")
      .trim();

    return text;
  }

  function lastMatch(text, regex) {
    var flags = regex.flags.indexOf("g") >= 0 ? regex.flags : regex.flags + "g";
    var re = new RegExp(regex.source, flags);
    var match = null;
    var current = null;
    while ((current = re.exec(text)) !== null) {
      match = current;
      if (current[0] === "") re.lastIndex += 1;
    }
    return match;
  }

  function parseAmbientStructuredData(text, reviewedText) {
    var patient = activePatient();
    if (!patient || !text || !text.trim()) return [];

    var normalized = normalizeClinicalTranscript(text).replace(/,/g, "");
    var reviewedNormalized = normalizeClinicalTranscript(reviewedText || "");
    var extractedByField = new Map();

    function addLab(field, label, regex, unit) {
      var m = lastMatch(normalized, regex);
      if (!m) return;
      var value = Number(m[1]);
      if (!Number.isFinite(value)) return;
      extractedByField.set(field, recordExtraction(patient, field, label, value, unit, m[0], "lab"));
    }

    function addVital(field, label, regex, unit, transform) {
      var m = lastMatch(normalized, regex);
      if (!m) return;
      var value = transform ? transform(m) : Number(m[1]);
      if (value == null || (typeof value === "number" && !Number.isFinite(value))) return;
      extractedByField.set(field, recordExtraction(patient, field, label, value, unit, m[0], "vital"));
    }

    addVital(
      "bloodPressure", "Blood pressure",
      /(?:blood\s+pressure|\bbp\b)\s*(?:(?:is|was|of|today(?:\s+is)?|equals?|at|reads?|reading)\s*)?(\d{2,3})\s*(?:over|\/)\s*(\d{2,3})/i,
      "mm Hg",
      function(m){ return { systolic:Number(m[1]), diastolic:Number(m[2]) }; }
    );
    addVital(
      "heartRate", "Heart rate",
      /(?:heart\s+rate|pulse)\s*(?:(?:is|was|of|equals?|at|reads?|reading)\s*)?(\d{2,3})/i,
      "bpm"
    );
    addVital(
      "weight", "Weight",
      /(?:weight|weighs|weighed)\s*(?:(?:is|was|of|equals?|at)\s*)?(\d+(?:\.\d+)?)\s*(pounds?|lbs?|lb|kg|kilograms?)?/i,
      "reported",
      function(m){
        return { amount:Number(m[1]), reportedUnit:(m[2] || "").toLowerCase() || "unspecified" };
      }
    );
    addVital(
      "temperature", "Temperature",
      /(?:temperature|temp)\s*(?:(?:is|was|of|equals?|at)\s*)?(\d{2,3}(?:\.\d+)?)/i,
      "reported"
    );
    addVital(
      "oxygenSaturation", "Oxygen saturation",
      /(?:oxygen\s+saturation|o2\s*sat(?:uration)?|spo2|sat(?:uration)?)\s*(?:(?:is|was|of|equals?|at)\s*)?(\d{2,3})(?:\s*percent|\s*%)?/i,
      "%"
    );

    addLab(
      "eGFR", "eGFR",
      /(?:\begfr\b|estimated\s+(?:glomerular\s+filtration\s+rate|gfr)|\bgfr\b)\s*(?:(?:is|was|of|equals?|at|now|today(?:\s+is)?)\s*)?(\d+(?:\.\d+)?)/i,
      "mL/min/1.73m²"
    );
    addLab(
      "UACR", "UACR",
      /(?:\buacr\b|urine\s+albumin(?:\s*[-\/]?to)?\s+creatinine\s+ratio|albumin\s+creatinine\s+ratio)\s*(?:(?:is|was|of|equals?|at)\s*)?(\d+(?:\.\d+)?)/i,
      "mg/g"
    );
    addLab(
      "UPCR", "UPCR",
      /(?:\bupcr\b|urine\s+protein(?:\s*[-\/]?to)?\s+creatinine\s+ratio|protein\s+creatinine\s+ratio)\s*(?:(?:is|was|of|equals?|at)\s*)?(\d+(?:\.\d+)?)/i,
      "g/g"
    );
    addLab(
      "Potassium", "Potassium",
      /\bpotassium\b\s*(?:(?:is|was|of|equals?|at|now)\s*)?(\d+(?:\.\d+)?)/i,
      "mEq/L"
    );
    addLab(
      "Phosphate", "Phosphate",
      /\b(?:phosphorus|phosphate)\b\s*(?:(?:is|was|of|equals?|at|now)\s*)?(\d+(?:\.\d+)?)/i,
      "mg/dL"
    );
    addLab(
      "Bicarbonate", "Bicarbonate",
      /\b(?:bicarbonate|hco3)\b\s*(?:(?:is|was|of|equals?|at|now)\s*)?(\d+(?:\.\d+)?)/i,
      "mEq/L"
    );
    addLab(
      "Hemoglobin", "Hemoglobin",
      /\b(?:hemoglobin|haemoglobin|hgb)\b\s*(?:(?:is|was|of|equals?|at|now)\s*)?(\d+(?:\.\d+)?)/i,
      "g/dL"
    );
    addLab(
      "Creatinine", "Creatinine",
      /\bcreatinine\b\s*(?:(?:is|was|of|equals?|at|now)\s*)?(\d+(?:\.\d+)?)/i,
      "mg/dL"
    );

    var extracted = Array.from(extractedByField.values());
    if (extracted.length) {
      persistAmbientExtractions(
        patient,
        extracted,
        String(text || "").trim(),
        reviewedNormalized
      );
    }
    return extracted;
  }

  function extractionValueText(record) {
    if (record.field === "bloodPressure" && record.value) {
      return record.value.systolic + "/" + record.value.diastolic + " " + record.unit;
    }
    if (record.field === "weight" && record.value) {
      return record.value.amount + " " + record.value.reportedUnit;
    }
    return record.value + (record.unit ? " " + record.unit : "");
  }

  function renderScribeExtractions(patient) {
    if (!scribeExtractionList || !scribeExtractionCount) return;
    ensureScribeStores(patient);
    var records = patient.scribeExtractionLog || [];
    scribeExtractionCount.textContent = records.length + " extracted";
    if (!records.length) {
      scribeExtractionList.innerHTML = "<div class='prechart-ledger-empty'>No discrete observations extracted yet.</div>";
      return;
    }

    if (window.PRECHART_LABS_API && PRECHART_LABS_API.upsertExternalEntry) {
      var latest = Object.keys(patient.scribeObservations || {}).map(function(key) {
        return patient.scribeObservations[key];
      });
      PRECHART_LABS_API.upsertExternalEntry(
        patient.id,
        "Ambient scribe · structured observations",
        {
          name:"Ambient scribe · structured observations",
          current:latest.length,
          unit:"discrete fields",
          ref:null,
          summary:latest.map(function(record) {
            return record.displayLabel + " " + extractionValueText(record);
          }).join(" · "),
          progression:{ source:"ambient-scribe-extraction", status:"applied-synthetic" },
          history:latest.map(function(record) {
            return { date:record.observedDate, value:record.displayLabel + " " + extractionValueText(record) };
          })
        }
      );
    }

    scribeExtractionList.innerHTML = records.slice(0, 12).map(function(record){
      return "<div class='scribe-extraction-item'>" +
        "<div class='scribe-extraction-main'>" +
          "<span class='scribe-extraction-label'>" + safeText(record.displayLabel) + "</span>" +
          "<strong>" + safeText(extractionValueText(record)) + "</strong>" +
          "<small>Applied to synthetic Patient State · ambient-scribe provenance</small>" +
        "</div>" +
        "<div class='scribe-extraction-source'>“" + safeText(record.sourceText) + "”</div>" +
      "</div>";
    }).join("");
  }


  function conservativeTranscriptReview(raw) {
    var text = normalizeClinicalTranscript(raw);
    if (!text) return "";

    text = text
      .replace(/\b(?:um+|uh+|erm+|hmm+)\b/gi, " ")
      .replace(/\b(?:you know|I mean|sort of|kind of)\b/gi, " ")
      .replace(/\b(\w+)(?:\s+\1\b)+/gi, "$1")
      .replace(/\s+([,.;:?])/g, "$1")
      .replace(/([,.;:?])(?=[A-Za-z0-9])/g, "$1 ")
      .replace(/\s{2,}/g, " ")
      .trim();

    text = text
      .replace(/\be\s*gfr\b/gi, "eGFR")
      .replace(/\bu\s*a\s*c\s*r\b/gi, "UACR")
      .replace(/\bu\s*p\s*c\s*r\b/gi, "UPCR")
      .replace(/\bhco\s*3\b/gi, "HCO3");

    var sentences = text
      .split(/(?<=[.!?])\s+/)
      .map(function (sentence) { return sentence.trim(); })
      .filter(Boolean)
      .map(function (sentence) {
        if (!sentence) return sentence;
        var first = sentence.charAt(0).toUpperCase() + sentence.slice(1);
        return /[.!?]$/.test(first) ? first : first + ".";
      });

    return sentences.join(" ");
  }

  function reviewAmbientTranscript() {
    if (!ambientReviewedInput) return "";
    var reviewed = conservativeTranscriptReview(ambientInput.value);
    ambientReviewedInput.value = reviewed;
    if (ambientReviewStatus) {
      ambientReviewStatus.textContent = reviewed
        ? "reviewed locally · fillers/repetition/punctuation normalized · facts unchanged"
        : "nothing to review";
    }
    return reviewed;
  }

  function setRuntimeStatus(text, tone) {
    if (!voiceRuntimeStatus) return;
    voiceRuntimeStatus.textContent = text;
    voiceRuntimeStatus.classList.remove("ok", "warn", "error", "live");
    if (tone) voiceRuntimeStatus.classList.add(tone);
  }

  function focusVoiceMode(mode) {
    var card = mode === "dictation" ? dictationCaptureCard : ambientCaptureCard;
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "start" });
      card.classList.add("voice-focus-pulse");
      window.setTimeout(function () {
        card.classList.remove("voice-focus-pulse");
      }, 1100);
    }
  }

  function requestMicrophonePermission() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.resolve({ ok: false, reason: "Microphone permission API unavailable in this browser." });
    }
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      stream.getTracks().forEach(function (track) { track.stop(); });
      return { ok: true };
    }).catch(function (error) {
      return {
        ok: false,
        reason: error && error.name ? "Microphone access failed: " + error.name : "Microphone access denied."
      };
    });
  }

  var SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  var activeRecognition = null;
  var activeVoiceMode = null;
  var finalTextByMode = { ambient: "", dictation: "" };

  function voiceConfig(mode) {
    if (mode === "dictation") {
      return {
        input: dictationInput,
        status: dictationStatus,
        button: startDictationBtn,
        activeText: "Stop dictation",
        idleText: "Start dictation mic"
      };
    }
    return {
      input: ambientInput,
      status: ambientStatus,
      button: startAmbientDemoBtn,
      activeText: "Stop ambient mic",
      idleText: "Start ambient mic"
    };
  }

  function setVoiceStatus(mode, text, active) {
    var cfg = voiceConfig(mode);
    cfg.status.textContent = text;
    cfg.status.classList.toggle("active", Boolean(active));
    cfg.button.textContent = active ? cfg.activeText : cfg.idleText;
    cfg.button.classList.toggle("recording", Boolean(active));
  }

  function appendTranscriptText(mode, finalText, interimText) {
    var cfg = voiceConfig(mode);
    var base = finalTextByMode[mode] || "";
    var combined = [base, finalText, interimText].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    cfg.input.value = combined;
  }

  function stopVoiceCapture() {
    if (activeRecognition) {
      try { activeRecognition.stop(); } catch (_) {}
    }
  }

  function startVoiceCapture(mode) {
    if (!SpeechRecognitionCtor) {
      setVoiceStatus(mode, "unsupported", false);
      setRuntimeStatus("Speech recognition is not supported in this browser. Try current Chrome or Edge desktop.", "error");
      return;
    }

    if (activeRecognition) {
      if (activeVoiceMode === mode) {
        stopVoiceCapture();
        return;
      }
      stopVoiceCapture();
    }

    setRuntimeStatus("Requesting microphone permission…", "warn");

    requestMicrophonePermission().then(function (permission) {
      if (!permission.ok) {
        setVoiceStatus(mode, "permission denied", false);
        setRuntimeStatus(permission.reason, "error");
        return;
      }

      var cfg = voiceConfig(mode);
      finalTextByMode[mode] = cfg.input.value.trim();
      var recognition = new SpeechRecognitionCtor();
      activeRecognition = recognition;
      activeVoiceMode = mode;

      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || "en-US";

      recognition.onstart = function () {
        setVoiceStatus(mode, "listening", true);
        setRuntimeStatus((mode === "dictation" ? "Dictation" : "Ambient") + " microphone is live. Speak now.", "live");
        cfg.input.focus();
      };

      recognition.onspeechstart = function () {
        setRuntimeStatus("Speech detected. Transcribing…", "live");
      };

      recognition.onresult = function (event) {
        var finalChunk = "";
        var interimChunk = "";
        for (var i = event.resultIndex; i < event.results.length; i += 1) {
          var transcript = event.results[i][0] ? event.results[i][0].transcript : "";
          if (event.results[i].isFinal) finalChunk += transcript + " ";
          else interimChunk += transcript + " ";
        }

        if (finalChunk.trim()) {
          finalTextByMode[mode] = [finalTextByMode[mode], finalChunk.trim()]
            .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
          if (mode === "ambient") {
            parseAmbientStructuredData(finalTextByMode.ambient, reviewAmbientTranscript());
          }
        }
        appendTranscriptText(mode, "", interimChunk.trim());
        if (mode === "ambient") reviewAmbientTranscript();
        setRuntimeStatus("Receiving transcript…", "ok");
      };

      recognition.onerror = function (event) {
        var label = event && event.error ? event.error : "microphone error";
        setVoiceStatus(mode, label, false);
        setRuntimeStatus("Speech recognition error: " + label, "error");
      };

      recognition.onend = function () {
        if (activeRecognition === recognition) {
          activeRecognition = null;
          activeVoiceMode = null;
        }
        setVoiceStatus(mode, "stopped", false);
        setRuntimeStatus("Voice capture stopped. Review and save the transcript.", "ok");
      };

      try {
        recognition.start();
      } catch (_) {
        setVoiceStatus(mode, "unable to start", false);
        setRuntimeStatus("Unable to start speech recognition in this browser session.", "error");
        activeRecognition = null;
        activeVoiceMode = null;
      }
    });
  }

  if (SpeechRecognitionCtor) {
    if (ambientMicSupport) ambientMicSupport.textContent = "browser speech recognition available";
    setRuntimeStatus("Voice transcription supported. Choose Ambient or Dictation.", "ok");
  } else {
    if (ambientMicSupport) ambientMicSupport.textContent = "speech recognition unavailable in this browser";
    setRuntimeStatus("Speech recognition unavailable in this browser. Try current Chrome or Edge desktop.", "error");
    startAmbientDemoBtn.disabled = true;
    if (startDictationBtn) startDictationBtn.disabled = true;
  }

  if (ambientModeBtn) {
    ambientModeBtn.addEventListener("click", function () {
      focusVoiceMode("ambient");
      startVoiceCapture("ambient");
    });
  }

  if (dictationModeBtn) {
    dictationModeBtn.addEventListener("click", function () {
      focusVoiceMode("dictation");
      startVoiceCapture("dictation");
    });
  }

  startAmbientDemoBtn.addEventListener("click", function () {
    startVoiceCapture("ambient");
  });

  if (reviewAmbientBtn) {
    reviewAmbientBtn.addEventListener("click", function () {
      reviewAmbientTranscript();
    });
  }

  startDictationBtn.addEventListener("click", function () {
    startVoiceCapture("dictation");
  });

  addAmbientSourceBtn.addEventListener("click", function () {
    var rawTranscript = ambientInput.value.trim();
    var reviewedTranscript = ambientReviewedInput && ambientReviewedInput.value.trim()
      ? ambientReviewedInput.value.trim()
      : reviewAmbientTranscript();
    parseAmbientStructuredData(rawTranscript, reviewedTranscript);

    if (reviewedTranscript && addTextSource(
      "ambient-transcript",
      "Ambient transcript · reviewed",
      reviewedTranscript,
      "Pre-chart workspace · reviewed from raw browser ambient transcript · synthetic test"
    )) {
      var patientId = activePatientId();
      if (patientId) {
        var state = getState(patientId);
        var latest = state.sources[state.sources.length - 1];
        if (latest && latest.kind === "ambient-transcript") {
          latest.rawText = rawTranscript;
          latest.reviewMethod = "conservative-local-review";
        }
      }
      ambientInput.value = "";
      if (ambientReviewedInput) ambientReviewedInput.value = "";
      finalTextByMode.ambient = "";
      setVoiceStatus("ambient", "saved", false);
      if (ambientReviewStatus) ambientReviewStatus.textContent = "saved reviewed transcript";
    }
  });

  addDictationSourceBtn.addEventListener("click", function () {
    if (addTextSource(
      "physician-dictation",
      "Physician dictation",
      dictationInput.value,
      "Pre-chart workspace · live browser physician dictation · synthetic test"
    )) {
      dictationInput.value = "";
      finalTextByMode.dictation = "";
      setVoiceStatus("dictation", "saved", false);
    }
  });

  clearDictationBtn.addEventListener("click", function () {
    dictationInput.value = "";
    finalTextByMode.dictation = "";
    setVoiceStatus("dictation", "idle", false);
  });

  addTypedSourceBtn.addEventListener("click", function () {
    var kind = typedSourceType.value;
    var label = typedSourceType.options[typedSourceType.selectedIndex].text;
    if (addTextSource(
      kind,
      label,
      typedInput.value,
      "Pre-chart workspace · physician entered/pasted text"
    )) {
      typedInput.value = "";
    }
  });

  fileInput.addEventListener("change", function () {
    addFiles(fileInput.files);
  });

  ["dragenter", "dragover"].forEach(function (type) {
    dropzone.addEventListener(type, function (event) {
      event.preventDefault();
      dropzone.classList.add("drag-active");
    });
  });

  ["dragleave", "drop"].forEach(function (type) {
    dropzone.addEventListener(type, function (event) {
      event.preventDefault();
      dropzone.classList.remove("drag-active");
    });
  });

  dropzone.addEventListener("drop", function (event) {
    addFiles(event.dataTransfer && event.dataTransfer.files);
  });

  [attachmentList, sourceLedger].forEach(function (container) {
    container.addEventListener("click", function (event) {
      var remove = event.target.closest(".prechart-remove-source");
      if (remove) {
        removeSource(remove.dataset.sourceId);
        return;
      }

      var openFile = event.target.closest(".prechart-open-file");
      if (openFile) {
        var url = fileUrlStore.get(openFile.dataset.sourceId);
        if (url) window.open(url, "_blank", "noopener,noreferrer");
      }
    });
  });

  organizeBtn.addEventListener("click", organize);

  noteEditor.addEventListener("input", function () {
    var patientId = activePatientId();
    if (patientId) getState(patientId).note = noteEditor.value;
  });

  copyBtn.addEventListener("click", function () {
    var text = noteEditor.value || "";
    if (!text) return;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        copyBtn.textContent = "Copied";
        window.setTimeout(function () { copyBtn.textContent = "Copy"; }, 1200);
      }).catch(function () {});
    }
  });

  window.PRECHART_WORKSPACE_API = {
    open: openWorkspace,
    refresh: renderWorkspace,
    hydrateEncounterDraft: function (patientId, draft) {
      if (!draft || !Array.isArray(draft.sources)) return false;
      var state = getState(patientId);
      // Opening a fresh workspace generates a note from lab trends. Replace that
      // generated note with the saved encounter, but preserve actual local edits.
      var patient = activePatient();
      var generatedNote = patient && patient.id === patientId ? buildOrganizedNote(patient, state) : null;
      if (state.sources.some(function (s) { return s.kind !== "lab-trend"; }) ||
          (state.note.trim() && state.note !== generatedNote)) return false;
      state.note = String(draft.note_text || "");
      state.sources = draft.sources.map(function (source) {
        return {
          id:newId("saved"), kind:source.kind, title:source.title, text:source.text || "",
          rawText:source.rawText || "", file:source.file ? Object.assign({label:"FILE"},source.file) : null,
          status:source.kind === "attachment" ? "attached" : "ready",
          provenance:"Saved synthetic encounter", createdAt:new Date().toISOString()
        };
      });
      if (activePatientId() === patientId) renderWorkspace();
      return true;
    },
    getPatientState: function (patientId) {
      var state = patientStore.get(patientId);
      return state ? JSON.parse(JSON.stringify({
        sources: state.sources.map(function (source) {
          return {
            id: source.id,
            kind: source.kind,
            title: source.title,
            text: source.text,
            rawText: source.rawText || null,
            reviewMethod: source.reviewMethod || null,
            status: source.status,
            provenance: source.provenance,
            createdAt: source.createdAt,
            file: source.file ? {
              name: source.file.name,
              size: source.file.size,
              type: source.file.type,
              label: source.file.label
            } : null
          };
        }),
        note: state.note,
        createdAt: state.createdAt
      })) : null;
    }
  };
})();
