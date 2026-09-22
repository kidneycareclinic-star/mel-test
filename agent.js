/* =========================================================================
 * Nephrology Agentic Harness — shared nephrology agent
 *
 * Primary input is the canonical Patient State. This demo remains deterministic
 * and synthetic; it does not call an external LLM.
 * ========================================================================= */

const AGENT = (() => {
  function val(node, fallback = null) {
    return node && node.value !== undefined && node.value !== null ? node.value : fallback;
  }

  function medicationNames(state) {
    return state && state.medications && Array.isArray(state.medications.active)
      ? state.medications.active.map((m) => m.name)
      : [];
  }

  function deriveFindings(state) {
    const f = [];
    const egfr = Number(val(state.kidney.function.currentEgfr));
    const k = Number(val(state.electrolytes.potassium));
    const hb = Number(val(state.anemia.hemoglobin));
    const phos = Number(val(state.ckdMbd.phosphate));
    const pth = Number(val(state.ckdMbd.pth));
    const upcr = Number(val(state.kidney.proteinuria.current));
    const bicarb = Number(val(state.electrolytes.bicarbonate));
    const stage = val(state.kidney.stage);
    const meds = medicationNames(state);

    if (!Number.isNaN(egfr)) {
      if (egfr < 15) f.push({ sev: "critical", title: "Advanced kidney dysfunction", body: `Current synthetic eGFR is ${egfr} mL/min/1.73m².` });
      else if (egfr < 30) f.push({ sev: "high", title: "Reduced kidney function", body: `Current synthetic eGFR is ${egfr} mL/min/1.73m².` });
      else if (egfr < 60) f.push({ sev: "medium", title: "CKD-range kidney function", body: `Current synthetic eGFR is ${egfr} mL/min/1.73m².` });
      else f.push({ sev: "info", title: "Current kidney function", body: `Current synthetic eGFR is ${egfr} mL/min/1.73m².` });
    }

    if (stage === "AKI") {
      f.push({ sev: "high", title: "AKI context present", body: "The shared patient state carries an acute kidney injury problem label." });
    }

    if (!Number.isNaN(k) && k > 5.0) {
      f.push({ sev: k > 5.5 ? "critical" : "high", title: "Potassium requires review", body: `Synthetic potassium is ${k} mEq/L.` });
    }

    if (!Number.isNaN(hb) && hb < 11) {
      f.push({ sev: "medium", title: "Hemoglobin requires review", body: `Synthetic hemoglobin is ${hb} g/dL.` });
    }

    if (!Number.isNaN(phos) && phos > 4.5) {
      f.push({ sev: "medium", title: "Phosphate requires review", body: `Synthetic phosphate is ${phos} mg/dL.` });
    }

    if (!Number.isNaN(pth) && pth > 65) {
      f.push({ sev: "medium", title: "PTH requires review", body: `Synthetic PTH is ${pth} pg/mL.` });
    }

    if (!Number.isNaN(upcr) && upcr > 0.2) {
      f.push({ sev: upcr > 3 ? "high" : "info", title: "Proteinuria signal", body: `Synthetic UPCR is ${upcr} g/g.` });
    }

    if (!Number.isNaN(bicarb) && bicarb < 22) {
      f.push({ sev: "medium", title: "Bicarbonate requires review", body: `Synthetic bicarbonate is ${bicarb} mEq/L.` });
    }

    if (meds.includes("Ibuprofen")) {
      f.push({ sev: "high", title: "Medication review signal", body: "Ibuprofen is present on the synthetic active medication list." });
    }

    if (state.openLoops && state.openLoops.some((x) => x.status === "pending")) {
      f.push({
        sev: "medium",
        title: "Open clinical loops",
        body: `${state.openLoops.filter((x) => x.status === "pending").length} tracked follow-up item(s) remain pending.`,
      });
    }

    if (!f.length) {
      f.push({ sev: "info", title: "No structural flags", body: "No demo-rule flags were generated from the current canonical patient state." });
    }

    return f;
  }

  function classify(q) {
    const s = String(q || "").toLowerCase();
    const has = (arr) => arr.some((w) => s.includes(w));
    if (has(["summar", "overview", "history", "profile"])) return "summary";
    if (has(["next step", "what next", "plan", "next"])) return "next";
    if (has(["interpret", "abnormal", "finding", "concern", "flag"])) return "findings";
    if (has(["lab", "potassium", "creatinine", "egfr", "gfr", "phosphate", "hemoglobin", "pth", "bicarb", "upcr"])) return "labs";
    if (has(["med", "drug", "nsaid", "prescription"])) return "meds";
    if (has(["risk", "progress", "prognos"])) return "risk";
    if (has(["loop", "pending", "follow-up", "follow up"])) return "loops";
    return "summary";
  }

  function summarize(state, workspace) {
    const name = val(state.identity.name, "Patient");
    const age = val(state.identity.age, "—");
    const diagnosis = val(state.kidney.diagnosis, "kidney condition");
    const egfr = val(state.kidney.function.currentEgfr, "—");
    const active = PATIENT_STATE_ENGINE.activeInWorkspace(state, workspace);
    return `${name}, age ${age}, has ${diagnosis}. Current synthetic eGFR is ${egfr} mL/min/1.73m². ${workspace} context is ${active ? "active" : "not active"}.`;
  }

  function labsText(state) {
    return [
      ["eGFR", val(state.kidney.function.currentEgfr), "mL/min/1.73m²"],
      ["UPCR", val(state.kidney.proteinuria.current), "g/g"],
      ["Potassium", val(state.electrolytes.potassium), "mEq/L"],
      ["Bicarbonate", val(state.electrolytes.bicarbonate), "mEq/L"],
      ["Hemoglobin", val(state.anemia.hemoglobin), "g/dL"],
      ["Phosphate", val(state.ckdMbd.phosphate), "mg/dL"],
      ["PTH", val(state.ckdMbd.pth), "pg/mL"],
    ].map(([name, value, unit]) => `${name}: ${value} ${unit}`).join(" · ");
  }

  function medsText(state) {
    const meds = medicationNames(state);
    return meds.length ? meds.join(" · ") : "No active medications in the canonical state.";
  }

  function loopsText(state) {
    const loops = state.openLoops || [];
    if (!loops.length) return "No tracked open loops.";
    return loops.map((loop) => `${loop.status.toUpperCase()}: ${loop.label} [${loop.owner}]`).join("\n");
  }

  function nextText(state, workspace) {
    const items = [];
    const pending = (state.openLoops || []).filter((x) => x.status === "pending");
    if (pending.length) items.push(`Review ${pending.length} pending open-loop item(s).`);
    const episode = PATIENT_STATE_ENGINE.workspaceContext(state, workspace);
    if (episode && episode.active) items.push(`Continue within the active ${workspace} workflow context.`);
    else items.push(`No active ${workspace} episode is attached to this patient state.`);
    items.push("Any treatment decision remains physician-controlled in this synthetic prototype.");
    return items.map((x, i) => `${i + 1}. ${x}`).join("\n");
  }

  function riskText(state) {
    const findings = deriveFindings(state);
    const high = findings.filter((x) => ["critical", "high"].includes(x.sev)).length;
    const medium = findings.filter((x) => x.sev === "medium").length;
    return `Demo structural review: ${high} high/critical signal(s), ${medium} medium signal(s). This is not a validated clinical risk score.`;
  }

  function run(state, query, workspace = "office") {
    const intent = classify(query);
    const findings = deriveFindings(state);

    const body = {
      summary: summarize(state, workspace),
      labs: labsText(state),
      meds: medsText(state),
      next: nextText(state, workspace),
      risk: riskText(state),
      loops: loopsText(state),
      findings: findings.map((x) => `${x.sev.toUpperCase()}: ${x.title} — ${x.body}`).join("\n"),
    }[intent];

    return {
      intent,
      patientId: state.patientId,
      patientName: val(state.identity.name),
      workspace,
      findings,
      body,
      openLoops: state.openLoops,
      stateVersion: state.engineVersion,
    };
  }

  return { run, deriveFindings, classify };
})();
