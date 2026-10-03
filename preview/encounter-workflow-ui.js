/* Synthetic encounter: persist pre-chart sources, review discrete values, then sign. */
(function () {
  var drafts = new Map();
  var busy = false;
  var panel = document.querySelector(".prechart-note-editor-card .prechart-section-head");
  if (!panel) return;
  var actions = document.createElement("div");
  actions.className = "encounter-workflow-actions";
  actions.innerHTML =
    '<button id="encounterSaveBtn" class="small-btn" type="button">Save encounter draft</button>' +
    '<button id="encounterSignBtn" class="small-btn" type="button">Sign reviewed encounter</button>' +
    '<button id="encounterRefreshBtn" class="small-btn" type="button">Refresh encounter</button>';
  panel.parentNode.insertBefore(actions, panel.nextSibling);
  var status = document.createElement("p");
  status.id = "encounterWorkflowStatus";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.textContent = "Add a synthetic pre-chart source, then save a draft before recording observations.";
  actions.parentNode.insertBefore(status, actions.nextSibling);
  var lastSigned = document.createElement("details");
  lastSigned.id = "encounterLastSigned";
  lastSigned.hidden = true;
  lastSigned.innerHTML = '<summary>Last signed encounter · approved state and history</summary><div class="encounter-final-view"></div>';
  status.parentNode.insertBefore(lastSigned, status.nextSibling);
  var reviewPanel=document.createElement("section");
  reviewPanel.id="encounterAstraReview";
  reviewPanel.setAttribute("aria-label","Astra physician review");
  lastSigned.parentNode.insertBefore(reviewPanel,lastSigned);

  function textNode(parent,tag,text){
    var node=document.createElement(tag);node.textContent=text;parent.appendChild(node);return node;
  }
  function valueText(value){return value==null?"—":typeof value==="object"?JSON.stringify(value):String(value);}
  function renderDetail(parent,detail){
    if(!detail)return;
    textNode(parent,"h4","Reviewed observations");
    var table=document.createElement("table");table.className="encounter-observation-table";parent.appendChild(table);
    var header=document.createElement("tr");table.appendChild(header);
    ["Observation","Generated","Reviewed","Status"].forEach(function(label){textNode(header,"th",label);});
    (detail.observations||[]).forEach(function(obs){
      var row=document.createElement("tr");table.appendChild(row);
      [obs.display_label||obs.field,valueText(obs.original_numeric??obs.original_json)+" "+(obs.unit||""),
       valueText(obs.reviewed_numeric??obs.reviewed_json),obs.status].forEach(function(value){textNode(row,"td",value);});
    });
    (detail.reviews||[]).forEach(function(review){
      textNode(parent,"h4","Astra review · "+review.status);
      textNode(parent,"p",review.reviewed_content?.summary||"No approved narrative.");
      var original=document.createElement("details");parent.appendChild(original);
      textNode(original,"summary","Original generated review and model");
      textNode(original,"pre",JSON.stringify(review.generated_content,null,2));
    });
    textNode(parent,"h4","State history");
    (detail.audit||[]).forEach(function(audit){
      var item=document.createElement("details");parent.appendChild(item);
      textNode(item,"summary","State v"+audit.previous_version+" → v"+audit.resulting_version+" · "+audit.event_type+" · "+new Date(audit.created_at).toLocaleString());
      textNode(item,"p","Recorded by "+(audit.actor_id||"system"));
      textNode(item,"pre",JSON.stringify({before:audit.previous_state,after:audit.resulting_state},null,2));
    });
  }
  function renderSigned(encounter){
    lastSigned.hidden=!encounter;
    var view=lastSigned.querySelector(".encounter-final-view");view.replaceChildren();
    if(!encounter)return;
    var patient=encounter.patient||{};
    textNode(view,"p","Signed "+new Date(encounter.signed_at).toLocaleString()+" · saved Patient State v"+encounter.final_state_version);
    textNode(view,"h4","Assessment and plan");textNode(view,"pre",encounter.note_text||"");
    textNode(view,"p",patient.approvedEncounterReview?.content?.summary||"");
    textNode(view,"h4","Kidney function and problem list");
    textNode(view,"p","eGFR: "+valueText(patient.labs?.eGFR?.value)+" · Recorded CKD stage: "+valueText(patient.ckdStage));
    textNode(view,"p",(patient.problemList||[]).map(function(problem){return problem.name;}).join(" · "));
    textNode(view,"h4","Medications");textNode(view,"p",(patient.meds||[]).map(valueText).join(" · "));
    textNode(view,"h4","Saved laboratory values");
    textNode(view,"p",Object.entries(patient.labs||{}).map(function(entry){return entry[0]+": "+valueText(entry[1].value)+" "+(entry[1].unit||"")+" ("+(entry[1].flag||"unflagged")+")";}).join(" · "));
    renderDetail(view,encounter.detail);
  }
  function renderReview(detail,encounterId){
    reviewPanel.replaceChildren();
    (detail?.reviews||[]).filter(function(review){return review.status==="pending";}).forEach(function(review){
      var item=document.createElement("article");item.className="encounter-review-card";reviewPanel.appendChild(item);
      textNode(item,"h4","Astra · pending physician review · source State v"+review.base_state_version);
      var editor=document.createElement("textarea");editor.value=review.generated_content?.review?.summary||"";
      editor.setAttribute("aria-label","Edit Astra summary");editor.maxLength=20000;item.appendChild(editor);
      var evidence=document.createElement("details");item.appendChild(evidence);textNode(evidence,"summary","Review evidence and limitations");
      textNode(evidence,"pre",JSON.stringify(review.generated_content?.review||{},null,2));
      [["Accept","accepted"],["Accept edit","edited"],["Reject","rejected"]].forEach(function(action){
        var button=textNode(item,"button",action[0]);button.type="button";button.className="small-btn";
        button.addEventListener("click",function(){withBusy(async function(patientId){
          var result=await request("POST",patientId,{action:"review-astra",patientId:patientId,encounterId:encounterId,reviewId:review.id,decision:action[1],summary:editor.value});
          window.SCRIBE_REVIEW_UI?.applyBackendPatient(result);
          await refresh();
          setStatus(result.status==="rejected"?"Astra review rejected. Patient State unchanged.":"Astra review approved and saved · Patient State v"+result.stateVersion);
        });});
      });
    });
    (detail?.tools||[]).filter(function(tool){return tool.status==="awaiting_approval";}).forEach(function(tool){
      var item=document.createElement("article");item.className="encounter-review-card";reviewPanel.appendChild(item);
      textNode(item,"p","Pending internal action: "+(tool.input?.label||tool.tool_name));
      [["Approve action","approved"],["Reject action","rejected"]].forEach(function(action){
        var button=textNode(item,"button",action[0]);button.type="button";button.className="small-btn";
        button.addEventListener("click",function(){withBusy(async function(){await window.WORKSPACE_REVIEW_AGENTS?.decide(tool.id,action[1]);await refresh();});});
      });
    });
    if(detail){var history=document.createElement("details");reviewPanel.appendChild(history);textNode(history,"summary","Encounter review and audit history");renderDetail(history,detail);}
  }

  function activePatient() {
    try { return currentPatient || null; } catch (_) { return window.currentPatient || null; }
  }
  function setStatus(message, error) {
    status.textContent = message;
    status.classList.toggle("is-error", !!error);
  }
  function currentId(patientId) { return drafts.get(patientId)?.id || null; }
  function config() { return window.SUPABASE_DEMO_BACKEND || null; }
  async function request(method, patientId, body) {
    var cfg = config();
    if (!cfg || !cfg.anonJwt) throw new Error("Sign in as a clinician first.");
    var url = cfg.baseUrl + "/functions/v1/synthetic-encounter-gated" +
      (method === "GET" ? "?patient_id=" + encodeURIComponent(patientId) : "");
    var result = await fetch(url, {
      method: method,
      headers: { "Authorization": "Bearer " + cfg.anonJwt, "Accept": "application/json",
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store"
    });
    var payload = await result.json().catch(function () { return {}; });
    if (!result.ok) throw new Error(payload.error || "Encounter request failed (HTTP " + result.status + ").");
    return payload;
  }
  async function refresh() {
    var patient = activePatient();
    if (!patient) return;
    var id = patient.id;
    try {
      var result = await request("GET", id);
      if (activePatient()?.id !== id) return;
      if(result.patient && Number(activePatient()?.backendSource?.stateVersion)!==Number(result.stateVersion))window.SCRIBE_REVIEW_UI?.applyBackendPatient(result);
      renderSigned(result.lastSigned);
      renderReview(result.draftDetail,result.draft?.id);
      if (result.draft) {
        var priorDraft=drafts.get(id);
        drafts.set(id, { id: result.draft.id, version: result.draft.version });
        if ((!priorDraft||priorDraft.version!==result.draft.version) && window.PRECHART_WORKSPACE_API?.hydrateEncounterDraft) {
          PRECHART_WORKSPACE_API.hydrateEncounterDraft(id, result.draft);
        }
        setStatus("Draft v" + result.draft.version + " saved. Review proposed observations before signing.");
      } else {
        drafts.delete(id);
        setStatus(result.lastSigned ? "Last encounter signed at Patient State v" + result.lastSigned.final_state_version + ". Add a new source to begin another." :
          "Add a synthetic pre-chart source, then save a draft before recording observations.");
      }
      if (window.SCRIBE_REVIEW_UI?.refresh) SCRIBE_REVIEW_UI.refresh();
    } catch (error) { setStatus("Encounter load failed: " + error.message, true); }
  }
  async function saveDraft(patientId) {
    var local = window.PRECHART_WORKSPACE_API?.getPatientState(patientId);
    if (!local || !local.sources.length) throw new Error("Add at least one pre-chart source before saving.");
    var prior = drafts.get(patientId);
    var result = await request("POST", patientId, {
      action: "save-draft", patientId: patientId,
      encounterId: prior?.id || null, expectedVersion: prior?.version || null,
      noteText: local.note || "", sources: local.sources
    });
    drafts.set(patientId, { id: result.encounterId, version: result.version });
    setStatus("Encounter draft v" + result.version + " saved. Structured observations now link to this encounter.");
    if (window.SCRIBE_REVIEW_UI?.refresh) SCRIBE_REVIEW_UI.refresh();
    return result;
  }
  async function withBusy(action) {
    if (busy) return;
    var patient = activePatient();
    if (!patient) return;
    busy = true;
    document.querySelectorAll(".encounter-workflow-actions button,#encounterAstraReview button").forEach(function (button) { button.disabled = true; });
    try { await action(patient.id); }
    catch (error) { setStatus(error?.message || "Encounter unavailable.", true); }
    finally { busy = false; document.querySelectorAll(".encounter-workflow-actions button,#encounterAstraReview button").forEach(function (button) { button.disabled = false; }); }
  }
  document.getElementById("encounterSaveBtn").addEventListener("click", function () {
    withBusy(saveDraft);
  });
  document.getElementById("encounterSignBtn").addEventListener("click", function () {
    withBusy(async function (patientId) {
      var saved = await saveDraft(patientId);
      var result = await request("POST", patientId, {
        action: "sign", patientId: patientId,
        encounterId: saved.encounterId, expectedVersion: saved.version,
        expectedStateVersion: activePatient()?.backendSource?.stateVersion
      });
      drafts.delete(patientId);
      var local = window.PRECHART_WORKSPACE_API?.getPatientState(patientId);
      await refresh();
      setStatus("Signed synthetic encounter · " + result.acceptedCount + " reviewed observation(s) · "+(result.approvedReviewCount||0)+" approved Astra review(s) · Patient State v" + result.stateVersion + " · audit event recorded.");
      if (window.PATIENT_AUDIT_UI?.refresh) PATIENT_AUDIT_UI.refresh();
    });
  });
  document.getElementById("encounterRefreshBtn").addEventListener("click", function () { withBusy(refresh); });
  var open = document.getElementById("openPrechartWorkspaceBtn");
  if (open) open.addEventListener("click", function () { window.setTimeout(refresh, 0); });
  window.ENCOUNTER_WORKFLOW_UI = { currentId: currentId, refresh: refresh };
})();

