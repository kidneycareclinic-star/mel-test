/* =========================================================================
 * Nephrology Agentic Harness — longitudinal lab trend / pre-charting UI
 * Keeps trend interaction isolated from core patient-state and agent logic.
 * ========================================================================= */

(function () {
  var expandedLabName = null;
  var labViewMode = "prose";
  var prechartByPatient = new Map();
  var centerPaneWidth = null;

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

    if (labViewMode === "table") return labTrendTable(history, lab.unit);
    if (labViewMode === "graph") return labTrendGraph(history, lab.unit);

    return "<div class='lab-trend-prose'>" +
      labTrendSummary(name, history, lab.unit) + "</div>";
  }

  function upsertPrechartLab(patient, name) {
    if (!patient || !name) return;

    var history = patient.labHistory && patient.labHistory[name];
    var lab = patient.labs && patient.labs[name];
    if (!history || !lab) return;

    var entries = prechartByPatient.get(patient.id) || new Map();
    entries.set(name, {
      name: name,
      current: lab.value,
      unit: lab.unit,
      ref: lab.ref,
      summary: labTrendSummary(name, history, lab.unit),
      history: history.values.map(function (x) {
        return { date: x.date, value: x.value };
      })
    });
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

  if (currentPatient) {
    enhancedRenderSourceData(currentPatient);
    renderPrechartNote(currentPatient);
  }
})();