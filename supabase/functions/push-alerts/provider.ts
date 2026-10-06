import webpush from 'npm:web-push@3.6.7';
export function pushFail(code:string,status=400):never{throw Object.assign(new Error(code),{status});}
export const pushUuid=(value:any)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const pushConsent='push-alerts-v17';
export const pushPublicUrl='https://kidneycareclinic-star.github.io/mel-test/preview/#inbox';
export const pushPayload=JSON.stringify({title:'KidneyCare EHR',body:'A review needs your attention. Sign in to your EHR.',url:pushPublicUrl});
export async function pushHash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(n=>n.toString(16).padStart(2,'0')).join('');}
export function pushExact(body:any,keys:string[]){if(!body||Array.isArray(body)||Object.keys(body).sort().join(',')!==keys.sort().join(','))pushFail('invalid_push_request');}
function decode(value:string){return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}
export async function pushSubscription(value:any){
  if(!value||Array.isArray(value)||Object.keys(value).some(k=>!['endpoint','keys','expirationTime'].includes(k))||typeof value.endpoint!=='string'||value.endpoint.length>2048)pushFail('invalid_push_subscription');
  let url:URL;try{url=new URL(value.endpoint);}catch(_){pushFail('invalid_push_subscription');}
  if(url.protocol!=='https:'||url.port||url.username||url.password||url.hash||!['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(url.hostname)||url.pathname==='/')pushFail('unsupported_push_endpoint');
  if(!value.keys||Object.keys(value.keys).sort().join(',')!=='auth,p256dh'||typeof value.keys.p256dh!=='string'||!/^[A-Za-z0-9_-]{87}$/.test(value.keys.p256dh)||typeof value.keys.auth!=='string'||!/^[A-Za-z0-9_-]{22}$/.test(value.keys.auth))pushFail('invalid_push_subscription');
  try{const raw=decode(value.keys.p256dh);if(raw.length!==65||raw[0]!==4||decode(value.keys.auth).length!==16)pushFail('invalid_push_subscription');await crypto.subtle.importKey('raw',raw,{name:'ECDH',namedCurve:'P-256'},false,[]);}catch(_){pushFail('invalid_push_subscription');}
  return {endpoint:url.href,keys:{p256dh:value.keys.p256dh,auth:value.keys.auth},hash:await pushHash(url.href)};
}
export async function pushConfig(tx:any){
  const [row]=await tx.unsafe('select * from ehr.push_alert_config where singleton for update');if(!row)pushFail('push_not_configured',503);
  if(!row.vapid_public||!row.vapid_private){const keys=webpush.generateVAPIDKeys();await tx.unsafe('update ehr.push_alert_config set vapid_public=$1,vapid_private=$2 where singleton',[keys.publicKey,keys.privateKey]);row.vapid_public=keys.publicKey;row.vapid_private=keys.privateKey;}
  return row;
}
export function pushQuiet(pref:any,now=new Date()){if(!pref.quiet_hours)return false;const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:pref.time_zone,hour:'2-digit',hourCycle:'h23'}).format(now));return hour>=22||hour<7;}
export async function sendPush(config:any,device:any,fetcher=fetch){
  const subscription=await pushSubscription({endpoint:device.endpoint,keys:{p256dh:device.public_key,auth:device.auth_key}});
  let details:any;try{details=webpush.generateRequestDetails(subscription,pushPayload,{vapidDetails:{subject:'https://kidneycareclinic-star.github.io/mel-test/preview/',publicKey:config.vapid_public,privateKey:config.vapid_private},TTL:300,contentEncoding:'aes128gcm',urgency:'normal',topic:'ehr-review'});}catch(_){return {status:'failed',error:'push_encryption_failed',gone:false};}
  try{const result=await fetcher(details.endpoint,{method:'POST',headers:details.headers,body:details.body,redirect:'error',signal:AbortSignal.timeout(10000)});
    if(result.status===404||result.status===410)return {status:'failed',error:'device_subscription_expired',gone:true};
    if(result.ok)return {status:'accepted',error:null,gone:false};
    return {status:result.status>=500?'unknown':'failed',error:result.status===429?'push_rate_limited':'push_provider_rejected',gone:false};
  }catch(_){return {status:'unknown',error:'delivery_unconfirmed',gone:false};}
}
