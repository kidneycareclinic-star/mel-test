/* =========================================================================
 * Nephrology Agentic Harness — shared patient-state UI
 * One patient identity + one longitudinal kidney state + care-setting overlays.
 * ========================================================================= */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let currentSetting = "office";
let currentPatient = null;
let currentFindings = [];

const LAB_META = [
  ["eGFR", "mL/min/1.73m²"], ["Creatinine", "mg/dL"], ["Potassium", "mEq/L"],
  ["Hemoglobin", "g/dL"], ["Phosphate", "mg/dL"], ["Calcium", "mg/dL"],
  ["PTH", "pg/mL"], ["Albumin", "g/dL"], ["UPCR", "g/g"],
  ["Sodium", "mEq/L"], ["Bicarbonate", "mEq/L"], ["BUN", "mg/dL"],
];

const SUGGESTIONS = [
  "Summarize this patient",
  "Interpret the labs",
  "What are the next steps?",
  "What is the risk?",
  "Review medications",
  "Any nephrotoxic meds?",
];

const WORKSPACES = {
  office: {
    title: "Office nephrology",
    subtitle: "Longitudinal outpatient kidney care",
    census: "Office census",
    context: "Office encounter context",
    badge: "longitudinal",
  },
  hospital: {
    title: "Hospital nephrology",
    subtitle: "Consults, inpatient kidney events and rounds",
    census: "Hospital census",
    context: "Hospital episode context",
    badge: "inpatient",
  },
  dialysis: {
    title: "Dialysis nephrology",
    subtitle: "Chairside rounds and longitudinal dialysis workflow",
    census: "Dialysis census",
    context: "Dialysis treatment context",
    badge: "rounding",
  },
};

function activeInSetting(p, setting = currentSetting) {
  return Boolean(p.contexts && p.contexts[setting] && p.contexts[setting].active);
}

function settingPatients() {
  return window.PATIENTS.filter((p) => activeInSetting(p));
}

function sevDot(sev) {
  return { critical: "🔴", high: "🟠", medium: "🟡", info: "🔵" }[sev] || "⚪";
}

function renderWorkspace() {
  const w = WORKSPACES[currentSetting];
  $("#workspaceTitle").textContent = w.title;
  $("#workspaceSubtitle").textContent = w.subtitle;
  $("#workspaceMode").textContent = currentSetting;
  $("#censusTitle").textContent = w.census;
  $("#contextTitle").textContent = w.context;
  $("#contextBadge").textContent = w.badge;
  $("#search").placeholder = `Filter ${currentSetting} census…`;
  $$(".workspace-tab").forEach((b) => b.classList.toggle("active", b.dataset.setting === currentSetting));
  renderCensus($("#search").value);

  if (!currentPatient && window.PATIENTS.length) currentPatient = window.PATIENTS[0];
  if (currentPatient) renderPatient(currentPatient, false);
}

function renderCensus(filter = "") {
  const list = $("#patientList");
  const q = filter.toLowerCase();
  const pts = settingPatients();
  list.innerHTML = "";

  pts.filter((p) =>
    !q ||
    p.name.toLowerCase().includes(q) ||
    p.diagnosis.toLowerCase().includes(q) ||
    p.id.toLowerCase().includes(q)
  ).forEach((p) => {
    const li = document.createElement("li");
    li.dataset.id = p.id;
    if (currentPatient && currentPatient.id === p.id) li.classList.add("active");

    const maxSev = AGENT.deriveFindings(p).reduce((m, f) => {
      const rank = { critical: 4, high: 3, medium: 2, info: 1 }[f.sev];
      return rank > m ? rank : m;
    }, 0);

    const flag = maxSev >= 4
      ? '<span class="p-flag" style="background:#2a141b;color:#ff4d6d">critical</span>'
      : maxSev === 3
      ? '<span class="p-flag" style="background:#2a1d13;color:#ffb454">flag</span>'
      : '<span class="p-flag" style="background:#132432;color:#3ddc97">stable</span>';

    li.innerHTML = `
      <div class="p-name">${p.name} <span style="color:var(--muted);font-weight:400">· ${p.age}${p.sex}</span></div>
      <div class="p-sub">${p.diagnosis} · eGFR ${p.labs.eGFR.value}</div>
      ${flag}`;
    li.addEventListener("click", () => selectPatient(p));
    list.appendChild(li);
  });

  $("#patientCount").textContent = `${pts.length} ${currentSetting} patients`;
  $("#censusMeta").textContent = `${pts.length} synthetic patients active in this workspace`;
}

function renderCareFootprint(p) {
  const box = $("#careFootprint");
  const labels = [
    ["office", "Office"],
    ["hospital", "Hospital"],
    ["dialysis", "Dialysis"],
  ];
  box.innerHTML = labels.map(([key, label]) => {
    const active = activeInSetting(p, key);
    const here = key === currentSetting;
    return `<span class="footprint-chip ${active ? "active" : "inactive"} ${here ? "current" : ""}">${label}${active ? " ✓" : ""}</span>`;
  }).join("");
}

function contextCards(p) {
  const c = p.contexts[currentSetting];
  if (!c || !c.active) return [];

  if (currentSetting === "office") {
    return [
      ["Visit type", c.visitType, "accent"],
      ["Blood pressure", c.bp, ""],
      ["Primary focus", c.focus, "warn"],
      ["Open loops", c.openLoops ? `${c.openLoops} pending` : "none pending", c.openLoops ? "warn" : "good"],
    ];
  }

  if (currentSetting === "hospital") {
    return [
      ["Location", c.location, "accent"],
      ["Consult", c.consultType, "warn"],
      ["Hospital day", String(c.hospitalDay), ""],
      ["Pre-round state", c.preRound, c.preRound.includes("Needs") ? "warn" : "good"],
    ];
  }

  return [
    ["Unit", c.unit, "accent"],
    ["Chair", String(c.chair), ""],
    ["Access", c.access, ""],
    ["Round state", c.roundStatus, c.roundStatus.includes("Needs") ? "warn" : "good"],
  ];
}

function contextDetail(p) {
  const c = p.contexts[currentSetting];
  if (!c || !c.active) {
    const label = currentSetting[0].toUpperCase() + currentSetting.slice(1);
    return `
      <div class="empty-context">
        <strong>No active ${label.toLowerCase()} episode for this shared patient.</strong>
        <span>The longitudinal kidney state remains visible because identity and clinical state persist across workspaces.</span>
      </div>`;
  }

  if (currentSetting === "office") {
    return `
      <div class="context-story">
        <span class="story-label">PRE-VISIT BRIEF</span>
        <strong>${c.previsit}</strong>
        <span>Last nephrology visit ${c.lastVisit}. Current office focus: ${c.focus}. The harness carries unresolved tasks forward rather than relying on the note alone.</span>
      </div>`;
  }

  if (currentSetting === "hospital") {
    return `
      <div class="context-story">
        <span class="story-label">INPATIENT EVENT</span>
        <strong>${c.trigger}</strong>
        <span>Hospital day ${c.hospitalDay} · ${c.location} · urine output ${c.urineOutput}. The hospital layer is episode-oriented while the chronic kidney state remains underneath.</span>
      </div>`;
  }

  return `
    <div class="context-story">
      <span class="story-label">TODAY'S DIALYSIS ROUND</span>
      <strong>${c.modality} · chair ${c.chair}</strong>
      <span>Dry weight ${c.dryWeight} · IDWG ${c.idwg} · ${c.access} · ${c.attendance}. Dialysis data are a treatment context attached to the same longitudinal patient record.</span>
    </div>`;
}

function renderContext(p) {
  const grid = $("#contextGrid");
  const detail = $("#contextDetail");
  grid.innerHTML = "";

  const cards = contextCards(p);
  if (!cards.length) {
    grid.classList.add("empty");
  } else {
    grid.classList.remove("empty");
    cards.forEach(([label, value, tone]) => {
      const card = document.createElement("div");
      card.className = "context-card" + (tone ? " " + tone : "");
      card.innerHTML = `<span class="c-label">${label}</span><span class="c-value">${value}</span>`;
      grid.appendChild(card);
    });
  }
  detail.innerHTML = contextDetail(p);
}

function miniTrend(values, tone = "accent") {
  const nums = values.map((v) => Number(v));
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const spread = Math.max(1, max - min);
  return `
    <div class="spark ${tone}">
      ${nums.map((v) => {
        const h = 18 + ((v - min) / spread) * 28;
        return `<span style="height:${h}px" title="${v}"></span>`;
      }).join("")}
    </div>`;
}

function protectionText(s) {
  const parts = [];
  parts.push(s.raas ? "RAAS blockade present" : "No ACEi/ARB listed");
  parts.push(s.sglt2 ? "SGLT2i listed" : "No SGLT2i listed");
  if (s.nsaidExposure) parts.push("NSAID exposure flagged");
  return parts.join(" · ");
}

function renderPatientState(p) {
  const s = p.longitudinal;
  const grid = $("#stateGrid");
  grid.innerHTML = "";

  const cards = [
    {
      title: "Kidney function",
      value: `eGFR ${s.kidney.currentEgfr}`,
      sub: `${s.kidney.trajectoryLabel} · ${p.diagnosis}`,
      tone: s.kidney.trajectoryLabel === "declining" ? "warn" : "accent",
      visual: miniTrend(s.kidney.trajectory.map((x) => x.value), "accent"),
    },
    {
      title: "Proteinuria",
      value: `UPCR ${s.proteinuria.current} g/g`,
      sub: "longitudinal urine protein signal",
      tone: s.proteinuria.current > 3 ? "warn" : "accent",
      visual: miniTrend(s.proteinuria.trajectory, "warn"),
    },
    {
      title: "BP / volume",
      value: s.bpVolume.latestBp,
      sub: `${s.bpVolume.edema} · weight ${s.bpVolume.weightTrend}`,
      tone: s.bpVolume.edema.includes("1+") ? "warn" : "good",
    },
    {
      title: "Electrolytes / acid-base",
      value: `K ${s.electrolytes.potassium} · HCO₃ ${s.electrolytes.bicarbonate}`,
      sub: s.electrolytes.status,
      tone: s.electrolytes.status === "review" ? "warn" : "good",
    },
    {
      title: "Anemia",
      value: `Hb ${s.anemia.hemoglobin} g/dL`,
      sub: s.anemia.status,
      tone: s.anemia.status === "review" ? "warn" : "good",
    },
    {
      title: "CKD-MBD",
      value: `Phos ${s.ckdMbd.phosphate} · PTH ${s.ckdMbd.pth}`,
      sub: s.ckdMbd.status,
      tone: s.ckdMbd.status === "review" ? "warn" : "good",
    },
    {
      title: "Kidney protection",
      value: s.kidneyProtection.raas ? "RAAS active" : "Therapy review",
      sub: protectionText(s.kidneyProtection),
      tone: s.kidneyProtection.nsaidExposure ? "warn" : "accent",
    },
    {
      title: "Open loops",
      value: s.openLoops.length ? `${s.openLoops.length} unresolved` : "None",
      sub: s.openLoops.length ? s.openLoops.map((x) => x.label).join(" · ") : "No tracked unresolved tasks",
      tone: s.openLoops.length ? "warn" : "good",
    },
  ];

  cards.forEach((c) => {
    const el = document.createElement("div");
    el.className = `state-card ${c.tone || ""}`;
    el.innerHTML = `
      <div class="state-title">${c.title}</div>
      <div class="state-value">${c.value}</div>
      <div class="state-sub">${c.sub}</div>
      ${c.visual || ""}`;
    grid.appendChild(el);
  });
}

function renderSourceData(p) {
  const grid = $("#labsGrid");
  grid.innerHTML = "";
  LAB_META.forEach(([name, unit]) => {
    const L = p.labs[name];
    if (!L) return;
    const cell = document.createElement("div");
    cell.className = "lab-cell flag-" + L.flag;
    cell.innerHTML = `
      <div class="l-name">${name}</div>
      <div class="l-val">${L.value} <span class="l-unit">${unit}</span></div>
      <div class="l-ref">ref ${L.ref[0]}–${L.ref[1]}</div>`;
    grid.appendChild(cell);
  });

  const meds = $("#medsList");
  meds.innerHTML = "";
  p.meds.forEach((m) => {
    const el = document.createElement("span");
    el.className = "med-pill" + (m === "Ibuprofen" ? " warn" : "");
    el.textContent = m;
    el.title = MEDS[m] ? `${MEDS[m].dose} — ${MEDS[m].renal}` : "";
    meds.appendChild(el);
  });
}

function renderPatient(p, resetChat = true) {
  currentPatient = p;
  $("#ptName").innerHTML = `${p.name} <span class="dx-tag">${p.diagnosis}${p.ckdStage && !["DM", "HTN"].includes(p.ckdStage) ? " · " + p.ckdStage : ""}</span>`;
  $("#ptMeta").innerHTML = `${p.id} · ${p.age} yo · ${p.sex === "F" ? "Female" : "Male"} · ${p.ethnicity} · master record shared across care settings`;

  renderCareFootprint(p);
  renderContext(p);
  renderPatientState(p);
  renderSourceData(p);

  currentFindings = AGENT.deriveFindings(p);
  renderFindings(currentFindings);
  renderCensus($("#search").value);

  if (resetChat) $("#chat").innerHTML = "";
  $("#agentStatus").textContent = "ready";
}

function selectPatient(p) {
  renderPatient(p, true);
}

function renderFindings(findings) {
  const box = $("#findings");
  box.innerHTML = "";
  findings.forEach((f) => {
    const el = document.createElement("div");
    el.className = "finding " + f.sev;
    el.innerHTML = `<span class="f-title">${sevDot(f.sev)} ${f.title}</span>${f.body}`;
    box.appendChild(el);
  });
}

function addMsg(role, text, tag) {
  const chat = $("#chat");
  const el = document.createElement("div");
  el.className = "msg " + role;
  if (tag) el.innerHTML = `<span class="m-tag">${tag}</span>`;
  el.appendChild(document.createTextNode(text));
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
}

function ask(query) {
  if (!currentPatient) {
    addMsg("agent", "Select a patient from the census first.", "agent");
    return;
  }
  const q = query.trim();
  if (!q) return;

  addMsg("user", q, "you");
  $("#agentStatus").textContent = "thinking…";

  setTimeout(() => {
    const res = AGENT.run(currentPatient, q);
    const contextPrefix = activeInSetting(currentPatient)
      ? `${currentSetting} context active`
      : `${currentSetting} context inactive · answering from shared patient state`;
    addMsg("agent", res.body, `${contextPrefix} · ${res.intent}`);
    $("#agentStatus").textContent = "ready";
  }, 220);
}

$("#askForm").addEventListener("submit", (e) => {
  e.preventDefault();
  ask($("#query").value);
  $("#query").value = "";
});

$("#search").addEventListener("input", (e) => renderCensus(e.target.value));

$$(".workspace-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentSetting = btn.dataset.setting;
    $("#search").value = "";
    renderWorkspace();
  });
});

const sug = $("#suggestions");
SUGGESTIONS.forEach((s) => {
  const b = document.createElement("button");
  b.textContent = s;
  b.addEventListener("click", () => ask(s));
  sug.appendChild(b);
});

if (window.PATIENTS.length) currentPatient = window.PATIENTS[0];
renderWorkspace();
