import postgres from "npm:postgres@3.4.7";
import { clinician, patientAccess, authFailure } from "./clinician-auth.ts";

const dbUrl = Deno.env.get("SUPABASE_DB_URL");
if (!dbUrl) throw new Error("SUPABASE_DB_URL is not configured");
const sql = postgres(dbUrl, { prepare: false, max: 1 });

function allowedOrigin(origin: string | null) {
  if (!origin) return null;
  if (origin === "https://kidneycareclinic-star.github.io") return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}

function response(body: unknown, status = 200, origin: string | null = null) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  const allowed = allowedOrigin(origin);
  if (allowed) {
    headers.set("Access-Control-Allow-Origin", allowed);
    headers.set("Vary", "Origin");
  }
  headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type");
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin && !allowedOrigin(origin)) return response({ error: "origin_not_allowed" }, 403, origin);
  if (req.method === "OPTIONS") return response({ ok: true }, 200, origin);
  if (req.method !== "GET") return response({ error: "method_not_allowed" }, 405, origin);

  const url = new URL(req.url);
  const patientExternalId = String(url.searchParams.get("patient_id") || "");
  const limitRaw = Number(url.searchParams.get("limit") || "50");
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), 100);
  if (!/^PT-\d{3}$/.test(patientExternalId)) return response({ error: "invalid_patient_id" }, 400, origin);

  try {
    const person = await clinician(req, sql);
    await patientAccess(sql, person, patientExternalId, "office", "patient.read");
    const patientRows = await sql.unsafe(
      "select id, external_id, display_name, synthetic from ehr.patient where external_id=$1 limit 1",
      [patientExternalId]
    );
    if (!patientRows.length || patientRows[0].synthetic !== true) {
      return response({ error: "synthetic_patient_not_found" }, 404, origin);
    }
    const patient = patientRows[0];

    const eventRows = await sql.unsafe([
      "select",
      "  e.id, e.event_type, e.actor_type, e.actor_id, e.source, e.status, e.payload, e.created_at,",
      "  p.id as provenance_id, p.source_kind, p.source_label, p.source_system, p.source_reference,",
      "  p.observed_at as provenance_observed_at, p.recorded_at as provenance_recorded_at,",
      "  p.actor_type as provenance_actor_type, p.actor_id as provenance_actor_id,",
      "  p.confidence, p.certainty, p.raw_payload",
      "from ehr.event e",
      "left join ehr.provenance p on p.id=e.provenance_id",
      "where e.patient_id=$1",
      "order by e.created_at desc",
      "limit $2"
    ].join("\n"), [patient.id, limit]);

    const eventIds = eventRows.map((row: any) => row.id);
    let observationRows: any[] = [];
    let stateRows: any[] = [];
    let toolRows: any[] = [];
    let approvalRows: any[] = [];
    let openLoopRows: any[] = [];
    let agentRows: any[] = [];
    if (eventIds.length) {
      observationRows = await sql.unsafe([
        "select id, source_event_id, observation_type, display, value_numeric, value_text, value_json, unit,",
        "       interpretation, status, observed_at, recorded_at, client_record_id",
        "from ehr.clinical_observation",
        "where source_event_id = any($1::uuid[])",
        "order by recorded_at, observation_type"
      ].join("\n"), [eventIds]);

      stateRows = await sql.unsafe([
        "select id, source_event_id, state_version, generated_at, engine_version",
        "from ehr.patient_state",
        "where source_event_id = any($1::uuid[])",
        "order by state_version"
      ].join("\n"), [eventIds]);

      toolRows = await sql.unsafe([
        "select id,agent_run_id,tool_name,risk_level,requires_approval,status,input,output,prepared_event_id,executed_event_id,created_at,executed_at",
        "from ehr.tool_call",
        "where prepared_event_id = any($1::uuid[]) or executed_event_id = any($1::uuid[])"
      ].join("\n"), [eventIds]);

      approvalRows = await sql.unsafe([
        "select id,tool_call_id,decision,decided_by_type,decided_by_id,rationale,event_id,decided_at",
        "from ehr.approval where event_id = any($1::uuid[])"
      ].join("\n"), [eventIds]);

      openLoopRows = await sql.unsafe([
        "select id,label,loop_type,workspace,status,created_from_event_id,completed_by_event_id,created_at,completed_at",
        "from ehr.open_loop",
        "where created_from_event_id = any($1::uuid[]) or completed_by_event_id = any($1::uuid[])"
      ].join("\n"), [eventIds]);

      const actorRunIds = eventRows
        .filter((row:any)=>row.actor_type==="agent" && row.actor_id)
        .map((row:any)=>String(row.actor_id))
        .filter((id:string)=>/^[0-9a-f-]{36}$/i.test(id));

      if (actorRunIds.length) {
        agentRows = await sql.unsafe([
          "select id,agent_name,agent_version,run_type,status,input_snapshot,output,model_provider,model_name,started_at,completed_at",
          "from ehr.agent_run where id = any($1::uuid[])"
        ].join("\n"), [actorRunIds]);
      }
    }

    const observationsByEvent = new Map<string, any[]>();
    for (const row of observationRows) {
      const key = String(row.source_event_id);
      if (!observationsByEvent.has(key)) observationsByEvent.set(key, []);
      observationsByEvent.get(key)!.push({
        observationId: row.id,
        field: row.observation_type,
        display: row.display,
        valueNumeric: row.value_numeric == null ? null : Number(row.value_numeric),
        valueText: row.value_text,
        valueJson: row.value_json,
        unit: row.unit,
        interpretation: row.interpretation,
        status: row.status,
        observedAt: row.observed_at,
        recordedAt: row.recorded_at,
        clientRecordId: row.client_record_id
      });
    }

    const statesByEvent = new Map<string, any[]>();
    for (const row of stateRows) {
      const key = String(row.source_event_id);
      if (!statesByEvent.has(key)) statesByEvent.set(key, []);
      statesByEvent.get(key)!.push({
        patientStateId: row.id,
        stateVersion: Number(row.state_version),
        generatedAt: row.generated_at,
        engineVersion: row.engine_version
      });
    }

    const toolsByEvent = new Map<string, any[]>();
    for (const row of toolRows) {
      const keys = [row.prepared_event_id, row.executed_event_id].filter(Boolean).map(String);
      for (const key of keys) {
        if (!toolsByEvent.has(key)) toolsByEvent.set(key, []);
        toolsByEvent.get(key)!.push({
          toolCallId: row.id,
          agentRunId: row.agent_run_id,
          toolName: row.tool_name,
          riskLevel: row.risk_level,
          requiresApproval: row.requires_approval,
          status: row.status,
          input: row.input || {},
          output: row.output || null,
          createdAt: row.created_at,
          executedAt: row.executed_at
        });
      }
    }

    const approvalsByEvent = new Map<string, any[]>();
    for (const row of approvalRows) {
      const key = String(row.event_id);
      if (!approvalsByEvent.has(key)) approvalsByEvent.set(key, []);
      approvalsByEvent.get(key)!.push({
        approvalId: row.id,
        toolCallId: row.tool_call_id,
        decision: row.decision,
        decidedByType: row.decided_by_type,
        decidedById: row.decided_by_id,
        rationale: row.rationale,
        decidedAt: row.decided_at
      });
    }

    const loopsByEvent = new Map<string, any[]>();
    for (const row of openLoopRows) {
      for (const rawKey of [row.created_from_event_id, row.completed_by_event_id]) {
        if (!rawKey) continue;
        const key = String(rawKey);
        if (!loopsByEvent.has(key)) loopsByEvent.set(key, []);
        loopsByEvent.get(key)!.push({
          openLoopId: row.id,
          label: row.label,
          loopType: row.loop_type,
          workspace: row.workspace,
          status: row.status,
          createdAt: row.created_at,
          completedAt: row.completed_at
        });
      }
    }

    const agentById = new Map<string, any>();
    for (const row of agentRows) {
      agentById.set(String(row.id), {
        runId: row.id,
        agentName: row.agent_name,
        agentVersion: row.agent_version,
        runType: row.run_type,
        status: row.status,
        inputSnapshot: row.input_snapshot || {},
        output: row.output || {},
        modelProvider: row.model_provider,
        modelName: row.model_name,
        startedAt: row.started_at,
        completedAt: row.completed_at
      });
    }

    const events = eventRows.map((row: any) => {
      const rawPayload = row.raw_payload || {};
      return {
        eventId: row.id,
        eventType: row.event_type,
        actorType: row.actor_type,
        actorId: row.actor_id,
        source: row.source,
        status: row.status,
        createdAt: row.created_at,
        payload: row.payload || {},
        heard: {
          rawTranscript: rawPayload.rawTranscript || null,
          reviewedTranscript: rawPayload.reviewedTranscript || null
        },
        provenance: row.provenance_id ? {
          provenanceId: row.provenance_id,
          sourceKind: row.source_kind,
          sourceLabel: row.source_label,
          sourceSystem: row.source_system,
          sourceReference: row.source_reference,
          observedAt: row.provenance_observed_at,
          recordedAt: row.provenance_recorded_at,
          actorType: row.provenance_actor_type,
          actorId: row.provenance_actor_id,
          confidence: row.confidence == null ? null : Number(row.confidence),
          certainty: row.certainty
        } : null,
        acceptedObservations: observationsByEvent.get(String(row.id)) || [],
        resultingStates: statesByEvent.get(String(row.id)) || [],
        agentRun: row.actor_type === "agent" && row.actor_id ? (agentById.get(String(row.actor_id)) || null) : null,
        toolCalls: toolsByEvent.get(String(row.id)) || [],
        approvals: approvalsByEvent.get(String(row.id)) || [],
        openLoops: loopsByEvent.get(String(row.id)) || []
      };
    });

    const latestState = await sql.unsafe(
      "select state_version, generated_at, engine_version from ehr.patient_state where patient_id=$1 order by state_version desc limit 1",
      [patient.id]
    );

    return response({
      source: "supabase-postgresql",
      patient: { externalId: patient.external_id, displayName: patient.display_name },
      latestState: latestState.length ? {
        stateVersion: Number(latestState[0].state_version),
        generatedAt: latestState[0].generated_at,
        engineVersion: latestState[0].engine_version
      } : null,
      eventCount: events.length,
      events
    }, 200, origin);
  } catch (error) {
    const denied = authFailure(error);
    if (denied) return response({ error: denied.code }, denied.status, origin);
    return response({ error: String(error?.message || error) }, 400, origin);
  }
});
