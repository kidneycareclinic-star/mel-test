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
    return new Date().toISOString().slice(0, 10);
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

  function setLatestHistoryPoint(history, value, date) {
    if (!Array.isArray(history)) return;
    if (!history.length) {
      history.push({ date:date, value:value });
      return;
    }
    var last = history[history.length - 1];
    if (typeof last === "object" && last !== null) {
      last.date = date;
      last.value = value;
    } else {
      history[history.length - 1] = value;
    }
  }

  function applyLabExtraction(patient, labName, value, record) {
    if (!patient.labs || !patient.labs[labName]) return;
    patient.labs[labName].value = value;
    patient.labs[labName].flag = labFlag(patient.labs[labName], value);

    if (patient.labHistory && patient.labHistory[labName]) {
      setLatestHistoryPoint(patient.labHistory[labName].values, value, record.observedDate);
      patient.labHistory[labName].currentFlag = patient.labs[labName].flag;
    }

    if (!patient.longitudinal) return;

    if (labName === "eGFR" && patient.longitudinal.kidney) {
      patient.longitudinal.kidney.currentEgfr = value;
      setLatestHistoryPoint(patient.longitudinal.kidney.trajectory, value, record.observedDate);
      if (patient.combinedCkdProgression) {
        patient.combinedCkdProgression.gCategory = gfrCategory(value);
        patient.combinedCkdProgression.cgaLabel =
          patient.combinedCkdProgression.gCategory + (patient.combinedCkdProgression.aCategory || "");
      }
    }

    if (labName === "UPCR" && patient.longitudinal.proteinuria) {
      patient.longitudinal.proteinuria.current = value;
      setLatestHistoryPoint(patient.longitudinal.proteinuria.trajectory, value, record.observedDate);
    }

    if (labName === "UACR" && patient.longitudinal.proteinuria) {
      var a = albuminuriaCategory(value);
      patient.longitudinal.proteinuria.currentUacr = value;
      patient.longitudinal.proteinuria.albuminuriaCategory = a.code;
      setLatestHistoryPoint(patient.longitudinal.proteinuria.uacrTrajectory, value, record.observedDate);

      if (patient.albuminuriaProgression) {
        patient.albuminuriaProgression.current = value;
        patient.albuminuriaProgression.category = a.code;
        patient.albuminuriaProgression.categoryLabel = a.label;
        setLatestHistoryPoint(patient.albuminuriaProgression.history, value, record.observedDate);
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
      if (Array.isArray(patient.longitudinal.bpVolume.history)) {
        var bpPoint = patient.longitudinal.bpVolume.history[patient.longitudinal.bpVolume.history.length - 1];
        if (bpPoint) {
          bpPoint.date = record.observedDate;
          bpPoint.systolic = value.systolic;
          bpPoint.diastolic = value.diastolic;
          bpPoint.source = "ambient scribe extraction";
        }
      }
      if (patient.kidneyProtectionTimeline && Array.isArray(patient.kidneyProtectionTimeline.bpHistory)) {
        var ktPoint = patient.kidneyProtectionTimeline.bpHistory[patient.kidneyProtectionTimeline.bpHistory.length - 1];
        if (ktPoint) {
          ktPoint.date = record.observedDate;
          ktPoint.systolic = value.systolic;
          ktPoint.diastolic = value.diastolic;
          ktPoint.source = "ambient scribe extraction";
        }
      }
    }
  }

  function recordExtraction(patient, field, displayLabel, value, unit, sourceText, type) {
    ensureScribeStores(patient);
    var observedAt = new Date().toISOString();
    var record = {
      id:newId("scribe"),
      field:field,
      displayLabel:displayLabel,
      value:value,
      unit:unit || "",
      sourceText:sourceText,
      observedAt:observedAt,
      observedDate:observedAt.slice(0, 10),
      source:"ambient-scribe-extraction",
      sourceLabel:"Ambient scribe · extracted from spoken transcript",
      confidence:"pattern-match-demo",
      status:"applied-synthetic",
      type:type
    };
    patient.scribeObservations[field] = record;
    patient.scribeExtractionLog.unshift(record);
    patient.scribeExtractionLog = patient.scribeExtractionLog.slice(0, 40);

    if (type === "lab") applyLabExtraction(patient, field, Number(value), record);
    if (type === "vital") applyVitalExtraction(patient, field, value, record);
    return record;
  }

  function firstMatch(text, regex) {
    var match = regex.exec(text);
    return match || null;
  }

  function parseAmbientStructuredData(text) {
    var patient = activePatient();
    if (!patient || !text || !text.trim()) return [];

    var normalized = text.replace(/,/g, "").replace(/\s+/g, " ").trim();
    var extracted = [];

    function addLab(field, label, regex, unit) {
      var m = firstMatch(normalized, regex);
      if (!m) return;
      var value = Number(m[1]);
      if (!Number.isFinite(value)) return;
      extracted.push(recordExtraction(patient, field, label, value, unit, m[0], "lab"));
    }

    function addVital(field, label, regex, unit, transform) {
      var m = firstMatch(normalized, regex);
      if (!m) return;
      var value = transform ? transform(m) : Number(m[1]);
      if (value == null || (typeof value === "number" && !Number.isFinite(value))) return;
      extracted.push(recordExtraction(patient, field, label, value, unit, m[0], "vital"));
    }

    addVital(
      "bloodPressure", "Blood pressure",
      /(?:blood\s+pressure|\bbp\b)\s*(?:(?:is|was|of|today(?:\s+is)?)\s*)?(\d{2,3})\s*(?:over|\/)\s*(\d{2,3})/i,
      "mm Hg",
      function(m){ return { systolic:Number(m[1]), diastolic:Number(m[2]) }; }
    );
    addVital("heartRate", "Heart rate", /(?:heart\s+rate|pulse)\s*(?:(?:is|was|of)\s*)?(\d{2,3})/i, "bpm");
    addVital("weight", "Weight", /(?:weight|weighs)\s*(?:(?:is|was|of)\s*)?(\d+(?:\.\d+)?)\s*(pounds?|lbs?|kg|kilograms?)?/i, "reported", function(m){
      return { amount:Number(m[1]), reportedUnit:(m[2] || "").toLowerCase() || "unspecified" };
    });
    addVital("temperature", "Temperature", /(?:temperature|temp)\s*(?:(?:is|was|of)\s*)?(\d{2,3}(?:\.\d+)?)/i, "reported");
    addVital("oxygenSaturation", "Oxygen saturation", /(?:oxygen\s+saturation|o2\s*sat(?:uration)?|spo2)\s*(?:(?:is|was|of)\s*)?(\d{2,3})(?:\s*percent|\s*%)?/i, "%");

    addLab("eGFR", "eGFR", /(?:\be\s*[- ]?gfr\b|estimated\s+(?:glomerular\s+filtration\s+rate|gfr)|\bgfr\b)\s*(?:(?:is|was|of|equals?)\s*)?(\d+(?:\.\d+)?)/i, "mL/min/1.73m²");
    addLab("UACR", "UACR", /(?:\buacr\b|urine\s+albumin(?:\s*[-/]?to)?\s+creatinine\s+ratio|albumin\s+creatinine\s+ratio)\s*(?:(?:is|was|of|equals?)\s*)?(\d+(?:\.\d+)?)/i, "mg/g");
    addLab("UPCR", "UPCR", /(?:\bupcr\b|urine\s+protein(?:\s*[-/]?to)?\s+creatinine\s+ratio|protein\s+creatinine\s+ratio)\s*(?:(?:is|was|of|equals?)\s*)?(\d+(?:\.\d+)?)/i, "g/g");
    addLab("Potassium", "Potassium", /\bpotassium\b\s*(?:(?:is|was|of|equals?)\s*)?(\d+(?:\.\d+)?)/i, "mEq/L");
    addLab("Phosphate", "Phosphate", /\b(?:phosphorus|phosphate)\b\s*(?:(?:is|was|of|equals?)\s*)?(\d+(?:\.\d+)?)/i, "mg/dL");
    addLab("Bicarbonate", "Bicarbonate", /\b(?:bicarbonate|hco3)\b\s*(?:(?:is|was|of|equals?)\s*)?(\d+(?:\.\d+)?)/i, "mEq/L");
    addLab("Hemoglobin", "Hemoglobin", /\b(?:hemoglobin|haemoglobin)\b\s*(?:(?:is|was|of|equals?)\s*)?(\d+(?:\.\d+)?)/i, "g/dL");
    addLab("Creatinine", "Creatinine", /\bcreatinine\b\s*(?:(?:is|was|of|equals?)\s*)?(\d+(?:\.\d+)?)/i, "mg/dL");

    if (extracted.length) {
      renderScribeExtractions(patient);
      if (typeof renderPatient === "function") renderPatient(patient, false);
      if (window.PRECHART_WORKSPACE_API && PRECHART_WORKSPACE_API.refresh) {
        window.setTimeout(function(){ PRECHART_WORKSPACE_API.refresh(); }, 0);
      }
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
          if (mode === "ambient") parseAmbientStructuredData(finalChunk.trim());
        }
        appendTranscriptText(mode, "", interimChunk.trim());
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

  startDictationBtn.addEventListener("click", function () {
    startVoiceCapture("dictation");
  });

  addAmbientSourceBtn.addEventListener("click", function () {
    parseAmbientStructuredData(ambientInput.value);
    if (addTextSource(
      "ambient-transcript",
      "Ambient transcript",
      ambientInput.value,
      "Pre-chart workspace · live browser ambient transcription · synthetic test"
    )) {
      ambientInput.value = "";
      finalTextByMode.ambient = "";
      setVoiceStatus("ambient", "saved", false);
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
    getPatientState: function (patientId) {
      var state = patientStore.get(patientId);
      return state ? JSON.parse(JSON.stringify({
        sources: state.sources.map(function (source) {
          return {
            id: source.id,
            kind: source.kind,
            title: source.title,
            text: source.text,
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