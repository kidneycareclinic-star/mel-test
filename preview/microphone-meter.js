/* Actual microphone samples only; analysis never connects to speaker output. */
(function () {
  var instances=new WeakMap();
  window.MICROPHONE_METER = { mount: function (parent) {
    if(instances.has(parent))return instances.get(parent);
    var root=document.createElement('div');root.className='microphone-meter';
    root.innerHTML='<span class="mic-record-dot" aria-hidden="true"></span><span class="mic-level-bars" aria-hidden="true"></span><span class="mic-level-state">Microphone idle</span><time>0:00</time>';
    parent.appendChild(root);
    var bars=root.querySelector('.mic-level-bars'),label=root.querySelector('.mic-level-state'),clock=root.querySelector('time');
    for(var i=0;i<28;i++){var b=document.createElement('i');b.style.height='3px';bars.appendChild(b);}
    var context=null,source=null,analyser=null,frame=null,tick=null,started=0,last=0,values=[],running=false;
    function emit(kind,level){window.dispatchEvent(new CustomEvent('microphone-meter-state',{detail:{kind:kind,sourceId:parent.id,level:level,label:label.textContent}}));}
    function stop(text){
      running=false;if(frame!=null)cancelAnimationFrame(frame);frame=null;if(tick)clearInterval(tick);tick=null;
      if(source)source.disconnect();if(analyser)analyser.disconnect();source=null;analyser=null;
      if(context){context.close().catch(function(){});context=null;}
      root.classList.remove('is-recording');label.textContent=text||'Microphone stopped';values=[];
      Array.from(bars.children).forEach(function(b){b.style.height='3px';});
      emit('stop');
    }
    function start(stream,text){
      stop();running=true;started=Date.now();last=0;clock.textContent='0:00';root.classList.add('is-recording');label.textContent=text||'Recording';
      emit('start');
      tick=setInterval(function(){var seconds=Math.floor((Date.now()-started)/1000);clock.textContent=Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');},250);
      try {
        var Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw Error('unavailable');
        context=new Audio();source=context.createMediaStreamSource(stream);analyser=context.createAnalyser();analyser.fftSize=512;source.connect(analyser);
        var data=new Uint8Array(analyser.fftSize);context.resume().catch(function(){if(running)label.textContent='Recording · level meter unavailable';});
        function draw(now){
          if(!running)return;
          if(now-last>=60){last=now;analyser.getByteTimeDomainData(data);var sum=0;for(var j=0;j<data.length;j++){var sample=(data[j]-128)/128;sum+=sample*sample;}
            var rms=Math.sqrt(sum/data.length);values.push(Math.min(1,rms*5));if(values.length>28)values.shift();
            Array.from(bars.children).forEach(function(b,k){var value=values[k-(28-values.length)]||0;b.style.height=(3+value*33)+'px';});
            label.textContent=context.state==='suspended'?'Recording · level meter paused':rms<0.008?'Recording · quiet microphone':(text||'Recording')+' · sound detected';
            emit('level',context.state==='suspended'?0:Math.min(1,rms*5));
          }
          frame=requestAnimationFrame(draw);
        }
        frame=requestAnimationFrame(draw);
      } catch (_) {if(source)source.disconnect();if(context){context.close().catch(function(){});context=null;}source=null;analyser=null;label.textContent='Recording · level meter unavailable';emit('unavailable');}
    }
    var instance={start:start,stop:stop,element:root};instances.set(parent,instance);return instance;
  }};
})();
