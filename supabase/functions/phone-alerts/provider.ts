// Provider credentials stay in Edge Function secrets. No provider bodies are logged.
export const reviewBase='https://kidneycareclinic-star.github.io/mel-test/preview/';
export const consentVersion='phone-alerts-v13';
export const alertUuid=(value:any)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function alertFail(code:string,status=400):never {throw Object.assign(new Error(code),{status});}
export function alertText(reason:string,jobId:string|null){
  const intro=reason==='ready'?'An encounter is ready for your review.':reason==='test'?'This is a preview of your encounter alert.':'An encounter needs your attention.';
  return 'KidneyCare: '+intro+' Sign in securely: '+reviewBase+(jobId&&alertUuid(jobId)?'#review/'+jobId:'')+' Reply STOP to stop alerts.';
}
export function providerConfig(get:(key:string)=>string|undefined){
  const account=get('TWILIO_ACCOUNT_SID')||'',token=get('TWILIO_AUTH_TOKEN')||'',service=get('TWILIO_MESSAGING_SERVICE_SID')||'',verify=get('TWILIO_VERIFY_SERVICE_SID')||'',key=get('SMS_CONTACT_ENCRYPTION_KEY')||'';
  const configured=get('SMS_DELIVERY_MODE')==='twilio'&&/^AC[0-9a-f]{32}$/i.test(account)&&/^[0-9a-f]{32}$/i.test(token)&&/^MG[0-9a-f]{32}$/i.test(service)&&/^VA[0-9a-f]{32}$/i.test(verify)&&/^[0-9a-f]{64}$/i.test(key);
  return {configured,account,token,service,verify,key};
}
export function normalizePhone(value:any){
  if(typeof value!=='string'||!/^\+1[2-9][0-9]{2}[2-9][0-9]{6}$/.test(value))alertFail('us_mobile_number_required');
  return value;
}
export function isQuiet(pref:any,now=new Date()){
  if(!pref.quiet_hours)return false;
  const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:pref.time_zone,hour:'2-digit',hourCycle:'h23'}).format(now));
  return hour>=22||hour<7;
}
async function contactKey(key:string){
  if(!/^[0-9a-f]{64}$/i.test(key))alertFail('phone_delivery_not_configured',503);
  const bytes=Uint8Array.from(key.match(/../g)!,x=>parseInt(x,16));
  return crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
export async function encryptPhone(phone:string,owner:string,key:string){
  const iv=crypto.getRandomValues(new Uint8Array(12)),encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(owner)},await contactKey(key),new TextEncoder().encode(phone));
  return Array.from(new Uint8Array([...iv,...new Uint8Array(encrypted)])).map(n=>n.toString(16).padStart(2,'0')).join('');
}
export async function decryptPhone(cipher:string,owner:string,key:string){
  if(!/^[0-9a-f]{80,160}$/i.test(cipher))alertFail('phone_contact_unavailable',503);
  try{const bytes=Uint8Array.from(cipher.match(/../g)!,x=>parseInt(x,16));return normalizePhone(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12),additionalData:new TextEncoder().encode(owner)},await contactKey(key),bytes.slice(12))));}
  catch(_){alertFail('phone_contact_unavailable',503);}
}
async function twilio(config:any,url:string,fields:Record<string,string>|null,fetcher=fetch){
  if(!config.configured)alertFail('phone_delivery_not_configured',503);
  let response:Response;
  try{response=await fetcher(url,{method:fields?'POST':'GET',headers:{Authorization:'Basic '+btoa(config.account+':'+config.token),...(fields?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(fields?{body:new URLSearchParams(fields).toString()}:{}),signal:AbortSignal.timeout(8000),redirect:'error'});}
  catch(_){return {ok:false,uncertain:true,error:'delivery_unconfirmed'};}
  const data=await response.json().catch(()=>null);
  if(!response.ok){const code=String(data?.code||'');return {ok:false,uncertain:response.status>=500,error:['21610','30630'].includes(code)?'recipient_opted_out':response.status===429?'provider_rate_limited':'provider_rejected'};}
  if(!data)return {ok:false,uncertain:true,error:'delivery_unconfirmed'};
  return {ok:true,data};
}
export async function startVerification(config:any,phone:string,fetcher=fetch){
  const result=await twilio(config,'https://verify.twilio.com/v2/Services/'+config.verify+'/Verifications',{To:phone,Channel:'sms'},fetcher);
  if(!result.ok||result.data?.status!=='pending'||!/^VE[0-9a-f]{32}$/i.test(result.data?.sid||''))alertFail(result.ok?'verification_unavailable':result.error!,503);
  return result.data.sid;
}
export async function checkVerification(config:any,sid:string,code:string,fetcher=fetch){
  const result=await twilio(config,'https://verify.twilio.com/v2/Services/'+config.verify+'/VerificationCheck',{VerificationSid:sid,Code:code},fetcher);
  if(!result.ok)alertFail(result.error!,503);
  return result.data?.status==='approved'&&result.data?.valid===true;
}
export async function sendAlert(config:any,phone:string,text:string,fetcher=fetch){
  const result=await twilio(config,'https://api.twilio.com/2010-04-01/Accounts/'+config.account+'/Messages.json',{To:phone,MessagingServiceSid:config.service,Body:text,ValidityPeriod:'300'},fetcher);
  if(!result.ok)return {status:result.uncertain?'unknown':'failed',error:result.error,sid:null};
  const sid=result.data?.sid;if(!/^SM[0-9a-f]{32}$/i.test(sid||''))return {status:'unknown',error:'delivery_unconfirmed',sid:null};
  return {status:['delivered','sent','undelivered','failed'].includes(result.data.status)?result.data.status:'accepted',sid,error:['21610','30630'].includes(String(result.data.error_code))?'recipient_opted_out':result.data.error_code?'provider_rejected':null};
}
export async function pollAlert(config:any,sid:string,fetcher=fetch){
  if(!/^SM[0-9a-f]{32}$/i.test(sid))alertFail('invalid_provider_receipt');
  const result=await twilio(config,'https://api.twilio.com/2010-04-01/Accounts/'+config.account+'/Messages/'+sid+'.json',null,fetcher);
  if(!result.ok)return null;
  if(result.data?.sid!==sid||!['accepted','queued','sending','sent','delivered','undelivered','failed','canceled'].includes(result.data?.status))return null;
  return {status:['queued','sending','accepted'].includes(result.data.status)?'accepted':result.data.status==='canceled'?'failed':result.data.status,error:['21610','30630'].includes(String(result.data.error_code))?'recipient_opted_out':result.data.error_code?'provider_rejected':null};
}
