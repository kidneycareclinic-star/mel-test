import assert from 'node:assert/strict';import fs from 'node:fs';import {pathToFileURL} from 'node:url';
const {JSDOM}=await import(pathToFileURL(process.env.DOM_TEST_MODULE).href);
const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{url:'https://example.test/preview/',runScripts:'outside-only'}),w=dom.window,d=w.document;
w.eval(fs.readFileSync('data.js','utf8'));w.currentPatient=w.PATIENTS[0];const first=w.currentPatient;w.renderPatient=()=>{};let rec,tracksStopped=0,recognition,posts=[],fail=false;
Object.defineProperty(w.navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>{tracksStopped++;}}]})}});
class Recording{static isTypeSupported(m){return m.startsWith('audio/webm');}constructor(){this.state='inactive';rec=this;}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new w.Blob(['synthetic audio'],{type:'audio/webm'})});this.onstop();}}
w.MediaRecorder=Recording;w.URL.createObjectURL=()=> 'blob:synthetic';w.URL.revokeObjectURL=()=>{};
class Recognition{constructor(){recognition=this;}start(){this.onstart();}stop(){this.onend();}}
w.SpeechRecognition=Recognition;w.SUPABASE_DEMO_BACKEND={baseUrl:'https://synthetic.test',anonJwt:'ci-session'};
w.fetch=async(url,options)=>{posts.push({url,options});if(fail)return {ok:false,json:async()=>({error:'transcription_provider_failed'})};return {ok:true,json:async()=>({patientId:options.body.get('patientId'),text:'I do not take two tablets. Potassium four point nine.\nNo no swelling.',reviewHints:[' nine']})};};
w.eval(d.getElementById('syntheticAudioTranscriptionConfig').textContent);
assert.equal(w.SYNTHETIC_AUDIO_TRANSCRIPTION_ENABLED,true,'approved preview must enable recorded transcription before the UI loads');
w.eval(fs.readFileSync('prechart-workspace.js','utf8'));w.eval(fs.readFileSync('recorded-audio-ui.js','utf8'));w.PRECHART_WORKSPACE_API.open();
const raw=d.getElementById('ambientTranscriptInput'),review=d.getElementById('ambientReviewedInput');
async function settle(){await new Promise(r=>setTimeout(r,15));}async function click(id){d.getElementById(id).click();await settle();}
await click('recordAudioBtn');assert.equal(rec.state,'recording');await click('recordAudioBtn');assert.ok(tracksStopped>0);assert.equal(d.getElementById('recordedAudioPlayback').hidden,false);assert.equal(posts.length,0,'recording itself must not upload audio');
fail=true;await click('transcribeAudioBtn');assert.equal(d.getElementById('transcribeAudioBtn').disabled,false);assert.equal(d.getElementById('recordedAudioPlayback').hidden,false);assert.match(d.getElementById('recordAudioStatus').textContent,/retained/);
fail=false;await click('transcribeAudioBtn');assert.equal(raw.value,'','provider text requires explicit import');await click('useRecordedTranscriptBtn');assert.equal(raw.value,'I do not take two tablets. Potassium four point nine.\nNo no swelling.');assert.equal(review.value,raw.value);review.value='Physician corrected text';raw.value+=' Later words.';await click('reviewAmbientBtn');assert.equal(review.value,'Physician corrected text','local copying must not overwrite corrected draft');await click('copyRawReviewBtn');assert.equal(review.value,raw.value);
await click('discardAudioBtn');assert.equal(d.getElementById('recordedAudioPlayback').hidden,true);assert.equal(raw.value.includes('No no swelling.'),true,'discarding audio retains reviewed text');
raw.value='';review.value='Keep my reviewed correction';await click('startAmbientDemoBtn');const r1=[{transcript:'No no swelling.'}];r1.isFinal=true;const interim=[{transcript:'Not final dose'}];interim.isFinal=false;
recognition.onresult({resultIndex:0,results:[r1,interim]});assert.equal(raw.value,'No no swelling. Not final dose');assert.equal(review.value,'Keep my reviewed correction');recognition.onresult({resultIndex:0,results:[r1,interim]});assert.equal(raw.value,'No no swelling. Not final dose','replayed recognition events cannot duplicate final words');await click('startAmbientDemoBtn');assert.equal(raw.value,'No no swelling.','interim text must not survive stop');assert.equal(posts.filter(p=>p.url.includes('ambient-scribe-write')).length,0,'live speech must not create observation proposals');
await click('recordAudioBtn');assert.equal(rec.state,'recording');const second=w.PATIENTS[1];w.currentPatient=second;w.PRECHART_WORKSPACE_API.refresh();assert.equal(rec.state,'inactive','patient switch must stop recording');assert.equal(raw.value,'');assert.equal(review.value,'');assert.equal(d.getElementById('useRecordedTranscriptBtn').disabled,true);w.currentPatient=first;w.PRECHART_WORKSPACE_API.refresh();assert.equal(raw.value,'No no swelling.');assert.equal(review.value,'Keep my reviewed correction');
const exactRaw=raw.value,exactReviewed=review.value;await click('addAmbientSourceBtn');const source=w.PRECHART_WORKSPACE_API.getPatientState(first.id).sources.find(s=>s.kind==='ambient-transcript');assert.equal(source.rawText,exactRaw);assert.equal(source.text,exactReviewed);
w.dispatchEvent(new w.Event('pagehide'));dom.window.close();console.log('Recorded audio/browser DOM: local-only recording/playback, retry with retained audio, explicit transcript import, exact negations/numbers/repetitions, review edit retention, replay deduplication, interim exclusion, no live proposals and patient isolation passed.');

const disabledDom=new JSDOM('<section id="ambientCaptureCard"><div class="ambient-transcript-grid"></div></section>',{url:'https://example.test',runScripts:'outside-only'});
disabledDom.window.eval(fs.readFileSync('recorded-audio-ui.js','utf8'));
assert.equal(disabledDom.window.document.getElementById('transcribeAudioBtn').disabled,true);
assert.match(disabledDom.window.document.getElementById('recordAudioStatus').textContent,/not enabled/);
disabledDom.window.close();console.log('Published default keeps external audio transcription disabled pending authorization.');
