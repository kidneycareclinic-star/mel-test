import { jsonObject, patientState } from "./json-boundary.ts";
import postgres from "postgres";
import { clinician, patientAccess, authFailure, AccessError } from "./clinician-auth.ts";

const dbUrl = Deno.env.get("SUPABASE_DB_URL");
if (!dbUrl) throw new Error("SUPABASE_DB_URL is not configured");
const sql = postgres(dbUrl, { prepare: false, max: 1 });

const API_VERSION = "astra-review-v1-clinician-gated";
const MODEL = "gpt-6-astra";
const SERVICE_TIER = "ultrafast";

function allowed(origin: string | null) {
  if (!origin) return null;
  if (origin === "https://kidneycareclinic-star.github.io") return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}

function reply(body: unknown, status = 200, origin: string | null = null) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  const accepted = allowed(origin);
  if (accepted) {
    headers.set("Access-Control-Allow-Origin", accepted);
    headers.set("Vary", "Origin");
  }
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type");
  return new Response(JSON.stringify(body), { status, headers });
}

function workspaceName(workspace: string) {
  return workspace === "ckd" ? "office" : workspace;
}

function buildContext(externalId: string, workspace: string, stateVersion: number, state: any) {
  return {
    synthetic: true,
    patientId: externalId,
    stateVersion,
    workspace,
    diagnosis: state?.diagnosis ?? null,
    ckdStage: state?.ckdStage ?? null,
    labs: state?.labs ?? {},
    medications: Array.isArray(state?.meds) ? state.meds : [],
    problems: Array.isArray(state?.problems) ? state.problems : [],
    workspaceContext: workspace === "ckd"
      ? (state?.contexts?.office ?? {})
      : (state?.contexts?.[workspace] ?? {}),
    longitudinal: {
      openLoops: state?.longitudinal?.openLoops ?? [],
      bpVolume: state?.longitudinal?.bpVolume ?? null
    }
  };
}

const reviewSchema = {
  type: "object",
  properties: {
    summary: { type: "string", minLength: 1, maxLength: 1200 },
    signals: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          title: { type: "string", minLength: 1, maxLength: 160 },
          evidence: { type: "string", minLength: 1, maxLength: 500 },
          priority: { type: "string", enum: ["routine", "attention", "urgent"] }
        },
        required: ["title", "evidence", "priority"],
        additionalProperties: false
      }
    },
    proposal: {
      type: "object",
      properties: {
        shouldCreateOpenLoop: { type: "boolean" },
        label: { type: "string", maxLength: 180 },
        reason: { type: "string", maxLength: 500 },
        workspace: { type: "string", enum: ["office", "dialysis", "hospital"] }
      },
      required: ["shouldCreateOpenLoop", "label", "reason", "workspace"],
      additionalProperties: false
    },
    limitations: {
      type: "array",
      maxItems: 6,
      items: { type: "string", minLength: 1, maxLength: 400 }
    }
  },
  required: ["summary", "signals", "proposal", "limitations"],
  additionalProperties: false
};

function outputText(payload: any) {
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    if (item?.type !== "message") continue;
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

function validReview(value: any) {
  return value && typeof value === "object" &&
    typeof value.summary === "string" &&
    Array.isArray(value.signals) &&
    value.proposal && typeof value.proposal === "object" &&
    typeof value.proposal.shouldCreateOpenLoop === "boolean" &&
    typeof value.proposal.label === "string" &&
    typeof value.proposal.reason === "string" &&
    ["office", "dialysis", "hospital"].includes(String(value.proposal.workspace)) &&
    Array.isArray(value.limitations);
}

async function markFailed(runId: string, patientId: string, code: string, httpStatus: number | null, requestId: string | null, latencyMs: number | null) {
  await sql.begin(async (tx: any) => {
    const errorPayload = { code, httpStatus, requestId, latencyMs };
    const eventPayload = { runId, model: MODEL, serviceTierRequested: SERVICE_TIER, code, httpStatus, requestId, latencyMs };
    await tx`
      update ehr.agent_run
      set status='failed',
          completed_at=now(),
          model_provider='openai',
          model_name=${MODEL},
          error=${tx.json(errorPayload)}
      where id=${runId}::uuid
    `;
    await tx`
      insert into ehr.event(patient_id,event_type,actor_type,actor_id,source,status,payload)
      values(
        ${patientId}::uuid,
        'AGENT_RUN_FAILED',
        'agent',
        ${runId},
        'astra-review',
        'failed',
        ${tx.json(eventPayload)}
      )
    `;
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin && !allowed(origin)) return reply({ apiVersion: API_VERSION, error: "origin_not_allowed" }, 403, origin);
  if (req.method === "OPTIONS") return reply({ apiVersion: API_VERSION, ok: true }, 200, origin);
  if (req.method !== "POST") return reply({ apiVersion: API_VERSION, error: "method_not_allowed" }, 405, origin);

  const body = await req.json().catch(() => null);
  const externalId = String(body?.patientId || "");
  const workspace = String(body?.workspace || "ckd").toLowerCase();
  const encounterId=body?.encounterId||null;
  if(encounterId!==null&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(encounterId))return reply({error:"invalid_encounter"},400,origin);
  const testApprovalPath = body?.testApprovalPath === true;
  if (!/^PT-\d{3}$/.test(externalId)) return reply({ apiVersion: API_VERSION, error: "invalid_patient" }, 400, origin);
  if (!["ckd", "dialysis", "hospital"].includes(workspace)) return reply({ apiVersion: API_VERSION, error: "invalid_workspace" }, 400, origin);

  try {
    const person = await clinician(req, sql);
    await patientAccess(sql, person, externalId, workspaceName(workspace), "agent.review");

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return reply({
        apiVersion: API_VERSION,
        error: "openai_key_not_configured",
        diagnostics: {
          openaiApiKeyPresent: false,
          supabaseUrlPresent: Boolean(Deno.env.get("SUPABASE_URL")),
          supabaseDbUrlPresent: Boolean(Deno.env.get("SUPABASE_DB_URL")),
          deploymentIdPresent: Boolean(Deno.env.get("DENO_DEPLOYMENT_ID"))
        }
      }, 503, origin);
    }

    const patient = await sql.unsafe(
      "select id,display_name,synthetic from ehr.patient where external_id=$1 and active=true limit 1",
      [externalId]
    );
    if (!patient.length || patient[0].synthetic !== true) throw new AccessError(404, "synthetic_patient_not_found");
    const patientId = String(patient[0].id);

    if(encounterId){
      const encounter=await sql.unsafe("select id from ehr.synthetic_encounter where id=$1::uuid and patient_id=$2::uuid and clinician_principal_id=$3::uuid and status='draft'",[encounterId,patientId,person.id]);
      if(!encounter.length)throw new AccessError(409,"encounter_draft_not_found");
    }
    const states = await sql.unsafe(
      "select state_version,state::text as state_text from ehr.patient_state where patient_id=$1::uuid order by state_version desc limit 1",
      [patientId]
    );
    if (!states.length) throw new AccessError(404, "patient_state_not_found");
    const stateVersion = Number(states[0].state_version);
    const state = patientState(states[0].state_text,externalId);
    const context = buildContext(externalId, workspace, stateVersion, state);

    const inputSnapshot = { encounterId, patientId: externalId, stateVersion, workspace, synthetic: true, serviceTierRequested: SERVICE_TIER, testApprovalPath };
    const started = await sql`
      insert into ehr.agent_run(
        patient_id,agent_name,agent_version,run_type,status,input_snapshot,model_provider,model_name
      )
      values(
        ${patientId}::uuid,
        ${workspace + "-astra-review-agent"},
        '1.0.0',
        'astra-ultrafast-review',
        'started',
        ${sql.json(inputSnapshot)},
        'openai',
        ${MODEL}
      )
      returning id,started_at
    `;
    const runId = String(started[0].id);

    const instructions = [
      "You are a nephrology review agent operating ONLY on synthetic test data.",
      "Use only the supplied canonical Patient State context. Never invent missing values.",
      "Return a concise clinician-facing review, not a patient-facing message.",
      "Do not execute or imply execution of orders, medications, scheduling, or external actions.",
      "If follow-up tracking would help, you may propose ONE low-risk internal open loop only.",
      "If no open loop is needed, set shouldCreateOpenLoop=false and use empty label and reason.",
      "Every proposed action requires physician review before it can affect Patient State."
    ].join(" ");

    const requestBody = {
      model: MODEL,
      service_tier: SERVICE_TIER,
      store: false,
      max_output_tokens: 1200,
      instructions,
      input: "Review this synthetic canonical Patient State context:\n" + JSON.stringify(context),
      text: {
        format: {
          type: "json_schema",
          name: "nephrology_workspace_review",
          strict: true,
          schema: reviewSchema
        }
      }
    };

    const startedAt = performance.now();
    let openaiResponse: Response;
    try {
      openaiResponse = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + openaiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(45000)
      });
    } catch (_) {
      const latencyMs = Math.round(performance.now() - startedAt);
      await markFailed(runId, patientId, "openai_unavailable", null, null, latencyMs);
      throw new AccessError(502, "openai_unavailable");
    }

    const latencyMs = Math.round(performance.now() - startedAt);
    const requestId = openaiResponse.headers.get("x-request-id");
    const payload = await openaiResponse.json().catch(() => null);

    if (!openaiResponse.ok) {
      await markFailed(runId, patientId, "openai_request_failed", openaiResponse.status, requestId, latencyMs);
      throw new AccessError(502, "openai_request_failed");
    }

    const text = outputText(payload);
    let review: any;
    try {
      review = JSON.parse(text);
    } catch (_) {
      await markFailed(runId, patientId, "structured_output_parse_failed", openaiResponse.status, requestId, latencyMs);
      throw new AccessError(502, "structured_output_parse_failed");
    }
    if (!validReview(review)) {
      await markFailed(runId, patientId, "structured_output_invalid", openaiResponse.status, requestId, latencyMs);
      throw new AccessError(502, "structured_output_invalid");
    }

    if (testApprovalPath) {
      review.proposal = {
        shouldCreateOpenLoop: true,
        label: "Synthetic Astra approval-path verification",
        reason: "Synthetic test-only open loop to verify physician approval, audit, and Patient State versioning. No external action.",
        workspace: workspaceName(workspace)
      };
    }

    const actualTier = String(payload?.service_tier || "unknown");
    const telemetry = {
      model: String(payload?.model || MODEL),
      serviceTierRequested: SERVICE_TIER,
      serviceTierActual: actualTier,
      ultrafastVerified: actualTier === SERVICE_TIER,
      latencyMs,
      openaiRequestId: requestId,
      openaiResponseId: String(payload?.id || ""),
      usage: payload?.usage || null,
      store: false
    };

    let result:any;
    try { result = await sql.begin(async (tx: any) => {
      const completedOutput = { review, telemetry };
      if(encounterId){
        await tx.unsafe("select id from ehr.patient where id=$1::uuid for update",[patientId]);
        const e=await tx.unsafe("select id from ehr.synthetic_encounter where id=$1::uuid and patient_id=$2::uuid and clinician_principal_id=$3::uuid and status='draft' for update",[encounterId,patientId,person.id]);
        if(!e.length)throw new AccessError(409,"encounter_draft_not_found");
        await tx.unsafe("insert into ehr.encounter_review(patient_id,encounter_id,run_id,base_state_version,generated_content) values($1::uuid,$2::uuid,$3::uuid,$4,$5::text::jsonb)",[patientId,encounterId,runId,stateVersion,JSON.stringify(completedOutput)]);
      }
      const completed = await tx`
        update ehr.agent_run
        set status='completed',
            output=${tx.json(completedOutput)},
            model_provider='openai',
            model_name=${MODEL},
            completed_at=now()
        where id=${runId}::uuid
        returning completed_at
      `;

      const completedEventPayload = { encounterId, runId, workspace, stateVersion, ...telemetry };
      const event = await tx`
        insert into ehr.event(patient_id,event_type,actor_type,actor_id,source,status,payload)
        values(
          ${patientId}::uuid,
          'AGENT_RUN_COMPLETED',
          'agent',
          ${runId},
          'astra-review',
          'recorded',
          ${tx.json(completedEventPayload)}
        )
        returning id
      `;

      let proposedAction: any = null;
      if (review.proposal.shouldCreateOpenLoop === true && review.proposal.label.trim()) {
        const toolInput = {
          label: review.proposal.label.trim().slice(0, 180),
          loopType: "astra-review",
          workspace: review.proposal.workspace,
          agentType: "astra-ultrafast",
          reason: review.proposal.reason.trim().slice(0, 500),
          encounterId,
          baseStateVersion: stateVersion,
          externalExecution: false,
          testOnly: testApprovalPath
        };
        const tool = await tx`
          insert into ehr.tool_call(
            agent_run_id,patient_id,tool_name,risk_level,requires_approval,status,input,prepared_event_id
          )
          values(
            ${runId}::uuid,
            ${patientId}::uuid,
            'create_open_loop',
            'low',
            true,
            'awaiting_approval',
            ${tx.json(toolInput)},
            ${event[0].id}::uuid
          )
          returning id
        `;
        proposedAction = {
          toolCallId: tool[0].id,
          label: review.proposal.label.trim().slice(0, 180),
          status: "awaiting_approval",
          externalExecution: false,
          baseStateVersion: stateVersion
        };
      }

      return {
        runId,
        eventId: event[0].id,
        completedAt: completed[0].completed_at,
        proposedAction
      };
    });

    } catch(error) {
      await markFailed(runId,patientId,"encounter_review_save_failed",null,requestId,latencyMs);
      throw error;
    }
    return reply({
      apiVersion: API_VERSION,
      mode: "astra-review",
      workspace,
      stateVersion,
      summary: review.summary,
      signals: review.signals,
      limitations: review.limitations,
      testApprovalPath,
      telemetry,
      ...result
    }, 200, origin);
  } catch (error) {
    const denied = authFailure(error);
    return reply({ apiVersion: API_VERSION, error: denied?.code || String((error as any)?.message || error) }, denied?.status || 400, origin);
  }
});

