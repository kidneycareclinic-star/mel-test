// Actual command/coordinator/action UIs, synthetic network and microphone boundaries.
import assert from 'node:assert/strict';import fs from 'node:fs';import {pathToFileURL} from 'node:url';
const {JSDOM}=await import(pathToFileURL(process.env.DOM_TEST_MODULE).href);
const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{url:'https://example.test/preview/',runScripts:'outside-only'}),w=dom.window,d=w.document;
w.eval(fs.readFileSync('data.js','utf8'));w.currentPatient=w.PATIENTS[0];const patient=w.currentPatient,second=w.PATIENTS[1];
let owner='voice-physician',version=1,reviewVersion=0,sourceChanged=false,recording=false,permissionHold=null,transcriptionHold=null,heard='Open the proposed orders.',hints=[];
const requests=[],meterEvents=[],encounterId='11111111-1111-4111-8111-111111111111',preparationId='22222222-2222-4222-8222-222222222222';
let noteText='SUBJECTIVE\nNo edema.\n\nOBJECTIVE\nPotassium 4.9 mmol/L.\n\nASSESSMENT\nCKD per chart.\n\nPLAN\nDo not increase to two tablets.\nRepeat BMP in 3 months.';
const packet={noteText,patientInstructions:'Repeat BMP in 3 months.',sources:[{kind:'typed-note',text:'No edema. Repeat BMP in 3 months.'}],sections:[],observations:[],reviews:[],tools:[],actions:[{id:'voice-lab',kind:'lab',label:'Repeat BMP',details:'Repeat BMP.',timing:'in 3 months',sourceTitle:'Reviewed source',sourceQuote:'Repeat BMP in 3 months.',intent:'physician-plan',patientText:'Repeat BMP in 3 months.',blockers:[],medication:null}]};
let saved=null;
function ready(){return {patient,profile:{preferences:{template:'soap',detail:'standard',headings:[],instructions:''}},draft:w.currentPatient.id===patient.id?{id:encounterId,version,sources:[{kind:'typed-note',text:'Reviewed synthetic source'}]}:null,preparation:w.currentPatient.id===patient.id?{id:preparationId,encounter_id:encounterId,status:'ready',packet_hash:'voice-hash',current:!sourceChanged,packet,edit:saved?{version:reviewVersion,reviewed_snapshot:saved}:null}:null};}
w.CLINICIAN_AUTH={userId:()=>owner};w.SUPABASE_DEMO_BACKEND={baseUrl:'https://synthetic.test',get anonJwt(){return owner?'ci-session':null;}};
w.SYNTHETIC_ENCOUNTER_COORDINATOR_ENABLED=true;w.PRECHART_WORKSPACE_API={stopVoice(){},whenSourcesReady:async()=>{}};
w.RECORDED_AUDIO_UI={isRecording:()=>recording};w.MOBILE_PANE_UI={show(){}};
w.fetch=async(url,options)=>{
 if(url.includes('audio-transcription-gated')){
  const form=options.body;assert.equal(form.get('purpose'),'orchestrator-command');assert.equal(form.get('patientId'),patient.id);requests.push({type:'audio'});
  if(transcriptionHold)await transcriptionHold;
  return {ok:true,json:async()=>({patientId:patient.id,purpose:'orchestrator-command',text:heard,reviewHints:hints})};
 }
 const body=options.body&&JSON.parse(options.body);requests.push({type:'coordinator',body});
 if(!body)return {ok:true,json:async()=>ready()};
 if(body.action==='save-review'){assert.equal(body.voiceEncounterId,encounterId);assert.equal(body.voiceEncounterVersion,version);saved=body;noteText=body.noteText;reviewVersion++;return {ok:true,json:async()=>({reviewVersion})};}
 if(body.action==='prepare'){assert.equal(body.voiceCommand,true);assert.equal(body.encounterId,encounterId);assert.equal(body.expectedVersion,version);assert.equal(body.preferences.template,'soap');return {ok:true,json:async()=>({job:{id:'voice-job',status:'queued',stage:'chart'}})};}
 if(body.action==='save-profile')return {ok:true,json:async()=>({saved:true})};
 throw Error('Unexpected clinical action '+body.action);
};
let tracks=[];
Object.defineProperty(w.navigator,'mediaDevices',{value:{getUserMedia:async()=>{if(permissionHold)await permissionHold;const track={stopped:false,stop(){this.stopped=true;}};tracks.push(track);return {getTracks:()=>[track]};}}});
class Recorder{static isTypeSupported(m){return m.startsWith('audio/webm');}constructor(){this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';const self=this;setTimeout(()=>{self.ondataavailable?.({data:new w.Blob(['synthetic audio'])});self.onstop?.();},0);}}
w.MediaRecorder=Recorder;w.URL.createObjectURL=()=> 'blob:voice-ci';w.URL.revokeObjectURL=()=>{};
w.MICROPHONE_METER={mount:parent=>({start(){meterEvents.push(parent.id);w.dispatchEvent(new w.CustomEvent('microphone-meter-state',{detail:{sourceId:parent.id,kind:'start'}}));},stop(){}})};
w.eval(fs.readFileSync('note-drafting-ui.js','utf8'));w.eval(fs.readFileSync('encounter-actions-ui.js','utf8'));w.eval(fs.readFileSync('encounter-coordinator-ui.js','utf8'));w.eval(fs.readFileSync('agent-map-ui.js','utf8'));w.eval(fs.readFileSync('orchestrator-commands.js','utf8'));w.eval(fs.readFileSync('orchestrator-voice-ui.js','utf8'));
const settle=(ms=35)=>new Promise(r=>setTimeout(r,ms));await settle();
const panel=d.getElementById('orchestratorVoice'),input=panel.querySelector('[data-command]');
async function type(text){input.value=text;input.dispatchEvent(new w.Event('input'));panel.querySelector('[data-command-form]').dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();}
await type('Open the proposed orders.');assert.equal(w.ENCOUNTER_AGENT_MAP.selected(),'orders');assert.equal(d.activeElement,d.querySelector('[data-action] select'));assert.equal(requests.filter(r=>r.body).length,0);
for(const text of ['Sign this encounter.','Approve all orders.','Send me a text.','Open orders and sign.']){await type(text);assert.match(panel.querySelector('[data-status]').textContent,/cannot perform/);}
assert.equal(requests.filter(r=>r.body).length,0,'navigation and held commands never write');
await type('Add to plan: Do not start a new medication. Potassium 4.9 mmol/L.');assert.equal(panel.querySelector('[data-proposal]').hidden,false);assert.match(panel.querySelector('[data-after]').textContent,/Do not start/);assert.equal(d.querySelector('[data-note]').value,packet.noteText);assert.equal(requests.filter(r=>r.body).length,0,'proposals are read-only');
panel.querySelector('[data-reject]').click();assert.equal(d.querySelector('[data-note]').value,packet.noteText);
await type('Add to plan: Return in 2 months.');d.querySelector('[data-note]').value+='\nManual edit.';panel.querySelector('[data-apply]').click();await settle();assert.match(panel.querySelector('[data-status]').textContent,/changed/);assert.equal(requests.filter(r=>r.body?.action==='save-review').length,0);
d.querySelector('[data-note]').value=packet.noteText;await type('Add to plan: Return in 2 months.');
sourceChanged=true;panel.querySelector('[data-apply]').click();await settle();assert.match(panel.querySelector('[data-status]').textContent,/changed/);assert.equal(requests.filter(r=>r.body?.action==='save-review').length,0);sourceChanged=false;
// A reviewed plan change resets old approvals and persists through the protected draft API.
const action=d.querySelector('[data-action] select');action.value='accepted';d.querySelector('[data-instructions-reviewed]').checked=true;
await type('Add to plan: Return in 2 months.');panel.querySelector('[data-apply]').click();await settle();
assert.match(saved.noteText,/Do not increase to two tablets/);assert.match(saved.noteText,/Return in 2 months/);assert.equal(saved.actions[0].decision,'pending');assert.equal(saved.instructionsReviewed,false);assert.equal(d.querySelector('.coordinator-finalize').disabled,true);
// Permission request and late provider completion cannot carry a command to another patient.
let releasePermission;permissionHold=new Promise(r=>releasePermission=r);panel.querySelector('[data-record]').click();await settle();
w.currentPatient=second;w.dispatchEvent(new w.CustomEvent('scribe-patient-changed',{detail:{patientId:second.id}}));releasePermission();await settle();assert.equal(tracks.at(-1).stopped,true);assert.equal(requests.filter(r=>r.type==='audio').length,0);permissionHold=null;
w.currentPatient=patient;w.dispatchEvent(new w.CustomEvent('scribe-patient-changed',{detail:{patientId:patient.id}}));await settle();
let releaseTranscript;transcriptionHold=new Promise(r=>releaseTranscript=r);await w.ORCHESTRATOR_VOICE_UI.start();assert.equal(tracks.at(-1).stopped,false);assert.equal(meterEvents.at(-1),'orchestratorVoice');w.ORCHESTRATOR_VOICE_UI.stop();await settle();assert.equal(tracks.at(-1).stopped,true);
owner='another-physician';releaseTranscript();await settle();assert.equal(input.value,'','old clinician transcript is never displayed or executed');transcriptionHold=null;w.ORCHESTRATOR_VOICE_UI.cancel();owner='voice-physician';
// Ambiguous token hints require correction, while a known navigation command runs directly.
heard='Open the proposed orders.';hints=[' orders'];await w.ORCHESTRATOR_VOICE_UI.start();w.ORCHESTRATOR_VOICE_UI.stop();await settle();assert.match(panel.querySelector('[data-status]').textContent,/Double-check/);await type(input.value);assert.equal(w.ENCOUNTER_AGENT_MAP.selected(),'orders');
hints=[];await w.ORCHESTRATOR_VOICE_UI.start();w.ORCHESTRATOR_VOICE_UI.stop();await settle();assert.equal(w.ENCOUNTER_AGENT_MAP.selected(),'orders');
assert.equal(d.getElementById('ambientReviewedInput').value,'','commands never enter ambient review sources');
recording=true;await w.ORCHESTRATOR_VOICE_UI.start();assert.match(panel.querySelector('[data-status]').textContent,/Stop the ambient/);recording=false;
await type('Prepare this visit using my nephrology SOAP template.');assert.equal(requests.filter(r=>r.body?.action==='prepare').length,1);
assert.equal(requests.some(r=>['finalize','approve','sign','preferences','verify-start'].includes(r.body?.action)),false,'no voice clinical approval or SMS mutation');
w.ORCHESTRATOR_VOICE_UI.cancel();dom.window.close();
console.log('Voice DOM passed: direct navigation, explicit read-only plan proposal, exact guarded draft save, approval reset, source/edit races, actual capture lifecycle, permission/account isolation, token-hint review, separate ambient sources and saved-context preparation (provider/audio mocked).');
