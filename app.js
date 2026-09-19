/* =========================================================================
 * nephrology_ehr — harness UI glue
 * ========================================================================= */
const $ = (sel) => document.querySelector(sel);

let currentPatient = null;
let currentFindings = [];

const LAB_META = [
  ["eGFR", "mL/min/1.73m²"],
  ["Creatinine", "mg/dL"],
  ["Potassium", "mEq/L"],
  ["Hemoglobin", "g/dL"],
  ["Phosphate", "mg/dL"],
  ["Calcium", "mg/dL"],
  ["PTH", "pg/mL"],
  ["Albumin", "g/dL"],
  ["UPCR", "g/g"],
  ["Sodium", "mEq/L"],
  ["Bicarbonate", "mEq/L"],
  ["BUN", "mg/dL"],
];

const SUGGESTIONS = [
  "Summarize this patient",
  "Interpret the labs",
  "What are the next steps?",
  "What is the risk?",
  "Review medications",
  "Any nephrotoxic meds?",
];

function sevDot(sev) {
  return { critical: "🔴", high: "🟠", medium: "🟡", info: "🔵" }[sev] || "⚪";
}

/* ---- render census ---- */
function renderCensus(filter = "") {
  const list = $("#patientList");
  const q = filter.toLowerCase();
  list.innerHTML = "";
  window.PATIENTS.filter((p) =>
    !q || p.name.toLowerCase().includes(q) || p.diagnosis.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
  ).forEach((p) => {
    const li = document.createElement("li");
    li.dataset.id = p.id;
    if (currentPatient && currentPatient.id === p.id) li.classList.add("active");

    const maxSev = AGENT.deriveFindings(p).reduce((m, f) => {
      const rank = { critical: 4, high: 3, medium: 2, info: 1 }[f.sev];
      return rank > m ? rank : m;
    }, 0);
    const flag = maxSev >= 4 ? '<span class="p-flag" style="background:#2a141b;color:#ff4d6d">critical</span>'
      : maxSev === 3 ? '<span class="p-flag" style="background:#2a1d13;color:#ffb454">flag</span>'
      : '<span class="p-flag" style="background:#132432;color:#3ddc97">stable</span>';

    li.innerHTML = `
      <div class="p-name">${p.name} <span style="color:var(--muted);font-weight:400">· ${p.age}${p.sex}</span></div>
      <div class="p-sub">${p.diagnosis} · eGFR ${p.labs.eGFR.value}</div>
      ${flag}`;
    li.addEventListener("click", () => selectPatient(p));
    list.appendChild(li);
  });
  $("#patientCount").textContent = `${window.PATIENTS.length} synthetic patients`;
}

/* ---- render chart ---- */
function selectPatient(p) {
  currentPatient = p;
  $("#ptName").innerHTML = `${p.name} <span class="dx-tag">${p.diagnosis}${p.ckdStage && p.ckdStage !== "DM" && p.ckdStage !== "HTN" ? " · " + p.ckdStage : ""}</span>`;
  $("#ptMeta").innerHTML =
    `${p.id} · ${p.age} yo · ${p.sex === "F" ? "Female" : "Male"} · ${p.ethnicity} · last visit ${p.lastVisit}`;

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

  currentFindings = AGENT.deriveFindings(p);
  renderFindings(currentFindings);
  renderCensus($("#search").value);
  $("#chat").innerHTML = "";
  $("#agentStatus").textContent = "ready";
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

/* ---- agent chat ---- */
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

  /* small delay so the "thinking" state is visible */
  setTimeout(() => {
    const res = AGENT.run(currentPatient, q);
    addMsg("agent", res.body, "agent · " + res.intent);
    $("#agentStatus").textContent = "ready";
  }, 220);
}

/* ---- events ---- */
$("#askForm").addEventListener("submit", (e) => {
  e.preventDefault();
  ask($("#query").value);
  $("#query").value = "";
});
$("#search").addEventListener("input", (e) => renderCensus(e.target.value));

const sug = $("#suggestions");
SUGGESTIONS.forEach((s) => {
  const b = document.createElement("button");
  b.textContent = s;
  b.addEventListener("click", () => ask(s));
  sug.appendChild(b);
});

/* ---- init ---- */
renderCensus();
if (window.PATIENTS.length) selectPatient(window.PATIENTS[0]);
