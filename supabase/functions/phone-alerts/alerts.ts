import {alertFail,alertUuid,alertText,consentVersion,normalizePhone,isQuiet,encryptPhone,decryptPhone,startVerification,checkVerification,sendAlert,pollAlert} from './provider.ts';
import {resolveReview} from './inbox.ts';
export async function alertAudit(tx:any,owner:string,event:string,alertId:string|null=null){
  await tx.unsafe('insert into ehr.phone_alert_audit(clinician_principal_id,alert_id,event) values($1::uuid,$2::uuid,$3)',[owner,alertId,event]);
}
export async function phoneOwner(tx:any,owner:string){
  const rows=await tx.unsafe(`select p.id from iam.principal p join iam.practice_membership pm on pm.principal_id=p.id
    where p.id=$1::uuid and p.active and p.synthetic and p.principal_type='clinician' and pm.active and pm.role='physician'
    and 'office'=any(pm.workspaces) and pm.permissions->'patient.read'='true'::jsonb and pm.permissions->'encounter.draft'='true'::jsonb for share of p,pm`,[owner]);
  if(!rows.length)alertFail('phone_preferences_denied',403);
}
async function phonePreference(tx:any,owner:string){
  await phoneOwner(tx,owner);
  await tx.unsafe('insert into ehr.clinician_phone_preference(clinician_principal_id) values($1::uuid) on conflict do nothing',[owner]);
  const [pref]=await tx.unsafe('select * from ehr.clinician_phone_preference where clinician_principal_id=$1::uuid for update',[owner]);return pref;
}
function publicPreference(pref:any){
  return {version:pref.version,mode:pref.mode,readyAlerts:pref.ready_alerts,pausedAlerts:pref.paused_alerts,quietHours:pref.quiet_hours,timeZone:pref.time_zone,phoneLast4:pref.phone_last4||null,verified:!!pref.verified_at,verificationPending:!!pref.verify_sid&&Date.parse(pref.verify_expires_at)>Date.now(),consented:!!pref.consent_at};
}
export async function phoneView(tx:any,person:any,config:any){
  const pref=await phonePreference(tx,person.id);
  const rows=await tx.unsafe('select id,job_id,reason,status,error_code,created_at,updated_at,transport from ehr.phone_alert where clinician_principal_id=$1::uuid order by created_at desc,id desc limit 20',[person.id]);
  const history=[];
  for(const row of rows){if(row.job_id){try{await resolveReview(tx,person,row.job_id);}catch(_){continue;}}
    history.push({id:row.id,jobId:row.job_id,reason:row.reason,status:row.status,errorCode:row.error_code,createdAt:row.created_at,updatedAt:row.updated_at,transport:row.transport,text:alertText(row.reason,row.job_id)});
  }
  return {preferences:publicPreference(pref),providerReady:config.configured,history,quietHoursLabel:'10 PM–7 AM',previewText:alertText('ready',null)};
}
function exactKeys(body:any,keys:string[]){
  if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(k=>!keys.includes(k)))alertFail('invalid_request');
}
async function changedPreference(tx:any,owner:string){
  await tx.unsafe("update ehr.phone_alert set status='cancelled',error_code='preferences_changed',updated_at=now() where clinician_principal_id=$1::uuid and status='pending'",[owner]);
}
export async function phoneMutation(tx:any,person:any,body:any,config:any,fetcher=fetch){
  const pref=await phonePreference(tx,person.id);
  if(!Number.isSafeInteger(body?.expectedVersion)||body.expectedVersion!==pref.version)alertFail('phone_preferences_changed',409);
  if(body.action==='preferences'){
    exactKeys(body,['action','expectedVersion','mode','readyAlerts','pausedAlerts','quietHours','timeZone','consent']);
    if(!['off','preview','sms'].includes(body.mode)||['readyAlerts','pausedAlerts','quietHours'].some(k=>typeof body[k]!=='boolean')||typeof body.timeZone!=='string'||body.timeZone.length>64)alertFail('invalid_preferences');
    try{new Intl.DateTimeFormat('en-US',{timeZone:body.timeZone});}catch(_){alertFail('invalid_time_zone');}
    if(body.mode==='sms'&&!config.configured)alertFail('phone_delivery_not_configured',503);
    if(body.mode==='sms'&&(!pref.verified_at||!pref.phone_ciphertext||body.consent!==true))alertFail('verified_phone_and_consent_required',409);
    await tx.unsafe(`update ehr.clinician_phone_preference set mode=$2,ready_alerts=$3,paused_alerts=$4,quiet_hours=$5,time_zone=$6,
      consent_at=case when $2='sms' then now() else consent_at end,consent_version=case when $2='sms' then $7 else consent_version end,version=version+1,updated_at=now() where clinician_principal_id=$1::uuid`,[person.id,body.mode,body.readyAlerts,body.pausedAlerts,body.quietHours,body.timeZone,consentVersion]);
    await changedPreference(tx,person.id);await alertAudit(tx,person.id,'preferences_saved');
  }else if(body.action==='preview-test'){
    exactKeys(body,['action','expectedVersion']);
    const [rate]=await tx.unsafe("select count(*)::int as count from ehr.phone_alert where clinician_principal_id=$1::uuid and reason='test' and created_at>now()-interval '1 minute'",[person.id]);
    if(rate.count>0)alertFail('preview_rate_limited',429);
    const [test]=await tx.unsafe("insert into ehr.phone_alert(clinician_principal_id,revision,preference_version,transport,reason,status) values($1::uuid,$2,$3,'preview','test','preview') returning id",[person.id,crypto.randomUUID(),pref.version]);
    await alertAudit(tx,person.id,'preview_created',test.id);
  }else if(body.action==='forget-phone'){
    exactKeys(body,['action','expectedVersion']);
    await tx.unsafe("update ehr.clinician_phone_preference set mode='preview',phone_ciphertext=null,phone_last4=null,verified_at=null,consent_at=null,consent_version=null,verify_sid=null,verify_expires_at=null,verify_attempts=0,version=version+1,updated_at=now() where clinician_principal_id=$1::uuid",[person.id]);
    await changedPreference(tx,person.id);await alertAudit(tx,person.id,'phone_removed');
  }else if(body.action==='verify-start'){
    exactKeys(body,['action','expectedVersion','phone','consent']);
    if(!config.configured)alertFail('phone_delivery_not_configured',503);
    if(body.consent!==true)alertFail('verification_consent_required');
    const phone=normalizePhone(body.phone);
    const [rate]=await tx.unsafe("select count(*) filter(where created_at>now()-interval '1 minute')::int as recent,count(*)::int as daily from ehr.phone_alert_audit where clinician_principal_id=$1::uuid and event='verification_started' and created_at>now()-interval '24 hours'",[person.id]);
    if(rate.recent>0||rate.daily>=3)alertFail('verification_rate_limited',429);
    const cipher=await encryptPhone(phone,person.id,config.key);
    await tx.unsafe("update ehr.clinician_phone_preference set mode='preview',phone_ciphertext=$2,phone_last4=$3,verified_at=null,consent_at=null,consent_version=null,verify_sid=null,verify_expires_at=null,verify_attempts=0,version=version+1,updated_at=now() where clinician_principal_id=$1::uuid",[person.id,cipher,phone.slice(-4)]);
    await changedPreference(tx,person.id);await alertAudit(tx,person.id,'verification_started');
    // Known failures return inside the transaction so rate-limit receipts commit.
    try{const sid=await startVerification(config,phone,fetcher);await tx.unsafe("update ehr.clinician_phone_preference set verify_sid=$2,verify_expires_at=now()+interval '10 minutes' where clinician_principal_id=$1::uuid",[person.id,sid]);}
    catch(_){await alertAudit(tx,person.id,'verification_unavailable');return {error:'verification_unavailable',httpStatus:503};}
  }else if(body.action==='verify-check'){
    exactKeys(body,['action','expectedVersion','code']);
    if(!config.configured)alertFail('phone_delivery_not_configured',503);
    if(typeof body.code!=='string'||!/^\d{4,10}$/.test(body.code))alertFail('invalid_verification_code');
    if(!pref.verify_sid||Date.parse(pref.verify_expires_at)<=Date.now()||pref.verify_attempts>=5)alertFail('verification_expired',409);
    await tx.unsafe('update ehr.clinician_phone_preference set verify_attempts=verify_attempts+1,version=version+1 where clinician_principal_id=$1::uuid',[person.id]);
    await alertAudit(tx,person.id,'verification_checked');
    let approved=false;try{approved=await checkVerification(config,pref.verify_sid,body.code,fetcher);}catch(_){return {error:'verification_unavailable',httpStatus:503};}
    if(!approved)return {error:'verification_code_invalid',httpStatus:422};
    await tx.unsafe('update ehr.clinician_phone_preference set verified_at=now(),verify_sid=null,verify_expires_at=null,updated_at=now() where clinician_principal_id=$1::uuid',[person.id]);
    await alertAudit(tx,person.id,'phone_verified');
  }else alertFail('invalid_request');
  return {ok:true};
}

export async function claimPhoneDispatch(sql:any,id:any,bearer:any){
  if(!alertUuid(id)||typeof bearer!=='string'||!/^[0-9a-f-]{72}$/.test(bearer))alertFail('invalid_alert_dispatch',401);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(bearer)))).map(n=>n.toString(16).padStart(2,'0')).join('');
  return sql.begin(async(tx:any)=>{
    const [row]=await tx.unsafe('select alert_id from ehr.phone_alert_dispatch where id=$1::uuid and token_hash=$2 and used_at is null and expires_at>now() for update',[id,hash]);
    if(!row)alertFail('invalid_alert_dispatch',401);
    await tx.unsafe('update ehr.phone_alert_dispatch set used_at=now() where id=$1::uuid',[id]);return row.alert_id;
  });
}
async function lockedAlert(tx:any,id:string){
  const [base]=await tx.unsafe('select a.clinician_principal_id,j.patient_id from ehr.phone_alert a left join ehr.encounter_job j on j.id=a.job_id where a.id=$1::uuid',[id]);
  if(!base)return null;
  // Same order as preparation and signing: patient, current IAM rows, job, preference, alert.
  if(base.patient_id)await tx.unsafe('select id from ehr.patient where id=$1::uuid for update',[base.patient_id]);
  await phoneOwner(tx,base.clinician_principal_id);
  if(base.patient_id)await tx.unsafe('select pa.principal_id from iam.patient_assignment pa join iam.practice_membership pm on pm.principal_id=pa.principal_id and pm.practice_id=pa.practice_id where pa.principal_id=$1::uuid and pa.patient_id=$2::uuid for share of pa,pm',[base.clinician_principal_id,base.patient_id]);
  const [link]=await tx.unsafe('select job_id from ehr.phone_alert where id=$1::uuid',[id]);
  if(link.job_id)await tx.unsafe('select id from ehr.encounter_job where id=$1::uuid for update',[link.job_id]);
  const [pref]=await tx.unsafe('select * from ehr.clinician_phone_preference where clinician_principal_id=$1::uuid for update',[base.clinician_principal_id]);
  const [alert]=await tx.unsafe('select * from ehr.phone_alert where id=$1::uuid for update',[id]);return {alert,pref};
}
async function currentAlert(tx:any,alert:any,pref:any,config:any){
  if(!pref||pref.mode!==alert.transport||pref.version!==alert.preference_version||Date.parse(alert.expires_at)<=Date.now())return false;
  if(alert.transport==='sms'&&(!config.configured||!pref.verified_at||!pref.consent_at||pref.consent_version!==consentVersion||!pref.phone_ciphertext))return false;
  if(alert.reason==='ready'&&!pref.ready_alerts||['failed','expired'].includes(alert.reason)&&!pref.paused_alerts)return false;
  if(!alert.job_id)return alert.transport==='preview'&&alert.reason==='test';
  try{const result=await resolveReview(tx,{id:alert.clinician_principal_id},alert.job_id);
    if(result.mode!=='review'||result.jobId!==alert.job_id||result.revision!==alert.revision||result.status!==alert.reason)return false;
    const [source]=await tx.unsafe('select source_version=e.version as current from ehr.encounter_job j join ehr.synthetic_encounter e on e.id=j.encounter_id where j.id=$1::uuid',[alert.job_id]);if(!source?.current)return false;
    const [seen]=await tx.unsafe('select 1 from ehr.encounter_inbox_seen where job_id=$1::uuid and clinician_principal_id=$2::uuid and revision=$3',[alert.job_id,alert.clinician_principal_id,alert.revision]);return !seen;
  }catch(_){return false;}
}
async function cancelAlert(tx:any,alert:any,code='alert_no_longer_current'){
  await tx.unsafe("update ehr.phone_alert set status='cancelled',error_code=$2,updated_at=now() where id=$1::uuid",[alert.id,code]);await alertAudit(tx,alert.clinician_principal_id,'alert_cancelled',alert.id);
}
export async function processPhoneAlert(sql:any,id:string,config:any,fetcher=fetch){
  try{
    const reserve=await sql.begin(async(tx:any)=>{
      const locked=await lockedAlert(tx,id);if(!locked)return null;const {alert,pref}=locked;
      if(['accepted','sent'].includes(alert.status))return {poll:true};
      if(alert.status!=='pending')return null;
      if(!await currentAlert(tx,alert,pref,config)){await cancelAlert(tx,alert);return null;}
      if(Date.parse(alert.available_at)>Date.now())return null;
      const [rate]=await tx.unsafe("select count(*) filter(where send_started_at>now()-interval '2 minutes')::int as recent,count(*) filter(where send_started_at>now()-interval '1 hour')::int as hourly,count(*)::int as daily from ehr.phone_alert where clinician_principal_id=$1::uuid and transport=$2 and send_started_at>now()-interval '24 hours'",[alert.clinician_principal_id,alert.transport]);
      if(isQuiet(pref)||rate.recent>0||rate.hourly>=3||rate.daily>=10){await tx.unsafe("update ehr.phone_alert set available_at=now()+interval '2 minutes',dispatch_until=null where id=$1::uuid",[id]);return null;}
      await tx.unsafe("update ehr.phone_alert set status='sending',send_started_at=now(),updated_at=now() where id=$1::uuid",[id]);await alertAudit(tx,alert.clinician_principal_id,'send_reserved',id);return {poll:false};
    });
    if(!reserve)return;
    // Durable send intent is committed before provider I/O. A crash cannot make it retryable.
    await sql.begin(async(tx:any)=>{
      const locked=await lockedAlert(tx,id);if(!locked)return;const {alert,pref}=locked;
      if(reserve.poll){
        if(!['accepted','sent'].includes(alert.status))return;
        if(!config.configured||!alert.provider_sid||alert.poll_attempts>=12){await tx.unsafe("update ehr.phone_alert set status='unknown',error_code='delivery_unconfirmed',updated_at=now() where id=$1::uuid",[id]);return;}
        const result=await pollAlert(config,alert.provider_sid,fetcher);
        await tx.unsafe("update ehr.phone_alert set status=$2,error_code=$3,poll_attempts=poll_attempts+1,available_at=now()+interval '5 minutes',dispatch_until=null,updated_at=now() where id=$1::uuid",[id,result?.status||alert.status,result?.error||null]);
        if(result?.error==='recipient_opted_out'){
          await tx.unsafe("update ehr.clinician_phone_preference set mode='off',consent_at=null,consent_version=null,version=version+1,updated_at=now() where clinician_principal_id=$1::uuid",[alert.clinician_principal_id]);await changedPreference(tx,alert.clinician_principal_id);
        }
        if(result)await alertAudit(tx,alert.clinician_principal_id,'provider_'+result.status,id);return;
      }
      if(alert.status!=='sending')return;
      if(!await currentAlert(tx,alert,pref,config)){await cancelAlert(tx,alert);return;}
      if(alert.transport==='preview'){
        await tx.unsafe("update ehr.phone_alert set status='preview',dispatch_until=null,updated_at=now() where id=$1::uuid",[id]);await alertAudit(tx,alert.clinician_principal_id,'preview_created',id);return;
      }
      const phone=await decryptPhone(pref.phone_ciphertext,alert.clinician_principal_id,config.key);
      const result=await sendAlert(config,phone,alertText(alert.reason,alert.job_id),fetcher);
      await tx.unsafe("update ehr.phone_alert set status=$2,provider_sid=$3,error_code=$4,available_at=now()+interval '1 minute',dispatch_until=null,updated_at=now() where id=$1::uuid",[id,result.status,result.sid,result.error]);
      if(result.error==='recipient_opted_out'){
        await tx.unsafe("update ehr.clinician_phone_preference set mode='off',consent_at=null,consent_version=null,version=version+1,updated_at=now() where clinician_principal_id=$1::uuid",[alert.clinician_principal_id]);await changedPreference(tx,alert.clinician_principal_id);
      }
      await alertAudit(tx,alert.clinician_principal_id,'provider_'+result.status,id);
    });
  }catch(error){
    // Revoked access and unknown provider outcomes never get resubmitted.
    await sql.begin(async(tx:any)=>{
      const [alert]=await tx.unsafe("update ehr.phone_alert set status=case when status='pending' then 'cancelled' else 'unknown' end,error_code='delivery_unconfirmed',updated_at=now() where id=$1::uuid and status in ('pending','sending','accepted','sent') returning clinician_principal_id",[id]);
      if(alert)await alertAudit(tx,alert.clinician_principal_id,'delivery_unconfirmed',id);
    });
  }
}
