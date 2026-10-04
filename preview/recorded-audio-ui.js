/* Recorded synthetic speech: local playback, protected transcription, explicit review. */
(function(){
  var card=document.getElementById('ambientCaptureCard');if(!card)return;
  var transcriptionReady=window.SYNTHETIC_AUDIO_TRANSCRIPTION_ENABLED===true;
  var box=document.createElement('section');box.className='recorded-audio';
  box.innerHTML='<h4>Record, replay, then review</h4><p>Record up to 5 minutes of synthetic conversation. Audio stays in this tab until you click Transcribe recording, which sends it to OpenAI through the clinician gateway. This app does not save the audio to its database.</p><div class="prechart-inline-actions"><button id="recordAudioBtn" class="small-btn" type="button">Record audio</button><button id="transcribeAudioBtn" class="small-btn" type="button" disabled>Transcribe recording</button><button id="discardAudioBtn" class="small-btn" type="button">Discard recording</button><label>Spoken language <select id="recordAudioLanguage"><option value="">Detect language</option><option value="en">English</option><option value="es">Spanish</option></select></label></div><audio id="recordedAudioPlayback" controls preload="metadata" hidden></audio><p id="recordAudioStatus" role="status" aria-live="polite">Synthetic speech only. Verify medications, numbers, units and negations against the audio.</p><label>Recorded transcription (original wording)<textarea id="recordedAudioTranscript" readonly rows="6"></textarea></label><button id="useRecordedTranscriptBtn" class="small-btn" type="button" disabled>Use recorded text for review</button><button id="copyRawReviewBtn" class="small-btn" type="button">Copy current raw text into review draft</button>';
  card.querySelector('.ambient-transcript-grid').before(box);
  var record=box.querySelector('#recordAudioBtn'),transcribe=box.querySelector('#transcribeAudioBtn'),use=box.querySelector('#useRecordedTranscriptBtn'),status=box.querySelector('#recordAudioStatus'),playback=box.querySelector('audio'),output=box.querySelector('textarea');
  var recorder=null,stream=null,blob=null,objectUrl=null,patientId=null,timer=null,busy=false,request=null,generation=0;
  function activeId(){try{return currentPatient?.id||window.currentPatient?.id||null;}catch(_){return window.currentPatient?.id||null;}}
  function message(text,error){status.textContent=text;status.classList.toggle('is-error',!!error);}
  function controls(){record.textContent=recorder?.state==='recording'?'Stop recording':'Record audio';record.disabled=busy;transcribe.disabled=!transcriptionReady||busy||!blob||!!recorder;use.disabled=busy||!output.value||patientId!==activeId();}
  function release(){if(stream)stream.getTracks().forEach(function(t){t.stop();});stream=null;if(timer)clearTimeout(timer);timer=null;}
  function stop(){if(recorder?.state==='recording')recorder.stop();release();}
  function discard(){generation++;if(request)request.abort();request=null;busy=false;stop();recorder=null;blob=null;patientId=null;output.value='';if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=null;playback.removeAttribute('src');playback.hidden=true;controls();message('Recording discarded. Saved encounter sources are retained.');}
  async function start(){
    if(recorder){stop();return;}if(busy)return;
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){message('Audio recording is unavailable in this browser. You can paste a transcript or use the browser preview.',true);return;}
    if(blob){message('A recording is ready. Transcribe or discard it before recording another clip.',true);return;}
    var id=activeId();if(!id)return;var ticket=++generation;busy=true;controls();message('Requesting microphone access…');
    try{window.PRECHART_WORKSPACE_API?.stopVoice();var incoming=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
      if(ticket!==generation||id!==activeId()){incoming.getTracks().forEach(function(t){t.stop();});return;}stream=incoming;patientId=id;
      var mime=['audio/webm;codecs=opus','audio/mp4'].find(function(m){return MediaRecorder.isTypeSupported(m);});if(!mime)throw Error('No supported recording format is available. Use pasted text or browser preview.');
      var chunks=[],bytes=0;recorder=new MediaRecorder(stream,{mimeType:mime,audioBitsPerSecond:64000});var session=recorder;
      session.ondataavailable=function(e){if(ticket!==generation)return;if(e.data.size){chunks.push(e.data);bytes+=e.data.size;if(bytes>8*1024*1024){stop();message('Recording reached the 8 MB limit. Record a shorter clip.',true);}}};
      session.onerror=function(){if(ticket===generation){stop();message('Recording failed. Replay the captured clip if available, or record again.',true);}};
      session.onstop=function(){release();if(ticket!==generation||id!==activeId())return;recorder=null;if(bytes&&bytes<=8*1024*1024){blob=new Blob(chunks,{type:mime});objectUrl=URL.createObjectURL(blob);playback.src=objectUrl;playback.hidden=false;message(transcriptionReady?'Recording ready. Replay it, then click Transcribe recording.':'Recording ready for local playback. Recorded transcription is not enabled yet; enter or paste text for review.');}else message('No usable audio was captured. Record a shorter clip.',true);controls();};
      session.start(1000);timer=setTimeout(function(){stop();},300000);message('Recording synthetic conversation · maximum 5 minutes.');
    }catch(error){release();recorder=null;message(error.message||'Microphone access failed.',true);}finally{if(ticket===generation){busy=false;controls();}}
  }
  async function transcribeRecording(){
    if(!transcriptionReady){message('Recorded transcription is not enabled yet. Replay the audio and enter or paste text for review.',true);return;}
    if(busy||!blob||recorder)return;if(patientId!==activeId()){discard();return;}var cfg=window.SUPABASE_DEMO_BACKEND;if(!cfg?.anonJwt){message('Sign in as a clinician first.',true);return;}
    var ticket=generation,id=patientId;request=new AbortController();busy=true;controls();message('Transcribing the recorded audio…');
    try{var form=new FormData();form.set('patientId',id);form.set('file',blob,blob.type.startsWith('audio/mp4')?'recording.mp4':'recording.webm');form.set('language',box.querySelector('#recordAudioLanguage').value);
      var response=await fetch(cfg.baseUrl+'/functions/v1/audio-transcription-gated',{method:'POST',cache:'no-store',headers:{Authorization:'Bearer '+cfg.anonJwt},body:form,signal:request.signal});var result=await response.json().catch(function(){return {};});
      if(!response.ok)throw Error(({transcription_not_configured:'Server transcription is not configured. Your recording is retained for playback.',transcription_rate_limited:'Transcription is temporarily rate limited. Your recording is retained; retry later.',patient_access_denied:'Patient access was denied. Your recording is retained in this tab.',unsupported_audio:'The recorded audio format was not accepted.'})[result.error]||'Transcription failed. Your recording is retained; you can retry.');
      if(ticket!==generation||id!==activeId()||result.patientId!==id)return;
      output.value=result.text;var hints=(result.reviewHints||[]).join('').trim();message('Transcription ready for review. Replay the audio to verify it.'+(hints?' Words to double-check: '+hints:' No token hints were returned; this does not confirm accuracy.'));
    }catch(error){if(ticket===generation)message(error.message||'Transcription failed; recording retained.',true);}finally{if(ticket===generation){busy=false;request=null;controls();}}
  }
  record.addEventListener('click',start);transcribe.addEventListener('click',transcribeRecording);box.querySelector('#discardAudioBtn').addEventListener('click',discard);
  use.addEventListener('click',function(){if(patientId!==activeId())return;if(window.PRECHART_WORKSPACE_API?.receiveTranscript(patientId,output.value)){message('Recorded text copied into raw and review panes. Correct errors while replaying the audio, then Save reviewed transcript.');}});
  box.querySelector('#copyRawReviewBtn').addEventListener('click',function(){window.PRECHART_WORKSPACE_API?.copyRawToReview();message('Raw text copied into the review draft. Review it before saving.');});
  window.addEventListener('scribe-patient-changed',function(){if(patientId&&patientId!==activeId())discard();});window.addEventListener('pagehide',discard);
  if(!transcriptionReady){transcribe.title='Recorded transcription is not enabled yet';message('Recording and playback are available. Recorded transcription is not enabled yet; enter or paste a transcript for review.');}
  window.RECORDED_AUDIO_UI={start:start,stop:stop,isRecording:function(){return !!recorder;}};
})();
