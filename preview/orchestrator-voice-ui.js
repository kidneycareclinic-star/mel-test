/* Push-to-talk commands are isolated from ambient sources and explicit clinical approval. */
(function(){
  'use strict';
  var coordinator=document.getElementById('encounterCoordinator');
  if(!coordinator||!window.ORCHESTRATOR_COMMANDS)return;
  var panel=document.createElement('section');panel.id='orchestratorVoice';panel.className='orchestrator-voice';
  panel.innerHTML='<div class="orchestrator-voice-heading"><div><h4>Talk to your orchestrator</h4><p>Prepare, navigate, or propose an exact dictated plan change.</p></div><button data-record class="small-btn" type="button">Talk to orchestrator</button></div><p data-status role="status" aria-live="polite">Press Talk, speak a command, then Stop. Stopping sends this short recording to OpenAI. Synthetic speech only.</p><audio data-playback controls preload="metadata" hidden></audio><form data-command-form><label>Heard command · correct it or type instead<textarea data-command rows="2" maxlength="4000" placeholder="Open the proposed orders"></textarea></label><div class="orchestrator-voice-buttons"><button data-run class="small-btn" type="submit">Run command</button><button data-cancel class="small-btn" type="button">Clear command</button></div></form><details class="orchestrator-command-help"><summary>What can I say?</summary><ul><li>Prepare this visit using my nephrology SOAP template.</li><li>Show me what still needs review.</li><li>Open the proposed orders / patient instructions / chart / note.</li><li>Open the encounter inbox / phone alerts.</li><li>Add to plan: [your exact dictated wording].</li><li>Replace in plan "exact existing text" with "new text".</li></ul><p>Commands use these English phrases. Plan changes are proposals until you apply them. Signing, approving actions and sending messages require their existing controls.</p></details><section data-proposal hidden aria-label="Proposed plan change"><h4>Review proposed plan change</h4><p>Check the heard command, numbers, doses and negations against playback. Applying changes only the draft note and resets action and instruction review.</p><div class="orchestrator-proposal-grid"><div><strong>Current plan</strong><pre data-before></pre></div><div><strong>Proposed plan</strong><pre data-after></pre></div></div><div class="orchestrator-voice-buttons"><button data-apply class="small-btn" type="button">Apply to draft</button><button data-reject class="small-btn" type="button">Discard proposal</button></div></section>';
  var map=document.getElementById('encounterAgentMap');if(map)map.after(panel);else coordinator.prepend(panel);
  var record=panel.querySelector('[data-record]'),status=panel.querySelector('[data-status]'),input=panel.querySelector('[data-command]'),run=panel.querySelector('[data-run]'),apply=panel.querySelector('[data-apply]'),proposalBox=panel.querySelector('[data-proposal]'),playback=panel.querySelector('[data-playback]'),meter=window.MICROPHONE_METER?.mount(panel);
  if(meter?.element)panel.querySelector('.orchestrator-voice-heading').after(meter.element);
  var generation=0,recorder=null,stream=null,timer=null,controller=null,waiting=false,executing=false,scope=null,proposal=null,audioUrl=null,watch=null;
  function context(){return window.ENCOUNTER_COORDINATOR_UI.voiceContext();}
  function same(expected){var now=context();return !!expected?.owner&&now.owner===expected.owner&&now.patientId===expected.patientId&&now.encounterId===expected.encounterId&&now.sourceVersion===expected.sourceVersion;}
  function message(text,error){status.textContent=text;status.classList.toggle('is-error',!!error);}
  function controls(){record.textContent=recorder?.state==='recording'?'Stop command':waiting&&!controller?'Cancel microphone request':'Talk to orchestrator';record.disabled=!!controller||executing;run.disabled=waiting||!!recorder||executing;apply.disabled=executing;}
  function release(){if(timer)clearTimeout(timer);timer=null;meter?.stop('Command microphone stopped');if(stream)stream.getTracks().forEach(function(track){track.stop();});stream=null;}
  function clearAudio(){if(audioUrl)URL.revokeObjectURL(audioUrl);audioUrl=null;playback.removeAttribute('src');playback.hidden=true;}
  function reject(){proposal=null;proposalBox.hidden=true;panel.querySelector('[data-before]').textContent='';panel.querySelector('[data-after]').textContent='';}
  function cancel(){generation++;controller?.abort();controller=null;var old=recorder;recorder=null;if(old?.state==='recording')old.stop();release();clearAudio();reject();scope=null;input.value='';waiting=false;executing=false;if(watch)clearInterval(watch);watch=null;controls();message('Command cleared. Saved encounter text is retained.');}
  function watchContext(){if(watch)clearInterval(watch);watch=setInterval(function(){if(scope&&!same(scope)){cancel();message('The patient, encounter or clinician changed. Repeat the command for the current visit.',true);}},500);}
  function open(){window.ENCOUNTER_AGENT_MAP?.select('orchestrator');window.MOBILE_PANE_UI?.show('patient');panel.scrollIntoView?.({block:'center'});record.focus();}
  function focus(selector){var item=coordinator.querySelector(selector);item?.scrollIntoView?.({block:'center'});item?.focus();}
  function navigate(command){
    window.ENCOUNTER_AGENT_MAP?.select(command.agent);
    var text='Opened '+command.target+'.';
    if(command.target==='orders')focus('[data-action] select');
    if(command.target==='instructions')focus('[data-instructions]');
    if(command.target==='note')focus('[data-note]');
    if(command.target==='chart')coordinator.querySelector('.coordinator-chart details')?.setAttribute('open','');
    if(command.target==='template'){var prefs=coordinator.querySelector('.coordinator-preferences');prefs.open=true;prefs.querySelector('select')?.focus();}
    if(command.target==='evidence')coordinator.querySelector('[data-evidence] details')?.setAttribute('open','');
    if(command.target==='inbox'||command.target==='phone'){window.ENCOUNTER_INBOX_UI?.open();if(command.target==='phone'){var alerts=document.getElementById('encounterPhoneAlerts');if(alerts){alerts.open=true;alerts.scrollIntoView?.({block:'start'});}}}
    if(command.target==='review'){
      var pending=Array.from(coordinator.querySelectorAll('[data-action]')).filter(function(row){return row.querySelector('select').value==='pending';});
      var instructions=coordinator.querySelector('[data-instructions-reviewed]');
      text=context().noteText?'Review the entire note and source facts. '+pending.length+' action draft'+(pending.length===1?'':'s')+' still need a decision.'+(instructions&&!instructions.checked?' Patient instructions still need confirmation.':''):'Save reviewed encounter text first; no prepared note is available yet.';
      focus(pending.length?'[data-action] select':'[data-note]');
    }
    message(text);
  }
  async function execute(text,expected){
    if(executing)return;
    if(!same(expected)){message('Select the current encounter again before running this command.',true);return;}
    reject();var command=window.ORCHESTRATOR_COMMANDS.parse(text);
    if(command.kind==='held'){message('Use the existing physician review controls to sign, approve actions or send messages. Voice commands cannot perform those actions.',true);return;}
    if(command.kind==='unknown'){message('Command not recognized. Open “What can I say?” or correct the heard command.',true);return;}
    if(command.kind==='navigate'){navigate(command);return;}
    executing=true;controls();var ticket=generation;
    try{
      if(command.kind==='prepare'){
        message('Queuing preparation from saved, reviewed encounter sources…');
        await window.ENCOUNTER_COORDINATOR_UI.voicePrepare(expected,command.soap);
        if(ticket===generation&&same(expected))message('Preparation requested. The agent dots show progress; review and signing remain with you.');
      }else{
        var now=context();if(!now.current||now.noteText!==expected.noteText||now.preparationId!==expected.preparationId||now.packetHash!==expected.packetHash)throw Error('The note changed or is unavailable. Repeat the command after preparation finishes.');
        var edit=window.ORCHESTRATOR_COMMANDS.proposal(now.noteText,command,window.NOTE_DRAFTING?.preferences?.().headings);
        proposal={context:now,edit:edit,commandText:input.value};
        panel.querySelector('[data-before]').textContent=edit.before;panel.querySelector('[data-after]').textContent=edit.after;proposalBox.hidden=false;
        window.ENCOUNTER_AGENT_MAP?.select('note');message('Proposed plan change ready. Review it before applying to the draft.');
      }
    }catch(error){if(ticket===generation)message(error.message||'Command failed. No approval was performed.',true);}
    finally{if(ticket===generation){executing=false;controls();}}
  }
  async function transcribe(blob,expected,ticket){
    var cfg=window.SUPABASE_DEMO_BACKEND;if(!cfg?.anonJwt)throw Error('Sign in as a clinician first.');
    controller=new AbortController();waiting=true;controls();message('Transcribing command…');
    try{
      var form=new FormData();form.set('patientId',expected.patientId);form.set('purpose','orchestrator-command');form.set('language','en');form.set('file',blob,blob.type.startsWith('audio/mp4')?'command.mp4':'command.webm');
      var response=await fetch(cfg.baseUrl+'/functions/v1/audio-transcription-gated',{method:'POST',cache:'no-store',headers:{Authorization:'Bearer '+cfg.anonJwt},body:form,signal:controller.signal});
      var result=await response.json().catch(function(){return {};});
      if(ticket!==generation||!same(expected))return;
      if(!response.ok)throw Error('Command transcription failed. Replay the clip and type the command, or record again.');
      if(result.patientId!==expected.patientId||result.purpose!=='orchestrator-command'||typeof result.text!=='string'||result.text.length>4000)throw Error('The returned command could not be matched to this encounter.');
      input.value=result.text;waiting=false;controller=null;controls();
      if(result.reviewHints?.length){message('Double-check the heard command against playback, then press Run command. Words to check: '+result.reviewHints.join('').trim(),true);return;}
      await execute(result.text,expected);
    }catch(error){if(ticket===generation&&same(expected))message(error.message||'Command transcription failed.',true);}
    finally{if(ticket===generation){controller=null;waiting=false;controls();}}
  }
  function stop(){if(recorder?.state==='recording')recorder.stop();release();}
  async function start(){
    if(recorder){stop();return;}if(waiting&&!controller){cancel();return;}if(waiting||executing)return;
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){message('Microphone recording is unavailable. Type a command below.',true);return;}
    if(!context().owner||!window.SUPABASE_DEMO_BACKEND?.anonJwt){message('Sign in as a clinician first.',true);return;}
    if(window.RECORDED_AUDIO_UI?.isRecording?.()){message('Stop the ambient recording first, then record a separate orchestrator command.',true);return;}
    cancel();scope=context();var expected=scope,ticket=generation;watchContext();waiting=true;controls();message('Requesting microphone access for a command…');
    try{
      window.PRECHART_WORKSPACE_API?.stopVoice();var incoming=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
      if(ticket!==generation||!same(expected)){incoming.getTracks().forEach(function(track){track.stop();});return;}
      stream=incoming;var mime=['audio/webm;codecs=opus','audio/mp4'].find(function(m){return MediaRecorder.isTypeSupported(m);});if(!mime)throw Error('Use typed commands; this browser has no supported recording format.');
      var chunks=[],bytes=0,failed=false;recorder=new MediaRecorder(stream,{mimeType:mime,audioBitsPerSecond:64000});var session=recorder;
      session.ondataavailable=function(event){if(ticket!==generation)return;if(event.data.size){chunks.push(event.data);bytes+=event.data.size;if(bytes>1024*1024){failed=true;stop();}}};
      session.onerror=function(){if(ticket!==generation)return;failed=true;stop();};
      session.onstop=function(){if(ticket!==generation)return;release();recorder=null;waiting=false;controls();if(!same(expected))return;if(failed||!bytes){message('No usable command audio was captured. Type the command or record again.',true);return;}var blob=new Blob(chunks,{type:mime});clearAudio();audioUrl=URL.createObjectURL(blob);playback.src=audioUrl;playback.hidden=false;transcribe(blob,expected,ticket);};
      session.start(500);waiting=false;meter?.start(stream,'Recording orchestrator command');timer=setTimeout(stop,30000);controls();message('Recording command · maximum 30 seconds. Stop sends it for transcription.');
    }catch(error){if(ticket===generation){release();recorder=null;waiting=false;controls();message(error.message||'Microphone access failed. Type a command instead.',true);}}
  }
  record.addEventListener('click',start);
  panel.querySelector('[data-cancel]').addEventListener('click',cancel);
  panel.querySelector('[data-command-form]').addEventListener('submit',function(event){event.preventDefault();if(waiting||recorder||executing)return;scope=context();watchContext();execute(input.value,scope);});
  input.addEventListener('input',reject);
  panel.querySelector('[data-reject]').addEventListener('click',function(){reject();message('Proposal discarded. The draft note is unchanged.');});
  apply.addEventListener('click',async function(){if(!proposal||executing)return;var selected=proposal,ticket=generation;if(input.value!==selected.commandText){reject();message('The command changed. Run it again to create a new proposal.',true);return;}executing=true;controls();try{await window.ENCOUNTER_COORDINATOR_UI.voiceApply(selected.context,selected.edit.noteText);if(ticket===generation){reject();message('Plan change saved to the draft. Review action drafts and patient instructions against the new plan before signing.');}}catch(error){if(ticket===generation)message(error.message||'The proposal could not be saved. Review the current draft.',true);}finally{if(ticket===generation){executing=false;controls();}}});
  window.addEventListener('scribe-patient-changed',cancel);window.addEventListener('encounter-finalized',cancel);window.addEventListener('pagehide',cancel);
  document.addEventListener('visibilitychange',function(){if(document.hidden&&recorder)cancel();});
  window.addEventListener('microphone-meter-state',function(event){if(event.detail?.kind==='start'&&event.detail.sourceId!=='orchestratorVoice'&&(recorder||waiting))cancel();});
  window.ORCHESTRATOR_VOICE_UI={open:open,start:start,stop:stop,cancel:cancel,isRecording:function(){return !!recorder||waiting&&!controller;}};
})();
