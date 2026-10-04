// Deterministic organization of signed facts. No diagnosis or treatment inference.
export function soapSections(input:string) {
  const sections:Record<string,string>={},loose:string[]=[];let key='';
  const names:Record<string,string>={s:'subjective',subjective:'subjective',hpi:'hpi','history of present illness':'hpi',cc:'reason','chief complaint':'reason','reason for visit':'reason',ros:'ros','review of systems':'ros',pmh:'history','past medical history':'history',allergies:'allergies',o:'objective',objective:'objective',exam:'exam','physical examination':'exam',a:'assessment',assessment:'assessment',p:'plan',plan:'plan','assessment and plan':'combined','assessment & plan':'combined'};
  for(const line of String(input||'').split(/\r?\n/)){
    const m=/^\s*(S\s*[-–—]\s*Subjective|O\s*[-–—]\s*Objective|A\s*[-–—]\s*Assessment|P\s*[-–—]\s*Plan|Subjective|Objective|Assessment(?:\s+(?:and|&)\s+Plan)?|Plan|History of present illness|Chief complaint|Reason for visit|Review of systems|Past medical history|Physical examination|Allergies|HPI|ROS|PMH|Exam|CC|[SOAP])\s*(?::\s*(.*)|$)/i.exec(line);
    if(m){key=names[m[1].toLowerCase().replace(/^[SOAP]\s*[-–—]\s*/i,'')]||'';if(key&&m[2])sections[key]=[sections[key],m[2]].filter(Boolean).join('\n');}
    else if(key)sections[key]=[sections[key],line].filter(v=>v!=null).join('\n');else loose.push(line);
  }
  for(const k of Object.keys(sections))sections[k]=sections[k].trim();
  return {sections,unsectioned:loose.join('\n').trim()};
}
function readable(v:any):string{return v==null?'Not documented':typeof v==='object'?String(v.name||v.label||v.value||JSON.stringify(v)):String(v);}
export function soapNote(source:any,patient:any,externalId:string,approvedItems:any[]=[]) {
  const signedNote=String(source.note_text||''),organized=/^PRE-CHARTING WORKSPACE\b/.test(signedNote.trim());
  const clinicalSources=Array.isArray(source.sources)?source.sources.filter((v:any)=>['typed-note','physician-dictation','ambient-transcript'].includes(v.kind)&&typeof v.text==='string').map((v:any)=>v.text).join('\n\n'):'';
  const parsed=soapSections(organized?clinicalSources:signedNote),s=parsed.sections;
  const content=patient.approvedEncounterReview?.encounterId===source.id?patient.approvedEncounterReview.content:null;
  const bp=patient.vitals?.bloodPressure||patient.vitals?.bp||patient.bloodPressure||patient.bp||patient.longitudinal?.bpVolume?.latestBp||patient.contexts?.office?.bp;
  const bloodPressure=bp&&typeof bp==='object'?readable(bp.systolic)+'/'+readable(bp.diastolic):readable(bp);
  const labOrder=['Creatinine','eGFR','BUN','Sodium','Potassium','Bicarbonate','UACR','UPCR','Calcium','Phosphate','Albumin','PTH','Hemoglobin'];
  const labs=patient.labs||{},keys=[...labOrder.filter(k=>k in labs),...Object.keys(labs).filter(k=>!labOrder.includes(k))];
  const labText=keys.map(k=>{const v=labs[k];return k+': '+readable(v?.value??v)+(v?.unit?' '+v.unit:'')+(v?.observedAt||v?.date?' (recorded '+(v.observedAt||v.date)+')':'');}).join('\n')||'Not documented.';
  const meds=(Array.isArray(patient.meds)?patient.meds:[]).map(m=>typeof m==='string'?m:[m.name||m.label,m.dose,m.route,m.frequency].filter(Boolean).join(' ')).join('; ')||'Not documented.';
  const astraSignals=Array.isArray(content?.signals)?content.signals.filter((v:any)=>typeof v.title==='string'&&typeof v.evidence==='string').slice(0,8):[];
  const assessment=s.assessment||s.combined||[typeof content?.summary==='string'?content.summary:'Recorded diagnosis: '+readable(patient.diagnosis),...astraSignals.map((v:any,i:number)=>(i+1)+'. '+v.title+'\n'+v.evidence)].join('\n\n');
  const plan=s.plan||(s.combined?'See physician-authored assessment and plan above.':'Medication decisions: Not documented.\nTests / monitoring: Not documented.\nCounseling: Not documented.\nFollow-up interval: Not documented.');
  const approvedPlan=approvedItems.filter(i=>i.status==='approved').map(i=>'- '+i.label+(i.details?' — '+i.details:'')+(i.due_date?' (due '+i.due_date+')':'')).join('\n');
  const narrative=[s.hpi,s.subjective,parsed.unsectioned].filter(Boolean).join('\n\n');
  const note=['NEPHROLOGY SOAP NOTE','Patient: '+readable(patient.name||patient.displayName)+' | '+externalId,'Signed encounter: '+new Date(source.signed_at).toISOString(),
    'S — SUBJECTIVE','Reason for visit: '+(s.reason||'Not documented.'),'HPI: '+(narrative||'Not documented.'),'ROS: '+(s.ros||'Not documented.'),'Relevant history: '+(s.history||'Not documented.'),'Medications in signed record: '+meds,'Allergies: '+(s.allergies||(patient.allergies!=null?readable(patient.allergies):'Not documented.')),
    'O — OBJECTIVE','Blood pressure in signed record: '+bloodPressure+(bp?' mm Hg':''),'Physical examination: '+(s.exam||'Not documented.'),...(s.objective?[s.objective]:[]),'Laboratory data in signed record:\n'+labText,
    'A — ASSESSMENT',assessment||'Not documented.',
    'P — PLAN',plan,...(approvedPlan?['Physician-approved package items (simulated):\n'+approvedPlan]:[])].join('\n\n');
  return {noteText:note,bloodPressure,approvedSummary:typeof content?.summary==='string'?content.summary:null};
}
