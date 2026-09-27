/* =========================================================================
 * CKD progression-modifying therapy timeline UI
 * Synthetic demo only. Reports listed therapy and timing; does not prescribe.
 * ========================================================================= */
(function () {
  var openPatientId = null;
  var viewModeByPatient = new Map();

  function getMode(patient) {
    return viewModeByPatient.get(patient.id) || "concise";
  }

  function setMode(patient, mode) {
    viewModeByPatient.set(patient.id, mode);
  }

  function therapies(patient) {
    return patient && patient.kidneyProtectionTimeline
      ? patient.kidneyProtectionTimeline.therapies || []
      : [];
  }

  function bpHistory(patient) {
    return patient && patient.kidneyProtectionTimeline
      ? patient.kidneyProtectionTimeline.bpHistory || []
      : [];
  }

  function listedText(therapy) {
    if (!therapy) return "not listed";
    if (!therapy.active) return "not listed";
    return therapy.medication + (therapy.startedAt ? " · started " + therapy.startedAt : "");
  }

  function eligibilityContext(patient) {
    var t = patient.kidneyProtectionTimeline;
    if (!t) return "";
    var c = t.evidenceContext || {};
    var parts = [];

    parts.push("This synthetic assessment reports current listed therapy and start timing; it does not infer that every absent class is indicated.");
    parts.push("RAS inhibition is interpreted in the context of CKD, albuminuria, blood pressure, potassium, and tolerance.");
    parts.push("SGLT2 inhibitor eligibility depends on CKD phenotype, eGFR, comorbidities, and contraindications.");
    parts.push("Nonsteroidal MRA use is especially context-dependent on type 2 diabetes, persistent albuminuria, eGFR, potassium, and background RAS inhibition.");
    parts.push("GLP-1 receptor agonist use is particularly relevant in type 2 diabetes/CKD and cardiorenal-metabolic risk contexts.");
    parts.push("Current synthetic context: eGFR " + c.eGFR + ", UACR " + c.uacr + " mg/g (" + c.albuminuriaCategory + "), K " + c.potassium + ", T2D " + (c.hasT2D ? "present" : "not established") + ".");

    return parts.join(" ");
  }

  function conciseAssessment(patient) {
    var tx = therapies(patient);
    var active = tx.filter(function (x) { return x.active; });
    var absent = tx.filter(function (x) { return !x.active; });
    var latestBp = bpHistory(patient).slice(-1)[0];

    return "CKD progression-modifying therapy: " +
      active.map(function (x) { return x.label + " active"; }).join("; ") +
      (absent.length ? "; " + absent.map(function (x) { return x.label + " not listed"; }).join("; ") : "") +
      (latestBp ? ". Latest BP " + latestBp.systolic + "/" + latestBp.diastolic + " mm Hg." : ".");
  }

  function detailedAssessment(patient) {
    var tx = therapies(patient);
    var timeline = tx.map(function (x) {
      return x.label + ": " + listedText(x) + (x.subtype ? " (" + x.subtype + ")" : "");
    }).join(". ");
    var bp = bpHistory(patient).map(function (x) {
      return x.date + " " + x.systolic + "/" + x.diastolic;
    }).join("; ");

    return conciseAssessment(patient) + " " +
      "Therapy timeline — " + timeline + ". BP trajectory — " + bp + ". " +
      eligibilityContext(patient);
  }

  function assessment(patient, mode) {
    return mode === "detailed" ? detailedAssessment(patient) : conciseAssessment(patient);
  }

  function prechartEntry(patient) {
    var mode = getMode(patient);
    var tx = therapies(patient);
    return {
      name: "CKD progression-modifying therapy",
      current: tx.filter(function (x) { return x.active; }).length + "/4",
      unit: "classes listed",
      ref: null,
      summary: assessment(patient, mode === "graph" ? "detailed" : mode),
      progression: {
        detailMode: mode,
        therapies: tx.map(function (x) {
          return {
            key:x.key,
            label:x.label,
            medication:x.medication,
            active:x.active,
            startedAt:x.startedAt,
            subtype:x.subtype || null
          };
        })
      },
      history: bpHistory(patient).map(function (x) {
        return { date:x.date, value:"BP " + x.systolic + "/" + x.diastolic };
      })
    };
  }

  function pushPrechart(patient) {
    if (!window.PRECHART_LABS_API || !patient) return;
    PRECHART_LABS_API.upsertExternalEntry(
      patient.id,
      "CKD progression-modifying therapy",
      prechartEntry(patient)
    );
  }

  function therapyTimelineGraph(patient) {
    var bp = bpHistory(patient);
    var tx = therapies(patient);
    if (!bp.length) return "<div class='protection-empty'>No BP history available.</div>";

    var width = 760, height = 330;
    var left = 64, right = 28, top = 28, bpBottom = 188;
    var laneTop = 224, laneGap = 23;
    var innerW = width - left - right;

    var allDates = bp.map(function (x) { return new Date(x.date).getTime(); });
    tx.forEach(function (x) {
      if (x.startedAt) allDates.push(new Date(x.startedAt).getTime());
    });
    var minT = Math.min.apply(null, allDates);
    var maxT = Math.max.apply(null, allDates);
    var tSpread = Math.max(1, maxT - minT);

    function xFor(date) {
      return left + ((new Date(date).getTime() - minT) / tSpread) * innerW;
    }

    var allSys = bp.map(function (x) { return x.systolic; });
    var minSys = Math.min.apply(null, allSys) - 8;
    var maxSys = Math.max.apply(null, allSys) + 8;
    var sysSpread = Math.max(1, maxSys - minSys);
    function yFor(sys) {
      return top + (bpBottom - top) - ((sys - minSys) / sysSpread) * (bpBottom - top);
    }

    var bpPts = bp.map(function (p) {
      return { x:xFor(p.date), y:yFor(p.systolic), date:p.date, systolic:p.systolic, diastolic:p.diastolic };
    });
    var bpPath = bpPts.map(function (p,i) {
      return (i ? "L " : "M ") + p.x.toFixed(1) + " " + p.y.toFixed(1);
    }).join(" ");

    var bpMarks = bpPts.map(function (p) {
      var label = p.date + " · BP " + p.systolic + "/" + p.diastolic + " mm Hg";
      return "<g class='protection-hover-point' tabindex='0' aria-label='" + label + "'>" +
        "<circle cx='" + p.x + "' cy='" + p.y + "' r='12' class='protection-hit'></circle>" +
        "<circle cx='" + p.x + "' cy='" + p.y + "' r='5' class='protection-bp-point'></circle>" +
        "<title>" + label + "</title></g>";
    }).join("");

    var lanes = tx.map(function (therapy, i) {
      var y = laneTop + i * laneGap;
      var status = therapy.active ? "active" : "inactive";
      var start = therapy.startedAt ? xFor(therapy.startedAt) : null;
      var marker = start !== null
        ? "<g class='protection-hover-point' tabindex='0' aria-label='" + therapy.label + " started " + therapy.startedAt + " · " + therapy.medication + "'>" +
            "<circle cx='" + start + "' cy='" + y + "' r='11' class='protection-hit'></circle>" +
            "<circle cx='" + start + "' cy='" + y + "' r='5' class='protection-therapy-point " + status + "'></circle>" +
            "<title>" + therapy.label + " · " + therapy.medication + " · started " + therapy.startedAt + "</title></g>"
        : "<text x='" + (width-right) + "' y='" + (y+3) + "' text-anchor='end' class='protection-not-listed'>not listed</text>";

      return "<text x='8' y='" + (y+3) + "' class='protection-lane-label'>" + therapy.label + "</text>" +
        "<line x1='" + left + "' y1='" + y + "' x2='" + (width-right) + "' y2='" + y + "' class='protection-lane-line'></line>" +
        marker;
    }).join("");

    var dates = bp.map(function (p) {
      var x = xFor(p.date);
      return "<text x='" + x + "' y='" + (height-8) + "' text-anchor='middle' class='graph-label'>" + p.date.slice(5) + "</text>";
    }).join("");

    return "<div class='protection-graph-wrap'>" +
      "<div class='protection-legend'><span class='protection-legend-bp'>Systolic BP</span><span class='protection-legend-therapy'>Therapy start</span></div>" +
      "<svg class='protection-graph' viewBox='0 0 " + width + " " + height + "' role='img' aria-label='CKD therapy starts and blood pressure timeline'>" +
        "<line x1='" + left + "' y1='" + bpBottom + "' x2='" + (width-right) + "' y2='" + bpBottom + "' class='graph-axis'></line>" +
        "<line x1='" + left + "' y1='" + top + "' x2='" + left + "' y2='" + bpBottom + "' class='graph-axis'></line>" +
        "<path d='" + bpPath + "' class='protection-bp-line'></path>" +
        bpMarks +
        "<text x='8' y='" + (top+5) + "' class='graph-value'>" + maxSys + "</text>" +
        "<text x='8' y='" + bpBottom + "' class='graph-value'>" + minSys + "</text>" +
        lanes + dates +
      "</svg>" +
      "<div class='micro'>Hover or focus a BP point for exact systolic/diastolic values; hover a therapy marker for medication and start date. BP line displays systolic BP, with diastolic shown in the tooltip.</div>" +
    "</div>";
  }

  function detailHtml(patient) {
    var mode = getMode(patient);
    var tx = therapies(patient);

    var statusGrid = tx.map(function (therapy) {
      return "<div class='protection-status-card " + (therapy.active ? "active" : "inactive") + "'>" +
        "<span>" + therapy.label + "</span>" +
        "<strong>" + (therapy.active ? therapy.medication : "Not listed") + "</strong>" +
        "<small>" + (therapy.startedAt ? "Started " + therapy.startedAt : therapy.detail) + "</small>" +
      "</div>";
    }).join("");

    var content = mode === "graph"
      ? therapyTimelineGraph(patient)
      : "<div class='protection-prose'>" + assessment(patient, mode) + "</div>";

    return "<div class='protection-expanded'>" +
      "<div class='protection-status-grid'>" + statusGrid + "</div>" +
      "<div class='protection-view-tabs'>" +
        "<button type='button' data-protection-view='concise' class='" + (mode === "concise" ? "active" : "") + "'>Concise</button>" +
        "<button type='button' data-protection-view='detailed' class='" + (mode === "detailed" ? "active" : "") + "'>Detailed</button>" +
        "<button type='button' data-protection-view='graph' class='" + (mode === "graph" ? "active" : "") + "'>Graph</button>" +
      "</div>" +
      content +
      "<div class='protection-evidence-note'>Reports synthetic listed therapy and chronology only. Eligibility and treatment decisions remain physician-controlled.</div>" +
    "</div>";
  }

  function render(patient, state) {
    var card = document.querySelector(".state-special-kidney-protection");
    if (!card || !patient) return;

    card.classList.add("kidney-protection-card");
    card.classList.toggle("expanded", openPatientId === patient.id);

    var old = card.querySelector(".protection-expanded");
    if (old) old.remove();

    if (openPatientId === patient.id) {
      card.insertAdjacentHTML("beforeend", detailHtml(patient));
      card.querySelectorAll("[data-protection-view]").forEach(function (btn) {
        btn.addEventListener("click", function (event) {
          event.stopPropagation();
          setMode(patient, btn.dataset.protectionView);
          pushPrechart(patient);
          render(patient, state);
        });
      });
    }

    pushPrechart(patient);
  }

  function toggle(patient, state) {
    openPatientId = openPatientId === patient.id ? null : patient.id;
    render(patient, state);
  }

  var baseRenderPatient = renderPatient;
  renderPatient = function (patient, resetChat) {
    baseRenderPatient(patient, resetChat);
    window.setTimeout(function () {
      render(patient, currentState);
    }, 0);
  };

  window.CKD_PROTECTION_UI = {
    toggle: toggle,
    render: render,
    assessment: function (patient) {
      return assessment(patient, getMode(patient));
    }
  };

  if (currentPatient) {
    window.setTimeout(function () {
      render(currentPatient, currentState);
    }, 0);
  }
})();