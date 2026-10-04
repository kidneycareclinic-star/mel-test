import {jsonObject} from './json-boundary.ts';
const API_VERSION='encounter-coordinator-v9a';
function num(v:unknown,name:string){
  if(typeof v!=="number"&&typeof v!=="string")throw new Error("invalid numeric value for "+name);
  if(typeof v==="string"&&!v.trim())throw new Error("blank numeric value for "+name);
  if(typeof v==="string"&&!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(v.trim()))throw new Error("invalid numeric value for "+name);
  const n=Number(v);
  if(!Number.isFinite(n))throw new Error("invalid numeric value for "+name);
  return n;
}
function uuid(v:unknown){return typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);}


export async function applyObservations(tx:any,patientId:string,encounterId:string,person:any,decisions:any[]) {
  if(!decisions.length)return {canonicalInserted:0,outcomes:[]};
  const rawIds=decisions.map((d:any)=>d?.proposalId);
  if(rawIds.some((id:unknown)=>!uuid(id)))throw new Error('invalid_proposal_id');
  const ids=rawIds.map((id:string)=>id.toLowerCase());
  if(new Set(ids).size!==ids.length||decisions.some((d:any)=>!['accepted','edited','rejected'].includes(d.decision)))throw new Error('invalid_observation_decisions');
      // Lock every requested proposal before recording an event. A stale batch fails atomically.
      const placeholders=ids.map((_:string,i:number)=>"$"+(i+2)+"::uuid").join(",");
      const locked=await tx.unsafe([
        "select * from ehr.proposed_observation",
        "where patient_id=$1 and id in ("+placeholders+") order by id for update"
      ].join(" "),[patientId,...ids]);
      const proposals=new Map(locked.map((row:any)=>[String(row.id),row]));
      if(locked.length!==ids.length||locked.some((row:any)=>row.status!=="pending"||(encounterId&&String(row.encounter_id)!==encounterId.toLowerCase())))throw new Error("review_queue_changed_refresh_and_retry");
      // Check edits before inserting the decision event, so a rejected batch leaves no trace.
      const checked=new Map<string,{valueNumeric:number|null,valueJson:any}>();
      for(const d of decisions){
        if(d.decision!=="edited")continue;
        const po:any=proposals.get(d.proposalId.toLowerCase());
        if(po.value_json!=null)po.value_json=jsonObject(po.value_json,"observation");
        if(po.value_numeric!=null){checked.set(d.proposalId.toLowerCase(),{valueNumeric:num(d.editedValue,po.field),valueJson:null});}
        else if(po.field==="bloodPressure"){
          checked.set(d.proposalId.toLowerCase(),{valueNumeric:null,valueJson:{systolic:num(d?.editedValue?.systolic,"systolic"),diastolic:num(d?.editedValue?.diastolic,"diastolic")}});
        }else if(po.field==="weight"){
          checked.set(d.proposalId.toLowerCase(),{valueNumeric:null,valueJson:{amount:num(d?.editedValue?.amount,"weight"),reportedUnit:String(po.value_json?.reportedUnit||"unspecified")}});
        }else throw new Error("unsupported_edit_field");
      }
      const acceptedDecisions=decisions.filter((d:any)=>["accepted","edited"].includes(String(d?.decision||"")));
      const rejectedDecisions=decisions.filter((d:any)=>String(d?.decision||"")==="rejected");
      const ev=await tx.unsafe([
        "insert into ehr.event(patient_id,event_type,actor_type,actor_id,source,status,payload)",
        "values($1,'SCRIBE_REVIEW_DECIDED','physician',$5,'scribe-review','recorded',",
        "jsonb_build_object('decisions',$7::text::jsonb,'acceptedCount',$2::int,'rejectedCount',$3::int,'apiVersion',$4::text,'encounterId',$6::uuid)) returning id"
      ].join(" "),[patientId,acceptedDecisions.length,rejectedDecisions.length,API_VERSION,person.externalId,encounterId,JSON.stringify(decisions)]);
      const eventId=ev[0].id;
      let canonicalInserted=0;
      const outcomes:any[]=[];
      for(const d of decisions){
        const proposalId=String(d?.proposalId||"");
        const decision=String(d?.decision||"");
        const po:any=proposals.get(proposalId.toLowerCase());
        if(decision==="rejected"){
          await tx.unsafe([
            "update ehr.proposed_observation set status='rejected',decision_event_id=$2,reviewed_by_type='physician',reviewed_by_id=$3,reviewed_at=now()",
            "where id=$1::uuid"
          ].join(" "),[proposalId,eventId,person.externalId]);
          outcomes.push({proposalId,status:"rejected"});
          continue;
        }
        let valueNumeric=po.value_numeric==null?null:Number(po.value_numeric);
        let valueJson=po.value_json==null?null:jsonObject(po.value_json,"observation");
        if(decision==="edited"){
          const checkedValue=checked.get(proposalId.toLowerCase())!;
          valueNumeric=checkedValue.valueNumeric;
          valueJson=checkedValue.valueJson;
        }
        let obsRows:any[];
        if(valueJson&&po.field==="bloodPressure"){
          obsRows=await tx.unsafe([
            "insert into ehr.clinical_observation(patient_id,observation_type,display,value_json,unit,status,observed_at,provenance_id,source_event_id,client_record_id)",
            "values($1,$2,$3,jsonb_build_object('systolic',$4::numeric,'diastolic',$5::numeric),$6,'final',$7,$8,$9,$10)",
            "on conflict(patient_id,client_record_id) where client_record_id is not null do nothing returning id"
          ].join(" "),[patientId,"BloodPressure",po.display_label,num(valueJson.systolic,"systolic"),num(valueJson.diastolic,"diastolic"),po.unit,po.observed_at,po.provenance_id,eventId,po.client_record_id]);
        }else if(valueJson&&po.field==="weight"){
          obsRows=await tx.unsafe([
            "insert into ehr.clinical_observation(patient_id,observation_type,display,value_json,unit,status,observed_at,provenance_id,source_event_id,client_record_id)",
            "values($1,$2,$3,jsonb_build_object('amount',$4::numeric,'reportedUnit',$5::text),$6,'final',$7,$8,$9,$10)",
            "on conflict(patient_id,client_record_id) where client_record_id is not null do nothing returning id"
          ].join(" "),[patientId,po.field,po.display_label,num(valueJson.amount,"weight"),String(valueJson.reportedUnit||"unspecified"),po.unit,po.observed_at,po.provenance_id,eventId,po.client_record_id]);
        }else{
          obsRows=await tx.unsafe([
            "insert into ehr.clinical_observation(patient_id,observation_type,display,value_numeric,unit,status,observed_at,provenance_id,source_event_id,client_record_id)",
            "values($1,$2,$3,$4,$5,'final',$6,$7,$8,$9)",
            "on conflict(patient_id,client_record_id) where client_record_id is not null do nothing returning id"
          ].join(" "),[patientId,po.field,po.display_label,valueNumeric,po.unit,po.observed_at,po.provenance_id,eventId,po.client_record_id]);
        }
        if(!obsRows.length)throw new Error("observation_conflict_refresh_and_retry");
        const obsId=obsRows[0].id;
        canonicalInserted+=1;
        await tx.unsafe([
          "update ehr.proposed_observation set status=$2,decision_event_id=$3,accepted_observation_id=$4,reviewed_by_type='physician',reviewed_by_id=$8,reviewed_at=now(),",
          "metadata=metadata||jsonb_build_object('decisionApi',$5::text,'originalValue',$6::text::jsonb,'reviewedValue',$7::text::jsonb) where id=$1::uuid"
        ].join(" "),[proposalId,decision,eventId,obsId,API_VERSION,JSON.stringify(po.value_numeric==null?jsonObject(po.value_json,"observation"):Number(po.value_numeric)),JSON.stringify(valueNumeric==null?valueJson:valueNumeric),person.externalId]);
        outcomes.push({proposalId,status:decision,observationId:obsId});
      }
  return {canonicalInserted,outcomes};
}
