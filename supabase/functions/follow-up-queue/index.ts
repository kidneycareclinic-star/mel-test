import postgres from "npm:postgres@3.4.7";
import { clinician, censusAccess, authFailure } from "./clinician-auth.ts";
import { options, queueView } from "./queue.ts";
const url=Deno.env.get("SUPABASE_DB_URL");if(!url)throw new Error("SUPABASE_DB_URL is not configured");
const sql=postgres(url,{prepare:false,max:1});
function allowed(origin:string|null){return origin==="https://kidneycareclinic-star.github.io"||!!origin&&/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);}
function response(body:unknown,status=200,origin:string|null=null){
  const headers=new Headers({"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});
  if(origin&&allowed(origin)){headers.set("Access-Control-Allow-Origin",origin);headers.set("Vary","Origin");}
  headers.set("Access-Control-Allow-Methods","GET, OPTIONS");headers.set("Access-Control-Allow-Headers","authorization, apikey, content-type");
  return new Response(JSON.stringify({apiVersion:"follow-up-queue-v6",...body as any}),{status,headers});
}
Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("origin");if(origin&&!allowed(origin))return response({error:"origin_not_allowed"},403,origin);
  if(req.method==="OPTIONS")return response({ok:true},200,origin);
  if(req.method!=="GET")return response({error:"method_not_allowed"},405,origin);
  try{
    const opts=options(new URL(req.url).searchParams),person=await clinician(req,sql);
    const result=await sql.begin("isolation level repeatable read",async(tx:any)=>{
      const patients=await censusAccess(tx,person,"office");
      if(!patients.length)throw Object.assign(new Error("patient_access_denied"),{status:403});
      return {...await queueView(tx,person,opts),patients:patients.map((p:any)=>({id:p.external_id,name:p.display_name}))};
    });
    return response(result,200,origin);
  }catch(error){
    const denied=authFailure(error);if(denied)return response({error:denied.code},denied.status,origin);
    if(error&&typeof(error as any).status==="number")return response({error:(error as Error).message},(error as any).status,origin);
    console.error("Follow-up queue failed",error);return response({error:"queue_unavailable"},500,origin);
  }
});
