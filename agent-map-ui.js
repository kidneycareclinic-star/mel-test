/* Role-colored encounter navigation. Dots inspect work; they do not grant authority. */
(function () {
  if (window.SYNTHETIC_ENCOUNTER_COORDINATOR_ENABLED !== true) return;
  var coordinator = document.getElementById('encounterCoordinator');
  if (!coordinator) return;
  var definitions = [
    {id:'voice',name:'Ambient voice',role:'Capture & review',symbol:'◉',tier:1},
    {id:'orchestrator',name:'Orchestrator',role:'Coordinate encounter',symbol:'◎',tier:2},
    {id:'chart',name:'Chart organizer',role:'Labs · history · medications',symbol:'C',tier:3},
    {id:'evidence',name:'Clinical evidence',role:'Astra · guideline review',symbol:'E',tier:3},
    {id:'note',name:'Note writer',role:'SOAP · your template',symbol:'N',tier:3},
    {id:'orders',name:'Orders & instructions',role:'Plan · simulated package',symbol:'O',tier:3},
    {id:'verification',name:'Verification',role:'Review · exclusions · signature',symbol:'V',tier:3},
    {id:'followup',name:'Follow-up',role:'Track approved work',symbol:'F',tier:3}
  ];
  var map = document.createElement('section');
  map.id = 'encounterAgentMap'; map.className = 'encounter-agent-map';
  map.setAttribute('aria-labelledby','agentMapTitle');
  map.innerHTML = '<header class="agent-map-head"><div><span class="agent-map-eyebrow">YOUR ENCOUNTER TEAM</span><h3 id="agentMapTitle">Listen. Coordinate. Review.</h3></div><span id="agentMapPatient" class="agent-map-patient"></span></header><div class="agent-map-hierarchy"><div class="agent-map-leads"></div><div class="agent-map-branch" aria-hidden="true"></div><div class="agent-map-specialists" role="group" aria-label="Specialists coordinated by the orchestrator"></div></div><div class="agent-map-footer"><span id="agentMapCaptureState">Microphone idle</span><button id="agentMapStop" type="button" class="small-btn" hidden>Stop capture</button><span class="agent-map-legend">Color identifies role · Text identifies status</span></div>';
  coordinator.insertBefore(map,coordinator.firstChild);
  var inspector = document.createElement('section'); inspector.id='agentFunctionPanel'; inspector.className='agent-function-panel';
  inspector.setAttribute('aria-labelledby','agentFunctionTitle');
  inspector.innerHTML='<div class="agent-function-head"><h4 id="agentFunctionTitle"></h4><span id="agentFunctionState"></span></div><p id="agentFunctionDescription"></p><div id="agentFunctionActions" class="agent-function-actions"></div><div id="agentFunctionContent"></div>';
  map.after(inspector);
  var leads=map.querySelector('.agent-map-leads'),specialists=map.querySelector('.agent-map-specialists');
  definitions.forEach(function(definition){
    var button=document.createElement('button');button.type='button';button.className='agent-dot agent-dot-'+definition.id;
    button.dataset.agent=definition.id;button.setAttribute('aria-pressed','false');button.setAttribute('aria-controls','agentFunctionPanel');
    var circle=document.createElement('span');circle.className='agent-dot-circle';circle.setAttribute('aria-hidden','true');
    if(definition.id==='voice'){
      var levels=document.createElement('span');levels.className='agent-orb-levels';
      for(var i=0;i<7;i++){var bar=document.createElement('i');bar.style.setProperty('--orb-height','8px');levels.appendChild(bar);}circle.appendChild(levels);
      var center=document.createElement('span');center.className='agent-orb-caption';center.textContent='VOICE';circle.appendChild(center);
    }else circle.textContent=definition.symbol;
    button.appendChild(circle);
    var label=document.createElement('strong');label.textContent=definition.name;button.appendChild(label);
    var role=document.createElement('span');role.className='agent-dot-role';role.textContent=definition.role;button.appendChild(role);
    var state=document.createElement('span');state.className='agent-dot-state';state.textContent='Not started';button.appendChild(state);
    (definition.tier<3?leads:specialists).appendChild(button);
    button.addEventListener('click',function(){select(definition.id);});
  });
  var job=window.ENCOUNTER_COORDINATOR_UI?.job?.()||null,selected='voice',recordingSource=null,disposed=false,queued=false;
  var capture=coordinator.querySelector('.coordinator-capture'),chart=coordinator.querySelector('.coordinator-chart');
  var clinicalPane=document.querySelector('.agent-pane'),clinicalHome=clinicalPane?.parentNode,clinicalNext=clinicalPane?.nextSibling;
  var loops=document.getElementById('openLoopList')?.closest('.loop-panel'),loopHome=loops?.parentNode,loopNext=loops?.nextSibling;
  var description=inspector.querySelector('#agentFunctionDescription'),actions=inspector.querySelector('#agentFunctionActions'),content=inspector.querySelector('#agentFunctionContent');
  // Clinical identity stays above the encounter, and the encounter precedes detailed chart sections.
  var encounter=coordinator.closest('.prechart-panel'),identity=document.getElementById('demographics');
  if(encounter&&identity?.parentNode===encounter.parentNode)identity.after(encounter);
  function patient(){try{return currentPatient||window.currentPatient||null;}catch(_){return window.currentPatient||null;}}
  function state(){
    var status=coordinator.querySelector('.coordinator-status'),review=coordinator.querySelector('.coordinator-review');
    var hasNote=!!review.querySelector('[data-note]'),signed=!!review.querySelector('pre')&&!hasNote;
    return {hasPatient:!!patient(),chart:!!chart.children.length,note:hasNote,signed:signed,ready:hasNote&&!coordinator.querySelector('.coordinator-finalize').disabled,error:status.classList.contains('is-error'),message:status.textContent};
  }
  function restore(node,parent,next){if(!node||!parent)return;if(next?.parentNode===parent)parent.insertBefore(node,next);else parent.appendChild(node);}
  function labelFor(id,s){
    if(!s.hasPatient)return 'Select patient';
    if(job&&!s.signed&&id!=='voice'&&id!=='followup'){if(id==='orchestrator')return ({queued:'Queued · continues in background',running:'Working in background',failed:'Paused · retry available',ready:'Prepared · physician review',superseded:'Source changed',cancelled:'Stopped',finalized:'Finalized'})[job.status]||'Awaiting source';var stage=job.stages?.[id];if(stage)return ({complete:id==='verification'?'Source checks complete · review required':'Task complete',working:'Working',queued:'Queued',waiting:'Waiting for prior task','needs-attention':'Paused · needs attention',held:'Held'})[stage]||'Awaiting source';}
    if(id==='voice')return recordingSource?'Recording':'Capture & review';
    if(id==='chart')return s.chart?'Chart available':'Awaiting chart';
    if(id==='evidence')return coordinator.querySelector('[data-evidence]')?'KDIGO references available':'Awaiting preparation';
    if(id==='note')return s.signed?'Signed':s.note?'Draft available':'Awaiting reviewed source';
    if(id==='orders')return s.signed?'Review saved · simulated':s.note?coordinator.querySelectorAll('[data-action]').length+' source drafts · simulated':'Awaiting reviewed source';
    if(id==='verification')return s.signed?'Receipt saved':s.ready?'Review available':'Approval held';
    if(id==='followup')return 'Tracker · phone alerts planned';
    return s.error?'Needs attention':s.signed?'Finalized':s.ready?'Ready for review':s.note?'Review required':'Awaiting reviewed source';
  }
  function focusControl(selector){var element=coordinator.querySelector(selector);if(!element)return;element.scrollIntoView?.({block:'center',behavior:'auto'});element.focus();}
  function action(label,fn){var button=document.createElement('button');button.type='button';button.className='small-btn';button.textContent=label;button.addEventListener('click',fn);actions.appendChild(button);}
  function select(id){
    if(!definitions.some(function(d){return d.id===id;}))return;
    restore(clinicalPane,clinicalHome,clinicalNext);restore(loops,loopHome,loopNext);
    clinicalPane?.classList.remove('agent-map-inline-clinical');
    selected=id;map.querySelectorAll('[data-agent]').forEach(function(button){var active=button.dataset.agent===id;button.setAttribute('aria-pressed',String(active));button.classList.toggle('is-selected',active);});
    inspector.dataset.agent=id;inspector.querySelector('h4').textContent=definitions.find(function(d){return d.id===id;}).name;
    actions.replaceChildren();content.replaceChildren();capture.hidden=id!=='voice'&&!recordingSource;chart.hidden=id!=='chart';
    coordinator.querySelector('.coordinator-preferences').hidden=id!=='note'&&id!=='voice';
    var text={
      voice:'Record or dictate, correct the transcript, then save reviewed text. The note and approval packet remain below. Selecting this dot does not start the microphone.',
      orchestrator:'Coordinates preparation from saved, reviewed sources. Follow the actual status below; resolve exceptions and finalize the current encounter packet when ready.',
      chart:'Inspect dated laboratory values, problem list, medications and allergies assembled for this patient. Source detail remains available below the encounter.',
      evidence:'Inspect the versioned KDIGO monitoring and risk references below, then assess relevance to this patient. References remain separate from the documented plan. Astra analysis is also available here.',
      note:'Choose your template and detail, then edit the prepared note below. Your existing physician edits remain protected when preparation changes.',
      orders:'Review source-linked action drafts and synchronized patient instructions below. Clarify flagged intent or missing medication fields, or exclude a draft. Finalization saves the selected simulated items into follow-up tracking.',
      verification:'Review the entire note, source evidence, proposed values and exclusions below. The existing authenticated, version-checked finalization control signs the exact reviewed packet.',
      followup:'Inspect this patient’s open loops and the assigned-patient follow-up queue. Clinical orders remain simulated. The encounter inbox opens current work for review. Phone delivery is planned.'
    };description.textContent=text[id];
    if(id==='chart')chart.querySelector('details')?.setAttribute('open','');
    if(id==='voice'){action('Reviewed transcript',function(){focusControl('#ambientReviewedInput');});action('Physician dictation',function(){document.getElementById('dictationModeBtn')?.click();focusControl('#physicianDictationInput');});}
    if(id==='note'){action('Template & detail',function(){var prefs=coordinator.querySelector('.coordinator-preferences');prefs.open=true;prefs.querySelector('select')?.focus();});action('Edit note',function(){focusControl('[data-note]');});}
    if(id==='evidence')action('KDIGO reference review',function(){var detail=coordinator.querySelector('[data-evidence] details');if(detail){detail.open=true;detail.scrollIntoView?.({block:'center'});}});
    if(id==='orders')action('Draft actions',function(){focusControl('[data-action] select');});
    if(id==='orders')action('Patient instructions',function(){focusControl('[data-instructions]');});
    if(id==='verification')action('Review packet',function(){focusControl('[data-note]');});
    if(id==='evidence'&&clinicalPane){content.appendChild(clinicalPane);clinicalPane.classList.add('agent-map-inline-clinical');}
    if(id==='followup'){if(loops)content.appendChild(loops);action('Encounter inbox',function(){window.ENCOUNTER_INBOX_UI?.open();});action('Assigned-patient queue',function(){window.FOLLOW_UP_QUEUE_UI?.open();});}
    refresh();
  }
  function refresh(){
    if(disposed)return;queued=false;var s=state(),p=patient();
    map.querySelector('#agentMapPatient').textContent=p?String(p.id):'Select a patient';
    map.querySelectorAll('[data-agent]').forEach(function(button){var label=labelFor(button.dataset.agent,s),node=button.querySelector('.agent-dot-state');if(node.textContent!==label)node.textContent=label;});
    var stateLabel=labelFor(selected,s),stateNode=inspector.querySelector('#agentFunctionState');if(stateNode.textContent!==stateLabel)stateNode.textContent=stateLabel;
    var activeElement=document.activeElement;
    // Do not collapse a capture pane while its editor has keyboard focus.
    if(!capture.contains(activeElement))capture.hidden=selected!=='voice'&&!recordingSource;
    // Patient switch or asynchronous failures must never imply an available approval.
    map.dataset.encounterState=s.error?'attention':s.signed?'finalized':s.ready?'review':'preparing';
  }
  function schedule(){if(queued||disposed)return;queued=true;queueMicrotask(refresh);}
  var observer=new MutationObserver(schedule);
  // Observe clinical status only; observing our own navigation labels would cause a loop.
  observer.observe(coordinator.querySelector('.coordinator-status'),{childList:true,characterData:true,subtree:true,attributes:true});
  observer.observe(coordinator.querySelector('.coordinator-review'),{childList:true,subtree:true});
  observer.observe(coordinator.querySelector('.coordinator-finalize'),{attributes:true,attributeFilter:['disabled']});
  observer.observe(chart,{childList:true});
  function meter(event){
    var d=event.detail;if(!d||!['ambientCaptureCard','dictationCaptureCard'].includes(d.sourceId))return;
    if(d.kind==='start'){recordingSource=d.sourceId;map.classList.add('is-recording');map.querySelector('#agentMapStop').hidden=false;capture.hidden=false;map.querySelector('#agentMapCaptureState').textContent='Recording · microphone connected';}
    if(d.kind==='stop'&&recordingSource===d.sourceId){recordingSource=null;map.classList.remove('is-recording');map.querySelector('#agentMapStop').hidden=true;map.querySelector('#agentMapCaptureState').textContent='Microphone stopped';map.querySelectorAll('.agent-orb-levels i').forEach(function(bar){bar.style.setProperty('--orb-height','8px');});}
    if(d.sourceId===recordingSource&&d.kind==='level'){
      var level=Math.max(0,Math.min(1,Number(d.level)||0));map.querySelectorAll('.agent-orb-levels i').forEach(function(bar,index){var shape=[.45,.72,.9,1,.9,.72,.45][index];bar.style.setProperty('--orb-height',(8+level*42*shape)+'px');});
      map.querySelector('#agentMapCaptureState').textContent=d.label||'Recording';
    }
    if(d.sourceId===recordingSource&&d.kind==='unavailable')map.querySelector('#agentMapCaptureState').textContent='Recording · level meter unavailable';
    schedule();
  }
  window.addEventListener('microphone-meter-state',meter);
  map.querySelector('#agentMapStop').addEventListener('click',function(){window.RECORDED_AUDIO_UI?.stop();window.PRECHART_WORKSPACE_API?.stopVoice();});
  window.addEventListener('encounter-agent-progress',function(event){if(event.detail?.patientId!==patient()?.id)return;job=event.detail.job; schedule();});
  window.addEventListener('scribe-patient-changed',function(){job=null;select('voice');schedule();});
  window.addEventListener('pagehide',function(event){if(event.persisted)return;disposed=true;observer.disconnect();window.removeEventListener('microphone-meter-state',meter);});
  window.ENCOUNTER_AGENT_MAP={select:select,selected:function(){return selected;},refresh:refresh};
  select('voice');
})();
