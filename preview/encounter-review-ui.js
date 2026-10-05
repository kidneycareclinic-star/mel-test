/* A view of existing review gates. Navigation never approves or changes a draft. */
(function(){
  var coordinator=document.getElementById('encounterCoordinator');if(!coordinator||!window.ENCOUNTER_COORDINATOR_UI?.reviewSummary)return;
  var panel=document.createElement('details');panel.id='encounterReviewChecklist';panel.className='encounter-review-checklist';
  panel.innerHTML='<summary><span>Encounter review</span><span data-review-count></span></summary><p data-review-status role="status" aria-live="polite"></p><ol data-review-steps></ol><button class="small-btn" data-review-next type="button">Continue review</button><p class="micro">This checklist shows draft readiness. Read the note and source facts yourself; finalization is your explicit attestation and signature.</p>';
  coordinator.querySelector('.coordinator-review').before(panel);
  var list=panel.querySelector('[data-review-steps]'),count=panel.querySelector('[data-review-count]'),status=panel.querySelector('[data-review-status]'),next=panel.querySelector('[data-review-next]'),last=null,disposed=false,timer;
  function summary(){return window.ENCOUNTER_COORDINATOR_UI.reviewSummary();}
  function node(parent,tag,value){var n=document.createElement(tag);n.textContent=value;parent.appendChild(n);return n;}
  function row(key,title,text,state){var n=node(list,'li','');n.dataset.reviewStep=key;n.dataset.state=state;node(n,'strong',title);node(n,'span',text);}
  function refresh(){
    if(disposed)return;var s=summary(),fingerprint=JSON.stringify(s);if(fingerprint===last)return;last=fingerprint;list.replaceChildren();next.disabled=!s.owner||s.signed;
    if(!s.owner){count.textContent='Sign in required';status.textContent='Sign in to review the selected encounter.';return;}
    if(s.signed){count.textContent='Signed';status.textContent='Signed note and approved simulated visit completion are saved.';row('signed','Encounter finalized','The receipt remains in this patient view.','complete');return;}
    var preparing=['queued','running'].includes(s.job?.status),paused=s.job?.status==='failed';
    var remaining=s.pendingActions+s.clarificationActions+(s.instructionsConfirmationRequired&&!s.instructionsConfirmed?1:0);
    count.textContent=preparing?'Preparing':paused?'Preparation paused':!s.noteAvailable?'Awaiting reviewed source':s.savePending?'Saving edits':s.readyToSign?'Ready for your final review':remaining+' review item'+(remaining===1?'':'s')+' remaining';
    status.textContent=s.readyToSign?'Draft decisions are saved. Read the full note and source facts, then use Finalize reviewed encounter when satisfied.':s.savePending?'Your latest edits are saving. Signing stays unavailable until they are saved.':s.noteAvailable?'Resolve the items below and review the complete note before signing.':'Save a corrected transcript, dictation or typed source to prepare this encounter.';
    row('preparation','Prepared from reviewed sources',preparing?'Agents are preparing this encounter.':paused?'Preparation paused; inspect the orchestrator status and retry.':s.current?'Current preparation available.':s.noteAvailable?'Preparation needs refresh.':'Reviewed source not yet prepared.',s.current?'complete':'attention');
    row('note','Nephrology note and source facts',s.noteAvailable?'Read the note, source excerpts, numbers, medications and negations before signing.':'No prepared note is available yet.','review');
    row('actions','Orders and follow-up drafts',s.pendingActions?s.pendingActions+' draft'+(s.pendingActions===1?' needs':'s need')+' a decision.':s.clarificationActions?s.clarificationActions+' included draft'+(s.clarificationActions===1?' needs':'s need')+' clarification or complete medication fields.':s.actionCount?'All action decisions recorded · simulated.':'No source-linked action drafts.',s.pendingActions||s.clarificationActions?'attention':s.noteAvailable?'complete':'waiting');
    row('instructions','Patient instructions',s.instructionsConfirmationRequired?s.instructionsConfirmed?'Instruction review confirmed.':'Compare instructions against the note and selected actions, then confirm review.':s.noteAvailable?'Read the instructions with the note before signing.':'No prepared instructions yet.',s.instructionsConfirmed?'complete':'review');
    row('saved','Saved review revision',s.savePending?'Edits are still saving.':s.noteAvailable?'The displayed review revision is saved.':'Awaiting preparation.',s.noteAvailable&&!s.savePending?'complete':'waiting');
  }
  function focus(selector){var item=coordinator.querySelector(selector);if(!item)return;var detail=item.closest('details');if(detail)detail.open=true;item.scrollIntoView?.({block:'center'});item.focus();}
  function continueReview(){
    var s=summary();if(!s.owner||s.signed)return;
    if(!s.noteAvailable){window.ENCOUNTER_AGENT_MAP?.select(s.job?.status==='failed'?'orchestrator':'voice');focus(s.job?.status==='failed'?'.coordinator-retry':'#ambientReviewedInput');return;}
    if(!s.current){window.ENCOUNTER_AGENT_MAP?.select('orchestrator');focus('.coordinator-retry');return;}
    if(s.pendingActions||s.clarificationActions){window.ENCOUNTER_AGENT_MAP?.select('orders');var rows=Array.from(coordinator.querySelectorAll('[data-action]')),row=rows.find(function(r){var decision=r.querySelector('select').value;return decision==='pending'||decision!=='rejected'&&(r.dataset.blocked==='true'&&(decision!=='edited'||!r.querySelector('[data-clarified]').checked)||Array.from(r.querySelectorAll('[data-med]')).some(function(n){return !n.value.trim();}));});if(row){row.scrollIntoView?.({block:'center'});row.querySelector('select').focus();}return;}
    window.ENCOUNTER_AGENT_MAP?.select(s.instructionsConfirmationRequired&&!s.instructionsConfirmed?'orders':'verification');focus(s.instructionsConfirmationRequired&&!s.instructionsConfirmed?'[data-instructions-reviewed]':'[data-note]');
  }
  function open(){window.ENCOUNTER_AGENT_MAP?.select('verification');panel.open=true;refresh();panel.scrollIntoView?.({block:'center'});panel.querySelector('summary').focus();}
  next.addEventListener('click',continueReview);
  coordinator.addEventListener('input',refresh);coordinator.addEventListener('change',refresh);
  ['encounter-agent-progress','encounter-finalized','scribe-patient-changed'].forEach(function(name){window.addEventListener(name,function(){last=null;refresh();});});
  var observer=new MutationObserver(refresh);observer.observe(coordinator.querySelector('.coordinator-review'),{childList:true,subtree:true});observer.observe(coordinator.querySelector('.coordinator-finalize'),{attributes:true,attributeFilter:['disabled']});observer.observe(coordinator.querySelector('.coordinator-status'),{childList:true,characterData:true,subtree:true});
  timer=setInterval(refresh,1000);window.addEventListener('pagehide',function(){disposed=true;clearInterval(timer);observer.disconnect();});
  window.ENCOUNTER_REVIEW_UI={open:open,refresh:refresh,continueReview:continueReview};refresh();
})();
