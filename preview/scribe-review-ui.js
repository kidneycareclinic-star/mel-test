/* =========================================================================
 * Synthetic Scribe Review UI
 * Pending ambient extractions remain PROPOSED until physician review.
 * ========================================================================= */
(function(){
  var submitting=false;
  function cfg(){ return window.SUPABASE_DEMO_BACKEND || null; }
  function activePatient(){
    try { return currentPatient || null; } catch (_) { return window.BACKEND_PATIENT || null; }
  }
  function esc(v){
    return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
  function ensurePanel(){
    var host=document.querySelector(".scribe-extraction-panel");
    if(!host) return null;
    var panel=document.getElementById("scribeReviewPanel");
    if(panel) return panel;
    panel=document.createElement("div");
    panel.id="scribeReviewPanel";
    panel.className="scribe-review-panel";
    panel.innerHTML=
      "<div class='prechart-section-head'>"+
        "<div><h3>Physician review queue</h3><div class='micro'>PROPOSED → accept / edit / reject → canonical observation → Patient State reducer</div></div>"+
        "<div class='prechart-inline-actions'>"+
          "<span id='scribeReviewCount' class='chip'>0 pending</span>"+
          "<button id='scribeAcceptAllBtn' class='small-btn' type='button'>Accept all</button>"+
          "<button id='scribeReviewRefreshBtn' class='small-btn' type='button'>Refresh</button>"+
        "</div>"+
      "</div>"+
      "<div id='scribeReviewList' class='scribe-review-list'><div class='prechart-ledger-empty'>No pending proposed observations.</div></div>";
    host.parentNode.insertBefore(panel, host.nextSibling);
    document.getElementById("scribeAcceptAllBtn").addEventListener("click", function(){ submitAll("accepted"); });
    document.getElementById("scribeReviewRefreshBtn").addEventListener("click", refresh);
    return panel;
  }
  function endpoint(patientId){
    var c=cfg();
    var encounterId=window.ENCOUNTER_WORKFLOW_UI && ENCOUNTER_WORKFLOW_UI.currentId(patientId);
    return c ? c.baseUrl+"/functions/v1/scribe-review-gated?patient_id="+encodeURIComponent(patientId)+
      (encounterId?"&encounter_id="+encodeURIComponent(encounterId):"") : null;
  }
  async function api(method,patientId,body){
    var c=cfg(); if(!c) throw new Error("backend configuration unavailable");
    var res=await fetch(method==="GET"?endpoint(patientId):c.baseUrl+"/functions/v1/scribe-review-gated",{
      method:method,
      headers:{
        "Accept":"application/json",
        "Authorization":"Bearer "+c.anonJwt,
        ...(method==="POST"?{"Content-Type":"application/json"}:{})
      },
      cache:"no-store",
      body:method==="POST"?JSON.stringify(body):undefined
    });
    var payload=await res.json().catch(function(){return {};});
    if(!res.ok) throw new Error(payload.error||("scribe review HTTP "+res.status));
    return payload;
  }
  function displayValue(p){
    if(p.value_numeric!=null) return String(p.value_numeric)+(p.unit?" "+p.unit:"");
    if(p.value_json && p.field==="bloodPressure") return p.value_json.systolic+"/"+p.value_json.diastolic+(p.unit?" "+p.unit:"");
    if(p.value_json && p.field==="weight") return p.value_json.amount+" "+(p.value_json.reportedUnit||p.unit||"");
    return "—";
  }
  function editControl(p){
    if(p.value_numeric!=null){
      return "<input class='scribe-review-edit' data-kind='numeric' data-proposal='"+esc(p.id)+"' value='"+esc(p.value_numeric)+"' />";
    }
    if(p.field==="bloodPressure" && p.value_json){
      return "<div class='scribe-review-bp'>"+
        "<input class='scribe-review-edit' data-kind='bp-sys' data-proposal='"+esc(p.id)+"' value='"+esc(p.value_json.systolic)+"' />"+
        "<span>/</span>"+
        "<input class='scribe-review-edit' data-kind='bp-dia' data-proposal='"+esc(p.id)+"' value='"+esc(p.value_json.diastolic)+"' />"+
      "</div>";
    }
    if(p.field==="weight" && p.value_json){
      return "<input class='scribe-review-edit' data-kind='weight' data-proposal='"+esc(p.id)+"' value='"+esc(p.value_json.amount)+"' />";
    }
    return "";
  }
  function render(payload){
    ensurePanel();
    var list=document.getElementById("scribeReviewList");
    var count=document.getElementById("scribeReviewCount");
    var proposals=payload && Array.isArray(payload.proposals)?payload.proposals:[];
    count.textContent=proposals.length+" pending";
    if(!proposals.length){
      list.innerHTML="<div class='prechart-ledger-empty'>No pending proposed observations.</div>";
      return;
    }
    list.innerHTML=proposals.map(function(p){
      return "<article class='scribe-review-item' data-proposal='"+esc(p.id)+"'>"+
        "<div class='scribe-review-main'>"+
          "<div><strong>"+esc(p.display_label||p.field)+"</strong><span>"+esc(displayValue(p))+"</span></div>"+
          "<small>"+esc(p.source_text||"ambient transcript")+"</small>"+
          "<div class='scribe-review-edit-wrap'>"+editControl(p)+"</div>"+
        "</div>"+
        "<div class='scribe-review-actions'>"+
          "<button class='small-btn scribe-accept-btn' type='button'>Accept</button>"+
          "<button class='small-btn scribe-edit-btn' type='button'>Accept edit</button>"+
          "<button class='small-btn scribe-reject-btn' type='button'>Reject</button>"+
        "</div>"+
      "</article>";
    }).join("");
    list.querySelectorAll(".scribe-accept-btn").forEach(function(btn){
      btn.addEventListener("click",function(){submitOne(btn.closest(".scribe-review-item").dataset.proposal,"accepted");});
    });
    list.querySelectorAll(".scribe-edit-btn").forEach(function(btn){
      btn.addEventListener("click",function(){submitOne(btn.closest(".scribe-review-item").dataset.proposal,"edited");});
    });
    list.querySelectorAll(".scribe-reject-btn").forEach(function(btn){
      btn.addEventListener("click",function(){submitOne(btn.closest(".scribe-review-item").dataset.proposal,"rejected");});
    });
  }
  function editedValueFor(proposalId){
    function requiredNumber(input,label){
      if(!input.value.trim()) throw new Error(label+" cannot be blank.");
      var value=Number(input.value);
      if(!Number.isFinite(value)) throw new Error(label+" must be a number.");
      return value;
    }
    var numeric=document.querySelector(".scribe-review-edit[data-proposal='"+CSS.escape(proposalId)+"'][data-kind='numeric']");
    if(numeric) return requiredNumber(numeric,"Edited value");
    var sys=document.querySelector(".scribe-review-edit[data-proposal='"+CSS.escape(proposalId)+"'][data-kind='bp-sys']");
    var dia=document.querySelector(".scribe-review-edit[data-proposal='"+CSS.escape(proposalId)+"'][data-kind='bp-dia']");
    if(sys&&dia) return {systolic:requiredNumber(sys,"Systolic pressure"),diastolic:requiredNumber(dia,"Diastolic pressure")};
    var weight=document.querySelector(".scribe-review-edit[data-proposal='"+CSS.escape(proposalId)+"'][data-kind='weight']");
    if(weight) return {amount:requiredNumber(weight,"Weight")};
    throw new Error("This observation cannot be edited here.");
  }
  function applyBackendPatient(payload){
    if(!payload || !payload.patient) return;
    var patient=payload.patient;
    patient.backendSource={
      type:"supabase-postgresql",
      stateVersion:payload.stateVersion,
      generatedAt:new Date().toISOString(),
      engineVersion:"patient-state-reducer-v1"
    };
    var idx=window.PATIENTS.findIndex(function(x){return x.id===patient.id;});
    if(idx>=0) window.PATIENTS[idx]=patient;
    try {
      if(currentPatient && currentPatient.id===patient.id) renderPatient(patient,false);
    } catch(_){}
    if(window.PATIENT_AUDIT_UI && PATIENT_AUDIT_UI.refresh) PATIENT_AUDIT_UI.refresh();
  }
  async function submit(decisions){
    if(submitting) return;
    var patient=activePatient(); if(!patient) return;
    submitting=true;
    document.querySelectorAll("#scribeReviewPanel button").forEach(function(button){button.disabled=true;});
    var status=document.getElementById("voiceRuntimeStatus");
    if(status){status.textContent="Applying physician review decisions…";status.className="voice-runtime-status is-listening";}
    try{
      var encounterId=window.ENCOUNTER_WORKFLOW_UI && ENCOUNTER_WORKFLOW_UI.currentId(patient.id);
      var payload=await api("POST",patient.id,{patientId:patient.id,encounterId:encounterId||null,decisions:decisions});
      applyBackendPatient(payload);
      if(status){status.textContent="Review applied · "+payload.canonicalInserted+" canonical observation"+(payload.canonicalInserted===1?"":"s")+" · Patient State v"+payload.stateVersion;status.className="voice-runtime-status is-ready";}
      if(activePatient() && activePatient().id===patient.id) render({proposals:payload.pending||[]});
      if(window.ENCOUNTER_WORKFLOW_UI && ENCOUNTER_WORKFLOW_UI.refresh) ENCOUNTER_WORKFLOW_UI.refresh();
    }catch(error){
      if(status){status.textContent="Scribe review failed: "+(error&&error.message?error.message:error);status.className="voice-runtime-status is-error";}
      await refresh();
    }finally{
      submitting=false;
      document.querySelectorAll("#scribeReviewPanel button").forEach(function(button){button.disabled=false;});
    }
  }
  function submitOne(proposalId,decision){
    var d={proposalId:proposalId,decision:decision};
    if(decision==="edited"){
      try{d.editedValue=editedValueFor(proposalId);}
      catch(error){
        var status=document.getElementById("voiceRuntimeStatus");
        if(status){status.textContent=error.message;status.className="voice-runtime-status is-error";}
        return;
      }
    }
    submit([d]);
  }
  function submitAll(decision){
    var ids=Array.from(document.querySelectorAll(".scribe-review-item")).map(function(n){return n.dataset.proposal;});
    if(ids.length) submit(ids.map(function(id){return {proposalId:id,decision:decision};}));
  }
  async function refresh(){
    ensurePanel();
    var patient=activePatient(); if(!patient) return;
    try{
      var payload=await api("GET",patient.id);
      if(activePatient() && activePatient().id===patient.id) render(payload);
    }
    catch(error){
      var list=document.getElementById("scribeReviewList");
      if(list) list.innerHTML="<div class='prechart-ledger-empty'>Unable to load review queue: "+esc(error&&error.message?error.message:error)+"</div>";
    }
  }
  ensurePanel();
  window.SCRIBE_REVIEW_UI={refresh:refresh};
})();
