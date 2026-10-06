// Actual push UI, consent and account races. Browser subscription and network are synthetic.
import assert from 'node:assert/strict';import fs from 'node:fs';import {pathToFileURL} from 'node:url';import {webcrypto} from 'node:crypto';
const {JSDOM}=await import(pathToFileURL(process.env.DOM_TEST_MODULE).href);
const dom=new JSDOM('<div class="top-right"></div>',{url:'https://example.test/preview/#inbox',runScripts:'outside-only'}),w=dom.window,d=w.document;
let owner='push-physician',version=1,enabled=false,active=false,sub=null,permissionHold=null,permissionCalls=0,fetchHold=null,history=[];
const requests=[],deviceId='11111111-1111-4111-8111-111111111111';
Object.defineProperty(w,'isSecureContext',{value:true});Object.defineProperty(w,'crypto',{value:webcrypto});w.TextEncoder=TextEncoder;w.AbortSignal=AbortSignal;
w.PushManager=function(){};w.Notification={permission:'default',requestPermission:async()=>{permissionCalls++;if(permissionHold)await permissionHold;return w.Notification.permission='granted';}};w.matchMedia=()=>({matches:false});
const device={endpoint:'https://fcm.googleapis.com/wp/ui-fixture',toJSON:()=>({endpoint:device.endpoint,keys:{p256dh:'B'.repeat(87),auth:'C'.repeat(22)}}),unsubscribe:async()=>{sub=null;return true;}};
let subscribeCalls=0;const registration={pushManager:{getSubscription:async()=>sub,subscribe:async(options)=>{subscribeCalls++;assert.equal(options.userVisibleOnly,true);assert.ok(options.applicationServerKey.length===65);sub=device;return sub;}}};
Object.defineProperty(w.navigator,'serviceWorker',{value:{register:async(url,options)=>{assert.equal(url,'https://example.test/preview/ehr-push-sw.js');assert.equal(options.scope,'https://example.test/preview/');return registration;},ready:Promise.resolve(registration),getRegistration:async()=>registration}});
w.CLINICIAN_AUTH={userId:()=>owner};w.SUPABASE_DEMO_BACKEND={baseUrl:'https://synthetic.test',get anonJwt(){return owner?'ci-only':null;}};
w.fetch=async(url,options)=>{
 if(url.includes('encounter-inbox-gated'))return {ok:true,json:async()=>({items:[],counts:{attention:0,unseen:0,preparing:0},page:0,hasNext:false})};
 assert.match(url,/push-alerts-gated/);const body=options.body&&JSON.parse(options.body);requests.push(body||{read:true});if(fetchHold)await fetchHold;
 if(body){assert.equal(body.expectedVersion,version);if(body.action==='subscribe'){assert.equal(body.consent,true);assert.deepEqual(Object.keys(body.subscription).sort(),['endpoint','keys']);version++;active=enabled=true;}else if(body.action==='test'){assert.equal(body.deviceId,deviceId);history=[{status:'accepted',test:true,createdAt:new Date().toISOString()}];}else if(body.action==='unsubscribe'||body.action==='disable-all'){active=false;version++;if(body.action==='disable-all')enabled=false;}else throw Error('Unexpected authority '+body.action);}
 return {ok:true,json:async()=>({apiVersion:'push-alerts-v17',preferences:{version,enabled,quietHours:true,timeZone:'America/New_York'},serverReady:true,publicKey:'B'+('A'.repeat(86)),device:active||history.length?{id:deviceId,active}:null,activeDevices:active?1:0,history})};
};
w.eval(fs.readFileSync('encounter-inbox-ui.js','utf8'));w.eval(fs.readFileSync('push-alerts-ui.js','utf8'));const settle=()=>new Promise(r=>setTimeout(r,40));await settle();
const panel=d.getElementById('encounterPushAlerts'),q=selector=>panel.querySelector(selector);
assert.ok(d.getElementById('encounterInboxDialog').hasAttribute('open'),'generic notification route opens the authenticated inbox');assert.equal(q('[data-push-test]').disabled,true);
q('[data-push-enable]').click();await settle();assert.equal(permissionCalls,0,'permission is never asked without explicit consent');assert.equal(subscribeCalls,0);assert.match(q('[data-push-status]').textContent,/Choose/);
q('[data-push-consent]').checked=true;q('[data-push-enable]').click();await settle();assert.equal(permissionCalls,1);assert.equal(subscribeCalls,1);assert.equal(q('[data-push-test]').disabled,false);assert.match(q('[data-push-state]').textContent,/Enabled/);assert.equal(w.localStorage.getItem('kidneycare-push-owner-v17'),owner);
q('[data-push-test]').click();await settle();assert.match(q('[data-push-status]').textContent,/about a minute/);assert.match(q('[data-push-history]').textContent,/receipt is not confirmed/);
q('[data-push-disable]').click();await settle();assert.equal(sub,null);assert.equal(active,false);assert.equal(q('[data-push-test]').disabled,true);assert.equal(w.localStorage.getItem('kidneycare-push-owner-v17'),null);
// A delayed permission result cannot subscribe for another clinician.
let release;permissionHold=new Promise(r=>release=r);q('[data-push-consent]').checked=true;q('[data-push-enable]').click();await settle();owner='other-clinician';release();await settle();assert.equal(subscribeCalls,1);permissionHold=null;owner='push-physician';await w.PUSH_ALERTS_UI.refresh();
q('[data-push-consent]').checked=true;q('[data-push-enable]').click();await settle();await w.PUSH_ALERTS_UI.signOut();assert.equal(active,false);assert.equal(sub,null);assert.equal(requests.at(-1).action,'unsubscribe','explicit sign-out disables the server device before the Auth token is cleared');
// No late view or history is rendered to a changed account.
fetchHold=new Promise(r=>release=r);const refresh=w.PUSH_ALERTS_UI.refresh();await settle();owner='other-clinician';release();await refresh;assert.equal(q('[data-push-history]').textContent,'');fetchHold=null;owner='push-physician';await w.PUSH_ALERTS_UI.refresh();
Object.defineProperty(w.navigator,'userAgent',{value:'iPhone'});await w.PUSH_ALERTS_UI.refresh();assert.equal(q('[data-push-install]').hidden,false);assert.equal(q('[data-push-enable]').disabled,true);assert.match(q('[data-push-status]').textContent,/Home Screen/);
assert.equal(requests.some(r=>['finalize','approve','sign','verify-start'].includes(r.action)),false);assert.equal(requests.some(r=>r.patientId||r.noteText||r.phone),false);
dom.window.close();console.log('Push DOM passed: generic inbox route, gesture/consent gate, scoped registration, bounded subscription, test receipt wording, opt-out/sign-out, permission/account/view races, iPhone installation help and no clinical/SMS mutation. Push provider/browser mocked.');
