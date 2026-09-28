/* =========================================================================
 * Nephrology Agentic Harness — Judgment Fabric interfaces
 *
 * v0.1.0 implements deterministic structural judgments only:
 * provenance coverage, state completeness, workspace context, and agent-result
 * identity/grounding checks. It does not make treatment decisions.
 * ========================================================================= */

const JUDGMENT_FABRIC = (() => {
  const VERSION = "0.1.0";

  const REQUIRED_PATHS = [
    ["identity.id", (s) => s.identity && s.identity.id],
    ["identity.name", (s) => s.identity && s.identity.name],
    ["kidney.diagnosis", (s) => s.kidney && s.kidney.diagnosis],
    ["kidney.function.currentEgfr", (s) => s.kidney && s.kidney.function && s.kidney.function.currentEgfr],
    ["electrolytes.potassium", (s) => s.electrolytes && s.electrolytes.potassium],
    ["anemia.hemoglobin", (s) => s.anemia && s.anemia.hemoglobin],
  ];

  function hasValue(node) {
    return Boolean(node && node.value !== null && node.value !== undefined && node.value !== "");
  }

  function hasProvenance(node) {
    return Boolean(
      node &&
      node.provenance &&
      node.provenance.kind &&
      node.provenance.label &&
      node.provenance.field
    );
  }

  function evaluateState(state, workspace) {
    const checks = REQUIRED_PATHS.map(([path, getter]) => {
      const node = getter(state || {});
      return {
        path,
        present: hasValue(node),
        grounded: hasProvenance(node),
      };
    });

    const missing = checks.filter((c) => !c.present).map((c) => c.path);
    const ungrounded = checks.filter((c) => c.present && !c.grounded).map((c) => c.path);
    const episode = state && state.episodes ? state.episodes[workspace] : null;

    return {
      version: VERSION,
      patientId: state ? state.patientId : null,
      workspace,
      grounding: {
        pass: ungrounded.length === 0,
        ungrounded,
      },
      completeness: {
        pass: missing.length === 0,
        missing,
      },
      context: {
        active: Boolean(episode && episode.active),
        workspace,
      },
      openLoops: {
        pending: state && Array.isArray(state.openLoops)
          ? state.openLoops.filter((x) => x.status === "pending").length
          : 0,
      },
      routing: {
        status: missing.length || ungrounded.length ? "state-review" : "ready",
        reason: missing.length
          ? "required-state-missing"
          : ungrounded.length
          ? "required-state-ungrounded"
          : "structural-checks-pass",
      },
    };
  }

  function evaluateAgentResult(state, result) {
    const issues = [];
    if (!state) issues.push("missing-state");
    if (!result) issues.push("missing-agent-result");
    if (state && result && result.patientId !== state.patientId) issues.push("patient-id-mismatch");
    if (result && (!result.body || !String(result.body).trim())) issues.push("empty-agent-body");

    return {
      version: VERSION,
      pass: issues.length === 0,
      issues,
      patientId: state ? state.patientId : null,
    };
  }

  return {
    VERSION,
    evaluateState,
    evaluateAgentResult,
  };
})();

window.JUDGMENT_FABRIC = JUDGMENT_FABRIC;
