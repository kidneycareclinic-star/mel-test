/* Encounter progression coordinates existing capture/review controls. It cannot sign. */
(function(){
  'use strict';
  var coordinator=document.getElementById('encounterCoordinator');
  if(!coordinator||!window.ENCOUNTER_COORDINATOR_UI?.reviewSummary||!window.ENCOUNTER_WORKFLOW_UI)return;
  var panel=document.createElement('section');panel.id='encounterLifecycle';panel.className='encounter-lifecycle';
  panel.setAttribute('aria-labelledby','encounterLifecycleTitle');
  panel.innerHTML='<div class="encounter-lifecycle-heading"><div><span class="agent-map-eyebrow">CURRENT ENCOUNTER</span><h4 id="encounterLifecycleTitle"></h4><p data-lifecycle-status role="status" aria-live="polite"></p></div><button class="small-btn" data-lifecycle-next type="button"></button></div><ol aria-label="Encounter progress"><li data-phase="capture">1. Capture</li><li data-phase="prepare">2. Prepare</li><li data-phase="review">3. Review</li><li data-phase="sign">4. Sign</li></ol><p data-lifecycle-error role="alert" hidden></p>';
  document.getElementById('encounterAgentMap').after(panel);
  var next=panel.querySelector('[data-lifecycle-next]'),title=panel.querySelector('h4'),status=panel.querySelector('[data-lifecycle-status]'),error=panel.querySelector('[data-lifecycle-error]'),busy=false,disposed=false,last=null,ownerPatient=null;
  function summary(){return window.ENCOUNTER_COORDINATOR_UI.reviewSummary();}
  function focusCapture(){window.ENCOUNTER_AGENT_MAP?.select('voice');document.getElementById('ambientModeBtn')?.click();var input=document.getElementById('ambientReviewedInput');input?.scrollIntoView?.({block:'center'});input?.focus();}
  function report(text){error.textContent=text;error.hidden=!text;}
  function render(){
    if(disposed)return;var s=summary(),key=s.owner+':'+s.patientId;if(key!==ownerPatient){ownerPatient=key;report('');last=null;}
    var fingerprint=JSON.stringify([s,busy,coordinator.querySelector('.coordinator-status').className]);if(last===fingerprint)return;last=fingerprint;
    var phase='capture',heading='Capture the encounter',text='Record or enter text, correct it, then save reviewed text. Agents prepare the encounter automatically.',label='Add reviewed encounter text',action='capture',disabled=false;
    if(!s.owner){heading='Sign in to begin';text='Select an assigned patient after signing in.';label='Sign in required';disabled=true;}
    else if(busy||s.loading||!s.loaded){heading='Checking the current encounter';text='Checking for a saved draft before opening a new visit.';label='Checking…';disabled=true;}
    else if(coordinator.querySelector('.coordinator-status').classList.contains('is-error')){phase=s.noteAvailable?'review':'prepare';heading='Encounter needs attention';text=coordinator.querySelector('.coordinator-status').textContent;label='Refresh encounter';action='refresh';disabled=s.busy;}
    else if(s.signed){phase='signed';heading='Visit signed · ready for the next encounter';text='The signed note and receipt are saved. Start the next visit here.';label='Start new encounter';action='start';}
    else if(['queued','running'].includes(s.job?.status)||s.busy){phase='prepare';heading='Agents are preparing this encounter';text='Your reviewed source is saved. Preparation continues in the background; you can return through the inbox.';label='Preparing…';disabled=true;}
    else if(s.job?.status==='failed'){phase='prepare';heading='Preparation paused';text='Your sources and completed work are retained. Retry the unfinished task.';label='Retry preparation';action='retry';}
    else if(s.noteAvailable){phase=s.readyToSign?'sign':'review';heading=s.readyToSign?'Ready for your signature':'Draft prepared · physician review';text=s.revisionPending?'A coordinated revision awaits approval or discard.':s.savePending?'Your review edits are saving.':s.pendingActions?s.pendingActions+' action draft'+(s.pendingActions===1?' needs':'s need')+' a decision.':s.clarificationActions?'Clarify the flagged actions or exclude them.':s.instructionsConfirmationRequired&&!s.instructionsConfirmed?'Review the patient instructions and confirm they match the selected plan.':'Read the complete note and source facts before using Finalize reviewed encounter below.';label=s.revisionPending?'Review proposed changes':s.readyToSign?'Review before signing':'Continue review';action='review';disabled=s.savePending;}
    else if(s.draftAvailable){phase='prepare';heading='Reviewed text saved · awaiting preparation';text='The saved draft will be prepared automatically. Refresh to check its progress.';label='Check preparation';action='refresh';}
    else if(s.capturingNew){heading='New encounter · capture and review text';text='Enter or record today’s encounter. Save reviewed text to create the draft and start preparation.';}
    title.textContent=heading;status.textContent=text;next.textContent=label;next.disabled=disabled;next.dataset.action=action;panel.dataset.phase=phase;
    var phases=['capture','prepare','review','sign'],current=phases.indexOf(phase);
    panel.querySelectorAll('[data-phase]').forEach(function(n,i){n.dataset.state=phase==='signed'||i<current?'complete':i===current?'current':'waiting';if(i===current)n.setAttribute('aria-current','step');else n.removeAttribute('aria-current');});
  }
  async function start(){
    if(busy)return;var expected=window.ENCOUNTER_COORDINATOR_UI.voiceContext();if(!expected.owner)return;
    busy=true;report('');render();
    try{
      if(window.ENCOUNTER_WORKFLOW_UI.isBusy?.()||window.PRECHART_WORKSPACE_API?.isRecording?.()||window.ORCHESTRATOR_VOICE_UI?.isRecording())throw Error('Finish the current save or stop recording first. Your text is kept.');
      var result=await window.ENCOUNTER_WORKFLOW_UI.refresh(),now=window.ENCOUNTER_COORDINATOR_UI.voiceContext();
      if(now.owner!==expected.owner||now.patientId!==expected.patientId)return;
      if(!result||result.loadError)throw Error(result?.loadError||'The encounter could not be checked. Try again.');
      await window.ENCOUNTER_COORDINATOR_UI.refresh();now=window.ENCOUNTER_COORDINATOR_UI.voiceContext();
      if(now.owner!==expected.owner||now.patientId!==expected.patientId)return;
      var s=summary();if(coordinator.querySelector('.coordinator-status').classList.contains('is-error'))throw Error('The current encounter could not be verified. Refresh before starting a new visit.');
      if(result.draft||s.draftAvailable){if(s.noteAvailable)window.ENCOUNTER_REVIEW_UI?.continueReview();else focusCapture();return;}
      window.PRECHART_WORKSPACE_API.beginNewCapture(expected.patientId);
      window.ENCOUNTER_COORDINATOR_UI.beginCapture(now);focusCapture();
    }catch(e){var current=window.ENCOUNTER_COORDINATOR_UI.voiceContext();if(current.owner===expected.owner&&current.patientId===expected.patientId)report(e.message);}
    finally{busy=false;last=null;render();}
  }
  next.addEventListener('click',function(){report('');var action=next.dataset.action;if(action==='start'){start();return;}if(action==='capture'){start();return;}if(action==='review'){window.ENCOUNTER_REVIEW_UI?.continueReview();return;}if(action==='retry')coordinator.querySelector('.coordinator-retry').click();else if(action==='refresh')window.ENCOUNTER_COORDINATOR_UI.refresh();});
  var observer=new MutationObserver(render);observer.observe(coordinator.querySelector('.coordinator-status'),{childList:true,subtree:true,attributes:true});observer.observe(coordinator.querySelector('.coordinator-review'),{childList:true,subtree:true});observer.observe(coordinator.querySelector('.coordinator-finalize'),{attributes:true});
  ['encounter-agent-progress','encounter-finalized','scribe-patient-changed','encounter-revision-state','encounter-capture-started'].forEach(function(name){window.addEventListener(name,function(){last=null;render();});});
  var timer=setInterval(render,1000);window.addEventListener('pagehide',function(){disposed=true;observer.disconnect();clearInterval(timer);});
  window.ENCOUNTER_LIFECYCLE_UI={start:start,refresh:render};render();
})();
