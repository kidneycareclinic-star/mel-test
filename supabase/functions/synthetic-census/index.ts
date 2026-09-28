import postgres from "npm:postgres@3.4.7";
import { clinician, censusAccess, authFailure } from "./clinician-auth.ts";

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
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  const allowed = allowedOrigin(origin);
  if (allowed) { headers.set("Access-Control-Allow-Origin", allowed); headers.set("Vary", "Origin"); }
  headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type");
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin && !allowedOrigin(origin)) return response({ error: "origin_not_allowed" }, 403, origin);
  if (req.method === "OPTIONS") return response({ ok: true }, 200, origin);
  if (req.method !== "GET") return response({ error: "method_not_allowed" }, 405, origin);
  try {
    const person = await clinician(req, sql);
    const rows = await censusAccess(sql, person, "office");
    return response({ source: "supabase-postgresql", count: rows.length, patients: rows.map((row: any) => ({
      externalId: row.external_id, displayName: row.display_name, stateVersion: Number(row.state_version),
      generatedAt: row.generated_at, engineVersion: row.engine_version, patient: row.state
    })) }, 200, origin);
  } catch (error) {
    const denied = authFailure(error);
    return response({ error: denied?.code || "census_unavailable" }, denied?.status || 500, origin);
  }
});
