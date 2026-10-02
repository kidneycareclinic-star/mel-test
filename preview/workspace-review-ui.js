/* =========================================================================
 * Harness workspace review agents
 * Backend-recorded, proposal-only reviews of canonical Patient State.
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
    var panel=document.getElementById("workspaceReviewAgents");
    if(panel) return panel;
    panel=document.createElement("section");
    panel.id="workspaceReviewAgents";
    panel.className="workspace-review-agents";
    panel.innerHTML=
      "<div class='workspace-review-head'>"+
        "<div><strong>Harness review agents</strong><span>Canonical Patient State → auditable agent_run · no direct state mutation</span></div>"+
        "<span id='workspaceReviewStatus' class='chip'>ready</span>"+
      "</div>"+
      "<div class='workspace-review-buttons'>"+
        "<button class='small-btn workspace-agent-btn' data-workspace='ckd' type='button'>CKD review</button>"+
        "<button class='small-btn workspace-agent-btn' data-workspace='dialysis' type='button'>Dialysis review</button>"+
        "<button class='small-btn workspace-agent-btn' data-workspace='hospital' type='button'>Hospital review</button>"+
        "<button class='small-btn workspace-astra-btn' data-workspace='ckd' type='button'>Astra Ultrafast</button>"+
        "<button class='small-btn workspace-astra-test-btn' data-workspace='ckd' type='button'>Astra Approval Test</button>"+
      "</div>"+
      "<div id='workspaceReviewResult' class='workspace-review-result'><div class='micro'>Run a workspace review to create an auditable agent record.</div></div>";
    var anchor=document.getElementById("judgmentSummary");
    pane.insertBefore(panel,anchor||pane.firstChild);
    panel.querySelectorAll(".workspace-agent-btn").forEach(function(btn){
      btn.addEventListener("click",function(){run(btn.dataset.workspace);});
    });
    panel.querySelector(".workspace-astra-btn").addEventListener("click",function(){runAstra(this.dataset.workspace,false);});
    panel.querySelector(".workspace-astra-test-btn").addEventListener("click",function(){runAstra(this.dataset.workspace,true);});
    return panel;
  }
  function prettyContext(context){
    if(!context||typeof context!=="object") return "";
    var rows=Object.keys(context).filter(function(k){
      var v=context[k];
      return v!==null && v!==undefined && typeof v!=="object";
    }).slice(0,8);
    if(!rows.length) return "<div class='micro'>No active structured context fields.</div>";
    return "<div class='workspace-review-context'>"+rows.map(function(k){
      return "<div><span>"+esc(k)+"</span><strong>"+esc(context[k])+"</strong></div>";
    }).join("")+"</div>";
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

  async function decide(toolCallId,decision){
    var patient=activePatient(), c=cfg();
    if(!patient||!c) return;
    var status=document.getElementById("workspaceReviewStatus");
    var result=document.getElementById("workspaceReviewResult");
    status.textContent=decision==="approved"?"approving":"rejecting";
    try{
      var res=await fetch(c.baseUrl+"/functions/v1/workspace-review-gated",{
        method:"POST",
        headers:{
          "Accept":"application/json",
          "Content-Type":"application/json",
          "Authorization":"Bearer "+c.anonJwt
        },
        cache:"no-store",
        body:JSON.stringify({
          patientId:patient.id,
          mode:"decide",
          toolCallId:toolCallId,
          decision:decision
        })
      });
      var payload=await res.json().catch(function(){return {};});
      if(!res.ok) throw new Error(payload.error||("workspace decision HTTP "+res.status));
      applyBackendPatient(payload);
      status.textContent=payload.status;
      result.innerHTML=
        "<div class='workspace-review-decision'><strong>"+esc(payload.status==="executed"?"Approved and executed":"Rejected")+"</strong>"+
        "<span>"+(payload.status==="executed"?"Open loop created · Patient State v"+esc(payload.stateVersion):"No Patient State change")+"</span></div>";
      if(window.PATIENT_AUDIT_UI&&PATIENT_AUDIT_UI.refresh) PATIENT_AUDIT_UI.refresh();
    }catch(error){
      status.textContent="error";
      result.innerHTML="<div class='micro workspace-review-error'>"+esc(error&&error.message?error.message:error)+"</div>";
    }
  }

  function renderAstraSignals(signals){
    if(!Array.isArray(signals)||!signals.length) return "<div class='micro'>No discrete review signals returned.</div>";
    return "<div class='workspace-review-context'>"+signals.slice(0,8).map(function(s){
      return "<div><span>"+esc((s.priority||"routine").toUpperCase())+"</span><strong>"+esc(s.title||"Signal")+"</strong><small>"+esc(s.evidence||"")+"</small></div>";
    }).join("")+"</div>";
  }

  async function runAstra(workspace,testApprovalPath){
    var panel=ensurePanel(), patient=activePatient(), c=cfg();
    if(!panel||!patient||!c) return;
    var status=document.getElementById("workspaceReviewStatus");
    var result=document.getElementById("workspaceReviewResult");
    status.textContent=testApprovalPath?"Astra · approval test":"Astra · running";
    result.innerHTML="<div class='micro'>GPT-6 Astra · Ultrafast · reading synthetic canonical Patient State…</div>";
    try{
      var res=await fetch(c.baseUrl+"/functions/v1/astra-review-gated",{
        method:"POST",
        headers:{
          "Accept":"application/json",
          "Content-Type":"application/json",
          "Authorization":"Bearer "+c.anonJwt
        },
        cache:"no-store",
        body:JSON.stringify({patientId:patient.id,workspace:workspace,testApprovalPath:testApprovalPath===true})
      });
      var payload=await res.json().catch(function(){return {};});
      if(!res.ok) throw new Error(payload.error||("Astra review HTTP "+res.status));
      var telemetry=payload.telemetry||{};
      status.textContent=telemetry.ultrafastVerified?"Astra · Ultrafast verified":"Astra · tier "+esc(telemetry.serviceTierActual||"unknown");
      var actionHtml="";
      if(payload.proposedAction){
        actionHtml=
          "<div class='workspace-review-proposal' data-tool='"+esc(payload.proposedAction.toolCallId)+"'>"+
            "<div><span>ASTRA PROPOSED OPEN LOOP</span><strong>"+esc(payload.proposedAction.label)+"</strong>"+
            "<small>Low-risk internal tool · physician approval required · based on Patient State v"+esc(payload.proposedAction.baseStateVersion)+"</small></div>"+
            "<div class='workspace-review-proposal-actions'>"+
              "<button class='small-btn workspace-approve-btn' type='button'>Approve</button>"+
              "<button class='small-btn workspace-reject-btn' type='button'>Reject</button>"+
            "</div>"+
          "</div>";
      }
      var limitations=Array.isArray(payload.limitations)&&payload.limitations.length
        ? "<div class='micro'>Limitations: "+payload.limitations.map(esc).join(" · ")+"</div>"
        : "";
      result.innerHTML=
        "<div class='workspace-review-summary'><strong>GPT-6 ASTRA · ULTRAFAST</strong>"+
        "<span>"+esc(payload.summary||"")+"</span>"+
        "<small>Patient State v"+esc(payload.stateVersion)+" · "+esc(telemetry.latencyMs)+" ms · requested "+esc(telemetry.serviceTierRequested)+" · served "+esc(telemetry.serviceTierActual)+" · run "+esc(String(payload.runId).slice(0,8))+"…</small></div>"+
        renderAstraSignals(payload.signals)+limitations+actionHtml;
      var proposal=result.querySelector(".workspace-review-proposal");
      if(proposal){
        proposal.querySelector(".workspace-approve-btn").addEventListener("click",function(){decide(proposal.dataset.tool,"approved");});
        proposal.querySelector(".workspace-reject-btn").addEventListener("click",function(){decide(proposal.dataset.tool,"rejected");});
      }
      if(window.PATIENT_AUDIT_UI&&PATIENT_AUDIT_UI.refresh) PATIENT_AUDIT_UI.refresh();
    }catch(error){
      status.textContent="Astra · error";
      result.innerHTML="<div class='micro workspace-review-error'>"+esc(error&&error.message?error.message:error)+"</div>";
    }
  }

  async function run(workspace){
    var panel=ensurePanel(), patient=activePatient(), c=cfg();
    if(!panel||!patient||!c) return;
    var status=document.getElementById("workspaceReviewStatus");
    var result=document.getElementById("workspaceReviewResult");
    status.textContent="running";
    result.innerHTML="<div class='micro'>Reading canonical Patient State and recording "+esc(workspace)+" review…</div>";
    try{
      var res=await fetch(c.baseUrl+"/functions/v1/workspace-review-gated",{
        method:"POST",
        headers:{
          "Accept":"application/json",
          "Content-Type":"application/json",
          "Authorization":"Bearer "+c.anonJwt
        },
        cache:"no-store",
        body:JSON.stringify({patientId:patient.id,workspace:workspace})
      });
      var payload=await res.json().catch(function(){return {};});
      if(!res.ok) throw new Error(payload.error||("workspace review HTTP "+res.status));
      status.textContent="recorded";
      var actionHtml="";
      if(payload.proposedAction){
        actionHtml=
          "<div class='workspace-review-proposal' data-tool='"+esc(payload.proposedAction.toolCallId)+"'>"+
            "<div><span>PROPOSED ACTION</span><strong>"+esc(payload.proposedAction.label)+"</strong>"+
            "<small>Low-risk internal tool · physician approval required</small></div>"+
            "<div class='workspace-review-proposal-actions'>"+
              "<button class='small-btn workspace-approve-btn' type='button'>Approve</button>"+
              "<button class='small-btn workspace-reject-btn' type='button'>Reject</button>"+
            "</div>"+
          "</div>";
      }
      result.innerHTML=
        "<div class='workspace-review-summary'><strong>"+esc(payload.workspace.toUpperCase())+" review</strong>"+
        "<span>"+esc(payload.summary)+"</span>"+
        "<small>Patient State v"+esc(payload.stateVersion)+" · run "+esc(String(payload.runId).slice(0,8))+"… · event "+esc(String(payload.eventId).slice(0,8))+"…</small></div>"+
        prettyContext(payload.context)+actionHtml;
      var proposal=result.querySelector(".workspace-review-proposal");
      if(proposal){
        proposal.querySelector(".workspace-approve-btn").addEventListener("click",function(){
          decide(proposal.dataset.tool,"approved");
        });
        proposal.querySelector(".workspace-reject-btn").addEventListener("click",function(){
          decide(proposal.dataset.tool,"rejected");
        });
      }
      if(window.PATIENT_AUDIT_UI&&PATIENT_AUDIT_UI.refresh) PATIENT_AUDIT_UI.refresh();
    }catch(error){
      status.textContent="error";
      result.innerHTML="<div class='micro workspace-review-error'>"+esc(error&&error.message?error.message:error)+"</div>";
    }
  }
  ensurePanel();
  window.WORKSPACE_REVIEW_AGENTS={run:run,runAstra:runAstra};
})();
