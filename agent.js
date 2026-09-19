/* =========================================================================
 * nephrology_ehr — "agentic harness": rule-based nephrology reasoning engine
 *
 * The agent receives a natural-language query plus the patient record, then:
 *   1. classifies intent  (summary / labs / meds / next-step / plan / risk)
 *   2. derives findings  (eGFR staging, AKI, hyperkalemia, acidosis, anemia,
 *      mineral-bone disease, proteinuria, unsafe meds)
 *   3. composes a structured, evidence-styled answer + suggested next actions
 *
 * It is deliberately deterministic and explainable — no external model, no
 * network, no API key. Replace/extend the rules below with an LLM call and
 * the harness shape stays the same.
 * ========================================================================= */

const AGENT = (() => {
  const REF = {
    potassium: [3.5, 5.0],
    creatinine: [0.6, 1.2],
    hemoglobin: [13.5, 17.5],
    phosphate: [2.5, 4.5],
    calcium: [8.5, 10.2],
    pth: [10, 65],
    albumin: [3.5, 5.0],
    upcr: [0, 0.2],
    sodium: [135, 145],
    bicarbonate: [22, 29],
    bun: [7, 20],
  };

  const lab = (p, k) => (p.labs && p.labs[k] ? p.labs[k].value : null);
  const flag = (p, k) => (p.labs && p.labs[k] ? p.labs[k].flag : "unknown");

  /* ---- findings ------------------------------------------------------ */
  function deriveFindings(p) {
    const f = [];
    const egfr = lab(p, "eGFR");
    const k = lab(p, "Potassium");
    const hb = lab(p, "Hemoglobin");
    const phos = lab(p, "Phosphate");
    const pth = lab(p, "PTH");
    const alb = lab(p, "Albumin");
    const upcr = lab(p, "UPCR");
    const bicarb = lab(p, "Bicarbonate");
    const cr = lab(p, "Creatinine");

    if (egfr !== null) {
      if (egfr < 15) f.push({ sev: "critical", title: "Stage 5 CKD / kidney failure", body: `eGFR ${egfr} mL/min/1.73m² — at this level dialysis planning and access evaluation are indicated.` });
      else if (egfr < 30) f.push({ sev: "high", title: "Stage 4 CKD (severe)", body: `eGFR ${egfr} mL/min/1.73m² — nephrology co-management, CKD-MBD and anemia treatment, dialysis education.` });
      else if (egfr < 60) f.push({ sev: "medium", title: "Stage 3 CKD (moderate)", body: `eGFR ${egfr} mL/min/1.73m² — risk-factor control, BP target <130/80, avoid nephrotoxins.` });
      else f.push({ sev: "info", title: "Preserved renal function", body: `eGFR ${egfr} mL/min/1.73m².` });
    }

    /* AKI — keyed off the diagnosis stage rather than a loose Cr threshold */
    if (p.ckdStage === "AKI") {
      f.push({ sev: "high", title: "Acute kidney injury", body: `Creatinine ${cr} mg/dL, eGFR ${egfr} — assess volume status, review nephrotoxins (NSAIDs, contrast, aminoglycosides), and discontinue offending agents.` });
    }

    if (k !== null) {
      if (k > 5.5) f.push({ sev: "critical", title: "Severe hyperkalemia", body: `K⁺ ${k} mEq/L — ECG, cardiac monitor, urgent treatment. Hold K⁺-sparing/ACEi/ARB.` });
      else if (k > 5.0) f.push({ sev: "high", title: "Hyperkalemia", body: `K⁺ ${k} mEq/L — review diet and K⁺-raising medications; recheck.` });
      else if (k < 3.5) f.push({ sev: "medium", title: "Hypokalemia", body: `K⁺ ${k} mEq/L — replace cautiously; monitor in setting of loop diuretics.` });
    }

    if (hb !== null && hb < 11 && egfr !== null && egfr < 60) {
      f.push({ sev: "medium", title: "Anemia of CKD", body: `Hb ${hb} g/dL — evaluate iron stores; consider ESA if iron-replete, target Hb 10–11 g/dL.` });
    }

    if (phos !== null && phos > 4.5) {
      f.push({ sev: "medium", title: "Hyperphosphatemia", body: `Phosphate ${phos} mg/dL — dietary restriction and phosphate binders; drives secondary hyperparathyroidism.` });
    }

    if (pth !== null && pth > 65 && egfr !== null && egfr < 60) {
      f.push({ sev: "medium", title: "Secondary hyperparathyroidism", body: `PTH ${pth} pg/mL — check vitamin D; consider calcitriol/cinacalcet.` });
    }

    if (alb !== null && alb < 3.0) {
      f.push({ sev: "medium", title: "Hypoalbuminemia", body: `Albumin ${alb} g/dL — suggests nephrotic-range losses or malnutrition.` });
    }

    if (upcr !== null && upcr > 3.0) {
      f.push({ sev: "high", title: "Nephrotic-range proteinuria", body: `UPCR ${upcr} g/g — >3 g/g is nephrotic range; consider kidney biopsy referral, anticoagulation if albumin very low.` });
    } else if (upcr !== null && upcr > 0.2) {
      f.push({ sev: "info", title: "Proteinuria", body: `UPCR ${upcr} g/g — start/maximize RAAS blockade; recheck for response.` });
    }

    if (bicarb !== null && bicarb < 22) {
      f.push({ sev: "medium", title: "Metabolic acidosis", body: `Bicarbonate ${bicarb} mEq/L — alkali therapy (sodium bicarbonate) if <22; slows CKD progression.` });
    }

    /* unsafe / renally-dosed medications */
    const unsafe = p.meds.filter((m) => ["Ibuprofen"].includes(m));
    if (unsafe.length) {
      f.push({ sev: "high", title: "Nephrotoxic medication", body: `${unsafe.join(", ")} — NSAIDs should be avoided in CKD/AKI; consider alternative analgesia.` });
    }
    const hold = p.meds.filter((m) =>
      (m === "Metformin" && egfr !== null && egfr < 30) ||
      (m === "Spironolactone" && k !== null && k > 5.0) ||
      (m === "Hydrochlorothiazide" && egfr !== null && egfr < 30)
    );
    if (hold.length) {
      f.push({ sev: "high", title: "Renal dose adjustment needed", body: `${hold.join(", ")} — hold or dose-adjust at this eGFR/K⁺.` });
    }

    if (f.length === 0) f.push({ sev: "info", title: "No acute flags", body: "No critical renal findings on current labs." });
    return f;
  }

  /* ---- intent classification ----------------------------------------- */
  function classify(q) {
    const s = q.toLowerCase();
    const has = (arr) => arr.some((w) => s.includes(w));
    if (has(["summar", "overview", "history", "tell me about", "who is", "profile"])) return "summary";
    if (has(["next step", "what next", "recommend", "suggest", "plan", "what should", "next"])) return "next";
    if (has(["interpret", "abnormal", "acid", "hyperkalem", "anemia", "proteinuria", "bone", "flag", "finding", "worried", "concern"])) return "findings";
    if (has(["lab", "potassium", "creatinine", "egfr", "gfr", "phosphate", "calcium", "hemoglobin", "pth", "bun", "bicarb", "albumin", "sodium", "upcr", "result", "value"])) return "labs";
    if (has(["med", "drug", "dose", "nsaid", "prescription", "metformin", "lisinopril"])) return "meds";
    if (has(["risk", "dialysis", "progress", "prognos"])) return "risk";
    return "summary";
  }

  function ordinal(stage) {
    if (stage === "5") return "stage 5 (kidney failure)";
    if (stage === "4") return "stage 4";
    if (stage === "3b") return "stage 3b";
    if (stage === "3a") return "stage 3a";
    if (stage === "AKI") return "acute kidney injury";
    return stage;
  }

  /* ---- composition ---------------------------------------------------- */
  function summarize(p) {
    const egfr = lab(p, "eGFR");
    return `${p.name} is a ${p.age}-year-old ${p.sex === "F" ? "female" : "male"} with ${p.diagnosis}${p.ckdStage && p.ckdStage !== "DM" && p.ckdStage !== "HTN" ? ` (${ordinal(p.ckdStage)})` : ""}. Current eGFR ${egfr ?? "—"} mL/min/1.73m².`;
  }

  function labsText(p) {
    const order = ["eGFR", "Creatinine", "BUN", "Potassium", "Sodium", "Bicarbonate", "Hemoglobin", "Phosphate", "Calcium", "PTH", "Albumin", "UPCR"];
    return order
      .filter((k) => p.labs && p.labs[k])
      .map((k) => {
        const L = p.labs[k];
        return `${k}: ${L.value} ${L.unit} (ref ${L.ref[0]}–${L.ref[1]}) [${L.flag}]`;
      })
      .join(" · ");
  }

  function medsText(p) {
    if (!p.meds.length) return "No active medications.";
    return p.meds
      .map((m) => `${m} (${MEDS[m] ? MEDS[m].dose : "dose per chart"}${MEDS[m] ? " — " + MEDS[m].renal : ""})`)
      .join(" · ");
  }

  function nextSteps(p) {
    const steps = [];
    const egfr = lab(p, "eGFR");
    const k = lab(p, "Potassium");
    const upcr = lab(p, "UPCR");
    const hb = lab(p, "Hemoglobin");

    if (egfr !== null && egfr < 15) steps.push("Refer for dialysis access planning and modality education (HD vs PD vs transplant).");
    if (egfr !== null && egfr < 30) steps.push("Quarterly nephrology follow-up; monitor eGFR, K⁺, phosphate, PTH, and Hb.");
    if (k !== null && k > 5.0) steps.push("Address hyperkalemia: dietary counseling, review K⁺-raising meds, repeat K⁺.");
    if (upcr !== null && upcr > 0.2) steps.push("Maximize RAAS blockade (ACEi/ARB) titrated to BP and K⁺; add SGLT2i if eligible.");
    if (hb !== null && hb < 11) steps.push("Check iron studies (ferritin, TSAT); replete iron before ESA therapy.");
    if (p.meds.includes("Ibuprofen")) steps.push("Discontinue NSAID — nephrotoxic in CKD.");
    if (lab(p, "Bicarbonate") !== null && lab(p, "Bicarbonate") < 22) steps.push("Start sodium bicarbonate to correct metabolic acidosis (target HCO₃ ≥22).");
    if (steps.length === 0) steps.push("Routine monitoring; continue risk-factor control (BP <130/80, HbA1c, lipid).");
    return steps;
  }

  function riskText(p) {
    const egfr = lab(p, "eGFR");
    const upcr = lab(p, "UPCR");
    const lines = [];
    if (egfr !== null && egfr < 15) lines.push("High risk of progression to ESRD — dialysis/transplant planning is appropriate now.");
    else if (egfr !== null && egfr < 30) lines.push("Moderate-high progression risk — optimize BP, RAAS blockade, and address modifiable factors.");
    else lines.push("Low-moderate short-term progression risk — monitor eGFR trajectory.");
    if (upcr !== null && upcr > 3.0) lines.push("Nephrotic-range proteinuria independently increases cardiovascular and thromboembolic risk.");
    if (upcr !== null && upcr > 0.2) lines.push("Persistent proteinuria is a strong marker of CKD progression — target >50% reduction.");
    return lines.join(" ");
  }

  /* ---- public API ------------------------------------------------------ */
  function run(patient, query) {
    const intent = classify(query);
    const findings = deriveFindings(patient);
    const body = {
      summary: summarize(patient) + " " + medsText(patient),
      labs: labsText(patient),
      meds: medsText(patient),
      next: nextSteps(patient).map((s, i) => `${i + 1}. ${s}`).join("\n"),
      risk: riskText(patient),
      findings: findings.map((f) => `${f.sev.toUpperCase()}: ${f.title} — ${f.body}`).join("\n"),
    }[intent];

    return {
      intent,
      patientId: patient.id,
      patientName: patient.name,
      findings,
      body,
      nextSteps: nextSteps(patient),
      rawLabs: patient.labs,
      meds: patient.meds,
    };
  }

  return { run, deriveFindings, classify };
})();
