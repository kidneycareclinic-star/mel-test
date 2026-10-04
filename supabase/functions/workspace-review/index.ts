import { jsonObject, patientState } from "./json-boundary.ts";
import postgres from "npm:postgres@3.4.7";
import { clinician, patientAccess, authFailure, AccessError } from "./clinician-auth.ts";
const dbUrl=Deno.env.get("SUPABASE_DB_URL");
if(!dbUrl) throw new Error("SUPABASE_DB_URL is not configured");
const sql=postgres(dbUrl,{prepare:false,max:1});
const API_VERSION="workspace-review-v6-state-v4";

function allowed(origin:string|null){
  if(!origin) return null;
  if(origin==="https://kidneycareclinic-star.github.io") return origin;
  if(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}
function reply(body:unknown,status=200,origin:string|null=null){
  const h=new Headers({"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});
  const a=allowed(origin);
  if(a){h.set("Access-Control-Allow-Origin",a);h.set("Vary","Origin");}
  h.set("Access-Control-Allow-Methods","POST, OPTIONS");
  h.set("Access-Control-Allow-Headers","authorization, apikey, content-type");
  return new Response(JSON.stringify(body),{status,headers:h});
}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("origin");
  if(origin&&!allowed(origin)) return reply({apiVersion:API_VERSION,error:"origin_not_allowed"},403,origin);
  if(req.method==="OPTIONS") return reply({apiVersion:API_VERSION,ok:true},200,origin);
  if(req.method!=="POST") return reply({apiVersion:API_VERSION,error:"method_not_allowed"},405,origin);

  const body=await req.json().catch(()=>null);
  const externalId=String(body?.patientId||"");
  const mode=String(body?.mode||"review");
  const workspace=String(body?.workspace||"").toLowerCase();

  if(!/^PT-\d{3}$/.test(externalId)){
    return reply({apiVersion:API_VERSION,error:"invalid_patient"},400,origin);
  }

  try{
    const person=await clinician(req,sql);
    if(mode==="decide"){
      const toolCallId=String(body?.toolCallId||"");
      if(!/^[0-9a-f-]{36}$/i.test(toolCallId))throw new AccessError(400,"invalid_tool_call");
      const proposed=await sql.unsafe([
        "select tc.tool_name,tc.risk_level,tc.input from ehr.tool_call tc",
        "join ehr.patient p on p.id=tc.patient_id where tc.id=$1::uuid",
        "and p.external_id=$2 and p.active=true and p.synthetic=true and tc.status='awaiting_approval' limit 1"
      ].join(" "),[toolCallId,externalId]);
      if(!proposed.length)throw new AccessError(403,"tool_call_not_available");
      const risk=String(proposed[0].risk_level);
      if(!["low","moderate"].includes(risk))throw new AccessError(403,"risk_not_enabled");
      const tool=String(proposed[0].tool_name);
      if(!["create_open_loop","prepare_followup_lab_order","prepare_followup_appointment"].includes(tool))throw new AccessError(403,"tool_not_enabled");
      proposed[0].input=jsonObject(proposed[0].input,"tool_input");
      const assignedWorkspace=tool==="create_open_loop"?String(proposed[0].input?.workspace||"office"):"office";
      await patientAccess(sql,person,externalId,assignedWorkspace,
        risk==="low"?"tool.approve.low":"tool.prepare");
    }else{
      const assignedWorkspace=mode==="prepare"?"office":workspace==="ckd"?"office":workspace;
      await patientAccess(sql,person,externalId,assignedWorkspace,mode==="prepare"?"tool.prepare":"agent.review");
    }
    const result=await sql.begin(async(tx:any)=>{
      const p=await tx.unsafe("select id,display_name,synthetic from ehr.patient where external_id=$1 limit 1 for update",[externalId]);
      if(!p.length||p[0].synthetic!==true) throw new Error("synthetic_patient_not_found");
      const patientId=p[0].id;

      const st=await tx.unsafe("select state_version,state::text as state_text from ehr.patient_state where patient_id=$1 order by state_version desc limit 1",[patientId]);
      if(!st.length) throw new Error("patient_state_not_found");
      const stateVersion=Number(st[0].state_version);
      const state=patientState(st[0].state_text,externalId);

      if(mode==="prepare"){
        const toolName=String(body?.toolName||"");
        if(!["prepare_followup_lab_order","prepare_followup_appointment"].includes(toolName)){
          throw new Error("tool_not_allowed_for_preparation");
        }
        const summary=String(body?.summary||"").trim();
        const timing=String(body?.timing||"").trim();
        const reason=String(body?.reason||"").trim();
        const tests=Array.isArray(body?.tests)?body.tests.map(String).filter(Boolean).slice(0,20):[];
        if(!summary) throw new Error("summary_required");

        const registry=await tx.unsafe(
          "select tool_name,risk_level,requires_approval,execution_mode,enabled from ehr.tool_registry where tool_name=$1 limit 1",
          [toolName]
        );
        if(!registry.length||registry[0].enabled!==true) throw new Error("tool_not_available");

        const ev=await tx.unsafe(
          "insert into ehr.event(patient_id,event_type,actor_type,actor_id,source,status,payload) values($1,'TOOL_ACTION_PREPARED','physician',$4,'workflow-preparation','proposed',jsonb_build_object('toolName',$2::text,'summary',$3::text,'externalExecution',false)) returning id",
          [patientId,toolName,summary,person.externalId]
        );

        const tool=await tx.unsafe(
          "insert into ehr.tool_call(patient_id,tool_name,risk_level,requires_approval,status,input,prepared_event_id) values($1,$2,$3,$4,'awaiting_approval',jsonb_build_object('summary',$5::text,'timing',$6::text,'reason',$7::text,'testsText',$8::text,'externalExecution',false),$9) returning id",
          [
            patientId,
            toolName,
            registry[0].risk_level,
            registry[0].requires_approval,
            summary,
            timing,
            reason,
            tests.join(", "),
            ev[0].id
          ]
        );

        return {
          mode:"prepare",
          stateVersion,
          toolName,
          proposedAction:{
            toolCallId:tool[0].id,
            label:summary,
            status:"awaiting_approval",
            externalExecution:false
          }
        };
      }

      if(mode==="decide"){
        const toolCallId=String(body?.toolCallId||"");
        const decision=String(body?.decision||"");
        if(!toolCallId||!["approved","rejected"].includes(decision)) throw new Error("invalid_decision_payload");

        const rows=await tx.unsafe(
          "select tc.*,tr.execution_mode from ehr.tool_call tc join ehr.tool_registry tr on tr.tool_name=tc.tool_name where tc.id=$1::uuid and tc.patient_id=$2 and tc.status='awaiting_approval' and tr.enabled=true limit 1 for update",
          [toolCallId,patientId]
        );
        if(!rows.length) throw new Error("tool_call_not_pending");
        const tc=rows[0];
        tc.input=jsonObject(tc.input,"tool_input");
        if(tc.input.encounterId){
          const e=await tx.unsafe("select id from ehr.synthetic_encounter where id=$1::uuid and patient_id=$2::uuid and clinician_principal_id=$3::uuid and status='draft' for update",[tc.input.encounterId,patientId,person.id]);
          if(!e.length)throw new AccessError(409,"encounter_draft_not_found");
        }
        const proposedBaseVersion=Number(tc.input?.baseStateVersion||0);
        if(decision==="approved" && proposedBaseVersion>0 && proposedBaseVersion!==stateVersion){
          const fresh=tc.agent_run_id?await tx.unsafe("select ehr.review_source_current($1::uuid,$2::bigint,$3::uuid) as current",[patientId,proposedBaseVersion,tc.agent_run_id]):[];
          if(fresh[0]?.current!==true)throw new AccessError(409,"stale_agent_proposal");
        }

        const decisionEvent=await tx.unsafe(
          "insert into ehr.event(patient_id,event_type,actor_type,actor_id,source,status,payload) values($1,$2,'physician',$5,'workspace-review','recorded',jsonb_build_object('toolCallId',$3::text,'decision',$4::text,'encounterId',$6::text)) returning id",
          [patientId,decision==="approved"?"PHYSICIAN_APPROVAL_GRANTED":"PHYSICIAN_APPROVAL_REJECTED",toolCallId,decision,person.externalId,tc.input.encounterId||null]
        );

        await tx.unsafe(
          "insert into ehr.approval(patient_id,tool_call_id,decision,decided_by_type,decided_by_id,event_id) values($1,$2::uuid,$3,'physician',$5,$4)",
          [patientId,toolCallId,decision,decisionEvent[0].id,person.externalId]
        );

        if(decision==="rejected"){
          await tx.unsafe("update ehr.tool_call set status='rejected' where id=$1::uuid",[toolCallId]);
          return {mode:"decision",toolCallId,status:"rejected",stateVersion,patient:state};
        }

        const input=tc.input||{};
        const executedEvent=await tx.unsafe(
          "insert into ehr.event(patient_id,event_type,actor_type,source,status,payload) values($1,'TOOL_ACTION_EXECUTED','system','workspace-review','executed',jsonb_build_object('toolCallId',$2::text,'toolName',$3::text,'externalExecution',false,'encounterId',$4::text)) returning id",
          [patientId,toolCallId,tc.tool_name,tc.input.encounterId||null]
        );

        let loopLabel="";
        let loopType="";
        let loopWorkspace="office";
        let sourceLabel="approved-workflow-action";

        if(tc.tool_name==="create_open_loop"){
          loopLabel=String(input.label||"Review agent workspace");
          loopType=String(input.loopType||"agent-review");
          loopWorkspace=String(input.workspace||"shared");
          sourceLabel="approved-agent-review";
        }else if(tc.tool_name==="prepare_followup_lab_order"){
          loopLabel="Prepared lab follow-up: "+String(input.summary||"physician-specified labs");
          loopType="lab-order-preparation";
        }else if(tc.tool_name==="prepare_followup_appointment"){
          loopLabel="Prepared follow-up appointment: "+String(input.summary||"physician-specified follow-up");
          loopType="appointment-preparation";
        }else{
          throw new Error("tool_not_allowlisted_for_execution");
        }

        const loop=await tx.unsafe(
          "insert into ehr.open_loop(patient_id,label,loop_type,workspace,owner_type,status,created_from_event_id,metadata) values($1,$2,$3,$4,'nephrology-team','pending',$5,jsonb_build_object('toolCallId',$6::text,'source',$7::text,'externalExecution',false)) returning id",
          [patientId,loopLabel,loopType,loopWorkspace,executedEvent[0].id,toolCallId,sourceLabel]
        );

        await tx.unsafe(
          "update ehr.tool_call set status='executed',executed_event_id=$2,executed_at=now(),output=jsonb_build_object('openLoopId',$3::text,'prepared',true,'externalExecution',false) where id=$1::uuid",
          [toolCallId,executedEvent[0].id,loop[0].id]
        );

        const reduced=await tx.unsafe(
          "select ehr.reduce_patient_state($1,$2,$3) as state_version",
          [patientId,executedEvent[0].id,"patient-state-reducer-v4"]
        );
        const nextVersion=Number(reduced[0].state_version);
        const next=await tx.unsafe(
          "select state::text as state_text from ehr.patient_state where patient_id=$1 and state_version=$2 limit 1",
          [patientId,nextVersion]
        );

        return {
          mode:"decision",
          toolCallId,
          status:"executed",
          openLoopId:loop[0].id,
          stateVersion:nextVersion,
          patient:patientState(next[0].state_text,externalId)
        };
      }

      if(!["ckd","dialysis","hospital"].includes(workspace)) throw new Error("invalid_workspace");

      const context=workspace==="ckd"
        ? {
            active:true,
            diagnosis:state?.diagnosis||null,
            ckdStage:state?.ckdStage||null,
            eGFR:state?.labs?.eGFR?.value??null,
            UACR:state?.labs?.UACR?.value??null,
            UPCR:state?.labs?.UPCR?.value??null,
            potassium:state?.labs?.Potassium?.value??null,
            bicarbonate:state?.labs?.Bicarbonate?.value??null,
            hemoglobin:state?.labs?.Hemoglobin?.value??null,
            phosphate:state?.labs?.Phosphate?.value??null,
            bloodPressure:state?.longitudinal?.bpVolume?.latestBp||state?.contexts?.office?.bp||null,
            activeMedications:Array.isArray(state?.meds)?state.meds.length:0,
            openLoops:Array.isArray(state?.longitudinal?.openLoops)?state.longitudinal.openLoops.length:0
          }
        : (state?.contexts?.[workspace]||{});
      const summary=workspace==="ckd"
        ?"CKD workspace review snapshot generated from canonical Patient State."
        : workspace.charAt(0).toUpperCase()+workspace.slice(1)+" workspace review snapshot generated from canonical Patient State.";

      const run=await tx.unsafe(
        "insert into ehr.agent_run(patient_id,agent_name,agent_version,run_type,status,input_snapshot,output,model_provider,model_name,completed_at) values($1,$2,'1.0.0','workspace-review','completed',jsonb_build_object('patientId',$3::text,'stateVersion',$4::bigint),jsonb_build_object('summary',$5::text,'contextText',$6::text),'deterministic','workspace-review-v2',now()) returning id,started_at,completed_at",
        [patientId,workspace+"-review-agent",externalId,stateVersion,summary,JSON.stringify(context)]
      );

      const ev=await tx.unsafe(
        "insert into ehr.event(patient_id,event_type,actor_type,actor_id,source,status,payload) values($1,'AGENT_RUN_COMPLETED','agent',$2,'workspace-review','recorded',jsonb_build_object('workspace',$3::text,'runId',$4::text,'stateVersion',$5::bigint)) returning id",
        [patientId,run[0].id,workspace,run[0].id,stateVersion]
      );

      const proposalLabel=workspace==="ckd"
        ? "Review CKD longitudinal workspace"
        : workspace==="dialysis"
          ? "Review dialysis longitudinal workspace"
          : "Review hospital nephrology workspace";

      const tool=await tx.unsafe(
        "insert into ehr.tool_call(agent_run_id,patient_id,tool_name,risk_level,requires_approval,status,input,prepared_event_id) values($1,$2,'create_open_loop','low',true,'awaiting_approval',jsonb_build_object('label',$3::text,'loopType','agent-review','workspace',$4::text,'agentType',$5::text),$6) returning id",
        [run[0].id,patientId,proposalLabel,workspace==="ckd"?"office":workspace,workspace,ev[0].id]
      );

      return {
        mode:"review",
        runId:run[0].id,
        eventId:ev[0].id,
        workspace,
        stateVersion,
        summary,
        context,
        completedAt:run[0].completed_at,
        proposedAction:{toolCallId:tool[0].id,label:proposalLabel,status:"awaiting_approval"}
      };
    });

    return reply({apiVersion:API_VERSION,...result},200,origin);
  }catch(error){
    const denied=authFailure(error);
    return reply({apiVersion:API_VERSION,error:denied?.code||String(error?.message||error)},denied?.status||400,origin);
  }
});

