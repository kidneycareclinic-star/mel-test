global.window = globalThis;

await import("../data.js");

const patients = globalThis.PATIENTS;
if (!Array.isArray(patients) || patients.length !== 23) {
  throw new Error("Expected 23 browser-owned synthetic patients after PT-001 removal; got " + (patients && patients.length));
}

const endpoint = "https://excqvjpsmdxzhujsbkmz.supabase.co/functions/v1/synthetic-census";
const anonJwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV4Y3F2anBzbWR4emh1anNia216Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1NjE1NDAsImV4cCI6MjEwNjEzNzU0MH0.qjhZBxmU2odQ2U2eEISxZNrHQp4EUkqCsfcD5ZceE5U";

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    "Authorization": "Bearer " + anonJwt,
    "Content-Type": "application/json",
    "x-synthetic-seed": "nephrology-harness-v1"
  },
  body: JSON.stringify({ patients })
});

const body = await response.text();
if (!response.ok) {
  throw new Error("Synthetic census import failed: HTTP " + response.status + " " + body);
}

console.log(body);
