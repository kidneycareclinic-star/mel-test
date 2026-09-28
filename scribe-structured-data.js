/* =========================================================================
 * Ambient Scribe Structured Data Extractor
 * Synthetic-patient demo: extracts explicitly spoken discrete observations
 * and applies them to the selected synthetic patient with provenance.
 *
 * Production note:
 * Real-patient use should route extracted values through a physician
 * confirmation gate before committing them to the system of record.
 * ========================================================================= */

(function () {
  var FIELD_CONFIG = {
    eGFR: {
      label: "eGFR",
      unit: "mL/min/1.73 m²",
      labKey: "eGFR",
      patterns: [
        /\b(?:e\s*[- ]?\s*g\s*[- ]?\s*f\s*[- ]?\s*r|egfr|estimated\s+gfr|estimated\s+glomerular\s+filtration\s+rate)\b\s*(?:is|was|of|equals|equal\s+to|:)??\s*(-?\d+(?:\.\d+)?)/ig
      ]
    },
    UACR: {
      label: "UACR",
      unit: "mg/g",
      labKey: "UACR",
      patterns: [
        /\b(?:u\s*[- ]?\s*a\s*[- ]?\s*c\s*[- ]?\s*r|uacr|urine\s+albumin(?:\s+to)?\s+creatinine\s+ratio|albumin\s+creatinine\s+ratio)\b\s*(?:is|was|of|equals|equal\s+to|:)??\s*(-?\d+(?:\.\d+)?)/ig
      ]
    },
    UPCR: {
      label: "UPCR",
      unit: "g/g",
      labKey: "UPCR",
      patterns: [
        /\b(?:u\s*[- ]?\s*p\s*[- ]?\s*c\s*[- ]?\s*r|upcr|urine\s+protein(?:\s+to)?\s+creatinine\s+ratio|protein\s+creatinine\s+ratio)\b\s*(?:is|was|of|equals|equal\s+to|:)??\s*(-?\d+(?:\.\d+)?)(?:\s*(?:g\/g|gram(?:s)?\s+per\s+gram))?/ig
      ]
    },
    Potassium: {
      label: "Potassium",
      unit: "mEq/L",
      labKey: "Potassium",
      patterns: [
        /\bpotassium\b\s*(?:is|was|of|equals|equal\s+to|:)??\s*(-?\d+(?:\.\d+)?)/ig,
        /\bk\+?\b\s*(?:is|was|of|equals|equal\s+to|:)\s*(-?\d+(?:\.\d+)?)/ig
      ]
    },
    Phosphate: {
      label: "Phosphorus",
      unit: "mg/dL",
      labKey: "Phosphate",
      patterns: [
        /\b(?:phosphorus|phosphate)\b\s*(?:is|was|of|equals|equal\s+to|:)??\s*(-?\d+(?:\.\d+)?)/ig
      ]
    },
    Bicarbonate: {
      label: "Bicarbonate",
      unit: "mEq/L",
      labKey: "Bicarbonate",
      patterns: [
        /\b(?:bicarbonate|serum\s+bicarbonate)\b\s*(?:is|was|of|equals|equal\s+to|:)??\s*(-?\d+(?:\.\d+)?)/ig
      ]
    },
    Hemoglobin: {
      label: "Hemoglobin",
      unit: "g/dL",
      labKey: "Hemoglobin",
      patterns: [
        /\b(?:hemoglobin|hgb)\b\s*(?:is|was|of|equals|equal\s+to|:)??\s*(-?\d+(?:\.\d+)?)/ig
      ]
    },
    Creatinine: {
      label: "Creatinine",
      unit: "mg/dL",
      labKey: "Creatinine",
      patterns: [
        /\b(?:creatinine|serum\s+creatinine)\b\s*(?:is|was|of|equals|equal\s+to|:)??\s*(-?\d+(?:\.\d+)?)/ig
      ]
    }
  };

  function nowIso() {
    return new Date().toISOString();
  }

  function dateOnly(iso) {
    return String(iso || "").slice(0, 10);
  }

  function ensureStore(patient) {
    if (!patient.scribeStructured) {
      patient.scribeStructured = {
        events: [],
        latestByKey: {},
        vitals: {}
      };
    }
    return patient.scribeStructured;
  }

  function pushLatestHistory(patient, labKey, value, observedAt) {
    patient.labHistory = patient.labHistory || {};
    var lab = patient.labs && patient.labs[labKey];
    var history = patient.labHistory[labKey] || {
      unit: lab ? lab.unit : "",
      ref: lab ? lab.ref : null,
      currentFlag: "unknown",
      values: []
    };
    history.values = Array.isArray(history.values) ? history.values : [];
    var day = dateOnly(observedAt);
    var last = history.values[history.values.length - 1];

    if (last && last.date === day) {
      last.value = value;
      last.source = "ambient-scribe-extracted";
    } else {
      history.values.push({
        date: day,
        value: value,
        source: "ambient-scribe-extracted"
      });
    }
    history.currentFlag = "scribe";
    patient.labHistory[labKey] = history;
  }

  function applyLab(patient, event) {
    patient.labs = patient.labs || {};
    var existing = patient.labs[event.key] || {
      value: event.value,
      unit: event.unit,
      ref: [0, 0],
      flag: "scribe"
    };
    patient.labs[event.key] = {
      value: event.value,
      unit: existing.unit || event.unit,
      ref: existing.ref || [0, 0],
      flag: "scribe",
      scribeExtracted: true,
      observedAt: event.observedAt
    };
    pushLatestHistory(patient, event.key, event.value, event.observedAt);

    patient.longitudinal = patient.longitudinal || {};
    patient.longitudinal.kidney = patient.longitudinal.kidney || {};
    patient.longitudinal.proteinuria = patient.longitudinal.proteinuria || {};
    patient.longitudinal.electrolytes = patient.longitudinal.electrolytes || {};
    patient.longitudinal.anemia = patient.longitudinal.anemia || {};
    patient.longitudinal.ckdMbd = patient.longitudinal.ckdMbd || {};

    if (event.key === "eGFR") {
      patient.longitudinal.kidney.currentEgfr = event.value;
      patient.longitudinal.kidney.trajectory = Array.isArray(patient.longitudinal.kidney.trajectory)
        ? patient.longitudinal.kidney.trajectory
        : [];
      var day = dateOnly(event.observedAt);
      var lastEgfr = patient.longitudinal.kidney.trajectory[patient.longitudinal.kidney.trajectory.length - 1];
      if (lastEgfr && lastEgfr.date === day) lastEgfr.value = event.value;
      else patient.longitudinal.kidney.trajectory.push({ date: day, value: event.value });
      if (patient.eGFRProgression) {
        patient.eGFRProgression.staleAfterScribeUpdate = true;
        patient.eGFRProgression.staleReason = "New ambient-scribe eGFR entered; verified slope requires recalculation.";
      }
      if (patient.combinedCkdProgression) {
        patient.combinedCkdProgression.staleAfterScribeUpdate = true;
      }
    } else if (event.key === "UPCR") {
      patient.longitudinal.proteinuria.current = event.value;
    } else if (event.key === "UACR") {
      patient.longitudinal.proteinuria.currentUacr = event.value;
      if (patient.albuminuriaProgression) {
        patient.albuminuriaProgression.staleAfterScribeUpdate = true;
        patient.albuminuriaProgression.staleReason = "New ambient-scribe UACR entered; trajectory interpretation requires refresh.";
      }
      if (patient.combinedCkdProgression) {
        patient.combinedCkdProgression.staleAfterScribeUpdate = true;
      }
    } else if (event.key === "Potassium") {
      patient.longitudinal.electrolytes.potassium = event.value;
      patient.longitudinal.electrolytes.status = "new scribe value";
    } else if (event.key === "Bicarbonate") {
      patient.longitudinal.electrolytes.bicarbonate = event.value;
      patient.longitudinal.electrolytes.status = "new scribe value";
    } else if (event.key === "Hemoglobin") {
      patient.longitudinal.anemia.hemoglobin = event.value;
      patient.longitudinal.anemia.status = "new scribe value";
    } else if (event.key === "Phosphate") {
      patient.longitudinal.ckdMbd.phosphate = event.value;
      patient.longitudinal.ckdMbd.status = "new scribe value";
    }
  }

  function recordEvent(patient, event) {
    var store = ensureStore(patient);
    store.events.push(event);
    store.latestByKey[event.key] = event;
  }

  function extractNumericFields(text, patient, provenance) {
    var events = [];
    Object.keys(FIELD_CONFIG).forEach(function (key) {
      var cfg = FIELD_CONFIG[key];
      cfg.patterns.forEach(function (pattern) {
        pattern.lastIndex = 0;
        var match;
        while ((match = pattern.exec(text)) !== null) {
          var value = Number(match[1]);
          if (!Number.isFinite(value)) continue;
          events.push({
            id: "scribe-" + key + "-" + Date.now() + "-" + events.length,
            type: "lab",
            key: cfg.labKey,
            label: cfg.label,
            value: value,
            unit: cfg.unit,
            observedAt: nowIso(),
            sourceKind: "ambient-scribe-extracted",
            sourceLabel: provenance || "Ambient scribe · spoken transcript",
            sourceText: match[0],
            status: "auto-applied-synthetic",
            confidence: "deterministic phrase match"
          });
        }
      });
    });
    return events;
  }

  function extractVitals(text) {
    var events = [];
    var observedAt = nowIso();
    var bp = /\b(?:blood\s+pressure|bp)\b\s*(?:is|was|of|equals|equal\s+to|:)??\s*(\d{2,3})\s*(?:\/|over)\s*(\d{2,3})/i.exec(text);
    if (bp) {
      events.push({
        id: "scribe-bp-" + Date.now(),
        type: "vital",
        key: "bloodPressure",
        label: "Blood pressure",
        value: bp[1] + "/" + bp[2],
        systolic: Number(bp[1]),
        diastolic: Number(bp[2]),
        unit: "mm Hg",
        observedAt: observedAt,
        sourceKind: "ambient-scribe-extracted",
        sourceLabel: "Ambient scribe · spoken transcript",
        sourceText: bp[0],
        status: "auto-applied-synthetic",
        confidence: "deterministic phrase match"
      });
    }

    var hr = /\b(?:heart\s+rate|pulse)\b\s*(?:is|was|of|equals|equal\s+to|:)??\s*(\d{2,3})/i.exec(text);
    if (hr) {
      events.push({
        id: "scribe-hr-" + Date.now(),
        type: "vital",
        key: "heartRate",
        label: "Heart rate",
        value: Number(hr[1]),
        unit: "bpm",
        observedAt: observedAt,
        sourceKind: "ambient-scribe-extracted",
        sourceLabel: "Ambient scribe · spoken transcript",
        sourceText: hr[0],
        status: "auto-applied-synthetic",
        confidence: "deterministic phrase match"
      });
    }

    var spo2 = /\b(?:oxygen\s+saturation|o2\s*sat|spo2)\b\s*(?:is|was|of|equals|equal\s+to|:)??\s*(\d{2,3})(?:\s*%)?/i.exec(text);
    if (spo2) {
      events.push({
        id: "scribe-spo2-" + Date.now(),
        type: "vital",
        key: "oxygenSaturation",
        label: "Oxygen saturation",
        value: Number(spo2[1]),
        unit: "%",
        observedAt: observedAt,
        sourceKind: "ambient-scribe-extracted",
        sourceLabel: "Ambient scribe · spoken transcript",
        sourceText: spo2[0],
        status: "auto-applied-synthetic",
        confidence: "deterministic phrase match"
      });
    }

    var temp = /\b(?:temperature|temp)\b\s*(?:is|was|of|equals|equal\s+to|:)??\s*(\d{2,3}(?:\.\d+)?)(?:\s*(?:degrees?)?)?/i.exec(text);
    if (temp) {
      events.push({
        id: "scribe-temp-" + Date.now(),
        type: "vital",
        key: "temperature",
        label: "Temperature",
        value: Number(temp[1]),
        unit: "as spoken",
        observedAt: observedAt,
        sourceKind: "ambient-scribe-extracted",
        sourceLabel: "Ambient scribe · spoken transcript",
        sourceText: temp[0],
        status: "auto-applied-synthetic",
        confidence: "deterministic phrase match"
      });
    }

    var weight = /\b(?:weight|weighs?)\b\s*(?:is|was|of|equals|equal\s+to|:)??\s*(\d{2,3}(?:\.\d+)?)\s*(kg|kilograms?|lb|lbs|pounds?)?/i.exec(text);
    if (weight) {
      events.push({
        id: "scribe-weight-" + Date.now(),
        type: "vital",
        key: "weight",
        label: "Weight",
        value: Number(weight[1]),
        unit: weight[2] || "unit not stated",
        observedAt: observedAt,
        sourceKind: "ambient-scribe-extracted",
        sourceLabel: "Ambient scribe · spoken transcript",
        sourceText: weight[0],
        status: "auto-applied-synthetic",
        confidence: "deterministic phrase match"
      });
    }
    return events;
  }

  function applyVital(patient, event) {
    var store = ensureStore(patient);
    store.vitals[event.key] = event;

    patient.longitudinal = patient.longitudinal || {};
    patient.longitudinal.bpVolume = patient.longitudinal.bpVolume || {};

    if (event.key === "bloodPressure") {
      patient.longitudinal.bpVolume.latestBp = event.value;
      patient.longitudinal.bpVolume.history = Array.isArray(patient.longitudinal.bpVolume.history)
        ? patient.longitudinal.bpVolume.history
        : [];
      var day = dateOnly(event.observedAt);
      var history = patient.longitudinal.bpVolume.history;
      var last = history[history.length - 1];
      var point = {
        date: day,
        systolic: event.systolic,
        diastolic: event.diastolic,
        source: "ambient-scribe-extracted"
      };
      if (last && last.date === day) history[history.length - 1] = point;
      else history.push(point);
    }
  }

  function dedupe(events) {
    var seen = {};
    return events.filter(function (event) {
      var key = event.type + "|" + event.key + "|" + event.value;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function extract(text, patient, options) {
    if (!patient || !text || !String(text).trim()) return [];
    var provenance = options && options.provenance
      ? options.provenance
      : "Ambient scribe · spoken transcript";

    var events = dedupe(
      extractNumericFields(String(text), patient, provenance)
        .concat(extractVitals(String(text)))
    );

    events.forEach(function (event) {
      event.sourceLabel = provenance;
      recordEvent(patient, event);
      if (event.type === "lab") applyLab(patient, event);
      else applyVital(patient, event);
    });

    return events;
  }

  function latest(patient) {
    var store = patient && patient.scribeStructured;
    if (!store) return [];
    return Object.keys(store.latestByKey || {}).map(function (key) {
      return store.latestByKey[key];
    }).concat(Object.keys(store.vitals || {}).map(function (key) {
      return store.vitals[key];
    }));
  }

  window.SCRIBE_STRUCTURED_DATA = {
    extractAndApply: extract,
    latest: latest
  };
})();