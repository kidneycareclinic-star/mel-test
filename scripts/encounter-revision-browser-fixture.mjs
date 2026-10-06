// Shared synthetic network fixture for DOM and actual Chromium checks. No real provider.
export function revisionBrowserFixture(w){
 const t=w.revisionTest={owner:'revision-physician',version:1,reviewVersion:0,saved:null,hold:null,failApply:false,requests:[],heard:'Change follow-up to three months and update patient instructions.'};
 w.currentPatient=w.PATIENTS[0];const patient=w.currentPatient;t.patient=patient;t.second=w.PATIENTS[1];t.encounterId='11111111-1111-4111-8111-111111111111';t.preparationId='22222222-2222-4222-8222-222222222222';t.proposalId='33333333-3333-4333-8333-333333333333';
 t.note='SUBJECTIVE\nNo edema.\n\nOBJECTIVE\nPotassium 4.9 mmol/L.\n\nASSESSMENT\nCKD per chart.\n\nPLAN\nRepeat BMP in 6 months.\nReturn for follow-up in 6 months.\nContinue lisinopril 5 mg daily.\nDo not start a new medication.';t.instructions='Get a repeat BMP in 6 months.\n\nReturn for follow-up in 6 months.\n\nDo not start a new medication.';
 t.actions=[{id:'lab',kind:'lab',label:'BMP',details:'Repeat BMP.',timing:'in 6 months',patientText:'Get a repeat BMP in 6 months.'},{id:'visit',kind:'follow-up',label:'Nephrology follow-up',details:'Return for follow-up.',timing:'in 6 months',patientText:'Return for follow-up in 6 months.'}].map(a=>({...a,intent:'physician-plan',blockers:[],sourceTitle:'Reviewed source',sourceQuote:a.patientText,medication:null}));
 t.packet={noteText:t.note,patientInstructions:t.instructions,sources:[{kind:'typed-note',text:'Reviewed source'}],sections:[],observations:[],reviews:[],tools:[],actions:t.actions};
 t.saved={noteText:t.note,patientInstructions:t.instructions,actions:t.actions.map(a=>({actionId:a.id,decision:'accepted',clarified:false})),observations:[],reviews:[],tools:[],instructionsReviewed:true,instructionsManual:true};
 function copy(v){return JSON.parse(JSON.stringify(v));}
 w.CLINICIAN_AUTH={userId:()=>t.owner};w.SUPABASE_DEMO_BACKEND={baseUrl:'https://synthetic.test',get anonJwt(){return t.owner?'ci-session':null;}};w.SYNTHETIC_ENCOUNTER_COORDINATOR_ENABLED=true;w.SYNTHETIC_AUDIO_TRANSCRIPTION_ENABLED=true;
 w.PRECHART_WORKSPACE_API={stopVoice(){},whenSourcesReady:async()=>{}};w.RECORDED_AUDIO_UI={isRecording:()=>false};w.MOBILE_PANE_UI={show(){}};
 w.fetch=async(url,opts)=>{
  if(url.includes('audio-transcription-gated')){t.requests.push({kind:'audio'});return {ok:true,json:async()=>({patientId:patient.id,purpose:'orchestrator-command',text:t.heard,reviewHints:[]})};}
  const body=opts?.body&&JSON.parse(opts.body);t.requests.push({url,body});
  if(url.includes('encounter-revision-gated')){
   if(body.action==='discard')return {ok:true,json:async()=>({discarded:true})};
   if(body.action==='apply'){
    if(t.failApply)return {ok:false,json:async()=>({error:'revision_unavailable'})};
    if(Object.keys(body).sort().join(',')!=='action,confirm,patientId,proposalId'||body.confirm!==true)throw Error('Unexpected approval authority');
    t.saved=copy(t.after);t.reviewVersion=t.proposedVersion+1;
    return {ok:true,json:async()=>({apiVersion:'encounter-revision-v18',patientId:patient.id,encounterId:t.encounterId,sourceVersion:t.version,preparationId:t.preparationId,packetHash:'revision-hash',reviewVersion:t.proposedVersion,proposalId:t.proposalId,saved:true,externalExecution:false,appliedReviewVersion:t.reviewVersion,reviewedSnapshot:copy(t.saved)})};
   }
   t.proposedVersion=body.reviewVersion;t.after=copy(t.saved);t.after.noteText=t.after.noteText.replace('Return for follow-up in 6 months.','Return for follow-up in 3 months.');t.after.patientInstructions=t.after.patientInstructions.replace('Return for follow-up in 6 months.','Return for follow-up in 3 months.');Object.assign(t.after.actions[1],{decision:'edited',label:'Nephrology follow-up',details:'Return for follow-up.',timing:'in 3 months',patientText:'Return for follow-up in 3 months.',medication:null,clarified:false});t.after.instructionsReviewed=false;
   const result={apiVersion:'encounter-revision-v18',...body,kind:'proposal',proposalId:t.proposalId,expiresAt:new Date(Date.now()+600000).toISOString(),confirmationRequired:true,externalExecution:false,changes:[{kind:'note',label:'Note · Plan',before:t.note.split('PLAN\n')[1],after:t.after.noteText.split('PLAN\n')[1]},{kind:'action',label:'Follow-up draft',before:'in 6 months',after:'in 3 months',sourceTitle:'Reviewed source',sourceQuote:'Return for follow-up in 6 months.'},{kind:'instructions',label:'Full patient instructions',before:t.instructions,after:t.after.patientInstructions}]};if(t.hold)await t.hold;return {ok:true,json:async()=>result};
  }
  if(!body)return {ok:true,json:async()=>copy({patient:w.currentPatient,profile:{preferences:{template:'soap',detail:'standard',headings:[],instructions:''}},draft:w.currentPatient.id===patient.id?{id:t.encounterId,version:t.version,sources:[{kind:'typed-note',text:'Reviewed source'}]}:null,preparation:w.currentPatient.id===patient.id?{id:t.preparationId,encounter_id:t.encounterId,status:'ready',packet_hash:'revision-hash',current:true,packet:t.packet,edit:t.reviewVersion?{version:t.reviewVersion,reviewed_snapshot:t.saved}:null}:null})};
  if(body.action==='save-profile')return {ok:true,json:async()=>({saved:true})};
  if(body.action==='save-review'){t.saved=copy(body);t.reviewVersion++;return {ok:true,json:async()=>({saved:true,reviewVersion:t.reviewVersion})};}
  throw Error('Unexpected clinical write '+body.action);
 };
 class Recorder{static isTypeSupported(){return true;}constructor(){this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';w.setTimeout(()=>{this.ondataavailable?.({data:new w.Blob(['synthetic'])});this.onstop?.();},0);}}
 w.MediaRecorder=Recorder;Object.defineProperty(w.navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}});w.URL.createObjectURL=()=> 'blob:ci-only';w.URL.revokeObjectURL=()=>{};w.MICROPHONE_METER={mount:()=>({start(){},stop(){}})};
}
