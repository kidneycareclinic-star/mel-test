import postgres from "npm:postgres@3.4.7";
const dbUrl=Deno.env.get("SUPABASE_DB_URL");
if(!dbUrl) throw new Error("SUPABASE_DB_URL is not configured");
const sql=postgres(dbUrl,{prepare:false,max:1});
const API_VERSION="workspace-review-v2";

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
    const result=await sql.begin(async(tx:any)=>{
      const p=await tx.unsafe("select id,display_name,synthetic from ehr.patient where external_id=$1 limit 1",[externalId]);
      if(!p.length||p[0].synthetic!==true) throw new Error("synthetic_patient_not_found");
      const patientId=p[0].id;

      const st=await tx.unsafe("select state_version,state::text as state_text from ehr.patient_state where patient_id=$1 order by state_version desc limit 1",[patientId]);
      if(!st.length) throw new Error("patient_state_not_found");
      const stateVersion=Number(st[0].state_version);
      const state=JSON.parse(String(st[0].state_text));

      if(mode==="decide"){
        const toolCallId=String(body?.toolCallId||"");
        const decision=String(body?.decision||"");
        if(!toolCallId||!["approved","rejected"].includes(decision)) throw new Error("invalid_decision_payload");

        const rows=await tx.unsafe(
          "select tc.* from ehr.tool_call tc where tc.id=$1::uuid and tc.patient_id=$2 and tc.status='awaiting_approval' and tc.tool_name='create_open_loop' limit 1 for update",
          [toolCallId,patientId]
        );
        if(!rows.length) throw new Error("tool_call_not_pending");
        const tc=rows[0];

        const decisionEvent=await tx.unsafe(
          "insert into ehr.event(patient_id,event_type,actor_type,source,status,payload) values($1,$2,'physician','workspace-review','recorded',jsonb_build_object('toolCallId',$3::text,'decision',$4::text)) returning id",
          [patientId,decision==="approved"?"PHYSICIAN_APPROVAL_GRANTED":"PHYSICIAN_APPROVAL_REJECTED",toolCallId,decision]
        );

        await tx.unsafe(
          "insert into ehr.approval(patient_id,tool_call_id,decision,decided_by_type,decided_by_id,event_id) values($1,$2::uuid,$3,'physician','synthetic-demo-physician',$4)",
          [patientId,toolCallId,decision,decisionEvent[0].id]
        );

        if(decision==="rejected"){
          await tx.unsafe("update ehr.tool_call set status='rejected' where id=$1::uuid",[toolCallId]);
          return {mode:"decision",toolCallId,status:"rejected",stateVersion,patient:state};
        }

        const input=tc.input||{};
        const executedEvent=await tx.unsafe(
          "insert into ehr.event(patient_id,event_type,actor_type,source,status,payload) values($1,'TOOL_ACTION_EXECUTED','system','workspace-review','executed',jsonb_build_object('toolCallId',$2::text,'toolName','create_open_loop')) returning id",
          [patientId,toolCallId]
        );

        const loop=await tx.unsafe(
          "insert into ehr.open_loop(patient_id,label,loop_type,workspace,owner_type,status,created_from_event_id,metadata) values($1,$2,$3,$4,'nephrology-team','pending',$5,jsonb_build_object('toolCallId',$6::text,'source','approved-agent-review')) returning id",
          [
            patientId,
            String(input.label||"Review agent workspace"),
            String(input.loopType||"agent-review"),
            String(input.workspace||"shared"),
            executedEvent[0].id,
            toolCallId
          ]
        );

        await tx.unsafe(
          "update ehr.tool_call set status='executed',executed_event_id=$2,executed_at=now(),output=jsonb_build_object('openLoopId',$3::text) where id=$1::uuid",
          [toolCallId,executedEvent[0].id,loop[0].id]
        );

        const reduced=await tx.unsafe(
          "select ehr.reduce_patient_state($1,$2,$3) as state_version",
          [patientId,executedEvent[0].id,"patient-state-reducer-v1"]
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
          patient:JSON.parse(String(next[0].state_text))
        };
      }

      if(!["ckd","dialysis","hospital"].includes(workspace)) throw new Error("invalid_workspace");

      const context=workspace==="ckd"?(state?.contexts?.office||{}):(state?.contexts?.[workspace]||{});
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
    return reply({apiVersion:API_VERSION,error:String(error?.message||error)},400,origin);
  }
});