/* Synthetic visit package: signed snapshot, physician review, simulated follow-up. */
(function () {
  var anchor=document.querySelector(".prechart-panel");
  if(!anchor)return;
  var panel=document.createElement("section");panel.className="panel completion-launcher";
  panel.innerHTML='<div class="panel-head"><div><h2>Visit completion</h2><div class="micro">Final note, patient instructions, simulated orders, and follow-up</div></div><button class="small-btn" type="button">Open visit package</button></div>';
  anchor.after(panel);
  var dialog=document.createElement("dialog");dialog.id="encounterCompletionDialog";
  dialog.setAttribute("aria-labelledby","completionDialogTitle");
  dialog.innerHTML='<div class="completion-shell"><header class="completion-head"><div><h2 id="completionDialogTitle">Visit completion</h2><p>Synthetic patient · orders simulated</p></div><button id="completionClose" class="icon-btn" type="button" aria-label="Close visit package">×</button></header><label class="completion-field">Signed visit<select id="completionEncounter"></select></label><p id="completionStatus" role="status" aria-live="polite"></p><div id="completionBody"></div></div>';
  document.body.appendChild(dialog);
  var status=dialog.querySelector("#completionStatus"),body=dialog.querySelector("#completionBody"),select=dialog.querySelector("#completionEncounter");
  var contextId=null,payload=null,busy=false,sequence=0,editorRevision=null,editorEncounter=null;
  function activePatient(){try{return currentPatient||null;}catch(_){return window.currentPatient||window.BACKEND_PATIENT||null;}}
  function node(parent,tag,content){var n=document.createElement(tag);if(content!=null)n.textContent=content;parent.appendChild(n);return n;}
  function button(parent,label,action){var b=node(parent,"button",label);b.type="button";b.className="small-btn";b.addEventListener("click",action);return b;}
  function field(parent,label,tag,value){var l=node(parent,"label",label);l.className="completion-field";var input=node(l,tag);input.value=value||"";return input;}
  function message(text,error){status.textContent=text;status.classList.toggle("is-error",!!error);}
  function errorText(code){return ({
    signed_encounter_required:"Sign a reviewed encounter before creating its visit package.",
    completion_version_changed:"This package changed. Copy any unsaved text, then click Refresh package and review the saved content before retrying.",
    completion_item_review_required:"Approve or reject each pending order or follow-up draft before approving the package.",
    approved_completion_is_immutable:"The approved note and instructions are saved. Follow-up status can still be updated.",
    invalid_due_date:"Enter a valid due date.",
    invalid_completion_content:"Enter the required note, instructions, item label, or completion note within the displayed length limit.",
    invalid_completion_item_transition:"Refresh the package and check this item's current status.",
    completion_unavailable:"The visit package is temporarily unavailable. Your last saved content is retained."
  })[code]||code;}
  async function request(action,values,encounterId){
    if(activePatient()?.id!==contextId)throw new Error("The selected patient changed. Close this window and reopen the visit package.");
    var cfg=window.SUPABASE_DEMO_BACKEND;
    if(!cfg?.anonJwt)throw new Error("Sign in as a clinician first.");
    var url=cfg.baseUrl+"/functions/v1/encounter-completion-gated";
    var id=encounterId||payload?.selectedEncounter?.id;
    var result=await fetch(url+(action?"":"?patient_id="+encodeURIComponent(contextId)+(id?"&encounter_id="+encodeURIComponent(id):"")),{
      method:action?"POST":"GET",cache:"no-store",
      headers:{Authorization:"Bearer "+cfg.anonJwt,Accept:"application/json",...(action?{"Content-Type":"application/json"}:{})},
      body:action?JSON.stringify({patientId:contextId,encounterId:id,action:action,expectedVersion:payload?.package?.version,...values}):undefined
    });
    var data=await result.json().catch(function(){return {};});
    if(!result.ok)throw new Error(errorText(data.error)||"Visit package request failed (HTTP "+result.status+").");
    return data;
  }
  async function withBusy(action){
    if(busy)return;
    busy=true;var ticket=sequence,priorPayload=payload,success=false;
    dialog.querySelectorAll("button,select,input,textarea").forEach(function(n){n.disabled=true;});
    try{await action();success=true;}catch(error){if(ticket===sequence)message(error.message||"Visit package unavailable.",true);}
    finally{busy=false;if(ticket===sequence){if(success&&payload!==priorPayload)render();dialog.querySelectorAll("button,select,input,textarea").forEach(function(n){n.disabled=false;});}}
  }
  async function load(encounterId){var ticket=sequence;var data=await request(null,null,encounterId);if(ticket!==sequence)return;payload=data;render();message(data.package?"Saved "+data.package.status+" package · revision "+data.package.version:"Choose a signed visit and create its package.");}
  function edited(){var p=payload?.package;if(!p||p.status!=="draft")return null;var note=dialog.querySelector("#completionNote"),instructions=dialog.querySelector("#completionInstructions");if(!note||!instructions)return null;return {noteText:note.value,patientInstructions:instructions.value};}
  async function saveEdits(){var values=edited();if(values&&(values.noteText!==payload.package.note_text||values.patientInstructions!==payload.package.patient_instructions)){payload=await request("save",values);editorRevision=payload.package.version;}}
  function localDate(){var d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");}
  function render(){
    // Preserve text after an error; successful responses replace the editor data.
    var unsaved=edited();
    select.replaceChildren();body.replaceChildren();
    (payload?.encounters||[]).forEach(function(e){var opt=node(select,"option",new Date(e.signed_at).toLocaleString()+" · State v"+e.final_state_version+" · "+(e.completion_status||"no package"));opt.value=e.id;opt.selected=e.id===payload?.selectedEncounter?.id;});
    if(!payload?.selectedEncounter){node(body,"p","No signed visit is available for this patient. Save, review, and sign an encounter first.");return;}
    var actions=node(body,"div");actions.className="completion-actions";
    button(actions,"Refresh package",function(){withBusy(function(){return load();});});
    if(!payload.package){button(actions,"Create visit package",function(){withBusy(async function(){payload=await request("create");message("Visit package draft created. Review the note and instructions, then add any intended orders or follow-up.");});});return;}
    var p=payload.package,approved=p.status==="approved";
    node(body,"p","Based on signed Patient State v"+p.source_state_version+" · package "+p.status+" · revision "+p.version).className="completion-source";
    if(approved)node(body,"p","Approved by "+p.approved_by_id+" on "+new Date(p.approved_at).toLocaleString());
    var note=field(body,"Final nephrology note","textarea",p.note_text);note.id="completionNote";note.maxLength=60000;note.readOnly=approved;
    var instructions=field(body,"Patient instructions · review for clarity","textarea",p.patient_instructions);instructions.id="completionInstructions";instructions.maxLength=40000;instructions.readOnly=approved;
    // An error leaves payload unchanged, so retain the physician's local edits.
    if(unsaved&&unsaved._version===p.version&&unsaved._encounter===p.encounter_id){note.value=unsaved.noteText;instructions.value=unsaved.patientInstructions;}
    editorRevision=p.version;editorEncounter=p.encounter_id;
    if(!approved){
      button(actions,"Save package draft",function(){withBusy(async function(){await saveEdits();message("Visit package draft saved.");});});
      button(actions,"Approve visit package",function(){withBusy(async function(){await saveEdits();payload=await request("approve");message("Visit package approved. The final note and instructions are saved; orders remain simulated.");});});
    }
    button(actions,"Copy note",function(){withBusy(async function(){await navigator.clipboard.writeText(note.value);message("Note copied.");});});
    button(actions,"Copy instructions",function(){withBusy(async function(){await navigator.clipboard.writeText(instructions.value);message("Instructions copied.");});});
    node(body,"h3","Orders and follow-up");
    node(body,"p","Review each draft before approving the package. To correct an item, reject it and enter a replacement.");
    if(!approved){
      var form=node(body,"div");form.className="completion-item-form";
      var kind=field(form,"Draft type","select");[["lab","Lab"],["medication","Medication"],["referral","Referral"],["follow-up","Follow-up"]].forEach(function(k){var o=node(kind,"option",k[1]);o.value=k[0];});
      var label=field(form,"Order or follow-up label","input");label.maxLength=240;
      var details=field(form,"Details entered by physician","textarea");details.maxLength=4000;
      var due=field(form,"Due date (optional)","input");due.type="date";
      button(form,"Add draft",function(){var values={kind:kind.value,label:label.value,details:details.value,dueDate:due.value};withBusy(async function(){await saveEdits();payload=await request("add-item",values);message("Draft added. Review it, then approve or reject.");});});
    }
    if(!payload.items.length)node(body,"p","No orders or follow-up drafts entered.");
    payload.items.forEach(function(item){
      var card=node(body,"article");card.className="completion-item";
      node(card,"h4",item.label);node(card,"p",item.kind+" · "+item.status+(item.due_date?" · due "+item.due_date:"")+(item.status==="approved"&&item.due_date&&item.due_date<localDate()?" · overdue":""));
      if(item.details)node(card,"pre",item.details);
      if(item.status==="pending"&&!approved)[["Approve draft","approved"],["Reject draft","rejected"]].forEach(function(decision){button(card,decision[0],function(){withBusy(async function(){await saveEdits();payload=await request("decide-item",{itemId:item.id,decision:decision[1]});message("Draft "+decision[1]+". Orders remain simulated.");});});});
      if(item.status==="approved"&&approved){
        var completionNote=field(card,"Completion or cancellation note","input");completionNote.maxLength=2000;
        [[item.kind==="follow-up"?"Mark follow-up complete":"Mark simulated complete","completed"],["Cancel item","cancelled"]].forEach(function(decision){button(card,decision[0],function(){var value=completionNote.value;withBusy(async function(){payload=await request("resolve-item",{itemId:item.id,decision:decision[1],completionNote:value});message("Item "+decision[1]+" and recorded in visit history.");});});});
      }
      if(item.completion_note)node(card,"p",item.completion_note+" · "+new Date(item.resolved_at).toLocaleString());
    });
    var original=node(body,"details");node(original,"summary","Original visit-package draft");node(original,"pre",p.generated_content.noteText);node(original,"pre",p.generated_content.patientInstructions);
    var history=node(body,"details");node(history,"summary","Visit-package history · "+payload.history.length+" recorded changes");
    payload.history.forEach(function(entry){var d=node(history,"details");node(d,"summary","Revision "+entry.version+" · "+entry.action.toLowerCase().replaceAll("_"," ")+" · "+new Date(entry.created_at).toLocaleString());node(d,"p","Recorded by "+entry.actor_id);node(d,"h4","Before");node(d,"pre",snapshotText(entry.before_snapshot));node(d,"h4","After");node(d,"pre",snapshotText(entry.after_snapshot));});
  }
  function snapshotText(snapshot){if(!snapshot)return "Package created from the signed visit.";return ["Status: "+snapshot.status,"Note\n"+snapshot.noteText,"Patient instructions\n"+snapshot.patientInstructions,"Orders and follow-up\n"+(snapshot.items||[]).map(function(i){return i.kind+": "+i.label+" · "+i.status+(i.due_date?" · "+i.due_date:"")+(i.details?"\n"+i.details:"")+(i.completion_note?"\n"+i.completion_note:"");}).join("\n\n")].join("\n\n");}
  // Capture local editors before an action so errors cannot discard text.
  var originalEdited=edited;
  edited=function(){var result=originalEdited();if(result){result._version=editorRevision;result._encounter=editorEncounter;}return result;};
  function open(){if(busy)return;var patient=activePatient();if(!patient)return;sequence++;contextId=patient.id;payload=null;editorRevision=null;editorEncounter=null;body.replaceChildren();message("Loading signed visits…");if(!dialog.open)dialog.showModal();withBusy(function(){return load();});}
  panel.querySelector("button").addEventListener("click",open);
  function close(){withBusy(async function(){await saveEdits();dialog.close();});}
  dialog.querySelector("#completionClose").addEventListener("click",close);
  dialog.addEventListener("cancel",function(event){event.preventDefault();if(!busy)close();});
  select.addEventListener("change",function(){var selected=select.value;withBusy(async function(){await saveEdits();payload=null;await load(selected);});});
  window.ENCOUNTER_COMPLETION_UI={open:open};
})();
