/* =========================================================================
 * Nephrology Agentic Harness — canonical Patient State Engine
 *
 * Purpose:
 *   raw synthetic patient record -> normalized shared patient state
 *
 * The engine does not prescribe treatment. It normalizes identity, longitudinal
 * renal state, care-setting episodes, open loops, and provenance so every
 * workspace and agent consumes the same clinical representation.
 * ========================================================================= */

const PATIENT_STATE_ENGINE = (() => {
  const VERSION = "0.3.0";

  function source(kind, label, field, observedAt, confidence = 1) {
    return {
      kind,
      label,
      field,
      observedAt: observedAt || null,
      confidence,
    };
  }

  function node(value, provenance, extra = {}) {
    return {
      value,
      provenance,
      ...extra,
    };
  }

  function latestTrajectoryDate(trajectory) {
    if (!Array.isArray(trajectory) || !trajectory.length) return null;
    return trajectory[trajectory.length - 1].date || null;
  }

  function normalizeOpenLoops(patient, rawLoops) {
    const liveLoops = (typeof OPEN_LOOP_ENGINE !== "undefined")
      ? OPEN_LOOP_ENGINE.list(patient)
      : (rawLoops || []).map((loop, index) => ({
          id: `${patient.id}-loop-${String(index + 1).padStart(2, "0")}`,
          patientId: patient.id,
          type: loop.type || "task",
          label: loop.label || "Unspecified follow-up",
          status: loop.status || "pending",
          owner: "nephrology-team",
          workspace: "shared",
          createdFrom: "synthetic-longitudinal-state",
          createdAt: patient.lastVisit || null,
          completedAt: null,
          history: [],
        }));

    return liveLoops.map((loop) => ({
      ...loop,
      source: source(
        "open-loop-engine",
        "Open-Loop Engine",
        loop.id,
        loop.createdAt || patient.lastVisit,
        1
      ),
    }));
  }

  function normalizeEpisode(patient, key, raw) {
    const active = Boolean(raw && raw.active);
    return {
      workspace: key,
      active,
      patientId: patient.id,
      data: raw ? { ...raw } : {},
      provenance: source(
        "synthetic-context",
        `${key} context`,
        key,
        patient.lastVisit,
        1
      ),
    };
  }

  function build(patient) {
    if (!patient || !patient.id) {
      throw new Error("PATIENT_STATE_ENGINE.build requires a patient with an id.");
    }

    const longitudinal = patient.longitudinal || {};
    const kidney = longitudinal.kidney || {};
    const proteinuria = longitudinal.proteinuria || {};
    const bpVolume = longitudinal.bpVolume || {};
    const electrolytes = longitudinal.electrolytes || {};
    const anemia = longitudinal.anemia || {};
    const ckdMbd = longitudinal.ckdMbd || {};
    const kidneyProtection = longitudinal.kidneyProtection || {};

    const egfrLab = patient.labs && patient.labs.eGFR;
    const upcrLab = patient.labs && patient.labs.UPCR;
    const potassiumLab = patient.labs && patient.labs.Potassium;
    const bicarbonateLab = patient.labs && patient.labs.Bicarbonate;
    const hemoglobinLab = patient.labs && patient.labs.Hemoglobin;
    const phosphateLab = patient.labs && patient.labs.Phosphate;
    const pthLab = patient.labs && patient.labs.PTH;

    const trajectory = Array.isArray(kidney.trajectory)
      ? kidney.trajectory.map((point) => ({
          date: point.date,
          value: point.value,
          provenance: source(
            "synthetic-longitudinal-lab",
            "Synthetic eGFR history",
            "eGFR",
            point.date,
            1
          ),
        }))
      : [];

    const proteinTrajectory = Array.isArray(proteinuria.trajectory)
      ? proteinuria.trajectory.map((value, index) => ({
          sequence: index + 1,
          value,
          provenance: source(
            "synthetic-longitudinal-lab",
            "Synthetic proteinuria history",
            "UPCR",
            null,
            1
          ),
        }))
      : [];

    const openLoops = normalizeOpenLoops(patient, longitudinal.openLoops);

    return {
      engineVersion: VERSION,
      patientId: patient.id,

      identity: {
        id: node(
          patient.id,
          source("synthetic-demographics", "Synthetic master patient record", "id", null, 1)
        ),
        name: node(
          patient.name,
          source("synthetic-demographics", "Synthetic master patient record", "name", null, 1)
        ),
        age: node(
          patient.age,
          source("synthetic-demographics", "Synthetic master patient record", "age", null, 1)
        ),
        sex: node(
          patient.sex,
          source("synthetic-demographics", "Synthetic master patient record", "sex", null, 1)
        ),
        ethnicity: node(
          patient.ethnicity,
          source("synthetic-demographics", "Synthetic master patient record", "ethnicity", null, 1)
        ),
      },

      kidney: {
        diagnosis: node(
          patient.diagnosis,
          source("synthetic-problem-list", "Synthetic problem list", "diagnosis", patient.lastVisit, 1)
        ),
        stage: node(
          patient.ckdStage,
          source("synthetic-problem-list", "Synthetic problem list", "ckdStage", patient.lastVisit, 1)
        ),
        function: {
          currentEgfr: node(
            kidney.currentEgfr ?? (egfrLab ? egfrLab.value : null),
            source("synthetic-lab", "Latest synthetic lab panel", "eGFR", latestTrajectoryDate(trajectory), 1),
            { flag: egfrLab ? egfrLab.flag : "unknown" }
          ),
          trajectory,
          trajectoryLabel: node(
            kidney.trajectoryLabel || "unknown",
            source("synthetic-derived-state", "Synthetic longitudinal state generator", "trajectoryLabel", latestTrajectoryDate(trajectory), 1)
          ),
        },
        proteinuria: {
          current: node(
            proteinuria.current ?? (upcrLab ? upcrLab.value : null),
            source("synthetic-lab", "Latest synthetic lab panel", "UPCR", patient.lastVisit, 1),
            { flag: upcrLab ? upcrLab.flag : "unknown" }
          ),
          trajectory: proteinTrajectory,
        },
      },

      bpVolume: {
        latestBp: node(
          bpVolume.latestBp || null,
          source("synthetic-office-observation", "Synthetic office observation", "bloodPressure", patient.lastVisit, 1)
        ),
        edema: node(
          bpVolume.edema || "not documented",
          source("synthetic-exam", "Synthetic volume-status observation", "edema", patient.lastVisit, 1)
        ),
        weightTrend: node(
          bpVolume.weightTrend || "unknown",
          source("synthetic-derived-state", "Synthetic longitudinal state generator", "weightTrend", patient.lastVisit, 1)
        ),
      },

      electrolytes: {
        potassium: node(
          electrolytes.potassium ?? (potassiumLab ? potassiumLab.value : null),
          source("synthetic-lab", "Latest synthetic lab panel", "Potassium", patient.lastVisit, 1),
          { flag: potassiumLab ? potassiumLab.flag : "unknown" }
        ),
        bicarbonate: node(
          electrolytes.bicarbonate ?? (bicarbonateLab ? bicarbonateLab.value : null),
          source("synthetic-lab", "Latest synthetic lab panel", "Bicarbonate", patient.lastVisit, 1),
          { flag: bicarbonateLab ? bicarbonateLab.flag : "unknown" }
        ),
        status: node(
          electrolytes.status || "unknown",
          source("synthetic-derived-state", "Synthetic longitudinal state generator", "electrolyteStatus", patient.lastVisit, 1)
        ),
      },

      anemia: {
        hemoglobin: node(
          anemia.hemoglobin ?? (hemoglobinLab ? hemoglobinLab.value : null),
          source("synthetic-lab", "Latest synthetic lab panel", "Hemoglobin", patient.lastVisit, 1),
          { flag: hemoglobinLab ? hemoglobinLab.flag : "unknown" }
        ),
        status: node(
          anemia.status || "unknown",
          source("synthetic-derived-state", "Synthetic longitudinal state generator", "anemiaStatus", patient.lastVisit, 1)
        ),
      },

      ckdMbd: {
        phosphate: node(
          ckdMbd.phosphate ?? (phosphateLab ? phosphateLab.value : null),
          source("synthetic-lab", "Latest synthetic lab panel", "Phosphate", patient.lastVisit, 1),
          { flag: phosphateLab ? phosphateLab.flag : "unknown" }
        ),
        pth: node(
          ckdMbd.pth ?? (pthLab ? pthLab.value : null),
          source("synthetic-lab", "Latest synthetic lab panel", "PTH", patient.lastVisit, 1),
          { flag: pthLab ? pthLab.flag : "unknown" }
        ),
        status: node(
          ckdMbd.status || "unknown",
          source("synthetic-derived-state", "Synthetic longitudinal state generator", "ckdMbdStatus", patient.lastVisit, 1)
        ),
      },

      kidneyProtection: {
        raas: node(
          Boolean(kidneyProtection.raas),
          source("synthetic-medication-list", "Synthetic active medication list", "RAAS", patient.lastVisit, 1)
        ),
        sglt2: node(
          Boolean(kidneyProtection.sglt2),
          source("synthetic-medication-list", "Synthetic active medication list", "SGLT2i", patient.lastVisit, 1)
        ),
        nsaidExposure: node(
          Boolean(kidneyProtection.nsaidExposure),
          source("synthetic-medication-list", "Synthetic active medication list", "NSAID", patient.lastVisit, 1)
        ),
      },

      problemList: (patient.problemList || []).map((problem) => ({
        ...problem,
        provenance: source(
          "synthetic-problem-list",
          "Synthetic active problem list",
          problem.code || problem.name,
          patient.lastVisit,
          1
        ),
      })),

      medications: {
        active: (patient.meds || []).map((name) => ({
          name,
          provenance: source(
            "synthetic-medication-list",
            "Synthetic active medication list",
            name,
            patient.lastVisit,
            1
          ),
        })),
      },

      episodes: {
        office: normalizeEpisode(patient, "office", patient.contexts && patient.contexts.office),
        hospital: normalizeEpisode(patient, "hospital", patient.contexts && patient.contexts.hospital),
        dialysis: normalizeEpisode(patient, "dialysis", patient.contexts && patient.contexts.dialysis),
      },

      openLoops,

      provenanceSummary: {
        syntheticOnly: true,
        sourceKinds: [
          "synthetic-demographics",
          "synthetic-problem-list",
          "synthetic-lab",
          "synthetic-medication-list",
          "synthetic-context",
          "synthetic-derived-state",
        ],
      },
    };
  }

  function activeInWorkspace(state, workspace) {
    return Boolean(
      state &&
      state.episodes &&
      state.episodes[workspace] &&
      state.episodes[workspace].active
    );
  }

  function workspaceContext(state, workspace) {
    if (!state || !state.episodes) return null;
    return state.episodes[workspace] || null;
  }

  function openLoops(state, status = null) {
    const loops = state && Array.isArray(state.openLoops) ? state.openLoops : [];
    return status ? loops.filter((loop) => loop.status === status) : loops.slice();
  }

  function provenanceOf(nodeValue) {
    return nodeValue && nodeValue.provenance ? nodeValue.provenance : null;
  }

  return {
    VERSION,
    build,
    activeInWorkspace,
    workspaceContext,
    openLoops,
    provenanceOf,
  };
})();

window.PATIENT_STATE_ENGINE = PATIENT_STATE_ENGINE;
