/* Synthetic clinician sign-in. Tokens stay in memory and are cleared on reload. */
(function () {
  var baseUrl = "https://excqvjpsmdxzhujsbkmz.supabase.co";
  // Legacy anon JWT is a public API key only. Never use it as a clinician credential.
  var publicKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV4Y3F2anBzbWR4emh1anNia216Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1NjE1NDAsImV4cCI6MjEwNjEzNzU0MH0.qjhZBxmU2odQ2U2eEISxZNrHQp4EUkqCsfcD5ZceE5U";
  var accessToken = null;
  var resolveReady;
  var ready = new Promise(function (resolve) { resolveReady = resolve; });

  window.SUPABASE_DEMO_BACKEND = {
    baseUrl: baseUrl,
    syntheticOnly: true,
    get anonJwt() { return accessToken; }
  };

  function status(message) {
    var node = document.getElementById("clinicianSignInStatus");
    if (node) node.textContent = message;
  }

  async function signIn(email, password) {
    var response = await fetch(baseUrl + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { "apikey": publicKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, password: password }),
      cache: "no-store"
    });
    var session = await response.json().catch(function () { return {}; });
    if (!response.ok || !session.access_token) throw new Error("Sign-in failed. Check the account and password.");
    // An Auth login alone is insufficient: the linked clinician needs an assigned patient.
    var censusResponse = await fetch(baseUrl + "/functions/v1/synthetic-census-gated", {
      headers: { "Authorization": "Bearer " + session.access_token, "Accept": "application/json" },
      cache: "no-store"
    });
    var census = await censusResponse.json().catch(function () { return {}; });
    if (!censusResponse.ok || !Array.isArray(census.patients) || !census.patients.length) {
      throw new Error("This account has no active synthetic clinician assignment.");
    }
    accessToken = session.access_token;
    window.CLINICIAN_AUTH.initialCensus = census;
    document.documentElement.classList.add("clinician-authenticated");
    document.getElementById("clinicianSignIn").hidden = true;
    resolveReady(accessToken);
  }

  async function signOut() {
    var token = accessToken;
    accessToken = null;
    document.documentElement.classList.remove("clinician-authenticated");
    if (token) {
      try {
        await fetch(baseUrl + "/auth/v1/logout", {
          method: "POST", headers: { "apikey": publicKey, "Authorization": "Bearer " + token },
          signal: AbortSignal.timeout(5000)
        });
      } catch (_) {}
    }
    window.location.reload();
  }

  window.CLINICIAN_AUTH = {
    ready: ready,
    accessToken: function () { return accessToken; },
    isSignedIn: function () { return !!accessToken; },
    signOut: signOut
  };
  document.getElementById("clinicianSignInForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    var form = event.currentTarget;
    var button = form.querySelector("button[type=submit]");
    button.disabled = true;
    status("Checking clinician account and patient assignment…");
    try {
      await signIn(form.elements.email.value.trim(), form.elements.password.value);
      form.elements.password.value = "";
    } catch (error) {
      form.elements.password.value = "";
      status(error && error.message ? error.message : "Sign-in unavailable.");
    } finally { button.disabled = false; }
  });
  document.getElementById("clinicianSignOut").addEventListener("click", signOut);
})();
