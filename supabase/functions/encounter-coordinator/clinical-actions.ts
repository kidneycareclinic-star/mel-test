import {providerRequest,schema,fail} from './drafting.ts';

// Bounded, paraphrased reference set. Informational in this synthetic build;
// not a clinic-approved protocol and never a source of executable actions.
export const evidenceCorpus={version:'kdigo-2024-monitoring-20261005',checkedAt:'2026-10-05',clinicalValidation:'starter reference set; physician applicability review required',references:[
  {id:'ckd-monitoring',title:'Kidney function and albuminuria monitoring',section:'Practice Points 2.1.1–2.1.2',page:40,summary:'For CKD, assess GFR and albuminuria at least yearly. Higher-risk patients may need more frequent assessment when results would affect treatment.',url:'https://kdigo.org/wp-content/uploads/2026/04/KDIGO-2024-CKD-Guideline.pdf#page=40'},
  {id:'ckd-risk',title:'Kidney failure risk assessment',section:'Recommendation 2.2.1 (1A)',page:41,summary:'For CKD G3–G5, use an externally validated equation to estimate kidney failure risk. Confirm the applicable population and required inputs.',url:'https://kdigo.org/wp-content/uploads/2026/04/KDIGO-2024-CKD-Guideline.pdf#page=41'}
]};
export function evidenceFor(context:any){
  const chart=context.chartContext,recorded=JSON.stringify({diagnosis:chart.diagnosis,problemList:chart.problemList});
  const match=recorded.match(/(?:\bCKD\b|chronic kidney disease)[^"\n]{0,100}/i);
  return {corpusVersion:evidenceCorpus.version,checkedAt:evidenceCorpus.checkedAt,clinicalValidation:evidenceCorpus.clinicalValidation,chartBasis:match?.[0]||null,applicability:match?'CKD is recorded in historical chart context. Confirm diagnosis, stage, result dates and relevance to this encounter.':'CKD was not identified in the chart problem context. These references have not been matched to this patient.',references:evidenceCorpus.references.map(r=>({...r,role:'Reference for physician consideration; not an order or documented plan'})),externalExecution:false};
}
export function actionSources(context:any){return [{id:'encounter-note',kind:'reviewed-encounter',title:'Saved encounter text',text:context.encounterNote},...context.reviewedSources.filter((s:any)=>s.kind!=='lab-trend').map((s:any,i:number)=>({...s,id:'reviewed-'+i}))].filter(s=>s.text?.trim());}
const medSchema={type:['object','null'],additionalProperties:false,required:['name','dose','route','frequency'],properties:Object.fromEntries(['name','dose','route','frequency'].map(k=>[k,{type:'string'}]))};
export const clinicalActionSchema={type:'array',items:{type:'object',additionalProperties:false,required:['kind','label','details','timing','sourceId','sourceQuote','intent','missingInformation','patientText','medication'],properties:{kind:{type:'string',enum:['lab','medication','referral','follow-up','instruction']},label:{type:'string'},details:{type:'string'},timing:{type:'string'},sourceId:{type:'string'},sourceQuote:{type:'string'},intent:{type:'string',enum:['physician-plan','uncertain']},missingInformation:{type:'array',items:{type:'string'}},patientText:{type:'string'},medication:medSchema}}};
export function actionRequest(context:any,prefs:any){
  const request=providerRequest(context,prefs);
  request.max_output_tokens=9000;
  request.instructions+=' Also return actions: at most 12 distinct intended labs, medication actions, referrals, follow-up or counseling instructions explicitly documented in actionSources. Do not derive actions from historical chart data or guideline references. Never transform a negated action into an affirmative lab or medication action. Explicit physician prohibitions may be included only as instructions with negation preserved. Never treat a patient request, hypothesis, question, deferred consideration or unclear speaker as physician intent: omit it or mark intent uncertain with a missingInformation explanation. Deduplicate repeated source text. Preserve exact timing; do not invent dates. Each action must cite a single exact sourceQuote and its sourceId. For medication actions preserve name, dose, route and frequency exactly; use empty strings for missing fields and flag them, never infer them from usual dosing or the medication list. For other kinds set medication to null. patientText is a short patient-facing restatement of this action only, preserving negation, numbers, uncertainty and timing. Do not add advice or app instructions. Empty actions is valid when no physician plan is documented.';
  request.input=JSON.stringify({preferences:prefs,evidence:context,actionSources:actionSources(context)});
  request.text.format={type:'json_schema',name:'encounter_review_packet',strict:true,schema:{...schema,required:[...schema.required,'actions'],properties:{...schema.properties,actions:clinicalActionSchema}}};
  return request;
}
function bounded(value:any,max:number,empty=false){return typeof value==='string'&&value.length<=max&&(empty||!!value.trim());}
export function validateActions(value:any,context:any){
  if(!Array.isArray(value)||value.length>12)fail('clinical_actions_invalid_output',502);
  const sources=actionSources(context),seen=new Set();
  return value.map((a:any)=>{
    const source=sources.find(s=>s.id===a?.sourceId);
    if(!a||!['lab','medication','referral','follow-up','instruction'].includes(a.kind)||!bounded(a.label,240)||!bounded(a.details,2000,true)||!bounded(a.timing,160,true)||!bounded(a.patientText,1000)||!bounded(a.sourceQuote,1500)||!source?.text.includes(a.sourceQuote)||!['physician-plan','uncertain'].includes(a.intent)||!Array.isArray(a.missingInformation)||a.missingInformation.length>10||a.missingInformation.some((s:any)=>!bounded(s,300)))fail('clinical_actions_invalid_output',502);
    const fingerprint=JSON.stringify([a.kind,a.label.toLowerCase(),a.sourceId,a.sourceQuote]);if(seen.has(fingerprint))fail('clinical_actions_invalid_output',502);seen.add(fingerprint);
    const blockers=[...a.missingInformation];if(a.intent==='uncertain')blockers.push('Physician intent or speaker attribution needs clarification.');
    if(a.kind==='medication'){
      if(!a.medication||Object.keys(a.medication).sort().join()!=='dose,frequency,name,route'||Object.values(a.medication).some(v=>!bounded(v,160,true)))fail('clinical_actions_invalid_output',502);
      for(const [k,v] of Object.entries(a.medication)){if(!v)blockers.push('Medication '+k+' not documented.');else if(!a.sourceQuote.toLowerCase().includes(String(v).toLowerCase()))fail('clinical_actions_invalid_output',502);}
    }else if(a.medication!==null)fail('clinical_actions_invalid_output',502);
    return {...a,blockers:[...new Set(blockers)],sourceTitle:source.title||source.kind,simulated:true};
  });
}
// Edits are clinician-authored, not re-inferred by a model. Finalization stores
// the original evidence and exact reviewed content in the immutable receipt.
export function reviewActions(packet:any,decisions:any,final=false){
  const actions=packet.actions||[];if(decisions==null&&!actions.length)decisions=[];
  if(!Array.isArray(decisions)||decisions.length!==actions.length||new Set(decisions.map(d=>d?.actionId)).size!==actions.length)fail('action_decisions_incomplete');
  return actions.map((a:any)=>{
    const d=decisions.find((d:any)=>d?.actionId===a.id);
    if(!d||!['pending','accepted','edited','rejected'].includes(d.decision))fail('action_decisions_incomplete');
    if(final&&d.decision==='pending')fail('action_review_required',409);
    const edited=d.decision==='edited';
    const current=edited?{...a,label:d.label,details:d.details,timing:d.timing,patientText:d.patientText,medication:a.kind==='medication'?d.medication:null}:a;
    if(edited&&(!bounded(current.label,240)||!bounded(current.details,2000,true)||!bounded(current.timing,160,true)||!bounded(current.patientText,1000)))fail('invalid_action_edit');
    if(edited&&current.kind==='medication'&&(!current.medication||Object.keys(current.medication).sort().join()!=='dose,frequency,name,route'||Object.values(current.medication).some(v=>!bounded(v,160,true))))fail('invalid_action_edit');
    if(final&&['accepted','edited'].includes(d.decision)){
      if(a.blockers.length&&(!edited||d.clarified!==true))fail('action_clarification_required',409);
      if(current.kind==='medication'&&Object.values(current.medication).some(v=>!v?.toString().trim()))fail('medication_fields_required',409);
    }
    return {...current,decision:d.decision,clarified:d.clarified===true,original:a};
  });
}
