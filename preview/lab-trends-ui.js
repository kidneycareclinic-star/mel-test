/* =========================================================================
 * Nephrology Agentic Harness — longitudinal lab trend / pre-charting UI
 * Keeps trend interaction isolated from core patient-state and agent logic.
 * ========================================================================= */

(function () {
  var expandedLabName = null;
  var labViewMode = "prose";
  var prechartByPatient = new Map();
  var centerPaneWidth = null;

  var progressionDetailByPatient = new Map();

  function getProgressionDetail(patient) {
    return progressionDetailByPatient.get(patient.id) || "concise";
  }

  function setProgressionDetail(patient, mode) {
    progressionDetailByPatient.set(patient.id, mode);
  }

  function progressionClass(patient) {
    return patient && patient.eGFRProgression ? patient.eGFRProgression : null;
  }

  function progressionLabelClass(category) {
    if (category === "very rapid progression") return "progression-very-rapid";
    if (category === "rapid progression") return "progression-rapid";
    if (category === "slow progression") return "progression-slow";
    return "progression-stable";
  }

  function progressionInterpretationText(patient, detailMode) {
    var p = progressionClass(patient);
    if (!p) return "Progression interpretation unavailable.";

    var slopeText = p.verifiedAnnualSlope.toFixed(1) + " mL/min/1.73 m²/year";
    var categoryText = p.category;

    if (detailMode === "concise") {
      return "eGFR trajectory: " + categoryText + " (verified synthetic slope " + slopeText + ").";
    }

    var parts = [
      "The verified synthetic eGFR slope is " + slopeText + ", categorized as " + categoryText + " under the configured office CKD progression profile.",
      "This classification is a practice taxonomy rather than a universal KDIGO category set.",
      "Interpretation should be confirmed against longitudinal context, including acute kidney injury, medication-related hemodynamic dips, intercurrent illness, and adequacy of serial measurements."
    ];

    if (p.adpkdRapidSignal) {
      parts.push("Because this synthetic patient has polycystic kidney disease, the ADPKD-specific rapid-progression threshold is lower than the general CKD rapid-progression threshold.");
    }

    if (detailMode === "references") {
      parts.push("Evidence anchors: KDIGO 2024 flags a >20% subsequent eGFR change as exceeding expected variability and warranting evaluation; older KDIGO guidance used >5 mL/min/1.73 m²/year as rapid progression; NICE defines accelerated progression as a sustained decline of ≥15 mL/min/1.73 m²/year or ≥25% decline with GFR-category change within 12 months; KDIGO 2025 ADPKD accepts confirmed historical decline ≥3 mL/min/1.73 m²/year as a rapid-progression signal in ADPKD.");
    }

    return parts.join(" ");
  }

  function progressionReferenceBlock(patient) {
    var p = progressionClass(patient);
    if (!p) return "";

    var adpkd = p.adpkdRapidSignal
      ? "<li>KDIGO 2025 ADPKD: confirmed historical eGFR decline ≥3 mL/min/1.73 m²/year can indicate rapid ADPKD progression.</li>"
      : "";

    return "<div class='egfr-reference-block'>" +
      "<strong>Evidence anchors</strong>" +
      "<ul>" +
        "<li>KDIGO 2024 CKD: >20% subsequent eGFR change exceeds expected variability and warrants evaluation.</li>" +
        "<li>KDIGO 2012 CKD: rapid progression historically defined as sustained decline >5 mL/min/1.73 m²/year.</li>" +
        "<li>NICE NG203: accelerated progression includes sustained decline ≥15 mL/min/1.73 m²/year or ≥25% decline plus GFR-category change within 12 months.</li>" +
        adpkd +
      "</ul>" +
      "<div class='micro'>Prototype evidence summary; not a substitute for clinician review of the underlying guideline and patient context.</div>" +
    "</div>";
  }

  function progressionSummaryPanel(patient) {
    var p = progressionClass(patient);
    if (!p) return "";

    var mode = getProgressionDetail(patient);
    var refs = mode === "references" ? progressionReferenceBlock(patient) : "";

    return "<div class='egfr-progression-panel'>" +
      "<div class='egfr-progression-head'>" +
        "<div>" +
          "<span class='eyebrow'>eGFR PROGRESSION INTERPRETATION</span>" +
          "<strong class='egfr-progression-label " + progressionLabelClass(p.category) + "'>" + p.category + "</strong>" +
        "</div>" +
        "<div class='egfr-slope-box'>" +
          "<span>Verified slope</span>" +
          "<strong>" + p.verifiedAnnualSlope.toFixed(1) + "</strong>" +
          "<small>mL/min/1.73 m²/year</small>" +
        "</div>" +
      "</div>" +
      "<div class='egfr-detail-toggle' role='group' aria-label='Interpretation detail'>" +
        "<button type='button' data-progression-detail='concise' class='" + (mode === "concise" ? "active" : "") + "'>Concise</button>" +
        "<button type='button' data-progression-detail='elaborated' class='" + (mode === "elaborated" ? "active" : "") + "'>Elaborated</button>" +
        "<button type='button' data-progression-detail='references' class='" + (mode === "references" ? "active" : "") + "'>Elaborated + references</button>" +
      "</div>" +
      "<div class='egfr-progression-text'>" + progressionInterpretationText(patient, mode) + "</div>" +
      "<div class='egfr-profile-note'>Profile: " + p.profileLabel + " · " + p.calculationStatus + "</div>" +
      refs +
    "</div>";
  }


  function albuminuriaInterpretation(patient, detailMode) {
    var a = patient && patient.albuminuriaProgression;
    if (!a) return "Albuminuria trajectory unavailable.";

    var base = "UACR " + a.current + " mg/g (" + a.category + ", " + a.categoryLabel + "); trajectory " + a.trajectorySignal + ".";
    if (detailMode === "concise") {
      return base + (a.doublingConfirmed ? " Synthetic doubling signal present." : "");
    }

    var text = base + " UACR is interpreted as a longitudinal kidney-damage signal alongside eGFR rather than as a substitute for kidney-function assessment.";
    if (a.doublingConfirmed) {
      text += " The synthetic trajectory includes a doubling signal, which exceeds expected laboratory variability under KDIGO 2024 and warrants evaluation in real clinical use.";
    } else {
      text += " No doubling signal is present in this synthetic trajectory.";
    }
    if (detailMode === "references") {
      text += " Evidence anchors: KDIGO classifies albuminuria as A1 <30 mg/g, A2 30–299 mg/g, and A3 ≥300 mg/g; KDIGO 2024 states that doubling of ACR on a subsequent test exceeds laboratory variability and warrants evaluation.";
    }
    return text;
  }

  function combinedProgressionInterpretation(patient, detailMode) {
    var c = patient && patient.combinedCkdProgression;
    var e = patient && patient.eGFRProgression;
    var a = patient && patient.albuminuriaProgression;
    if (!c || !e || !a) return "Combined CKD progression interpretation unavailable.";

    var text = "Combined kidney progression signal: " + c.signal +
      ". Current CGA position " + c.cgaLabel + " (" + c.cgaRisk + " KDIGO risk category), with eGFR slope " +
      e.verifiedAnnualSlope.toFixed(1) + " mL/min/1.73 m²/year and UACR " +
      a.current + " mg/g (" + a.category + ").";

    if (detailMode !== "concise") {
      text += " This is a descriptive concordance model, not a validated patient-level risk score. " +
        "It is intended to surface whether kidney function and albuminuria are worsening together or whether one marker is leading the other.";
      if (c.albuminuriaEarlySignal) {
        text += " In this synthetic case, albuminuria is the earlier worsening signal while the eGFR progression category has not reached the configured rapid threshold.";
      }
    }

    if (detailMode === "references") {
      text += " Evidence anchors: KDIGO CGA staging combines GFR and albuminuria; a doubling of ACR exceeds expected laboratory variability; observational data show combined worsening of UACR and eGFR is more strongly associated with advanced CKD than either change alone; trial meta-analysis supports combined UACR change plus GFR slope as complementary surrogate information.";
    }

    return text;
  }

  function combinedProgressionPanel(patient) {
    var c = patient && patient.combinedCkdProgression;
    var e = patient && patient.eGFRProgression;
    var a = patient && patient.albuminuriaProgression;
    if (!c || !e || !a) return "";

    var mode = getProgressionDetail(patient);
    var className = c.signal === "concordant worsening"
      ? "combined-worsening"
      : c.signal.indexOf("progression signal") >= 0
      ? "combined-discordant"
      : "combined-stable";

    return "<div class='combined-progression-panel " + className + "'>" +
      "<div class='combined-progression-head'>" +
        "<div>" +
          "<span class='eyebrow'>eGFR + ALBUMINURIA</span>" +
          "<strong>" + c.signal + "</strong>" +
          "<span class='combined-cga'>CGA " + c.cgaLabel + " · " + c.cgaRisk + " risk</span>" +
        "</div>" +
        "<div class='combined-metrics'>" +
          "<span><b>eGFR slope</b>" + e.verifiedAnnualSlope.toFixed(1) + "/yr</span>" +
          "<span><b>UACR</b>" + a.current + " mg/g · " + a.category + "</span>" +
        "</div>" +
      "</div>" +
      "<div class='egfr-detail-toggle'>" +
        "<button type='button' data-progression-detail='concise' class='" + (mode === "concise" ? "active" : "") + "'>Concise</button>" +
        "<button type='button' data-progression-detail='elaborated' class='" + (mode === "elaborated" ? "active" : "") + "'>Elaborated</button>" +
        "<button type='button' data-progression-detail='references' class='" + (mode === "references" ? "active" : "") + "'>Elaborated + references</button>" +
      "</div>" +
      "<div class='egfr-progression-text'>" + combinedProgressionInterpretation(patient, mode) + "</div>" +
      "<div class='egfr-profile-note'>" + c.interpretationStatus + "</div>" +
    "</div>";
  }

  function combinedEgfrUacrGraph(patient) {
    var egfrHistory = patient.labHistory && patient.labHistory.eGFR;
    var uacrHistory = patient.labHistory && patient.labHistory.UACR;
    if (!egfrHistory || !uacrHistory || egfrHistory.values.length < 2 || uacrHistory.values.length < 2) {
      return "<div class='lab-trend-empty'>Not enough paired eGFR/UACR history to graph.</div>";
    }

    var width = 620, height = 240, padX = 54, padY = 34;
    var innerW = width - padX * 2, innerH = height - padY * 2;
    var egfrVals = egfrHistory.values.map(function(p){ return Number(p.value); });
    var uacrVals = uacrHistory.values.map(function(p){ return Number(p.value); });
    var egfrMin = Math.min.apply(null, egfrVals), egfrMax = Math.max.apply(null, egfrVals);
    var uacrMin = Math.min.apply(null, uacrVals), uacrMax = Math.max.apply(null, uacrVals);
    var egfrSpread = Math.max(1, egfrMax - egfrMin);
    var uacrSpread = Math.max(1, uacrMax - uacrMin);

    function points(history, min, spread) {
      return history.values.map(function(p, i) {
        return {
          date:p.date,
          value:Number(p.value),
          x:padX + (innerW * i / Math.max(1, history.values.length - 1)),
          y:padY + innerH - ((Number(p.value) - min) / spread) * innerH
        };
      });
    }

    function path(pts) {
      return pts.map(function(p,i){ return (i ? "L " : "M ") + p.x.toFixed(1) + " " + p.y.toFixed(1); }).join(" ");
    }

    var ePts = points(egfrHistory, egfrMin, egfrSpread);
    var aPts = points(uacrHistory, uacrMin, uacrSpread);
    var marks = ePts.map(function(p,i) {
      var a = aPts[i];
      var egfrLabel = p.date + " · eGFR " + p.value + " mL/min/1.73 m²";
      var uacrLabel = a.date + " · UACR " + a.value + " mg/g";

      return "<g class='combined-hover-point combined-hover-egfr' tabindex='0' aria-label='" + egfrLabel + "'>" +
          "<circle cx='" + p.x + "' cy='" + p.y + "' r='11' class='combined-point-hit'></circle>" +
          "<circle cx='" + p.x + "' cy='" + p.y + "' r='4.5' class='combined-egfr-point'></circle>" +
          "<title>" + egfrLabel + "</title>" +
        "</g>" +
        "<g class='combined-hover-point combined-hover-uacr' tabindex='0' aria-label='" + uacrLabel + "'>" +
          "<circle cx='" + a.x + "' cy='" + a.y + "' r='11' class='combined-point-hit'></circle>" +
          "<circle cx='" + a.x + "' cy='" + a.y + "' r='4.5' class='combined-uacr-point'></circle>" +
          "<title>" + uacrLabel + "</title>" +
        "</g>" +
        "<text x='" + p.x + "' y='" + (height - 8) + "' text-anchor='middle' class='graph-label'>" + p.date.slice(5) + "</text>";
    }).join("");

    return "<div class='combined-graph-wrap'>" +
      "<div class='combined-graph-legend'><span class='legend-egfr'>eGFR</span><span class='legend-uacr'>UACR</span></div>" +
      "<svg class='combined-graph' viewBox='0 0 " + width + " " + height + "' role='img' aria-label='Combined eGFR and UACR trajectory'>" +
        "<line x1='" + padX + "' y1='" + (height-padY) + "' x2='" + (width-padX) + "' y2='" + (height-padY) + "' class='graph-axis'></line>" +
        "<line x1='" + padX + "' y1='" + padY + "' x2='" + padX + "' y2='" + (height-padY) + "' class='graph-axis'></line>" +
        "<line x1='" + (width-padX) + "' y1='" + padY + "' x2='" + (width-padX) + "' y2='" + (height-padY) + "' class='graph-axis'></line>" +
        "<path d='" + path(ePts) + "' class='combined-egfr-line'></path>" +
        "<path d='" + path(aPts) + "' class='combined-uacr-line'></path>" +
        marks +
        "<text x='8' y='18' class='graph-label'>eGFR</text>" +
        "<text x='" + (width-40) + "' y='18' class='graph-label'>UACR</text>" +
        "<text x='8' y='" + (padY+4) + "' class='graph-value'>" + egfrMax + "</text>" +
        "<text x='8' y='" + (height-padY) + "' class='graph-value'>" + egfrMin + "</text>" +
        "<text x='" + (width-47) + "' y='" + (padY+4) + "' class='graph-value'>" + uacrMax + "</text>" +
        "<text x='" + (width-47) + "' y='" + (height-padY) + "' class='graph-value'>" + uacrMin + "</text>" +
      "</svg>" +
      "<div class='micro'>Dual-axis display: eGFR (left) and UACR mg/g (right). Hover or focus any dot to see the exact date and value. Synthetic trajectories shown on a shared time axis; vertical positions use separate scales.</div>" +
    "</div>";
  }

  function combinedProgressionEntry(patient) {
    var mode = getProgressionDetail(patient);
    var c = patient.combinedCkdProgression;
    var a = patient.albuminuriaProgression;
    var e = patient.eGFRProgression;
    if (!c || !a || !e) return null;

    return {
      name: "CKD progression · eGFR + UACR",
      current: c.cgaLabel,
      unit: c.cgaRisk + " risk",
      ref: null,
      summary: combinedProgressionInterpretation(patient, mode),
      progression: {
        category: c.signal,
        verifiedAnnualSlope: e.verifiedAnnualSlope,
        uacr: a.current,
        albuminuriaCategory: a.category,
        detailMode: mode
      },
      history: a.history.map(function(point, i) {
        var ePoint = patient.labHistory.eGFR.values[i];
        return { date:point.date, value:"eGFR " + ePoint.value + " / UACR " + point.value };
      })
    };
  }

  function labTone(patient, name, lab) {
    var history = patient.labHistory && patient.labHistory[name];
    if (lab.flag === "high") return "tone-red";
    if (lab.flag === "low") return "tone-blue";

    if (history && Array.isArray(history.values) && Array.isArray(lab.ref)) {
      var lo = Number(lab.ref[0]);
      var hi = Number(lab.ref[1]);
      var priorOutside = history.values.slice(0, -1).some(function (point) {
        return point.value < lo || point.value > hi;
      });
      if (priorOutside) return "tone-yellow";
    }

    return "tone-green";
  }

  function labTrendSummary(name, history, unit) {
    if (!history || !history.values || !history.values.length) {
      return "No longitudinal history available.";
    }

    var first = history.values[0];
    var last = history.values[history.values.length - 1];
    var direction = "similar to the earliest displayed value";

    if (last.value > first.value) direction = "higher than the earliest displayed value";
    if (last.value < first.value) direction = "lower than the earliest displayed value";

    return name + " is " + last.value + " " + unit +
      ". Across the displayed synthetic history from " + first.date +
      " to " + last.date + ", the current value is " + direction + ".";
  }

  function labTrendTable(history, unit) {
    if (!history || !history.values) return "";

    var rows = history.values.map(function (point) {
      return "<tr><td>" + point.date + "</td><td>" + point.value +
        "</td><td>" + unit + "</td></tr>";
    }).join("");

    return "<div class='lab-trend-table-wrap'>" +
      "<table class='lab-trend-table'>" +
      "<thead><tr><th>Date</th><th>Value</th><th>Unit</th></tr></thead>" +
      "<tbody>" + rows + "</tbody></table></div>";
  }

  function labTrendGraph(history, unit) {
    if (!history || !history.values || history.values.length < 2) {
      return "<div class='lab-trend-empty'>Not enough data to graph.</div>";
    }

    var vals = history.values.map(function (p) { return Number(p.value); });
    var min = Math.min.apply(null, vals);
    var max = Math.max.apply(null, vals);
    var spread = Math.max(1, max - min);
    var width = 520;
    var height = 190;
    var padX = 42;
    var padY = 28;
    var innerW = width - padX * 2;
    var innerH = height - padY * 2;

    var points = history.values.map(function (p, i) {
      return {
        date: p.date,
        value: p.value,
        x: padX + (innerW * i / Math.max(1, history.values.length - 1)),
        y: padY + innerH - ((Number(p.value) - min) / spread) * innerH
      };
    });

    var path = points.map(function (p, i) {
      return (i ? "L " : "M ") + p.x.toFixed(1) + " " + p.y.toFixed(1);
    }).join(" ");

    var marks = points.map(function (p) {
      return "<circle cx='" + p.x + "' cy='" + p.y + "' r='4' class='graph-point'></circle>" +
        "<text x='" + p.x + "' y='" + (height - 8) + "' text-anchor='middle' class='graph-label'>" +
        p.date.slice(5) + "</text>" +
        "<text x='" + p.x + "' y='" + (p.y - 8) + "' text-anchor='middle' class='graph-value'>" +
        p.value + "</text>";
    }).join("");

    return "<div class='lab-graph-wrap'>" +
      "<svg class='lab-graph' viewBox='0 0 " + width + " " + height + "' role='img' aria-label='Historical lab trend'>" +
      "<line x1='" + padX + "' y1='" + (height - padY) + "' x2='" + (width - padX) +
      "' y2='" + (height - padY) + "' class='graph-axis'></line>" +
      "<line x1='" + padX + "' y1='" + padY + "' x2='" + padX +
      "' y2='" + (height - padY) + "' class='graph-axis'></line>" +
      "<path d='" + path + "' class='graph-line'></path>" + marks + "</svg>" +
      "<div class='micro'>Synthetic longitudinal values · " + unit + "</div></div>";
  }

  function renderLabTrendContent(name, patient) {
    var history = patient.labHistory && patient.labHistory[name];
    var lab = patient.labs && patient.labs[name];

    if (!history || !lab) {
      return "<div class='lab-trend-empty'>No historical values available.</div>";
    }

    var progression = name === "eGFR"
      ? progressionSummaryPanel(patient) + combinedProgressionPanel(patient)
      : name === "UACR"
      ? combinedProgressionPanel(patient)
      : "";

    if (labViewMode === "table") {
      return progression + labTrendTable(history, lab.unit);
    }
    if (labViewMode === "graph") {
      if (name === "eGFR" || name === "UACR") {
        return combinedProgressionPanel(patient) + combinedEgfrUacrGraph(patient);
      }
      return labTrendGraph(history, lab.unit);
    }

    var prose = name === "UACR"
      ? "<div class='lab-trend-prose'>" + albuminuriaInterpretation(patient, getProgressionDetail(patient)) + "</div>"
      : "<div class='lab-trend-prose'>" + labTrendSummary(name, history, lab.unit) + "</div>";

    return progression + prose;
  }

  function upsertPrechartLab(patient, name) {
    if (!patient || !name) return;

    var history = patient.labHistory && patient.labHistory[name];
    var lab = patient.labs && patient.labs[name];
    if (!history || !lab) return;

    var entries = prechartByPatient.get(patient.id) || new Map();
    var progression = name === "eGFR" && patient.eGFRProgression
      ? {
          category: patient.eGFRProgression.category,
          verifiedAnnualSlope: patient.eGFRProgression.verifiedAnnualSlope,
          profileLabel: patient.eGFRProgression.profileLabel,
          detailMode: getProgressionDetail(patient),
          interpretation: progressionInterpretationText(patient, getProgressionDetail(patient))
        }
      : null;

    entries.set(name, {
      name: name,
      current: lab.value,
      unit: lab.unit,
      ref: lab.ref,
      summary: progression
        ? progression.interpretation
        : name === "UACR"
        ? albuminuriaInterpretation(patient, getProgressionDetail(patient))
        : labTrendSummary(name, history, lab.unit),
      progression: progression,
      history: history.values.map(function (x) {
        return { date: x.date, value: x.value };
      })
    });
    prechartByPatient.set(patient.id, entries);
    renderPrechartNote(patient);
  }


  function upsertCombinedProgression(patient) {
    if (!patient) return;
    var entry = combinedProgressionEntry(patient);
    if (!entry) return;

    var entries = prechartByPatient.get(patient.id) || new Map();
    entries.set("CKD progression · eGFR + UACR", entry);
    prechartByPatient.set(patient.id, entries);
    renderPrechartNote(patient);
  }

  function renderPrechartNote(patient) {
    var box = document.querySelector("#prechartNote");
    if (!box) return;

    var entries = prechartByPatient.get(patient && patient.id);
    if (!entries || entries.size === 0) {
      box.innerHTML = "<div class='prechart-empty'>Open a lab tile to add its longitudinal trend to the pre-charting note.</div>";
      return;
    }

    box.innerHTML = Array.from(entries.values()).map(function (entry) {
      var historyText = entry.history.map(function (p) {
        return p.date + ": " + p.value;
      }).join(" · ");

      return "<div class='prechart-entry'>" +
        "<div class='prechart-entry-head'><strong>" + entry.name + "</strong>" +
        "<span>" + entry.current + " " + entry.unit + "</span></div>" +
        "<div class='prechart-entry-body'>" + entry.summary + "</div>" +
        "<div class='prechart-history'>" + historyText + "</div></div>";
    }).join("");
  }

  function openLabTrend(name, patient) {
    expandedLabName = expandedLabName === name ? null : name;
    if (expandedLabName) {
      labViewMode = "prose";
      upsertPrechartLab(patient, name);
    }
    enhancedRenderSourceData(patient);
  }

  function enhancedRenderSourceData(patient) {
    var grid = document.querySelector("#labsGrid");
    if (!grid || !patient) return;
    grid.innerHTML = "";

    LAB_META.forEach(function (meta) {
      var name = meta[0];
      var unit = meta[1];
      var lab = patient.labs[name];
      if (!lab) return;

      var cell = document.createElement("div");
      var tone = labTone(patient, name, lab);
      var expanded = expandedLabName === name;
      var prov = PROV_PATHS[name];

      cell.className = "lab-cell " + tone + (expanded ? " expanded" : "");

      cell.innerHTML =
        "<div class='lab-card-head'>" +
          "<div>" +
            "<div class='l-name'>" + name + "</div>" +
            "<div class='l-val'>" + lab.value + " <span class='l-unit'>" + unit + "</span></div>" +
            "<div class='l-ref'>ref " + lab.ref[0] + "–" + lab.ref[1] + "</div>" +
          "</div>" +
          "<div class='lab-card-actions'>" +
            (prov ? "<button type='button' class='lab-source-btn'>Source</button>" : "") +
            "<button type='button' class='lab-expand-btn'>" + (expanded ? "×" : "Trend") + "</button>" +
          "</div>" +
        "</div>" +
        (expanded
          ? "<div class='lab-trend-detail'>" +
              "<div class='lab-view-tabs' role='tablist' aria-label='Lab trend view'>" +
                "<button type='button' data-lab-view='prose' class='" + (labViewMode === "prose" ? "active" : "") + "'>Prose</button>" +
                "<button type='button' data-lab-view='table' class='" + (labViewMode === "table" ? "active" : "") + "'>Table</button>" +
                "<button type='button' data-lab-view='graph' class='" + (labViewMode === "graph" ? "active" : "") + "'>Graph</button>" +
              "</div>" +
              "<div class='lab-trend-content'>" + renderLabTrendContent(name, patient) + "</div>" +
              "<div class='lab-prechart-status'>Added to pre-charting note</div>" +
            "</div>"
          : "");

      cell.addEventListener("click", function (event) {
        if (event.target.closest("button")) return;
        openLabTrend(name, patient);
      });

      var expandBtn = cell.querySelector(".lab-expand-btn");
      if (expandBtn) {
        expandBtn.addEventListener("click", function (event) {
          event.stopPropagation();
          openLabTrend(name, patient);
        });
      }

      var sourceBtn = cell.querySelector(".lab-source-btn");
      if (sourceBtn && prov && currentState) {
        sourceBtn.addEventListener("click", function (event) {
          event.stopPropagation();
          showProvenance(name, prov[0], prov[1](currentState));
        });
      }

      cell.querySelectorAll("[data-lab-view]").forEach(function (btn) {
        btn.addEventListener("click", function (event) {
          event.stopPropagation();
          labViewMode = btn.dataset.labView;
          enhancedRenderSourceData(patient);
        });
      });

      cell.querySelectorAll("[data-progression-detail]").forEach(function (btn) {
        btn.addEventListener("click", function (event) {
          event.stopPropagation();
          setProgressionDetail(patient, btn.dataset.progressionDetail);
          upsertPrechartLab(patient, "eGFR");
          upsertPrechartLab(patient, "UACR");
          upsertCombinedProgression(patient);
          enhancedRenderSourceData(patient);
        });
      });

      grid.appendChild(cell);
    });

    var meds = document.querySelector("#medsList");
    meds.innerHTML = "";
    patient.meds.forEach(function (name) {
      var el = document.createElement("span");
      el.className = "med-pill" + (name === "Ibuprofen" ? " warn" : "");
      el.textContent = name;
      el.title = MEDS[name] ? MEDS[name].dose + " — " + MEDS[name].renal : "";
      meds.appendChild(el);
    });
  }

  var baseRenderPatient = renderPatient;
  renderPatient = function (patient, resetChat) {
    if (!currentPatient || currentPatient.id !== patient.id) {
      expandedLabName = null;
      labViewMode = "prose";
    }
    baseRenderPatient(patient, resetChat);
    if (patient && patient.labs && patient.labs.eGFR) {
      upsertPrechartLab(patient, "eGFR");
    }
    if (patient && patient.labs && patient.labs.UACR) {
      upsertPrechartLab(patient, "UACR");
    }
    upsertCombinedProgression(patient);
    renderPrechartNote(patient);
  };

  renderSourceData = enhancedRenderSourceData;

  var clearButton = document.querySelector("#clearPrechartBtn");
  if (clearButton) {
    clearButton.addEventListener("click", function () {
      if (!currentPatient) return;
      prechartByPatient.delete(currentPatient.id);
      renderPrechartNote(currentPatient);
    });
  }

  function applyCenterPaneWidth(width) {
    var layout = document.querySelector("#mainLayout");
    if (!layout) return;

    var available = Math.max(420, window.innerWidth - 700);
    var clamped = Math.max(420, Math.min(width, available));
    centerPaneWidth = clamped;
    layout.style.setProperty("--center-pane-width", clamped + "px");
  }

  var handle = document.querySelector("#centerResizeHandle");
  if (handle) {
    var dragging = false;

    handle.addEventListener("mousedown", function (event) {
      if (window.innerWidth <= 1100) return;
      dragging = true;
      document.body.classList.add("resizing-center");
      event.preventDefault();
    });

    document.addEventListener("mousemove", function (event) {
      if (!dragging) return;
      var target = event.clientX - 316;
      applyCenterPaneWidth(target);
    });

    document.addEventListener("mouseup", function () {
      dragging = false;
      document.body.classList.remove("resizing-center");
    });

    window.addEventListener("resize", function () {
      if (centerPaneWidth && window.innerWidth > 1100) {
        applyCenterPaneWidth(centerPaneWidth);
      }
    });
  }

  window.PRECHART_LABS_API = {
    getEntries: function (patientId) {
      var entries = prechartByPatient.get(patientId);
      return entries ? Array.from(entries.values()).map(function (entry) {
        return JSON.parse(JSON.stringify(entry));
      }) : [];
    },
    clearEntries: function (patientId) {
      prechartByPatient.delete(patientId);
      if (currentPatient && currentPatient.id === patientId) renderPrechartNote(currentPatient);
    },
    renderInline: function (patient) {
      renderPrechartNote(patient);
    }
  };

  if (currentPatient) {
    enhancedRenderSourceData(currentPatient);
    renderPrechartNote(currentPatient);
  }
})();