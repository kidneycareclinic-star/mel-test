// Postgres.js can return JSONB as an object or as serialized text.
// Decode once, validate, and fail closed; never silently replace corrupt state.
export function jsonObject(value: unknown, label = "json"): any {
  const decoded = typeof value === "string" ? JSON.parse(value) : value;
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new Error(label + "_invalid_shape");
  }
  return decoded;
}

export function patientState(value: unknown, externalId: string): any {
  const state = jsonObject(value, "patient_state");
  if (state.id !== externalId) throw new Error("patient_state_identity_mismatch");
  for (const key of ["labs", "contexts", "longitudinal", "scribeObservations"]) {
    if (state[key] != null && (typeof state[key] !== "object" || Array.isArray(state[key]))) throw new Error("patient_state_" + key + "_invalid_shape");
  }
  for (const key of ["meds", "problemList"]) {
    if (state[key] != null && !Array.isArray(state[key])) throw new Error("patient_state_" + key + "_invalid_shape");
  }
  return state;
}
