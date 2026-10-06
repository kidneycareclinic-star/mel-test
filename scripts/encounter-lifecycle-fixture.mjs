// Synthetic service fixture; UI tests run the real source, draft and review modules.
export function lifecycleFixture(w){
 const t=w.lifecycleTest={owner:'lifecycle-clinician',requests:[],draft:null,run:null,receipt:{id:'old-receipt',noteText:'PREVIOUS SIGNED NOTE',patientInstructions:'Previous approved instructions.'},lastSigned:{id:'previous-signed',note_text:'PREVIOUS SIGNED NOTE',signed_at:'2026-10-06T15:00:00Z',final_state_version:1},counter:0,getHold:null,failPrepare:false};
 w.currentPatient=w.PATIENTS[0];t.patient=w.currentPatient;t.second=w.PATIENTS[1];
 w.CLINICIAN_AUTH={userId:()=>t.owner};w.SUPABASE_DEMO_BACKEND={baseUrl:'https://synthetic.test',get anonJwt(){return t.owner?'synthetic-session':null;}};
 w.SYNTHETIC_ENCOUNTER_COORDINATOR_ENABLED=true;w.SYNTHETIC_NOTE_DRAFTING_ENABLED=true;w.SYNTHETIC_AUDIO_TRANSCRIPTION_ENABLED=true;
 t.permissionCalls=0;w.renderPatient=()=>{};w.SCRIBE_REVIEW_UI={refresh(){},applyBackendPatient(){}};w.RECORDED_AUDIO_UI={isRecording:()=>false,start(){t.permissionCalls++;}};w.MOBILE_PANE_UI={show(){}};
 const copy=v=>JSON.parse(JSON.stringify(v));
 w.fetch=async(url,opts)=>{
  const body=opts?.body?JSON.parse(opts.body):null,id=body?.patientId||new URL(url).searchParams.get('patient_id');t.requests.push({url,body});
  if(!body){if(url.includes('synthetic-encounter')&&t.getHold)await t.getHold;
   const isFirst=id===t.patient.id,patient=isFirst?t.patient:t.second;
   if(url.includes('synthetic-encounter'))return {ok:true,json:async()=>copy({patient,stateVersion:1,draft:isFirst?t.draft:null,lastSigned:isFirst?t.lastSigned:null})};
   return {ok:true,json:async()=>copy({patient,profile:{preferences:{template:'soap',detail:'standard',headings:[],instructions:''}},draft:isFirst?t.draft:null,preparation:isFirst?t.run||{status:'finalized'}:null,receipt:isFirst?t.receipt:null})};
  }
  if(body.action==='save-profile')return {ok:true,json:async()=>({saved:true})};
  if(body.action==='save-draft'){
   if(t.draft){if(body.encounterId!==t.draft.id||body.expectedVersion!==t.draft.version)throw Error('Stale save authority');t.draft.version++;}
   else {if(body.encounterId!==null)throw Error('Signed encounter reused');t.draft={id:'11111111-1111-4111-8111-'+String(++t.counter).padStart(12,'0'),version:1};}
   Object.assign(t.draft,{note_text:body.noteText,sources:copy(body.sources)});if(t.saveHold)await t.saveHold;return {ok:true,json:async()=>({encounterId:t.draft.id,version:t.draft.version})};
  }
  if(body.action==='prepare'){
   if(t.failPrepare)return {ok:false,json:async()=>({error:'note_drafting_provider_failed'})};
   const source=t.draft.sources.find(s=>s.kind!=='lab-trend'),action={id:'visit',kind:'follow-up',label:'Nephrology follow-up',details:'Return for follow-up.',timing:'in 6 months',sourceQuote:source.text,sourceTitle:source.title,intent:'physician-plan',patientText:'Return for follow-up in 6 months.',medication:null,blockers:[]};
   t.run={id:'run-'+t.counter,encounter_id:t.draft.id,status:'ready',current:true,packet_hash:'hash-'+t.counter,packet:{noteText:'SUBJECTIVE\n'+source.text+'\n\nPLAN\nReturn for follow-up in 6 months.',patientInstructions:action.patientText,actions:[action],sources:copy(t.draft.sources),sections:[],observations:[],reviews:[],tools:[]}};
   return {ok:true,json:async()=>copy({preparation:t.run,current:true})};
  }
  if(body.action==='save-review'){t.run.edit={version:(t.run.edit?.version||0)+1,reviewed_snapshot:copy(body)};return {ok:true,json:async()=>({reviewVersion:t.run.edit.version,saved:true})};}
  if(body.action==='finalize'){
   if(!body.instructionsReviewed||body.actions.some(a=>a.decision==='pending'))throw Error('Missing review');
   t.lastSigned={id:t.draft.id,note_text:body.noteText,signed_at:'2026-10-06T16:00:00Z',final_state_version:2};t.draft=null;t.run.status='finalized';t.receipt={id:'receipt-'+t.counter,noteText:body.noteText,patientInstructions:body.patientInstructions,actions:copy(body.actions)};
   return {ok:true,json:async()=>copy({...t.receipt,status:'finalized',receiptId:t.receipt.id,encounterId:t.lastSigned.id,stateVersion:2})};
  }
  throw Error('Unexpected lifecycle write '+body.action);
 };
}
