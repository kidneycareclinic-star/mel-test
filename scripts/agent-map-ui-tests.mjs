import fs from 'node:fs';
import assert from 'node:assert/strict';
const {JSDOM}=await import(process.env.DOM_TEST_MODULE||'jsdom');
const dom=new JSDOM('<!doctype html><body class="agentic-shell"><div class="layout"><main><section id="demographics"></section><section class="context-panel"></section><section class="prechart-panel"><section id="encounterCoordinator"><p class="coordinator-status">Chart assembled</p><div class="coordinator-chart"><details><summary>Chart assembled</summary><p>PT-001 dated lab</p></details></div><div class="coordinator-capture"><div id="ambientCaptureCard"><textarea id="ambientReviewedInput">Physician correction retained</textarea></div><div id="dictationCaptureCard"><textarea id="physicianDictationInput"></textarea></div></div><details class="coordinator-preferences"><summary>Preferences</summary><select><option>SOAP</option></select></details><div class="coordinator-review"><textarea data-note>Exact physician note</textarea><textarea data-instructions>Reviewed instructions</textarea></div><button class="coordinator-finalize" disabled>Finalize</button></section></section><section class="loop-panel"><div id="openLoopList">PT-001 follow-up</div></section></main><aside class="agent-pane"><div id="findings">Existing Astra analysis</div></aside></div></body>',{url:'https://synthetic.test',runScripts:'outside-only'});
const w=dom.window,d=w.document;w.SYNTHETIC_ENCOUNTER_COORDINATOR_ENABLED=true;w.currentPatient={id:'PT-001'};
let calls=0,queue=0,inbox=0,stops=0,commandStops=0,frame=null;
w.fetch=()=>{calls++;throw Error('Dot selection must not request or mutate clinical state');};
w.FOLLOW_UP_QUEUE_UI={open(){queue++;}};w.ENCOUNTER_INBOX_UI={open(){inbox++;}};
w.ORCHESTRATOR_VOICE_UI={open(){},stop(){commandStops++;}};w.RECORDED_AUDIO_UI={stop(){stops++;}};w.PRECHART_WORKSPACE_API={stopVoice(){stops++;}};
w.requestAnimationFrame=fn=>{frame=fn;return 1;};w.cancelAnimationFrame=()=>{frame=null;};
w.eval(fs.readFileSync('agent-map-ui.js','utf8'));
const map=d.getElementById('encounterAgentMap'),panel=d.getElementById('agentFunctionPanel'),capture=d.querySelector('.coordinator-capture');
const click=id=>map.querySelector('[data-agent="'+id+'"] strong').click();
const settle=()=>new Promise(r=>setTimeout(r,0));
assert.equal(map.querySelectorAll('[data-agent]').length,8);
assert.equal(map.querySelectorAll('[aria-pressed="true"]').length,1);
assert.equal(w.ENCOUNTER_AGENT_MAP.selected(),'voice');assert.equal(capture.hidden,false);
assert.equal(d.getElementById('demographics').nextElementSibling.className,'prechart-panel');
const textarea=d.querySelector('[data-note]'),finalize=d.querySelector('.coordinator-finalize');
for(const id of ['orchestrator','chart','evidence','note','orders','verification','followup','voice']){
 click(id);assert.equal(w.ENCOUNTER_AGENT_MAP.selected(),id);assert.equal(map.querySelectorAll('[aria-pressed="true"]').length,1);
 assert.equal(textarea.value,'Exact physician note');assert(finalize.isConnected);assert.equal(finalize.disabled,true);
 assert.equal(d.getElementById('ambientReviewedInput').value,'Physician correction retained');
}
assert.equal(calls,0);assert.equal(queue,0);assert.equal(stops,0);
click('chart');assert.equal(d.querySelector('.coordinator-chart').hidden,false);assert.equal(d.querySelector('.coordinator-chart details').open,true);
click('evidence');assert.equal(d.querySelector('.agent-pane').closest('#agentFunctionContent').id,'agentFunctionContent');
click('note');assert.equal(d.querySelector('.agent-pane').parentNode.className,'layout');assert.equal(d.querySelector('.agent-pane').classList.contains('agent-map-inline-clinical'),false);
click('followup');assert.equal(d.querySelector('.loop-panel').closest('#agentFunctionContent').id,'agentFunctionContent');Array.from(panel.querySelectorAll('button')).find(b=>b.textContent==='Encounter inbox').click();assert.equal(inbox,1);Array.from(panel.querySelectorAll('button')).find(b=>b.textContent==='Assigned-patient queue').click();assert.equal(queue,1);
click('note');assert.equal(d.querySelector('.loop-panel').parentNode.tagName,'MAIN');
finalize.disabled=false;await settle();click('verification');assert.match(map.querySelector('[data-agent="verification"] .agent-dot-state').textContent,/Review available/);
finalize.disabled=true;await settle();assert.match(map.querySelector('[data-agent="verification"] .agent-dot-state').textContent,/Approval held/);
// The orb is driven by the existing meter's actual sample path, not an idle animation.
let sample=128;w.AudioContext=class {state='running';createMediaStreamSource(){return {connect(){},disconnect(){}};}createAnalyser(){return {fftSize:512,connect(){},disconnect(){},getByteTimeDomainData(data){data.fill(sample);}};}resume(){return Promise.resolve();}close(){return Promise.resolve();}};
w.eval(fs.readFileSync('microphone-meter.js','utf8'));
const meter=w.MICROPHONE_METER.mount(d.getElementById('ambientCaptureCard'));
click('note');meter.start({},'Recording');await settle();assert(map.classList.contains('is-recording'));assert.equal(capture.hidden,false);assert.equal(d.getElementById('agentMapStop').hidden,false);
frame(100);assert.equal(map.querySelector('.agent-orb-levels i').style.getPropertyValue('--orb-height'),'8px');
sample=255;frame(200);assert(parseFloat(map.querySelector('.agent-orb-levels i').style.getPropertyValue('--orb-height'))>8);
// An inactive dictation meter stopping cannot clear an active ambient stream.
w.dispatchEvent(new w.CustomEvent('microphone-meter-state',{detail:{kind:'stop',sourceId:'dictationCaptureCard'}}));assert(map.classList.contains('is-recording'));
d.getElementById('agentMapStop').click();assert.equal(stops,2);meter.stop();await settle();assert.equal(map.classList.contains('is-recording'),false);assert.equal(capture.hidden,true);
assert.equal(map.querySelector('.agent-orb-levels i').style.getPropertyValue('--orb-height'),'8px');
// Actual sample path updates the COMMAND dot while the ambient orb stays idle.
const commandPanel=d.createElement('section');commandPanel.id='orchestratorVoice';d.querySelector('#encounterCoordinator').appendChild(commandPanel);const commandMeter=w.MICROPHONE_METER.mount(commandPanel);click('orchestrator');commandMeter.start({},'Recording orchestrator command');await settle();assert.equal(capture.hidden,true);assert.equal(d.getElementById('agentMapStop').textContent,'Stop command');frame(300);assert(parseFloat(map.querySelector('[data-agent="orchestrator"] .agent-orb-levels i').style.getPropertyValue('--orb-height'))>8);assert.equal(map.querySelector('[data-agent="voice"] .agent-orb-levels i').style.getPropertyValue('--orb-height'),'8px');d.getElementById('agentMapStop').click();assert.equal(commandStops,1);assert.equal(stops,2,'command stop does not touch ambient capture');commandMeter.stop();await settle();assert.equal(map.querySelector('[data-agent="orchestrator"]').classList.contains('is-capturing'),false);assert.equal(d.getElementById('agentMapStop').hidden,true);
w.currentPatient={id:'PT-002'};w.dispatchEvent(new w.CustomEvent('scribe-patient-changed',{detail:{patientId:'PT-002'}}));await settle();assert.equal(d.getElementById('agentMapPatient').textContent,'PT-002');assert.equal(w.ENCOUNTER_AGENT_MAP.selected(),'voice');
assert.match(map.querySelector('[data-agent="orders"] .agent-dot-state').textContent,/source drafts/);assert.match(map.querySelector('[data-agent="followup"] .agent-dot-state').textContent,/phone alert settings/);
assert.equal(calls,0);
for(const file of ['agent-map-ui.js','agent-map-ui.css','microphone-meter.js','encounter-coordinator-ui.js','index.html'])assert.equal(fs.readFileSync(file,'utf8'),fs.readFileSync('preview/'+file,'utf8'));
dom.window.close();console.log('Agent map DOM passed: labeled hierarchy, navigation without mutations, editor preservation, exact approval gate, inline evidence/loops, real-sample orb, explicit stop, patient reset and preview parity.');
