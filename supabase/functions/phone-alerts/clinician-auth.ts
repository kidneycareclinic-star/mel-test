// Shared by the synthetic-only Edge Functions. A valid anon JWT is NOT a clinician session.
export class AccessError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

type Conn = { unsafe: (query: string, values?: unknown[]) => Promise<any[]> };
export type Clinician = { id: string; externalId: string; role?: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const workspaceNames = new Set(["office", "hospital", "dialysis"]);
const actions = new Set(["patient.read", "scribe.review", "agent.review", "tool.prepare", "tool.approve.low", "encounter.draft", "encounter.sign"]);

export async function clinician(req: Request, conn: Conn): Promise<Clinician> {
  const header = req.headers.get("authorization") || "";
  const match = /^Bearer ([^\s]{1,8192})$/i.exec(header);
  if (!match) throw new AccessError(401, "clinician_session_required");
  const base = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!base || !key) throw new AccessError(503, "identity_service_not_configured");
  let result: Response;
  try {
    result = await fetch(base.replace(/\/$/, "") + "/auth/v1/user", {
      headers: { Authorization: header, apikey: key },
      signal: AbortSignal.timeout(5000)
    });
  } catch (_) { throw new AccessError(503, "identity_service_unavailable"); }
  if (!result.ok) throw new AccessError(401, "invalid_clinician_session");
  const user = await result.json().catch(() => null);
  if (!user || !uuid.test(String(user.id || "")) || user.is_anonymous === true) {
    throw new AccessError(401, "invalid_clinician_session");
  }
  const rows = await conn.unsafe(
    "select id::text,external_id from iam.principal where auth_user_id=$1::uuid and active=true and synthetic=true and principal_type='clinician' limit 1",
    [user.id]
  );
  if (!rows.length) throw new AccessError(403, "clinician_not_linked");
  return { id: rows[0].id, externalId: rows[0].external_id };
}

async function audit(conn: Conn, person: Clinician, patientId: string | null, workspace: string, action: string, allowed: boolean, reason: string) {
  await conn.unsafe(
    "insert into iam.access_audit(principal_id,patient_id,action,workspace,allowed,reason) values($1::uuid,$2::uuid,$3,$4,$5,$6)",
    [person.id, patientId, action, workspace, allowed, reason]
  );
}

export async function patientAccess(conn: Conn, person: Clinician, externalId: string, workspace: string, action: string): Promise<string> {
  if (!actions.has(action) || !workspaceNames.has(workspace) || !/^PT-\d{3}$/.test(externalId)) {
    throw new AccessError(400, "invalid_access_request");
  }
  const patients = await conn.unsafe(
    "select id::text from ehr.patient where external_id=$1 and active=true and synthetic=true limit 1", [externalId]
  );
  const patientId = patients[0]?.id || null;
  const rows = patientId ? await conn.unsafe([
    "select pm.role from iam.practice_membership pm join iam.patient_assignment pa",
    "on pa.practice_id=pm.practice_id and pa.principal_id=pm.principal_id and pa.active=true",
    "where pm.principal_id=$1::uuid and pa.patient_id=$2::uuid and pm.active=true",
    "and $3::text=any(pm.workspaces) and $3::text=any(pa.workspaces)",
    "and pm.permissions->$4::text='true'::jsonb and pm.role='physician' limit 1"
  ].join(" "), [person.id, patientId, workspace, action]) : [];
  const allowed = rows.length > 0;
  await audit(conn, person, patientId, workspace, action, allowed,
    allowed ? "Assigned synthetic clinician access." : "No active patient assignment or permission.");
  if (!allowed) throw new AccessError(403, "patient_access_denied");
  person.role = rows[0].role;
  return patientId;
}

export async function censusAccess(conn: Conn, person: Clinician, workspace = "office") {
  if (!workspaceNames.has(workspace)) throw new AccessError(400, "invalid_workspace");
  const rows = await conn.unsafe([
    "select p.external_id,p.display_name,ps.state_version,ps.generated_at,ps.engine_version,ps.state",
    "from iam.practice_membership pm join iam.patient_assignment pa",
    "on pa.practice_id=pm.practice_id and pa.principal_id=pm.principal_id and pa.active=true",
    "join ehr.patient p on p.id=pa.patient_id and p.active=true and p.synthetic=true",
    "join lateral (select state_version,generated_at,engine_version,state from ehr.patient_state",
    "where patient_id=p.id order by state_version desc limit 1) ps on true",
    "where pm.principal_id=$1::uuid and pm.active=true",
    "and $2::text=any(pm.workspaces) and $2::text=any(pa.workspaces)",
    "and pm.permissions->'patient.read'='true'::jsonb and pm.role='physician' order by p.external_id"
  ].join(" "), [person.id, workspace]);
  await audit(conn, person, null, workspace, "patient.read", rows.length > 0,
    rows.length ? "Assigned synthetic census returned." : "No assigned synthetic patients.");
  return rows;
}

export function authFailure(error: unknown): { status: number; code: string } | null {
  return error instanceof AccessError ? { status: error.status, code: error.code } : null;
}

