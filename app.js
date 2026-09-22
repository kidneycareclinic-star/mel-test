/* =========================================================================
 * Nephrology Agentic Harness — UI consuming canonical Patient State Engine
 * ========================================================================= */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let currentSetting = "office";
let currentPatient = null;
let currentState = null;
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

function buildState(patient) {
  return PATIENT_STATE_ENGINE.build(patient);
}

function activeInSetting(patient, setting = currentSetting) {
  const state = buildState(patient);
  return PATIENT_STATE_ENGINE.activeInWorkspace(state, setting);
}

function settingPatients() {
  return window.PATIENTS.filter((p) => activeInSetting(p));
}

function sevDot(sev) {
  return { critical: "🔴", high: "🟠", medium: "🟡", info: "🔵" }[sev] || "⚪";
}

function nodeValue(n, fallback = "—") {
  return n && n.value !== undefined && n.value !== null ? n.value : fallback;
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
  $$(".workspace-tab").forEach((b) =>
    b.classList.toggle("active", b.dataset.setting === currentSetting)
  );

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

function renderCareFootprint(state) {
  const box = $("#careFootprint");
  const labels = [
    ["office", "Office"],
    ["hospital", "Hospital"],
    ["dialysis", "Dialysis"],
  ];

  box.innerHTML = labels.map(([key, label]) => {
    const active = PATIENT_STATE_ENGINE.activeInWorkspace(state, key);
    const here = key === currentSetting;
    return `<span class="footprint-chip ${active ? "active" : "inactive"} ${here ? "current" : ""}">${label}${active ? " ✓" : ""}</span>`;
  }).join("");
}

function contextCards(state) {
  const ep = PATIENT_STATE_ENGINE.workspaceContext(state, currentSetting);
  if (!ep || !ep.active) return [];

  const c = ep.data;

  if (currentSetting === "office") {
    return [
      ["Visit type", c.visitType, "accent"],
      ["Blood pressure", c.bp, ""],
      ["Primary focus", c.focus, "warn"],
      ["Open loops", state.openLoops.length ? `${state.openLoops.length} pending` : "none pending", state.openLoops.length ? "warn" : "good"],
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

function contextDetail(state) {
  const ep = PATIENT_STATE_ENGINE.workspaceContext(state, currentSetting);

  if (!ep || !ep.active) {
    const label = currentSetting[0].toUpperCase() + currentSetting.slice(1);
    return `
      <div class="empty-context">
        <strong>No active ${label.toLowerCase()} episode for this shared patient.</strong>
        <span>The canonical patient state remains visible because identity and longitudinal kidney state persist across workspaces.</span>
      </div>`;
  }

  const c = ep.data;

  if (currentSetting === "office") {
    return `
      <div class="context-story">
        <span class="story-label">PRE-VISIT BRIEF</span>
        <strong>${c.previsit}</strong>
        <span>Last nephrology visit ${c.lastVisit}. Current office focus: ${c.focus}. Open loops are read from the shared patient-state engine rather than reconstructed from this encounter.</span>
      </div>`;
  }

  if (currentSetting === "hospital") {
    return `
      <div class="context-story">
        <span class="story-label">INPATIENT EVENT</span>
        <strong>${c.trigger}</strong>
        <span>Hospital day ${c.hospitalDay} · ${c.location} · urine output ${c.urineOutput}. This episode overlays the same chronic kidney state used in the office workspace.</span>
      </div>`;
  }

  return `
    <div class="context-story">
      <span class="story-label">TODAY'S DIALYSIS ROUND</span>
      <strong>${c.modality} · chair ${c.chair}</strong>
      <span>Dry weight ${c.dryWeight} · IDWG ${c.idwg} · ${c.access} · ${c.attendance}. Dialysis treatment data attach to the shared patient state instead of creating a separate chart.</span>
    </div>`;
}

function renderContext(state) {
  const grid = $("#contextGrid");
  const detail = $("#contextDetail");
  grid.innerHTML = "";

  const cards = contextCards(state);
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
  detail.innerHTML = contextDetail(state);
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

function protectionText(state) {
  const kp = state.kidneyProtection;
  const parts = [];
  parts.push(nodeValue(kp.raas, false) ? "RAAS blockade present" : "No ACEi/ARB listed");
  parts.push(nodeValue(kp.sglt2, false) ? "SGLT2i listed" : "No SGLT2i listed");
  if (nodeValue(kp.nsaidExposure, false)) parts.push("NSAID exposure flagged");
  return parts.join(" · ");
}

function renderPatientState(state) {
  const grid = $("#stateGrid");
  grid.innerHTML = "";

  const egfr = nodeValue(state.kidney.function.currentEgfr);
  const trajectoryLabel = nodeValue(state.kidney.function.trajectoryLabel, "unknown");
  const protein = nodeValue(state.kidney.proteinuria.current);
  const bp = nodeValue(state.bpVolume.latestBp);
  const edema = nodeValue(state.bpVolume.edema);
  const weightTrend = nodeValue(state.bpVolume.weightTrend);
  const k = nodeValue(state.electrolytes.potassium);
  const bicarb = nodeValue(state.electrolytes.bicarbonate);
  const electrolyteStatus = nodeValue(state.electrolytes.status);
  const hb = nodeValue(state.anemia.hemoglobin);
  const anemiaStatus = nodeValue(state.anemia.status);
  const phos = nodeValue(state.ckdMbd.phosphate);
  const pth = nodeValue(state.ckdMbd.pth);
  const mbdStatus = nodeValue(state.ckdMbd.status);

  const cards = [
    {
      title: "Kidney function",
      value: `eGFR ${egfr}`,
      sub: `${trajectoryLabel} · ${nodeValue(state.kidney.diagnosis)}`,
      tone: trajectoryLabel === "declining" ? "warn" : "accent",
      visual: miniTrend(state.kidney.function.trajectory.map((x) => x.value), "accent"),
    },
    {
      title: "Proteinuria",
      value: `UPCR ${protein} g/g`,
      sub: "longitudinal urine protein signal",
      tone: Number(protein) > 3 ? "warn" : "accent",
      visual: miniTrend(state.kidney.proteinuria.trajectory.map((x) => x.value), "warn"),
    },
    {
      title: "BP / volume",
      value: bp,
      sub: `${edema} · weight ${weightTrend}`,
      tone: String(edema).includes("1+") ? "warn" : "good",
    },
    {
      title: "Electrolytes / acid-base",
      value: `K ${k} · HCO₃ ${bicarb}`,
      sub: electrolyteStatus,
      tone: electrolyteStatus === "review" ? "warn" : "good",
    },
    {
      title: "Anemia",
      value: `Hb ${hb} g/dL`,
      sub: anemiaStatus,
      tone: anemiaStatus === "review" ? "warn" : "good",
    },
    {
      title: "CKD-MBD",
      value: `Phos ${phos} · PTH ${pth}`,
      sub: mbdStatus,
      tone: mbdStatus === "review" ? "warn" : "good",
    },
    {
      title: "Kidney protection",
      value: nodeValue(state.kidneyProtection.raas, false) ? "RAAS active" : "Therapy review",
      sub: protectionText(state),
      tone: nodeValue(state.kidneyProtection.nsaidExposure, false) ? "warn" : "accent",
    },
    {
      title: "Open loops",
      value: state.openLoops.length ? `${state.openLoops.length} unresolved` : "None",
      sub: state.openLoops.length ? state.openLoops.map((x) => x.label).join(" · ") : "No tracked unresolved tasks",
      tone: state.openLoops.length ? "warn" : "good",
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

function renderSourceData(patient) {
  const grid = $("#labsGrid");
  grid.innerHTML = "";

  LAB_META.forEach(([name, unit]) => {
    const L = patient.labs[name];
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
  patient.meds.forEach((m) => {
    const el = document.createElement("span");
    el.className = "med-pill" + (m === "Ibuprofen" ? " warn" : "");
    el.textContent = m;
    el.title = MEDS[m] ? `${MEDS[m].dose} — ${MEDS[m].renal}` : "";
    meds.appendChild(el);
  });
}

function renderPatient(patient, resetChat = true) {
  currentPatient = patient;
  currentState = buildState(patient);

  $("#ptName").innerHTML = `${nodeValue(currentState.identity.name)} <span class="dx-tag">${nodeValue(currentState.kidney.diagnosis)}${nodeValue(currentState.kidney.stage) && !["DM", "HTN"].includes(nodeValue(currentState.kidney.stage)) ? " · " + nodeValue(currentState.kidney.stage) : ""}</span>`;

  $("#ptMeta").innerHTML =
    `${nodeValue(currentState.identity.id)} · ${nodeValue(currentState.identity.age)} yo · ${nodeValue(currentState.identity.sex) === "F" ? "Female" : "Male"} · ${nodeValue(currentState.identity.ethnicity)} · state engine v${currentState.engineVersion}`;

  renderCareFootprint(currentState);
  renderContext(currentState);
  renderPatientState(currentState);
  renderSourceData(patient);

  currentFindings = AGENT.deriveFindings(patient);
  renderFindings(currentFindings);
  renderCensus($("#search").value);

  if (resetChat) $("#chat").innerHTML = "";
  $("#agentStatus").textContent = "ready";
}

function selectPatient(patient) {
  renderPatient(patient, true);
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
  if (!currentPatient || !currentState) {
    addMsg("agent", "Select a patient from the census first.", "agent");
    return;
  }

  const q = query.trim();
  if (!q) return;

  addMsg("user", q, "you");
  $("#agentStatus").textContent = "thinking…";

  setTimeout(() => {
    const res = AGENT.run(currentPatient, q);
    const contextPrefix = PATIENT_STATE_ENGINE.activeInWorkspace(currentState, currentSetting)
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
