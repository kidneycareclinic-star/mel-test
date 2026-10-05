import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_TEST_MODULE||'playwright');
const root=process.cwd(),output=path.join(root,'agent-map-screenshots');fs.mkdirSync(output,{recursive:true});
// Render the real protected page and actual UI modules with synthetic backend responses.
// No real account credentials, microphone, model requests, or clinical writes are used.
const html=fs.readFileSync('index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
 const file=path.resolve(root,'.'+url.pathname);
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;res.end();return;}
 res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(fs.readFileSync(file));
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1100}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try {
 await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle'});
 await page.evaluate(()=>{
  document.getElementById('clinicianSignIn').hidden=true;
  document.documentElement.classList.add('clinician-authenticated');
  window.currentPatient={id:'PT-001',name:'Synthetic patient',labs:{eGFR:{value:31,unit:'mL/min/1.73m²'}},meds:[],problemList:[{name:'CKD G3b, existing chart'}]};
  window.SYNTHETIC_ENCOUNTER_COORDINATOR_ENABLED=true;window.SYNTHETIC_AUDIO_TRANSCRIPTION_ENABLED=true;
  window.SUPABASE_DEMO_BACKEND={baseUrl:'https://synthetic.test',anonJwt:'browser-ci-only'};
  window.PRECHART_WORKSPACE_API={stopVoice(){},whenSourcesReady(){return Promise.resolve();}};
  window.NOTE_DRAFTING={mount(parent){parent.insertAdjacentHTML('beforeend','<label>Template<select><option>Nephrology SOAP</option><option>Problem-oriented</option></select></label>');},preferences(){return {};}};
  window.RECORDED_AUDIO_UI={stop(){}};
  window.FOLLOW_UP_QUEUE_UI={open(){}};
  window.browserJob={id:'browser-job',status:'ready',stage:'verification',stages:{chart:'complete',evidence:'complete',note:'complete',orders:'complete',verification:'complete'}};
  window.testRequests=[];
  window.fetch=async(url,options)=>{
   window.testRequests.push({url,method:options?.method});if(options?.method==='POST')throw Error('No clinical writes allowed in browser navigation test');
   return {ok:true,json:async()=>({patient:window.currentPatient,job:window.browserJob,draft:{id:'ci-encounter',version:1},preparation:{id:'ci-preparation',encounter_id:'ci-encounter',status:'ready',current:true,packet_hash:'ci-hash',packet:{noteText:'SUBJECTIVE\nPatient reports no new swelling.\n\nOBJECTIVE\nHistorical eGFR 31 mL/min/1.73m².\n\nASSESSMENT\nCKD G3b per chart.\n\nPLAN\nPhysician review of the current chart and encounter.',patientInstructions:'No patient-specific instructions documented.',sources:[{kind:'reviewed-transcript',text:'No new swelling.'}],observations:[],reviews:[],tools:[],sections:[],actions:[{id:'browser-lab',kind:'lab',label:'Repeat BMP',details:'Repeat BMP.',timing:'in 3 months',sourceTitle:'Reviewed transcript',sourceQuote:'Physician: repeat BMP in 3 months.',intent:'physician-plan',patientText:'Get a repeat BMP in 3 months.',blockers:[],medication:null}],clinicalEvidence:{applicability:'Historical CKD G3b chart context; confirm applicability.',corpusVersion:'kdigo-2024-monitoring-20261005',checkedAt:'2026-10-05',clinicalValidation:'Starter reference set; physician review required',references:[{title:'Kidney function and albuminuria monitoring',summary:'Review GFR and albuminuria monitoring in CKD.',section:'Practice Points 2.1.1–2.1.2',page:40,url:'https://kdigo.org/wp-content/uploads/2026/04/KDIGO-2024-CKD-Guideline.pdf#page=40',role:'Reference; not an order'}]}}}})};
  };
  document.getElementById('ptName').textContent='Synthetic patient · PT-001';document.getElementById('ptMeta').textContent='Office follow-up · Synthetic testing only';
  document.getElementById('contextMeta').textContent='Recorded context and source detail';
 });
 await page.addScriptTag({path:path.join(root,'theme.js')});
 await page.addScriptTag({path:path.join(root,'microphone-meter.js')});
 await page.addScriptTag({path:path.join(root,'recorded-audio-ui.js')});
 await page.addScriptTag({path:path.join(root,'encounter-actions-ui.js')});
 await page.addScriptTag({path:path.join(root,'encounter-coordinator-ui.js')});
 await page.addScriptTag({path:path.join(root,'agent-map-ui.js')});
 await page.locator('[data-note]').waitFor();
 assert.equal(await page.locator('#encounterAgentMap [data-agent]').count(),8);
 assert.equal(await page.locator('[data-agent="note"] .agent-dot-state').textContent(),'Task complete');
 await page.evaluate(()=>{window.browserJob={...window.browserJob,status:'running',stage:'orders',stages:{...window.browserJob.stages,orders:'working',verification:'waiting'}};return window.ENCOUNTER_COORDINATOR_UI.refresh();});
 assert.equal(await page.locator('[data-agent="orders"] .agent-dot-state').textContent(),'Working');
 assert.equal(await page.locator('.coordinator-finalize').isDisabled(),true);
 await page.evaluate(()=>{window.browserJob={...window.browserJob,status:'ready',stage:'verification',stages:{chart:'complete',evidence:'complete',note:'complete',orders:'complete',verification:'complete'}};return window.ENCOUNTER_COORDINATOR_UI.refresh();});
 await page.locator('[data-agent="note"] strong').click();
 for(const id of ['orchestrator','chart','evidence','orders','verification','followup','voice','note'])await page.locator('[data-agent="'+id+'"] strong').click();
 assert.equal(await page.locator('[data-note]').count(),1);
 assert.equal(await page.locator('[data-action]').count(),1);assert.equal(await page.locator('.coordinator-finalize').isDisabled(),true);
 await page.locator('[data-agent="evidence"] strong').click();await page.getByRole('button',{name:'KDIGO reference review'}).click();assert.equal(await page.locator('[data-evidence] details').getAttribute('open'),'');
 await page.locator('[data-agent="orders"] strong').click();await page.getByRole('button',{name:'Draft actions',exact:true}).click();assert.equal(await page.locator('[data-action] select').evaluate(n=>n===document.activeElement),true);
 const regions=await page.evaluate(()=>[...document.querySelectorAll('#encounterAgentMap [data-agent]')].map(n=>{const r=n.getBoundingClientRect();return {width:r.width,height:r.height};}));
 assert(regions.every(r=>r.width>=44&&r.height>=44));
 for(const theme of ['dark','light']){
  await page.evaluate(value=>{document.documentElement.dataset.theme=value;},theme);
  await page.locator('#encounterAgentMap').screenshot({path:path.join(output,theme+'-agent-map.png')});
  await page.screenshot({path:path.join(output,theme+'-desktop.png'),fullPage:true});
 }
 for(const width of [760,390,320]){
  await page.setViewportSize({width,height:1000});
  await page.evaluate(()=>{document.documentElement.dataset.theme='light';});
  const overflow=await page.evaluate(()=>({page:document.documentElement.scrollWidth,viewport:window.innerWidth,map:document.getElementById('encounterAgentMap').scrollWidth,mapWidth:document.getElementById('encounterAgentMap').clientWidth}));
  assert(overflow.page<=overflow.viewport+1,JSON.stringify({width,...overflow}));assert(overflow.map<=overflow.mapWidth+1,JSON.stringify({width,...overflow}));
  const overlap=await page.evaluate(()=>{const nodes=[...document.querySelectorAll('#encounterAgentMap [data-agent]')].map(n=>n.getBoundingClientRect());return nodes.some((a,i)=>nodes.some((b,j)=>i!==j&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top));});
  assert.equal(overlap,false,'Dot targets must not overlap at '+width);
  await page.locator('#encounterAgentMap').screenshot({path:path.join(output,'light-'+width+'-agent-map.png')});
 }
 // Render the actual authenticated inbox, mobile routing and scoped coordinator together.
 await page.evaluate(()=>{
  const prior=window.fetch;window.CLINICIAN_AUTH={userId:()=> 'browser-physician'};window.PATIENTS=[window.currentPatient];window.BACKEND_PATIENT_READY=Promise.resolve();
  window.openEncounterPatient=patient=>{window.currentPatient=patient;window.dispatchEvent(new CustomEvent('scribe-patient-changed',{detail:{patientId:patient.id}}));};
  window.fetch=async(url,options)=>{
   if(url.includes('phone-alerts-gated'))return {ok:true,json:async()=>({preferences:{version:1,mode:'preview',readyAlerts:true,pausedAlerts:true,quietHours:true,timeZone:'America/New_York',phoneLast4:null,verified:false,verificationPending:false,consented:false},providerReady:false,history:[{id:'browser-preview',jobId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',reason:'ready',status:'preview',transport:'preview',text:'KidneyCare: An encounter is ready for your review. Sign in securely: https://kidneycareclinic-star.github.io/mel-test/preview/#review/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa Reply STOP to stop alerts.',createdAt:'2026-10-05T21:00:00Z'}],previewText:'KidneyCare: An encounter is ready for your review. Sign in securely: https://kidneycareclinic-star.github.io/mel-test/preview/ Reply STOP to stop alerts.'})};
   if(!url.includes('encounter-inbox-gated')){const response=await prior(url,options),data=await response.json();return {ok:response.ok,json:async()=>({...data,profile:{version:1,preferences:{}}})};}
   const params=new URL(url).searchParams;return {ok:true,json:async()=>params.has('job_id')?{mode:'review',patientId:'PT-001',encounterId:'ci-encounter',jobId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',replaced:true}:{items:[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',encounterId:'ci-encounter',patientId:'PT-001',patientName:'Synthetic patient',status:'ready',revision:'4:ready',seen:false}],counts:{attention:1,unseen:1,preparing:0},hasNext:false}};
  };
 });
 await page.addScriptTag({path:path.join(root,'mobile-ui.js')});await page.addScriptTag({path:path.join(root,'encounter-inbox-ui.js')});await page.addScriptTag({path:path.join(root,'phone-alerts-ui.js')});
 await page.setViewportSize({width:1440,height:1100});
 for(const theme of ['dark','light']){await page.evaluate(value=>{document.documentElement.dataset.theme=value;return window.ENCOUNTER_INBOX_UI.open();},theme);await page.locator('#encounterInboxDialog').screenshot({path:path.join(output,theme+'-encounter-inbox.png')});}
 for(const width of [760,390,320]){
  await page.setViewportSize({width,height:1000});await page.evaluate(()=>window.ENCOUNTER_INBOX_UI.open());
  const metrics=await page.evaluate(()=>{const n=document.getElementById('encounterInboxDialog');return {page:document.documentElement.scrollWidth,viewport:innerWidth,dialog:n.scrollWidth,width:n.clientWidth,targets:[...n.querySelectorAll('button')].map(b=>b.getBoundingClientRect().height).filter(h=>h>0)};});
  assert(metrics.page<=metrics.viewport+1,JSON.stringify(metrics));assert(metrics.dialog<=metrics.width+1,JSON.stringify(metrics));assert(metrics.targets.every(h=>h>=44));
  await page.locator('#encounterInboxDialog').screenshot({path:path.join(output,'light-'+width+'-encounter-inbox.png')});
 }
 await page.evaluate(()=>{document.getElementById('encounterPhoneAlerts').open=true;});
 await page.waitForFunction(()=>document.querySelector('[data-phone-state]').textContent==='Preview only');
 assert.equal(await page.locator('[data-connect]').isVisible(),false);
 assert.equal(await page.locator('[data-mode] option[value=sms]').isDisabled(),true);
 for(const theme of ['dark','light']){
  await page.setViewportSize({width:1440,height:1100});await page.evaluate(v=>{document.documentElement.dataset.theme=v;},theme);
  await page.locator('[data-preferences]').screenshot({path:path.join(output,theme+'-phone-alert-preferences.png')});
  await page.locator('.phone-preview').screenshot({path:path.join(output,theme+'-phone-alert-message.png')});
 }
 for(const width of [760,390,320]){
  await page.setViewportSize({width,height:1000});await page.evaluate(()=>{document.documentElement.dataset.theme='light';});
  const metrics=await page.evaluate(()=>{const n=document.getElementById('encounterInboxDialog');return {page:document.documentElement.scrollWidth,viewport:innerWidth,dialog:n.scrollWidth,width:n.clientWidth,targets:[...document.querySelectorAll('#encounterPhoneAlerts button,#encounterPhoneAlerts select,#encounterPhoneAlerts input:not([type=checkbox]),#encounterPhoneAlerts .phone-check')].map(b=>b.getBoundingClientRect().height).filter(h=>h>0)};});
  assert(metrics.page<=metrics.viewport+1,JSON.stringify(metrics));assert(metrics.dialog<=metrics.width+1,JSON.stringify(metrics));assert(metrics.targets.every(h=>h>=44),JSON.stringify(metrics));
  await page.locator('[data-preferences]').screenshot({path:path.join(output,'light-'+width+'-phone-alert-preferences.png')});
  await page.locator('.phone-preview').screenshot({path:path.join(output,'light-'+width+'-phone-alert-message.png')});
 }
 await page.evaluate(()=>{document.getElementById('encounterPhoneAlerts').open=false;});
 await page.getByRole('button',{name:'Open review',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('encounterInboxDialog').open);
 assert.equal(await page.locator('#mainLayout').evaluate(n=>n.classList.contains('mobile-pane-patient')),true);assert.match(await page.locator('#encounterInboxNotice').textContent(),/original preparation changed/);
 assert.equal(await page.locator('.coordinator-finalize').isDisabled(),true,'inbox navigation cannot approve action drafts');
 assert.equal(await page.locator('[data-note]').count(),1);
 assert.deepEqual(errors,[]);
 console.log('Browser checks passed: real UI modules, dark/light rendering, labeled dot targets, one note editor, 760/390/320px overflow and hit-target separation. Synthetic backend only.');
} catch(error) {
 await page.screenshot({path:path.join(output,'failure-layout.png'),fullPage:true}).catch(()=>{});
 console.log('Browser diagnostic:',await page.evaluate(()=>({errors:window.testRequests,overflow:[...document.querySelectorAll('body *')].filter(n=>{const r=n.getBoundingClientRect();return r.width&&r.right>window.innerWidth+1;}).slice(0,12).map(n=>({tag:n.tagName,id:n.id,class:n.className,right:n.getBoundingClientRect().right}))})).catch(()=>({})));
 throw error;
} finally {await browser.close();await new Promise(r=>server.close(r));}
