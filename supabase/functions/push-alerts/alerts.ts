import {pushFail,pushUuid,pushConsent,pushExact,pushSubscription,pushConfig,pushHash,pushQuiet,sendPush} from './provider.ts';
import {resolveReview} from './inbox.ts';
export async function pushAudit(tx:any,owner:string,event:string,id:string|null=null){await tx.unsafe('insert into ehr.push_alert_audit(clinician_principal_id,alert_id,event) values($1::uuid,$2::uuid,$3)',[owner,id,event]);}
export async function pushOwner(tx:any,owner:string){
 const rows=await tx.unsafe(`select p.id from iam.principal p join iam.practice_membership pm on pm.principal_id=p.id where p.id=$1::uuid
  and p.active and p.synthetic and p.principal_type='clinician' and pm.active and pm.role='physician' and 'office'=any(pm.workspaces)
  and pm.permissions->'patient.read'='true'::jsonb and pm.permissions->'encounter.draft'='true'::jsonb for share of p,pm`,[owner]);
 if(!rows.length)pushFail('push_access_denied',403);
}
async function pushPreference(tx:any,owner:string){await pushOwner(tx,owner);await tx.unsafe('insert into ehr.clinician_push_preference(clinician_principal_id) values($1::uuid) on conflict do nothing',[owner]);return (await tx.unsafe('select * from ehr.clinician_push_preference where clinician_principal_id=$1::uuid for update',[owner]))[0];}
async function cancelPending(tx:any,owner:string){await tx.unsafe("update ehr.push_alert set status='cancelled',error_code='preferences_changed',updated_at=now() where clinician_principal_id=$1::uuid and status='pending'",[owner]);}
export async function pushView(tx:any,person:any,hash:string|null){
 if(hash!==null&&!/^[0-9a-f]{64}$/.test(hash))pushFail('invalid_push_request');
 const pref=await pushPreference(tx,person.id),config=await pushConfig(tx);
 const devices=await tx.unsafe('select id,active,endpoint_hash,updated_at from ehr.clinician_push_subscription where clinician_principal_id=$1::uuid',[person.id]);
 const current=devices.find((d:any)=>d.endpoint_hash===hash),history=current?await tx.unsafe('select status,error_code,reason,created_at from ehr.push_alert where clinician_principal_id=$1::uuid and subscription_id=$2::uuid order by created_at desc,id desc limit 5',[person.id,current.id]):[];
 return {preferences:{version:pref.version,enabled:pref.enabled,quietHours:pref.quiet_hours,timeZone:pref.time_zone},serverReady:config.enabled,publicKey:config.vapid_public,device:current?{id:current.id,active:current.active}:null,activeDevices:devices.filter((d:any)=>d.active).length,history:history.map((r:any)=>({status:r.status,errorCode:r.error_code,test:r.reason==='test',createdAt:r.created_at}))};
}
export async function pushMutation(tx:any,person:any,body:any){
 const pref=await pushPreference(tx,person.id);
 if(!Number.isSafeInteger(body?.expectedVersion)||body.expectedVersion!==pref.version)pushFail('push_preferences_changed',409);
 if(body.action==='subscribe'){
  pushExact(body,['action','expectedVersion','subscription','consent','quietHours','timeZone']);
  if(body.consent!==true)pushFail('push_consent_required');
  if(typeof body.quietHours!=='boolean'||typeof body.timeZone!=='string'||body.timeZone.length>64)pushFail('invalid_push_preferences');
  try{new Intl.DateTimeFormat('en-US',{timeZone:body.timeZone});}catch(_){pushFail('invalid_time_zone');}
  const config=await pushConfig(tx);if(!config.enabled)pushFail('push_not_configured',503);
  const sub=await pushSubscription(body.subscription),[existing]=await tx.unsafe('select id,clinician_principal_id,active from ehr.clinician_push_subscription where endpoint_hash=$1 for update',[sub.hash]);
  if(existing&&existing.clinician_principal_id!==person.id)pushFail('push_device_other_account',409);
  const [count]=await tx.unsafe('select count(*)::int as count from ehr.clinician_push_subscription where clinician_principal_id=$1::uuid and active',[person.id]);
  if(!existing?.active&&count.count>=5)pushFail('push_device_limit',409);
  const registered=await tx.unsafe(`insert into ehr.clinician_push_subscription(clinician_principal_id,endpoint_hash,endpoint,public_key,auth_key,consent_at,consent_version)
   values($1::uuid,$2,$3,$4,$5,now(),$6) on conflict(endpoint_hash) do update set public_key=excluded.public_key,auth_key=excluded.auth_key,active=true,consent_at=now(),consent_version=excluded.consent_version,version=ehr.clinician_push_subscription.version+1,updated_at=now() where ehr.clinician_push_subscription.clinician_principal_id=excluded.clinician_principal_id returning id`,[person.id,sub.hash,sub.endpoint,sub.keys.p256dh,sub.keys.auth,pushConsent]);
  if(!registered.length)pushFail('push_device_other_account',409);
  await tx.unsafe('update ehr.clinician_push_preference set enabled=true,quiet_hours=$2,time_zone=$3,version=version+1,updated_at=now() where clinician_principal_id=$1::uuid',[person.id,body.quietHours,body.timeZone]);
  await cancelPending(tx,person.id);await pushAudit(tx,person.id,'device_opted_in');return {hash:sub.hash};
 }
 if(body.action==='disable-all'){
  pushExact(body,['action','expectedVersion']);
  await tx.unsafe('update ehr.clinician_push_preference set enabled=false,version=version+1,updated_at=now() where clinician_principal_id=$1::uuid',[person.id]);
  await tx.unsafe('update ehr.clinician_push_subscription set active=false,version=version+1,updated_at=now() where clinician_principal_id=$1::uuid',[person.id]);
  await cancelPending(tx,person.id);await pushAudit(tx,person.id,'all_devices_disabled');return {};
 }
 pushExact(body,['action','expectedVersion','deviceId']);if(!pushUuid(body.deviceId))pushFail('invalid_push_request');
 const [device]=await tx.unsafe('select * from ehr.clinician_push_subscription where id=$1::uuid and clinician_principal_id=$2::uuid for update',[body.deviceId,person.id]);if(!device)pushFail('push_device_unavailable',404);
 if(body.action==='unsubscribe'){
  await tx.unsafe('update ehr.clinician_push_subscription set active=false,version=version+1,updated_at=now() where id=$1::uuid',[device.id]);
  await tx.unsafe('update ehr.clinician_push_preference set version=version+1,updated_at=now() where clinician_principal_id=$1::uuid',[person.id]);
  await cancelPending(tx,person.id);await pushAudit(tx,person.id,'device_disabled');return {};
 }
 if(body.action==='test'){
  if(!pref.enabled||!device.active)pushFail('push_opt_in_required',409);
  const [rate]=await tx.unsafe("select count(*)::int as count from ehr.push_alert where subscription_id=$1::uuid and reason='test' and created_at>now()-interval '1 minute'",[device.id]);if(rate.count>0)pushFail('push_test_rate_limited',429);
  const [alert]=await tx.unsafe("insert into ehr.push_alert(clinician_principal_id,subscription_id,subscription_version,preference_version,revision,reason,expires_at) values($1::uuid,$2::uuid,$3,$4,$5,'test',now()+interval '5 minutes') returning id",[person.id,device.id,device.version,pref.version,crypto.randomUUID()]);
  await pushAudit(tx,person.id,'test_requested',alert.id);return {};
 }
 pushFail('invalid_push_action');
}
export async function claimPushDispatch(sql:any,id:any,bearer:any){
 if(!pushUuid(id)||typeof bearer!=='string'||!/^[0-9a-f-]{72}$/.test(bearer))pushFail('invalid_push_dispatch',401);
 return sql.begin(async(tx:any)=>{const [row]=await tx.unsafe('select alert_id from ehr.push_alert_dispatch where id=$1::uuid and token_hash=$2 and used_at is null and expires_at>now() for update',[id,await pushHash(bearer)]);if(!row)pushFail('invalid_push_dispatch',401);await tx.unsafe('update ehr.push_alert_dispatch set used_at=now() where id=$1::uuid',[id]);return row.alert_id;});
}
async function lockedPush(tx:any,id:string){
 const [base]=await tx.unsafe('select a.clinician_principal_id,a.subscription_id,a.job_id,j.patient_id from ehr.push_alert a left join ehr.encounter_job j on j.id=a.job_id where a.id=$1::uuid',[id]);if(!base)return null;
 if(base.patient_id)await tx.unsafe('select id from ehr.patient where id=$1::uuid for update',[base.patient_id]);
 await pushOwner(tx,base.clinician_principal_id);
 if(base.patient_id)await tx.unsafe('select pa.principal_id from iam.patient_assignment pa join iam.practice_membership pm on pm.principal_id=pa.principal_id and pm.practice_id=pa.practice_id where pa.principal_id=$1::uuid and pa.patient_id=$2::uuid for share of pa,pm',[base.clinician_principal_id,base.patient_id]);
 if(base.job_id)await tx.unsafe('select id from ehr.encounter_job where id=$1::uuid for update',[base.job_id]);
 const [pref]=await tx.unsafe('select * from ehr.clinician_push_preference where clinician_principal_id=$1::uuid for update',[base.clinician_principal_id]);
 const [device]=await tx.unsafe('select * from ehr.clinician_push_subscription where id=$1::uuid for update',[base.subscription_id]);
 const [alert]=await tx.unsafe('select * from ehr.push_alert where id=$1::uuid for update',[id]);return {alert,pref,device};
}
async function currentPush(tx:any,alert:any,pref:any,device:any){
 if(!pref?.enabled||!device?.active||device.clinician_principal_id!==alert.clinician_principal_id||device.version!==alert.subscription_version||device.consent_version!==pushConsent||pref.version!==alert.preference_version||Date.parse(alert.expires_at)<=Date.now())return false;
 if(!alert.job_id)return alert.reason==='test';
 try{const result=await resolveReview(tx,{id:alert.clinician_principal_id},alert.job_id);
  if(result.mode!=='review'||result.jobId!==alert.job_id||result.revision!==alert.revision||result.status!==alert.reason)return false;
  const [source]=await tx.unsafe('select source_version=e.version as current from ehr.encounter_job j join ehr.synthetic_encounter e on e.id=j.encounter_id where j.id=$1::uuid',[alert.job_id]);if(!source?.current)return false;
  const [seen]=await tx.unsafe('select 1 from ehr.encounter_inbox_seen where job_id=$1::uuid and clinician_principal_id=$2::uuid and revision=$3',[alert.job_id,alert.clinician_principal_id,alert.revision]);return !seen;
 }catch(_){return false;}
}
export async function processPushAlert(sql:any,id:string,fetcher=fetch){
 try{
  const reserved=await sql.begin(async(tx:any)=>{const locked=await lockedPush(tx,id);if(!locked)return false;const {alert,pref,device}=locked;if(alert.status!=='pending')return false;
   if(!await currentPush(tx,alert,pref,device)){await tx.unsafe("update ehr.push_alert set status='cancelled',error_code='alert_no_longer_current',updated_at=now() where id=$1::uuid",[id]);return false;}
   if(Date.parse(alert.available_at)>Date.now())return false;
   const [rate]=await tx.unsafe("select count(*) filter(where send_started_at>now()-interval '2 minutes')::int as recent,count(*) filter(where send_started_at>now()-interval '1 hour')::int as hourly,count(*)::int as daily from ehr.push_alert where subscription_id=$1::uuid and send_started_at>now()-interval '24 hours'",[device.id]);
   if(alert.reason!=='test'&&(pushQuiet(pref)||rate.recent>0||rate.hourly>=3||rate.daily>=10)){await tx.unsafe("update ehr.push_alert set available_at=now()+interval '2 minutes',dispatch_until=null where id=$1::uuid",[id]);return false;}
   await tx.unsafe("update ehr.push_alert set status='sending',send_started_at=now(),updated_at=now() where id=$1::uuid",[id]);await pushAudit(tx,alert.clinician_principal_id,'send_reserved',id);return true;
  });if(!reserved)return;
  // Persist the send intent before I/O; a timeout/crash cannot cause automatic resubmission.
  await sql.begin(async(tx:any)=>{const locked=await lockedPush(tx,id);if(!locked)return;const {alert,pref,device}=locked;if(alert.status!=='sending')return;
   if(!await currentPush(tx,alert,pref,device)){await tx.unsafe("update ehr.push_alert set status='cancelled',error_code='alert_no_longer_current',updated_at=now() where id=$1::uuid",[id]);return;}
   const [config]=await tx.unsafe('select * from ehr.push_alert_config where singleton');if(!config?.enabled||!config.vapid_private)pushFail('push_not_configured',503);
   const result=await sendPush(config,device,fetcher);
   await tx.unsafe('update ehr.push_alert set status=$2,error_code=$3,dispatch_until=null,updated_at=now() where id=$1::uuid',[id,result.status,result.error]);
   if(result.gone){await tx.unsafe('update ehr.clinician_push_subscription set active=false,version=version+1,updated_at=now() where id=$1::uuid',[device.id]);await tx.unsafe("update ehr.push_alert set status='cancelled',error_code='device_subscription_expired',updated_at=now() where subscription_id=$1::uuid and status='pending'",[device.id]);}
   await pushAudit(tx,alert.clinician_principal_id,'provider_'+result.status,id);
  });
 }catch(_){await sql.begin(async(tx:any)=>{const [alert]=await tx.unsafe("update ehr.push_alert set status=case when status='pending' then 'cancelled' else 'unknown' end,error_code='delivery_unconfirmed',updated_at=now() where id=$1::uuid and status in ('pending','sending') returning clinician_principal_id",[id]);if(alert)await pushAudit(tx,alert.clinician_principal_id,'delivery_unconfirmed',id);});}
}
