/* Authenticated attention and navigation. Seen status never signs an encounter. */
(function(){
  var header=document.querySelector('.top-right');if(!header)return;
  var launch=document.createElement('button');launch.id='encounterInboxButton';launch.type='button';launch.className='small-btn';launch.textContent='Encounter inbox';launch.setAttribute('aria-haspopup','dialog');header.prepend(launch);
  var dialog=document.createElement('dialog');dialog.id='encounterInboxDialog';dialog.setAttribute('aria-labelledby','encounterInboxTitle');
  dialog.innerHTML='<div class="inbox-shell"><div class="inbox-head"><div><h2 id="encounterInboxTitle">Your encounter inbox</h2><p>Agents prepare. You review and finalize the current packet.</p></div><button class="small-btn" data-close type="button" aria-label="Close encounter inbox">Close</button></div><p class="inbox-summary"></p><div class="inbox-toolbar"><button class="small-btn" data-filter="attention" type="button">Needs attention</button><button class="small-btn" data-filter="preparing" type="button">Preparing</button><button class="small-btn" data-refresh type="button">Refresh</button></div><p class="inbox-message" role="status" aria-live="polite"></p><div class="inbox-list"></div><div class="inbox-toolbar"><button class="small-btn" data-prev type="button">Previous</button><span data-page></span><button class="small-btn" data-next type="button">Next</button></div><details><summary>Phone alert preview</summary><p>Example: “An encounter needs your attention. Sign in securely using your review link.”</p><p>Phone delivery is not connected. Links contain no patient details or session credentials. Sign in is required; opening a link does not approve the encounter.</p></details></div>';
  document.body.appendChild(dialog);
  var list=dialog.querySelector('.inbox-list'),message=dialog.querySelector('.inbox-message'),filter='attention',page=0,sequence=0,routeSequence=0,owner=null,poll=null,transition=null;
  var errors={review_link_unavailable:'This review link is unavailable for your account or current patient access.',review_link_no_longer_current:'This link belongs to an earlier encounter. Open the inbox to find the current visit.',inbox_item_changed:'This encounter changed. Refresh the inbox and review the current packet.',invalid_link:'The review link is invalid.'};
  function account(){return window.CLINICIAN_AUTH?.userId?.()||null;}
  function signedIn(){return !!account()&&!!window.SUPABASE_DEMO_BACKEND?.anonJwt;}
  function node(parent,tag,text){var n=document.createElement(tag);n.textContent=text;parent.appendChild(n);return n;}
  function say(text){message.textContent=text;}
  function show(){if(!dialog.open){if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');}}
  function close(){if(dialog.close)dialog.close();else dialog.removeAttribute('open');launch.focus();}
  function reset(){sequence++;routeSequence++;owner=account();list.replaceChildren();window.PHONE_ALERTS_UI?.reset();window.PUSH_ALERTS_UI?.reset();launch.textContent='Encounter inbox';dialog.querySelector('.inbox-summary').textContent='';say('Sign in to see encounters assigned to you.');}
  async function request(query,body){var requestedOwner=account(),cfg=window.SUPABASE_DEMO_BACKEND;if(!signedIn())throw Error('Sign in to open your encounter inbox.');
    var res=await fetch(cfg.baseUrl+'/functions/v1/encounter-inbox-gated'+(query?'?'+query:''),{method:body?'POST':'GET',headers:{Authorization:'Bearer '+cfg.anonJwt,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(12000)});
    var data=await res.json().catch(function(){return {};});if(account()!==requestedOwner){reset();throw Error('Clinician session changed. Sign in again.');}if(!res.ok)throw Error(errors[data.error]||'The encounter inbox is unavailable. Refresh or sign in again.');return data;
  }
  function link(id){return window.location.origin+window.location.pathname+'#review/'+id;}
  function button(parent,text,callback){var b=node(parent,'button',text);b.type='button';b.className='small-btn';b.addEventListener('click',async function(){b.disabled=true;try{await callback();}catch(e){say(e.message);}finally{b.disabled=false;}});return b;}
  function render(data){list.replaceChildren();launch.textContent='Encounter inbox'+(data.counts.unseen?' · '+data.counts.unseen+' new':'');launch.setAttribute('aria-label','Encounter inbox, '+data.counts.unseen+' new, '+data.counts.attention+' needing attention');
    dialog.querySelector('.inbox-summary').textContent=data.counts.attention+' need attention · '+data.counts.unseen+' unseen · '+data.counts.preparing+' preparing';
    dialog.querySelectorAll('[data-filter]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.filter===filter));});
    if(!data.items.length)node(list,'p',filter==='attention'?'No encounters currently need your attention. Saving reviewed encounter text starts preparation automatically.':'No encounters are currently preparing.');
    var labels={ready:'Ready for your review',failed:'Preparation paused · retry available',expired:'Preparation expired · refresh required',queued:'Queued',running:'Agent preparation in progress'};
    data.items.forEach(function(item){var card=node(list,'article','');card.className='inbox-card';node(card,'h3',item.patientName+' · '+item.patientId);node(card,'p',labels[item.status]||'Preparation status changed');node(card,'p',(item.seen?'Seen · ':'New · ')+(item.sourceChanged?'Source changed. Current content will be checked before review.':'Current encounter preparation.'));
      var actions=node(card,'div','');actions.className='inbox-toolbar';button(actions,item.status==='ready'?'Open review':item.status==='failed'||item.status==='expired'?'Open recovery':'View progress',function(){return openReview(item.id);});
      if(!item.seen)button(actions,'Mark seen',async function(){await request('',{action:'seen',jobId:item.id,revision:item.revision});say('Marked seen. Physician review and finalization are still required.');await refresh();});
      button(actions,'Copy secure link',async function(){if(!navigator.clipboard?.writeText)throw Error('Link copying is unavailable in this browser. Open the review and copy its address.');await navigator.clipboard.writeText(link(item.id));say('Secure link copied. It requires sign in and does not grant access.');});
    });
    dialog.querySelector('[data-prev]').disabled=page===0;dialog.querySelector('[data-next]').disabled=!data.hasNext;dialog.querySelector('[data-page]').textContent='Page '+(page+1);
  }
  async function refresh(){if(owner!==account())reset();if(!signedIn())return;var ticket=++sequence;try{var data=await request('filter='+filter+'&page='+page);if(ticket===sequence)render(data);}catch(e){if(ticket===sequence){list.replaceChildren();launch.textContent='Encounter inbox';say(e.message);}}}
  async function openReview(id){var ticket=++routeSequence,requestedOwner=account();show();say('Checking your access and the current encounter…');
    try{var target=await request('job_id='+encodeURIComponent(id));if(ticket!==routeSequence||account()!==requestedOwner)return;
      var patient=(window.PATIENTS||[]).find(function(p){return p.id===target.patientId;});if(!patient)throw Error('Refresh your assigned patient census before opening this encounter.');
      if(target.mode==='review')await window.ENCOUNTER_COORDINATOR_UI.openReview(patient,target.encounterId);
      else {window.openEncounterPatient(patient);window.MOBILE_PANE_UI?.show('patient');await window.ENCOUNTER_COMPLETION_UI.open(target.encounterId);}
      if(ticket!==routeSequence||account()!==requestedOwner)return;
      history.replaceState(null,'',link(target.jobId));close();
      if(target.mode==='review'){var panel=document.getElementById('encounterCoordinator'),notice=document.getElementById('encounterInboxNotice');if(!notice){notice=document.createElement('p');notice.id='encounterInboxNotice';notice.setAttribute('role','status');panel.prepend(notice);}notice.textContent=target.replaced?'The original preparation changed. This is the current encounter; review it before finalizing.':'Opened from your encounter inbox. Review the current packet before finalizing.';panel.setAttribute('tabindex','-1');panel.focus();panel.scrollIntoView({behavior:'smooth',block:'start'});}
      // Navigation is not acknowledgement: mark seen only when explicitly requested.
      refresh();
    }catch(e){if(ticket===routeSequence){show();say(e.message);}}
  }
  async function route(){if(window.location.hash==='#inbox'){if(signedIn()){show();await refresh();}return;}var match=/^#review\/([0-9a-f-]{36})$/i.exec(window.location.hash);if(match&&signedIn())await openReview(match[1]);else if(window.location.hash.startsWith('#review/')&&signedIn()){show();say(errors.invalid_link);}}
  launch.addEventListener('click',function(){show();refresh();window.PHONE_ALERTS_UI?.refresh();});dialog.querySelector('[data-close]').addEventListener('click',close);
  dialog.querySelector('[data-refresh]').addEventListener('click',refresh);
  dialog.querySelectorAll('[data-filter]').forEach(function(b){b.addEventListener('click',function(){filter=b.dataset.filter;page=0;refresh();});});
  dialog.querySelector('[data-prev]').addEventListener('click',function(){page=Math.max(0,page-1);refresh();});dialog.querySelector('[data-next]').addEventListener('click',function(){page++;refresh();});
  window.addEventListener('hashchange',route);window.addEventListener('encounter-finalized',refresh);
  window.addEventListener('encounter-agent-progress',function(event){var key=event.detail?.job?.id+':'+event.detail?.job?.status;if(key!==transition){transition=key;refresh();}});
  document.addEventListener('visibilitychange',function(){if(!document.hidden)refresh();});
  window.addEventListener('pagehide',function(){clearInterval(poll);});
  window.ENCOUNTER_INBOX_UI={open:function(){show();window.PHONE_ALERTS_UI?.refresh();return refresh();},refresh:refresh,openReview:openReview};
  Promise.resolve(window.BACKEND_PATIENT_READY).then(async function(){owner=account();await refresh();await route();poll=setInterval(function(){if(!document.hidden)refresh();},30000);});
})();
