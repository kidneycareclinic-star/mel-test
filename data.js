/* =========================================================================
 * nephrology_ehr — synthetic data (seeded, reproducible)
 * Data model: Patients -> Visits -> Labs, Medications, Diagnoses
 * All values are SYNTHETIC. Any resemblance to real people is coincidence.
 * ========================================================================= */

/* Seeded PRNG (mulberry32) so the dataset is reproducible across reloads. */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const R = mulberry32(20260919);
const pick = (arr) => arr[Math.floor(R() * arr.length)];
const rint = (min, max) => min + Math.floor(R() * (max - min + 1));
const rfloat = (min, max, dp) => {
  const v = min + R() * (max - min);
  return Number(v.toFixed(dp === undefined ? 2 : dp));
};
/* round-trip helper so values are deterministic even if JSON is regenerated */
const near = (target, spread, dp) => Number((target + (R() * 2 - 1) * spread).toFixed(dp === undefined ? 2 : dp));

/* -------------------------------------------------------------------------
 * Reference knowledge used by the generator (and mirrored by the agent)
 * ----------------------------------------------------------------------- */
const FIRST = ["Marcus", "Aisha", "Diego", "Priya", "Elena", "Samir", "Grace", "Omar", "Lena", "Tariq", "Hana", "Viktor", "Sofia", "Jamal", "Ingrid", "Rafael"];
const LAST = ["Okafor", "Nguyen", "Petrov", "Silva", "Kowalski", "Mensah", "Rossi", "Iqbal", "Tanaka", "Dubois", "Novak", "Alvarez", "Haddad", "Berg", "Kim", "Osei"];
const SEX = ["M", "F"];
const ETHNICITY = ["Black", "White", "Asian", "Hispanic", "Other"];

const MEDS = {
  "Lisinopril":       { class: "ACE inhibitor",        renal: "monitor K+/creatinine",                          dose: "10 mg daily" },
  "Losartan":         { class: "ARB",                  renal: "monitor K+/creatinine",                          dose: "50 mg daily" },
  "Furosemide":       { class: "Loop diuretic",        renal: "dose per edema; monitor K+",                     dose: "40 mg BID" },
  "Hydrochlorothiazide": { class: "Thiazide",          renal: "ineffective eGFR<30",                            dose: "25 mg daily" },
  "Metformin":        { class: "Biguanide",            renal: "hold if eGFR<30",                                dose: "500 mg BID" },
  "Spironolactone":   { class: "Aldosterone antagonist", renal: "hyperK risk; hold if K+>5.5",                   dose: "25 mg daily" },
  "Calcium acetate":  { class: "Phosphate binder",     renal: "bind dietary phosphate",                          dose: "667 mg TID with meals" },
  "Sevelamer":        { class: "Phosphate binder",     renal: "phosphate control in CKD",                        dose: "800 mg TID with meals" },
  "Erythropoietin":   { class: "ESA",                  renal: "anemia of CKD; target Hb 10-11",                  dose: "8000 U SC weekly" },
  "Calcitriol":       { class: "Vitamin D analog",     renal: "secondary hyperparathyroidism",                   dose: "0.25 mcg daily" },
  "Cinacalcet":       { class: "Calcimimetic",         renal: "secondary hyperparathyroidism",                   dose: "30 mg daily" },
  "Atorvastatin":     { class: "Statin",               renal: "dyslipidemia",                                   dose: "20 mg daily" },
  "Insulin glargine": { class: "Insulin (long-acting)", renal: "dose per glucose",                              dose: "20 U SC nightly" },
  "Amoxicillin":      { class: "Antibiotic",           renal: "renally dose; hold if AKI",                      dose: "500 mg TID" },
  "Ibuprofen":        { class: "NSAID",                renal: "AVOID in CKD/AKI",                               dose: "400 mg PRN" },
  "Ferrous sulfate":  { class: "Iron supplement",      renal: "iron repletion for ESA",                         dose: "325 mg daily" },
  "Sodium bicarbonate": { class: "Alkali therapy",     renal: "metabolic acidosis",                             dose: "650 mg TID" },
  "Darbepoetin":      { class: "ESA",                  renal: "anemia of CKD",                                  dose: "60 mcg SC weekly" },
};

const DIAGNOSES = {
  "CKD stage 3a":       { stage: "3a", eGFR: [45, 59] },
  "CKD stage 3b":       { stage: "3b", eGFR: [30, 44] },
  "CKD stage 4":        { stage: "4",  eGFR: [15, 29] },
  "CKD stage 5":        { stage: "5",  eGFR: [5, 14] },
  "AKI":                { stage: "AKI", eGFR: null },
  "Type 2 diabetes":    { stage: "DM", eGFR: null },
  "Hypertension":       { stage: "HTN", eGFR: null },
  "IgA nephropathy":    { stage: "GN", eGFR: null },
  "Polycystic kidney disease": { stage: "PKD", eGFR: null },
  "Nephrotic syndrome": { stage: "NS", eGFR: null },
};

/* -------------------------------------------------------------------------
 * Generator
 * ----------------------------------------------------------------------- */
function makeLabs(patient, eGFR) {
  const stage = patient.diagnosis;
  const out = {};
  const set = (name, value, unit, ref, flag) => {
    out[name] = { value, unit, ref, flag: flag || withinRef(value, ref) };
  };
  const withinRef = (v, [lo, hi]) => (v >= lo && v <= hi ? "normal" : v < lo ? "low" : "high");

  /* eGFR (mL/min/1.73m2) */
  const egfr = eGFR !== undefined ? eGFR : rint(8, 90);
  set("eGFR", egfr, "mL/min/1.73m2", [90, 120]);

  /* Creatinine (mg/dL) — inverse of eGFR, loose physiology (cr ≈ 100/eGFR) */
  const cr = Number((100 / Math.max(egfr, 5)).toFixed(1));
  set("Creatinine", cr, "mg/dL", [0.6, 1.2]);

  /* Potassium — higher in advanced CKD, higher with ACEi/ARB/spironolactone */
  const onKsparer = patient.medications.some((m) =>
    ["Lisinopril", "Losartan", "Spironolactone"].includes(m));
  const kBase = egfr < 30 ? 4.8 : 4.2;
  const k = near(kBase + (onKsparer ? 0.4 : 0), 0.6, 1);
  set("Potassium", k, "mEq/L", [3.5, 5.0]);

  /* BUN */
  set("BUN", rint(18, 70), "mg/dL", [7, 20]);

  /* Hemoglobin — anemia of CKD */
  const hb = near(egfr < 30 ? 9.6 : 12.5, 1.5, 1);
  set("Hemoglobin", hb, "g/dL", [13.5, 17.5]);

  /* Phosphate — rises as eGFR falls */
  const phos = near(egfr < 30 ? 5.8 : 3.8, 1.2, 1);
  set("Phosphate", phos, "mg/dL", [2.5, 4.5]);

  /* Calcium */
  set("Calcium", near(8.9, 0.7, 1), "mg/dL", [8.5, 10.2]);

  /* PTH */
  set("PTH", rint(egfr < 30 ? 150 : 60, egfr < 30 ? 600 : 150), "pg/mL", [10, 65]);

  /* Albumin — low in nephrotic syndrome */
  const alb = patient.diagnosis === "Nephrotic syndrome" ? near(2.2, 0.6, 1) : near(3.9, 0.5, 1);
  set("Albumin", alb, "g/dL", [3.5, 5.0]);

  /* Urine protein:creatinine ratio (UPCR) */
  const upcr = patient.diagnosis === "Nephrotic syndrome" ? rfloat(3.5, 12, 1)
    : patient.diagnosis === "IgA nephropathy" ? rfloat(0.5, 3.5, 1)
    : rfloat(0.1, 2.0, 1);
  set("UPCR", upcr, "g/g", [0, 0.2]);

  /* Sodium */
  set("Sodium", near(139, 4, 0), "mEq/L", [135, 145]);

  /* Bicarbonate — acidosis in CKD */
  const bicarb = egfr < 30 ? rint(16, 22) : rint(22, 28);
  set("Bicarbonate", bicarb, "mEq/L", [22, 29]);

  return out;
}

function makeMedications(stage) {
  const base = ["Lisinopril", "Atorvastatin"];
  if (stage === "5" || stage === "AKI") base[0] = "Losartan";
  if (stage === "5") base.push("Calcium acetate", "Calcitriol", "Erythropoietin", "Furosemide");
  else if (stage === "4") base.push("Furosemide", "Calcitriol", "Sodium bicarbonate");
  else if (stage === "AKI") base.push("Furosemide");
  if (R() < 0.3) base.push("Metformin");
  if (R() < 0.4) base.push("Ibuprofen"); // a flag the agent should catch
  if (R() < 0.2) base.push("Spironolactone");
  return base;
}

function makePatient(i) {
  const diagnosis = pick(Object.keys(DIAGNOSES));
  const info = DIAGNOSES[diagnosis];
  let eGFR;
  if (info.eGFR) {
    eGFR = rint(info.eGFR[0], info.eGFR[1]);
  } else {
    /* AKI or non-CKD diagnoses get a "current" eGFR */
    eGFR = diagnosis === "AKI" ? rint(12, 40) : rint(50, 95);
  }

  const sex = pick(SEX);
  const age = rint(42, 84);
  const meds = makeMedications(info.stage);
  const labs = makeLabs({ diagnosis, medications: meds }, eGFR);

  return {
    id: "PT-" + String(i).padStart(3, "0"),
    name: pick(FIRST) + " " + pick(LAST),
    age,
    sex,
    ethnicity: pick(ETHNICITY),
    diagnosis,
    ckdStage: info.stage,
    meds,
    labs,
    lastVisit: "2026-" + String(rint(6, 9)).padStart(2, "0") + "-" + String(rint(1, 28)).padStart(2, "0"),
  };
}

const patients = [];
for (let i = 1; i <= 24; i++) patients.push(makePatient(i));

/* Attach so the app can reach them */
window.PATIENTS = patients;
