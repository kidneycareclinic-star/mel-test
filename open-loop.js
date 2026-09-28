/* =========================================================================
 * Nephrology Agentic Harness — Open-Loop Engine
 *
 * Owns unresolved follow-up lifecycle independently from notes and UI.
 * Demo implementation is in-memory/session-only and seeded from synthetic data.
 * ========================================================================= */

const OPEN_LOOP_ENGINE = (() => {
  const VERSION = "0.1.0";
  const store = new Map();

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function seedPatient(patient) {
    if (!patient || !patient.id) throw new Error("OPEN_LOOP_ENGINE requires a patient id.");
    if (store.has(patient.id)) return;

    const raw = patient.longitudinal && Array.isArray(patient.longitudinal.openLoops)
      ? patient.longitudinal.openLoops
      : [];

    const seeded = raw.map((loop, index) => ({
      id: `${patient.id}-loop-${String(index + 1).padStart(2, "0")}`,
      patientId: patient.id,
      type: loop.type || "task",
      label: loop.label || "Unspecified follow-up",
      status: loop.status === "completed" ? "completed" : "pending",
      owner: "nephrology-team",
      workspace: "shared",
      createdFrom: "synthetic-longitudinal-state",
      createdAt: patient.lastVisit || null,
      completedAt: null,
      history: [{
        event: "seeded",
        at: patient.lastVisit || null,
        actor: "harness",
      }],
    }));

    store.set(patient.id, seeded);
  }

  function list(patient) {
    seedPatient(patient);
    return clone(store.get(patient.id) || []);
  }

  function pending(patient) {
    return list(patient).filter((loop) => loop.status === "pending");
  }

  function nextId(patientId) {
    const loops = store.get(patientId) || [];
    const next = loops.length + 1;
    return `${patientId}-loop-${String(next).padStart(2, "0")}`;
  }

  function create(patient, input = {}) {
    seedPatient(patient);
    const loops = store.get(patient.id);
    const loop = {
      id: nextId(patient.id),
      patientId: patient.id,
      type: input.type || "task",
      label: String(input.label || "Follow-up item").trim() || "Follow-up item",
      status: "pending",
      owner: input.owner || "nephrology-team",
      workspace: input.workspace || "shared",
      createdFrom: input.createdFrom || "physician-demo-input",
      createdAt: input.createdAt || "session",
      completedAt: null,
      history: [{
        event: "created",
        at: input.createdAt || "session",
        actor: input.actor || "physician-demo",
      }],
    };
    loops.push(loop);
    return clone(loop);
  }

  function updateStatus(patient, loopId, status, actor = "physician-demo") {
    seedPatient(patient);
    const loops = store.get(patient.id);
    const loop = loops.find((item) => item.id === loopId);
    if (!loop) return null;

    const normalized = status === "completed" ? "completed" : "pending";
    loop.status = normalized;
    loop.completedAt = normalized === "completed" ? "session" : null;
    loop.history.push({
      event: normalized === "completed" ? "completed" : "reopened",
      at: "session",
      actor,
    });
    return clone(loop);
  }

  function complete(patient, loopId, actor) {
    return updateStatus(patient, loopId, "completed", actor);
  }

  function reopen(patient, loopId, actor) {
    return updateStatus(patient, loopId, "pending", actor);
  }

  function summary(patient) {
    const loops = list(patient);
    return {
      total: loops.length,
      pending: loops.filter((x) => x.status === "pending").length,
      completed: loops.filter((x) => x.status === "completed").length,
    };
  }

  function resetPatient(patient) {
    if (patient && patient.id) store.delete(patient.id);
    seedPatient(patient);
    return list(patient);
  }

  return {
    VERSION,
    list,
    pending,
    create,
    complete,
    reopen,
    summary,
    resetPatient,
  };
})();

window.OPEN_LOOP_ENGINE = OPEN_LOOP_ENGINE;
