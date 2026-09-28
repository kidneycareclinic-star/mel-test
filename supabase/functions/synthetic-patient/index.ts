// Legacy read path retired. Assigned patients must be read through synthetic-census.
export {};
Deno.serve((_req: Request) => new Response(
  JSON.stringify({ error: "legacy_endpoint_retired" }),
  { status: 410, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
));
