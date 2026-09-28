/* =========================================================================
 * Physician-initiated follow-up preparation
 * Creates approval-required internal preparation artifacts only.
 * No external order/scheduling execution.
 * ========================================================================= */
(function(){
  function cfg(){return window.SUPABASE_DEMO_BACKEND||null;}
  function activePatient(){
    try{return currentPatient||null;}catch(_){return window.BACKEND_PATIENT||null;}
  }
  function esc(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}

  function ensurePanel(){
    var pane=document.querySelector(".agent-pane");
    if(!pane) return null;
    var panel=document.getElementById("workflowPrepPanel");
    if(panel) return panel;
    panel=document.createElement("section");
    panel.id="workflowPrepPanel";
    panel.className="workflow-prep-panel";
    panel.innerHTML=
      "<div class='workflow-prep-head'><div><strong>Follow-up preparation</strong><span>Physician-specified · approval required · no external execution</span></div><span id='workflowPrepStatus' class='chip'>idle</span></div>"+
      "<div class='workflow-prep-form'>"+
        "<select id='workflowPrepType'><option value='prepare_followup_lab_order'>Lab follow-up preparation</option><option value='prepare_followup_appointment'>Appointment preparation</option></select>"+
        "<input id='workflowPrepSummary' type='text' placeholder='Summary / purpose' />"+
        "<input id='workflowPrepTiming' type='text' placeholder='Timing (physician-specified)' />"+
        "<input id='workflowPrepTests' type='text' placeholder='Tests, comma-separated (lab preparation only)' />"+
        "<input id='workflowPrepReason' type='text' placeholder='Reason / context' />"+
        "<button id='workflowPrepBtn' class='small-btn' type='button'>Prepare</button>"+
      "</div>"+
      "<div id='workflowPrepResult' class='workflow-prep-result'><div class='micro'>No preparation pending.</div></div>";
    var review=document.getElementById("workspaceReviewAgents");
    if(review&&review.parentNode===pane) pane.insertBefore(panel,review.nextSibling);
    else pane.insertBefore(panel,pane.firstChild);
    document.getElementById("workflowPrepBtn").addEventListener("click",prepare);
    return panel;
  }

  function applyBackendPatient(payload){
    if(!payload||!payload.patient) return;
    var patient=payload.patient;
    patient.backendSource={
      type:"supabase-postgresql",
      stateVersion:payload.stateVersion,
      generatedAt:new Date().toISOString(),
      engineVersion:"patient-state-reducer-v1"
    };
    var idx=window.PATIENTS.findIndex(function(x){return x.id===patient.id;});
    if(idx>=0) window.PATIENTS[idx]=patient;
    try{
      if(currentPatient&&currentPatient.id===patient.id) renderPatient(patient,false);
    }catch(_){}
  }

  async function post(body){
    var c=cfg(); if(!c) throw new Error("backend configuration unavailable");
    var res=await fetch(c.baseUrl+"/functions/v1/workspace-review-gated",{
      method:"POST",
      headers:{
        "Accept":"application/json",
        "Content-Type":"application/json",
        "Authorization":"Bearer "+c.anonJwt
      },
      cache:"no-store",
      body:JSON.stringify(body)
    });
    var payload=await res.json().catch(function(){return {};});
    if(!res.ok) throw new Error(payload.error||("workflow preparation HTTP "+res.status));
    return payload;
  }

  async function prepare(){
    ensurePanel();
    var patient=activePatient();
    if(!patient) return;
    var type=document.getElementById("workflowPrepType").value;
    var summary=document.getElementById("workflowPrepSummary").value.trim();
    var timing=document.getElementById("workflowPrepTiming").value.trim();
    var reason=document.getElementById("workflowPrepReason").value.trim();
    var tests=document.getElementById("workflowPrepTests").value.split(",").map(function(x){return x.trim();}).filter(Boolean);
    var status=document.getElementById("workflowPrepStatus");
    var result=document.getElementById("workflowPrepResult");
    if(!summary){
      result.innerHTML="<div class='micro workflow-prep-error'>Summary is required.</div>";
      return;
    }
    status.textContent="preparing";
    result.innerHTML="<div class='micro'>Creating approval-required preparation…</div>";
    try{
      var payload=await post({
        patientId:patient.id,
        mode:"prepare",
        toolName:type,
        summary:summary,
        timing:timing,
        reason:reason,
        tests:tests
      });
      status.textContent="awaiting approval";
      var pa=payload.proposedAction;
      result.innerHTML=
        "<div class='workflow-prep-proposal' data-tool='"+esc(pa.toolCallId)+"'>"+
          "<div><span>PROPOSED PREPARATION</span><strong>"+esc(pa.label)+"</strong>"+
          "<small>"+esc(type==="prepare_followup_lab_order"?"Lab preparation":"Appointment preparation")+" · external execution disabled</small></div>"+
          "<div class='workflow-prep-actions'><button class='small-btn workflow-prep-approve' type='button'>Approve</button><button class='small-btn workflow-prep-reject' type='button'>Reject</button></div>"+
        "</div>";
      var proposal=result.querySelector(".workflow-prep-proposal");
      proposal.querySelector(".workflow-prep-approve").addEventListener("click",function(){decide(proposal.dataset.tool,"approved");});
      proposal.querySelector(".workflow-prep-reject").addEventListener("click",function(){decide(proposal.dataset.tool,"rejected");});
      if(window.PATIENT_AUDIT_UI&&PATIENT_AUDIT_UI.refresh) PATIENT_AUDIT_UI.refresh();
    }catch(error){
      status.textContent="error";
      result.innerHTML="<div class='micro workflow-prep-error'>"+esc(error&&error.message?error.message:error)+"</div>";
    }
  }

  async function decide(toolCallId,decision){
    var patient=activePatient(); if(!patient) return;
    var status=document.getElementById("workflowPrepStatus");
    var result=document.getElementById("workflowPrepResult");
    status.textContent=decision==="approved"?"approving":"rejecting";
    try{
      var payload=await post({patientId:patient.id,mode:"decide",toolCallId:toolCallId,decision:decision});
      applyBackendPatient(payload);
      status.textContent=payload.status;
      result.innerHTML=
        "<div class='workflow-prep-decision'><strong>"+esc(payload.status==="executed"?"Approved preparation":"Rejected")+"</strong>"+
        "<span>"+esc(payload.status==="executed"?"Internal preparation recorded · open loop created · no external execution":"No Patient State change")+"</span></div>";
      if(window.PATIENT_AUDIT_UI&&PATIENT_AUDIT_UI.refresh) PATIENT_AUDIT_UI.refresh();
    }catch(error){
      status.textContent="error";
      result.innerHTML="<div class='micro workflow-prep-error'>"+esc(error&&error.message?error.message:error)+"</div>";
    }
  }

  ensurePanel();
})();
