// Actual pinned library and WebCrypto on Deno. Network is mocked after encryption.
import {pushSubscription,pushConfig,pushPayload,sendPush,pushQuiet} from '../supabase/functions/push-alerts/provider.ts';
function check(value:boolean,label:string){if(!value)throw Error(label);}
function b64(bytes:Uint8Array){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
const publicKey=b64(new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey))),auth=b64(crypto.getRandomValues(new Uint8Array(16)));
const endpoint='https://web.push.apple.com/synthetic-runtime-fixture';
const sub=await pushSubscription({endpoint,keys:{p256dh:publicKey,auth}});check(sub.hash.length===64,'subscription hashing');
let saved:any;const tx={unsafe:async(query:string,values?:any[])=>{if(query.startsWith('select'))return [{enabled:true,vapid_public:saved?.[0],vapid_private:saved?.[1]}];saved=values;return [];}};
const config=await pushConfig(tx);check(config.vapid_public.length===87&&config.vapid_private.length===43,'actual runtime VAPID generation');
let called=0;
const result=await sendPush(config,{endpoint,public_key:publicKey,auth_key:auth},async(url:any,options:any)=>{
 called++;check(url===endpoint,'fixed validated endpoint');check(options.redirect==='error','no redirect SSRF');check(options.headers['Content-Encoding']==='aes128gcm'||options.headers['content-encoding']==='aes128gcm','encrypted wire');check(options.body.length>100,'encrypted body');check(options.headers.TTL===300||options.headers.TTL==='300','five minute provider TTL');return new Response('',{status:201});
});
check(result.status==='accepted'&&called===1,'mocked acceptance');check(!pushPayload.includes('PT-')&&!pushPayload.includes('token'),'generic payload');
check(pushQuiet({quiet_hours:true,time_zone:'America/New_York'},new Date('2026-10-06T02:30:00Z')),'quiet hours');
console.log('Actual Deno provider runtime passed: valid P-256 subscription, stable private VAPID keys, pinned encrypted request generation, native fetch boundary and generic payload. No real push sent.');
