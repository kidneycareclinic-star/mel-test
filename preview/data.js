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
  "Dapagliflozin":     { class: "SGLT2 inhibitor",      renal: "synthetic demo · kidney/cardiovascular protection context", dose: "synthetic demo" },
  "Finerenone":        { class: "Nonsteroidal MRA",     renal: "synthetic demo · albuminuric T2D/CKD context",              dose: "synthetic demo" },
  "Semaglutide":       { class: "GLP-1 receptor agonist", renal: "synthetic demo · T2D/CKD cardiorenal context",            dose: "synthetic demo" },
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
  "Polycystic kidney disease": { stage: "3b", eGFR: [30, 44] },
  "Nephrotic syndrome": { stage: "NS", eGFR: null },
};


/* -------------------------------------------------------------------------
 * Synthetic problem-list catalog (candidate ICD-10-CM display codes)
 * Codes are attached to explicitly generated synthetic diagnoses; the UI
 * labels them as candidates rather than final billing selections.
 * ----------------------------------------------------------------------- */
const ICD10_CANDIDATES = {
  "CKD stage 3a": { code: "N18.31", label: "Chronic kidney disease, stage 3a" },
  "CKD stage 3b": { code: "N18.32", label: "Chronic kidney disease, stage 3b" },
  "CKD stage 4": { code: "N18.4", label: "Chronic kidney disease, stage 4" },
  "CKD stage 5": { code: "N18.5", label: "Chronic kidney disease, stage 5" },
  "AKI": { code: "N17.9", label: "Acute kidney failure, unspecified" },
  "Type 2 diabetes": { code: "E11.9", label: "Type 2 diabetes mellitus without complications" },
  "Hypertension": { code: "I10", label: "Essential (primary) hypertension" },
  "IgA nephropathy": { code: "N02.B9", label: "Other recurrent and persistent immunoglobulin A nephropathy" },
  "Polycystic kidney disease": { code: "Q61.3", label: "Polycystic kidney, unspecified" },
  "Nephrotic syndrome": { code: "N04.9", label: "Nephrotic syndrome with unspecified morphologic changes" },
  "Hyperlipidemia": { code: "E78.5", label: "Hyperlipidemia, unspecified" },
  "Obesity": { code: "E66.9", label: "Obesity, unspecified" },
};

function buildProblemList(patient, index) {
  const labels = [patient.diagnosis];
  if (patient.diagnosis !== "Hypertension" && index % 2 === 0) labels.push("Hypertension");
  if (index % 3 === 0) labels.push("Hyperlipidemia");
  if (patient.diagnosis !== "Type 2 diabetes" && index % 4 === 0) labels.push("Type 2 diabetes");
  if (index % 5 === 0) labels.push("Obesity");

  return [...new Set(labels)].map((name, position) => ({
    id: patient.id + "-problem-" + String(position + 1).padStart(2, "0"),
    name,
    code: ICD10_CANDIDATES[name] ? ICD10_CANDIDATES[name].code : "—",
    codedLabel: ICD10_CANDIDATES[name] ? ICD10_CANDIDATES[name].label : name,
    primary: position === 0,
    status: "active",
    codeSystem: "ICD-10-CM",
    codingStatus: "candidate",
  }));
}


/* -------------------------------------------------------------------------
 * eGFR progression interpretation profile.
 *
 * IMPORTANT:
 * - The four labels are a configurable practice taxonomy for the demo.
 * - Synthetic "verifiedAnnualSlope" values are fixtures, NOT calculated
 *   from the displayed history in-browser.
 * - Production should receive a verified eGFR slope from a validated
 *   calculation service / analytics pipeline, preserving method + provenance.
 * ----------------------------------------------------------------------- */
const EGFR_PROGRESSION_PROFILE = {
  id: "office-egfr-progression-v1",
  label: "Office CKD eGFR progression profile",
  units: "mL/min/1.73m2/year",
  thresholds: {
    noProgressionMaxLoss: 1,
    rapidMinLoss: 5,
    veryRapidMinLoss: 15,
  },
  evidenceAnchors: [
    "KDIGO 2024 CKD: >20% change on a subsequent eGFR exceeds expected variability and warrants evaluation.",
    "KDIGO 2012 CKD: historical rapid progression definition >5 mL/min/1.73m2/year sustained decline.",
    "NICE NG203: accelerated progression includes sustained decline >=15 mL/min/1.73m2/year or >=25% plus GFR-category change within 12 months.",
    "KDIGO 2025 ADPKD: confirmed historical eGFR decline >=3 mL/min/1.73m2/year can indicate rapid ADPKD progression.",
  ],
};

function progressionCategoryFromVerifiedLoss(lossRate) {
  if (lossRate < EGFR_PROGRESSION_PROFILE.thresholds.noProgressionMaxLoss) return "no progression";
  if (lossRate < EGFR_PROGRESSION_PROFILE.thresholds.rapidMinLoss) return "slow progression";
  if (lossRate < EGFR_PROGRESSION_PROFILE.thresholds.veryRapidMinLoss) return "rapid progression";
  return "very rapid progression";
}

function buildEgfrProgressionFixture(patient, index) {
  const fixtures = [
    { verifiedAnnualSlope: -0.4, verifiedAnnualLoss: 0.4 },
    { verifiedAnnualSlope: -2.4, verifiedAnnualLoss: 2.4 },
    { verifiedAnnualSlope: -6.5, verifiedAnnualLoss: 6.5 },
    { verifiedAnnualSlope: -16.0, verifiedAnnualLoss: 16.0 },
  ];
  const fixture = fixtures[(index - 1) % fixtures.length];
  const category = progressionCategoryFromVerifiedLoss(fixture.verifiedAnnualLoss);
  const adpkdRapidSignal =
    patient.diagnosis === "Polycystic kidney disease" &&
    fixture.verifiedAnnualLoss >= 3;

  return {
    ...fixture,
    category,
    profileId: EGFR_PROGRESSION_PROFILE.id,
    profileLabel: EGFR_PROGRESSION_PROFILE.label,
    calculationStatus: "synthetic verified-slope fixture; not calculated in browser",
    slopeSource: "synthetic-verified-slope-fixture",
    interpretationStatus: "demo-only",
    adpkdRapidSignal,
    dataQuality: {
      displayedHistoryPoints: 4,
      note: "Production interpretation should use sufficient longitudinal measurements, exclude acute/reversible changes, and retain calculation provenance.",
    },
  };
}

window.EGFR_PROGRESSION_PROFILE = EGFR_PROGRESSION_PROFILE;


/* -------------------------------------------------------------------------
 * UACR + combined CKD progression fixtures.
 *
 * UACR is explicit synthetic data; it is NOT derived from UPCR.
 * The combined signal is descriptive concordance, not a validated risk score.
 * ----------------------------------------------------------------------- */
const UACR_PROGRESSION_PROFILE = {
  id: "office-uacr-progression-v1",
  label: "Office CKD albuminuria progression profile",
  units: "mg/g",
  categories: {
    A1: "normal to mildly increased",
    A2: "moderately increased",
    A3: "severely increased",
  },
  variabilitySignal: "KDIGO 2024: doubling of ACR on a subsequent test exceeds expected laboratory variability and warrants evaluation.",
};

function albuminuriaCategoryFromUacr(value) {
  if (value < 30) return "A1";
  if (value < 300) return "A2";
  return "A3";
}

function gfrCategoryFromEgfr(value) {
  if (value >= 90) return "G1";
  if (value >= 60) return "G2";
  if (value >= 45) return "G3a";
  if (value >= 30) return "G3b";
  if (value >= 15) return "G4";
  return "G5";
}

function cgaRiskFromCategories(g, a) {
  const risk = {
    G1: { A1: "low", A2: "moderate", A3: "high" },
    G2: { A1: "low", A2: "moderate", A3: "high" },
    G3a: { A1: "moderate", A2: "high", A3: "very high" },
    G3b: { A1: "high", A2: "very high", A3: "very high" },
    G4: { A1: "very high", A2: "very high", A3: "very high" },
    G5: { A1: "very high", A2: "very high", A3: "very high" },
  };
  return risk[g] && risk[g][a] ? risk[g][a] : "unclassified";
}

function buildUacrProgressionFixture(patient, index) {
  const fixtures = [
    {
      values: [16, 17, 18, 18],
      trajectorySignal: "stable",
      variabilitySignal: "no doubling signal",
      doublingConfirmed: false,
    },
    {
      values: [42, 55, 71, 92],
      trajectorySignal: "worsening",
      variabilitySignal: "doubling signal present in synthetic fixture",
      doublingConfirmed: true,
    },
    {
      values: [180, 230, 310, 420],
      trajectorySignal: "worsening",
      variabilitySignal: "doubling signal present in synthetic fixture",
      doublingConfirmed: true,
    },
    {
      values: [980, 910, 820, 780],
      trajectorySignal: "improving",
      variabilitySignal: "no doubling signal",
      doublingConfirmed: false,
    },
  ];
  const fixture = fixtures[(index - 1) % fixtures.length];
  const current = fixture.values[fixture.values.length - 1];
  const category = albuminuriaCategoryFromUacr(current);

  return {
    current,
    category,
    categoryLabel: UACR_PROGRESSION_PROFILE.categories[category],
    trajectorySignal: fixture.trajectorySignal,
    variabilitySignal: fixture.variabilitySignal,
    doublingConfirmed: fixture.doublingConfirmed,
    history: [
      { date: "2025-12-15", value: fixture.values[0] },
      { date: "2026-03-15", value: fixture.values[1] },
      { date: "2026-06-15", value: fixture.values[2] },
      { date: "2026-09-15", value: fixture.values[3] },
    ],
    calculationStatus: "synthetic verified UACR trajectory fixture; not derived from UPCR",
    source: "synthetic-verified-uacr-fixture",
  };
}

function buildCombinedCkdProgressionFixture(patient) {
  const egfr = patient.eGFRProgression;
  const uacr = patient.albuminuriaProgression;
  const egfrWorsening = egfr && ["rapid progression", "very rapid progression"].includes(egfr.category);
  const albuminuriaWorsening = uacr && uacr.trajectorySignal === "worsening";

  let signal = "concordant stable/improving";
  if (egfrWorsening && albuminuriaWorsening) signal = "concordant worsening";
  else if (!egfrWorsening && albuminuriaWorsening) signal = "albuminuria-led progression signal";
  else if (egfrWorsening && !albuminuriaWorsening) signal = "eGFR-led progression signal";

  const gCategory = gfrCategoryFromEgfr(patient.labs.eGFR.value);
  const aCategory = uacr ? uacr.category : "A1";

  return {
    signal,
    gCategory,
    aCategory,
    cgaLabel: gCategory + aCategory,
    cgaRisk: cgaRiskFromCategories(gCategory, aCategory),
    albuminuriaEarlySignal: !egfrWorsening && albuminuriaWorsening,
    interpretationStatus: "descriptive concordance model; not a validated risk score",
    profileLabel: "eGFR + UACR progression concordance",
  };
}

window.UACR_PROGRESSION_PROFILE = UACR_PROGRESSION_PROFILE;

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


/* -------------------------------------------------------------------------
 * Synthetic longitudinal lab history for interactive trend review.
 * Historical values are deterministic demo data anchored to the current lab.
 * ----------------------------------------------------------------------- */
function buildLabHistory(patient, index) {
  const dates = ["2025-12-15", "2026-03-15", "2026-06-15", "2026-09-15"];
  const history = {};

  Object.entries(patient.labs || {}).forEach(([name, lab], labIndex) => {
    const current = Number(lab.value);
    if (!Number.isFinite(current)) return;

    const decimals = Number.isInteger(current) ? 0 : 1;
    const scale = Math.max(Math.abs(current) * 0.08, decimals ? 0.2 : 1);
    const direction = ((index + labIndex) % 3) - 1;

    const values = [
      current - direction * scale * 2.1,
      current - direction * scale * 1.35,
      current - direction * scale * 0.65,
      current,
    ].map((value, i) => {
      if (name === "eGFR") value = Math.max(5, value);
      if (name === "UPCR") value = Math.max(0.05, value);
      return {
        date: dates[i],
        value: Number(value.toFixed(decimals)),
      };
    });

    history[name] = {
      unit: lab.unit,
      ref: lab.ref,
      currentFlag: lab.flag,
      values,
    };
  });

  return history;
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


/* =========================================================================
 * Shared longitudinal patient-state model
 * One synthetic identity can participate in multiple care settings. Setting
 * contexts are overlays; they do not create separate patient records.
 * ========================================================================= */
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }


function buildKidneyProtectionTimeline(p, index) {
  const hasT2D = p.diagnosis === "Type 2 diabetes" ||
    (p.problemList || []).some((problem) => problem.name === "Type 2 diabetes");

  const rasDrug = p.meds.includes("Lisinopril") ? "Lisinopril"
    : p.meds.includes("Losartan") ? "Losartan" : null;

  const sglt2Active = index % 3 !== 0 && !["5", "AKI"].includes(p.ckdStage);
  const nsMraActive = hasT2D && index % 4 === 0 && p.labs.Potassium.value <= 5.0;
  const steroidalMraActive = !nsMraActive && p.meds.includes("Spironolactone");
  const glp1Active = hasT2D && index % 5 <= 1;

  if (sglt2Active && !p.meds.includes("Dapagliflozin")) p.meds.push("Dapagliflozin");
  if (nsMraActive && !p.meds.includes("Finerenone")) p.meds.push("Finerenone");
  if (glp1Active && !p.meds.includes("Semaglutide")) p.meds.push("Semaglutide");

  const currentBpSys = 118 + (index * 7) % 42;
  const currentBpDia = 68 + (index * 5) % 24;
  const bpHistory = [
    { date: "2025-12-15", systolic: clamp(currentBpSys + 12, 96, 178), diastolic: clamp(currentBpDia + 6, 56, 108), source: "synthetic office BP" },
    { date: "2026-03-15", systolic: clamp(currentBpSys + 7, 96, 178), diastolic: clamp(currentBpDia + 4, 56, 108), source: "synthetic office BP" },
    { date: "2026-06-15", systolic: clamp(currentBpSys + 3, 96, 178), diastolic: clamp(currentBpDia + 2, 56, 108), source: "synthetic office BP" },
    { date: "2026-09-15", systolic: currentBpSys, diastolic: currentBpDia, source: "synthetic office BP" },
  ];

  return {
    therapies: [
      {
        key: "ras",
        label: "RAS blockade",
        medication: rasDrug,
        active: Boolean(rasDrug),
        startedAt: rasDrug ? "2025-10-01" : null,
        detail: rasDrug ? rasDrug + " listed" : "ACEi/ARB not listed",
      },
      {
        key: "sglt2",
        label: "SGLT2 inhibitor",
        medication: sglt2Active ? "Dapagliflozin" : null,
        active: sglt2Active,
        startedAt: sglt2Active ? "2026-01-20" : null,
        detail: sglt2Active ? "Dapagliflozin listed" : "SGLT2 inhibitor not listed",
      },
      {
        key: "mra",
        label: "MRA",
        medication: nsMraActive ? "Finerenone" : steroidalMraActive ? "Spironolactone" : null,
        active: nsMraActive || steroidalMraActive,
        startedAt: nsMraActive ? "2026-04-12" : steroidalMraActive ? "2026-02-28" : null,
        subtype: nsMraActive ? "nonsteroidal" : steroidalMraActive ? "steroidal" : null,
        detail: nsMraActive
          ? "Finerenone (ns-MRA) listed"
          : steroidalMraActive
          ? "Spironolactone listed; indication may differ from CKD progression therapy"
          : "MRA not listed",
      },
      {
        key: "glp1",
        label: "GLP-1 receptor agonist",
        medication: glp1Active ? "Semaglutide" : null,
        active: glp1Active,
        startedAt: glp1Active ? "2026-07-01" : null,
        detail: glp1Active ? "Semaglutide listed" : "GLP-1 receptor agonist not listed",
      },
    ],
    bpHistory,
    evidenceContext: {
      hasT2D,
      uacr: p.labs.UACR ? p.labs.UACR.value : null,
      albuminuriaCategory: p.albuminuriaProgression ? p.albuminuriaProgression.category : null,
      eGFR: p.labs.eGFR.value,
      potassium: p.labs.Potassium.value,
      note: "Eligibility and choice are patient-specific; this synthetic timeline reports listed therapy rather than prescribing missing therapy.",
    },
    source: "synthetic kidney-protection timeline fixture",
  };
}

function buildLongitudinalState(p, index) {
  const currentEgfr = p.labs.eGFR.value;
  const currentUpcr = p.labs.UPCR.value;
  const currentUacr = p.labs.UACR ? p.labs.UACR.value : null;
  const currentHb = p.labs.Hemoglobin.value;
  const currentK = p.labs.Potassium.value;
  const currentPhos = p.labs.Phosphate.value;
  const currentPth = p.labs.PTH.value;
  const currentBicarb = p.labs.Bicarbonate.value;

  const slope = ((index % 5) - 2) * 1.1;
  const e1 = clamp(Math.round(currentEgfr - slope * 3 + ((index % 3) - 1) * 2), 5, 110);
  const e2 = clamp(Math.round(currentEgfr - slope * 2 + (index % 2 ? 1 : -1)), 5, 110);
  const e3 = clamp(Math.round(currentEgfr - slope), 5, 110);

  const proteinFactor = 1 + (((index % 5) - 2) * 0.08);
  const bpSys = 118 + (index * 7) % 42;
  const bpDia = 68 + (index * 5) % 24;
  const protectionTimeline = p.kidneyProtectionTimeline || buildKidneyProtectionTimeline(p, index);

  return {
    kidney: {
      label: p.diagnosis,
      stage: p.ckdStage,
      currentEgfr,
      trajectory: [
        { date: "2025-12", value: e1 },
        { date: "2026-03", value: e2 },
        { date: "2026-06", value: e3 },
        { date: "2026-09", value: currentEgfr },
      ],
      trajectoryLabel: currentEgfr < e1 - 5 ? "declining" : currentEgfr > e1 + 5 ? "improving" : "relatively stable",
    },
    proteinuria: {
      current: currentUpcr,
      trajectory: [
        Number(Math.max(0.05, currentUpcr * proteinFactor * 0.82).toFixed(1)),
        Number(Math.max(0.05, currentUpcr * proteinFactor * 0.92).toFixed(1)),
        Number(currentUpcr.toFixed(1)),
      ],
      currentUacr,
      albuminuriaCategory: p.albuminuriaProgression ? p.albuminuriaProgression.category : null,
      uacrTrajectory: p.albuminuriaProgression ? p.albuminuriaProgression.history.map((point) => ({ ...point })) : [],
    },
    bpVolume: {
      latestBp: bpSys + "/" + bpDia,
      history: protectionTimeline.bpHistory.map((point) => ({ ...point })),
      edema: index % 6 === 0 ? "1+ peripheral edema" : index % 4 === 0 ? "trace edema" : "no edema documented",
      weightTrend: index % 5 === 0 ? "upward" : index % 5 === 1 ? "downward" : "stable",
    },
    electrolytes: {
      potassium: currentK,
      bicarbonate: currentBicarb,
      status: currentK > 5.0 || currentBicarb < 22 ? "review" : "stable",
    },
    anemia: {
      hemoglobin: currentHb,
      status: currentHb < 11 ? "review" : "stable",
    },
    ckdMbd: {
      phosphate: currentPhos,
      pth: currentPth,
      status: currentPhos > 4.5 || currentPth > 65 ? "review" : "stable",
    },
    kidneyProtection: {
      raas: protectionTimeline.therapies.find((x) => x.key === "ras").active,
      sglt2: protectionTimeline.therapies.find((x) => x.key === "sglt2").active,
      mra: protectionTimeline.therapies.find((x) => x.key === "mra").active,
      glp1ra: protectionTimeline.therapies.find((x) => x.key === "glp1").active,
      therapies: protectionTimeline.therapies.map((therapy) => ({ ...therapy })),
      timelineSource: protectionTimeline.source,
      evidenceContext: { ...protectionTimeline.evidenceContext },
      nsaidExposure: p.meds.includes("Ibuprofen"),
    },
    openLoops: [
      ...(index % 4 === 0 ? [{ type: "lab", label: "Repeat chemistry", status: "pending" }] : []),
      ...(index % 7 === 0 ? [{ type: "imaging", label: "Renal imaging follow-up", status: "pending" }] : []),
    ],
  };
}

function buildContexts(p, index) {
  const advanced = ["4", "5", "AKI"].includes(p.ckdStage);
  const dialysisEligible = p.ckdStage === "5";
  const dialysisMode = dialysisEligible && index % 3 === 0 ? "peritoneal" : "hemodialysis";
  const transplantActive = p.ckdStage === "5" || index % 6 === 0;
  return {
    office: {
      active: true,
      visitType: index % 2 ? "CKD follow-up" : "Nephrology return",
      lastVisit: p.lastVisit,
      focus: p.diagnosis,
      bp: p.longitudinal.bpVolume.latestBp,
      openLoops: p.longitudinal.openLoops.length,
      previsit: index % 4 === 0 ? "Review pending items" : "Pre-visit brief ready",
    },
    hospital: {
      active: p.ckdStage === "AKI" || advanced || index % 5 === 0,
      location: index % 2 ? "Medical floor" : "ICU",
      consultType: p.ckdStage === "AKI" ? "AKI consult" : "Nephrology consult",
      hospitalDay: (index % 6) + 1,
      trigger: p.ckdStage === "AKI" ? "Rising creatinine / AKI" : advanced ? "Advanced CKD / inpatient renal issue" : "Electrolyte / volume review",
      urineOutput: index % 4 === 0 ? "trend needs review" : "documented",
      preRound: index % 5 === 0 ? "Needs physician review" : "Pre-round brief ready",
    },
    dialysis: {
      active: dialysisEligible,
      mode: dialysisMode,
      longitudinal: true,
      unit: "Synthetic Dialysis Center",
      chair: dialysisMode === "hemodialysis" ? (index % 20) + 1 : null,
      modality: dialysisMode === "hemodialysis" ? "In-center hemodialysis" : "Peritoneal dialysis",
      access: dialysisMode === "hemodialysis"
        ? (index % 2 ? "AV fistula" : "AV graft")
        : "PD catheter",
      attendance: dialysisMode === "hemodialysis"
        ? (index % 4 === 0 ? "1 recent missed treatment" : "no recent missed treatments")
        : "home treatment log available",
      idwg: dialysisMode === "hemodialysis"
        ? (1.4 + (index % 6) * 0.35).toFixed(1) + " kg"
        : null,
      dryWeight: (58 + (index % 18) * 1.7).toFixed(1) + " kg",
      ktv: dialysisMode === "hemodialysis"
        ? (1.2 + (index % 5) * 0.08).toFixed(2)
        : null,
      weeklyKtV: dialysisMode === "peritoneal"
        ? (1.6 + (index % 5) * 0.12).toFixed(2)
        : null,
      ultrafiltration: dialysisMode === "peritoneal"
        ? (700 + (index % 6) * 120) + " mL/day"
        : null,
      exitSite: dialysisMode === "peritoneal"
        ? (index % 4 === 0 ? "needs review" : "clean/dry")
        : null,
      roundStatus: index % 4 === 0 ? "Needs review" : "Ready for round",
    },
    transplant: {
      active: transplantActive,
      phase: p.ckdStage === "5"
        ? (index % 2 ? "Evaluation" : "Waitlist follow-up")
        : "Post-transplant follow-up",
      center: "Synthetic Transplant Program",
      bloodType: ["A", "B", "AB", "O"][index % 4],
      status: index % 5 === 0 ? "Needs review" : "Active follow-up",
      lastMilestone: p.ckdStage === "5"
        ? (index % 2 ? "Education completed" : "Waitlist testing reviewed")
        : "Graft surveillance reviewed",
    },
  };
}

patients.forEach((p, idx) => {
  const index = idx + 1;
  p.problemList = buildProblemList(p, index);
  p.eGFRProgression = buildEgfrProgressionFixture(p, index);
  p.albuminuriaProgression = buildUacrProgressionFixture(p, index);
  p.labs.UACR = {
    value: p.albuminuriaProgression.current,
    unit: "mg/g",
    ref: [0, 29],
    flag: p.albuminuriaProgression.category === "A1" ? "normal" : "high",
  };
  p.labHistory = buildLabHistory(p, index);
  p.labHistory.UACR = {
    unit: "mg/g",
    ref: [0, 29],
    currentFlag: p.labs.UACR.flag,
    values: p.albuminuriaProgression.history.map((point) => ({ ...point })),
  };
  p.combinedCkdProgression = buildCombinedCkdProgressionFixture(p);
  p.kidneyProtectionTimeline = buildKidneyProtectionTimeline(p, index);
  p.longitudinal = buildLongitudinalState(p, index);
  p.contexts = buildContexts(p, index);
});


/* PT-001 is backend-owned after the Supabase migration.
 * Remove the browser fixture after all deterministic fixture generation has
 * completed so the remaining synthetic patient identities stay unchanged.
 */
{
  const backendOwnedIndex = patients.findIndex((patient) => patient.id === "PT-001");
  if (backendOwnedIndex >= 0) patients.splice(backendOwnedIndex, 1);
}
