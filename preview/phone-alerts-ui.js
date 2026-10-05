/* Private notification preferences. Alert previews and delivery receipts never approve care. */
(function(){
  var dialog=document.getElementById('encounterInboxDialog');if(!dialog)return;
  var old=dialog.querySelector('.inbox-shell > details'),panel=document.createElement('details');panel.className='phone-alert-panel';panel.id='encounterPhoneAlerts';
  panel.innerHTML='<summary>Phone alerts <span data-phone-state>Loading…</span></summary><p data-provider-notice></p><p class="phone-alert-message" role="status" aria-live="polite"></p><form data-preferences><fieldset><legend>When agents need you</legend><label>Delivery<select data-mode><option value="preview">Preview alerts here</option><option value="off">Alerts off</option><option value="sms">Text my verified phone</option></select></label><label class="phone-check"><input type="checkbox" data-ready> Encounter ready for review</label><label class="phone-check"><input type="checkbox" data-paused> Preparation paused or expired</label><label class="phone-check"><input type="checkbox" data-quiet> Quiet hours: 10 PM–7 AM</label><label>Time zone<select data-zone><option value="America/New_York">Eastern</option><option value="America/Chicago">Central</option><option value="America/Denver">Mountain</option><option value="America/Los_Angeles">Pacific</option><option value="Pacific/Honolulu">Hawaii</option><option value="America/Anchorage">Alaska</option></select></label><label class="phone-check" data-alert-consent-wrap hidden><input type="checkbox" data-alert-consent> I agree to receive encounter alerts at my verified number. Message frequency varies; message and data rates may apply. Reply STOP to stop. These alerts are not emergency monitoring.</label><button class="small-btn" type="submit">Save alert preferences</button></fieldset></form><section data-connect hidden><h3>Your phone</h3><p data-phone-contact></p><form data-verify-start><label>US mobile number<input type="tel" data-number placeholder="+12025550123" autocomplete="tel" maxlength="12"></label><label class="phone-check"><input type="checkbox" data-verify-consent> Send a verification code to this number.</label><button class="small-btn" type="submit">Send verification code</button></form><form data-verify-check hidden><label>Verification code<input data-code inputmode="numeric" autocomplete="one-time-code" maxlength="10"></label><button class="small-btn" type="submit">Verify phone</button></form><button class="small-btn" data-forget type="button" hidden>Remove phone</button></section><section class="phone-preview"><h3>What your alert will look like</h3><p data-preview-text></p><p>Patient details stay in the encounter. The link requires sign-in and does not approve or sign anything.</p><button class="small-btn" type="button" data-test>Run alert preview</button></section><section><h3>Recent alerts</h3><div data-phone-history></div></section>';
  if(old)old.replaceWith(panel);else dialog.querySelector('.inbox-shell').appendChild(panel);
  var data=null,owner=null,sequence=0,busy=false,poll;
  function account(){return window.CLINICIAN_AUTH?.userId?.()||null;}
  function select(q){return panel.querySelector(q);}
  function say(value){select('.phone-alert-message').textContent=value;}
  function node(parent,tag,value){var n=document.createElement(tag);n.textContent=value;parent.appendChild(n);return n;}
  var errors={phone_preferences_changed:'Your settings changed. Review the refreshed settings before saving again.',phone_delivery_not_configured:'Text messaging is not connected yet. You can preview alerts here.',verified_phone_and_consent_required:'Verify your phone and agree to receive alerts before enabling texts.',verification_consent_required:'Choose to receive a verification code before sending it.',us_mobile_number_required:'Enter a US mobile number with +1 and ten digits.',verification_rate_limited:'Please wait before requesting another code. Verification requests are limited.',verification_code_invalid:'That code was not accepted. Try the code from your verification text.',verification_expired:'That verification expired. Request a new code.',verification_unavailable:'Verification is unavailable. No encounter texts have been enabled.',preview_rate_limited:'Wait one minute before creating another preview.'};
  function reset(){sequence++;owner=account();data=null;select('[data-phone-history]').replaceChildren();select('[data-phone-state]').textContent='Sign in required';select('[data-phone-contact]').textContent='';select('[data-number]').value='';select('[data-code]').value='';select('[data-alert-consent]').checked=false;select('[data-verify-consent]').checked=false;select('[data-connect]').hidden=true;say('Sign in to manage your alerts.');panel.querySelectorAll('button,select,input').forEach(function(n){n.disabled=true;});}
  async function request(body){var requestedOwner=account(),cfg=window.SUPABASE_DEMO_BACKEND;if(!requestedOwner||!cfg?.anonJwt)throw Error('Sign in to manage your alerts.');
    var response=await fetch(cfg.baseUrl+'/functions/v1/phone-alerts-gated',{method:body?'POST':'GET',headers:{Authorization:'Bearer '+cfg.anonJwt,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(20000)});
    var result=await response.json().catch(function(){return {};});if(account()!==requestedOwner){reset();throw Error('Your clinician session changed. Sign in again.');}
    if(!response.ok)throw Error(errors[result.error]||'Phone alerts are unavailable. Refresh or sign in again.');return result;
  }
  function render(value){data=value;var p=value.preferences;
    panel.querySelectorAll('button,select,input').forEach(function(n){n.disabled=busy;});
    select('[data-phone-state]').textContent=p.mode==='sms'?'Texts enabled':p.mode==='off'?'Off':'Preview only';
    select('[data-provider-notice]').textContent=value.providerReady?'Verify your number, then choose text delivery. Alerts contain a secure review link and no patient details.':'Text messaging is not connected yet. Automatic alerts are previewed here; no text is sent.';
    select('[data-mode]').value=p.mode;select('[data-mode] option[value=sms]').disabled=!value.providerReady||!p.verified;
    select('[data-ready]').checked=p.readyAlerts;select('[data-paused]').checked=p.pausedAlerts;select('[data-quiet]').checked=p.quietHours;
    var zone=select('[data-zone]');if(!Array.from(zone.options).some(function(o){return o.value===p.timeZone;})){var option=node(zone,'option',p.timeZone);option.value=p.timeZone;}zone.value=p.timeZone;
    select('[data-alert-consent]').checked=p.consented;select('[data-alert-consent-wrap]').hidden=p.mode!=='sms';
    select('[data-connect]').hidden=!value.providerReady;select('[data-forget]').hidden=!p.phoneLast4;
    select('[data-phone-contact]').textContent=p.phoneLast4?(p.verified?'Verified phone ending in ':'Unverified phone ending in ')+p.phoneLast4:'No verified phone connected.';
    select('[data-verify-check]').hidden=!p.verificationPending;select('[data-preview-text]').textContent=value.previewText;
    var history=select('[data-phone-history]');history.replaceChildren();
    var labels={pending:'Waiting for delivery window',sending:'Submitting to provider',preview:'Preview only · no text sent',accepted:'Provider accepted · delivery not confirmed',sent:'Sent · delivery not confirmed',delivered:'Delivered · physician review still required',undelivered:'Not delivered · open your inbox',failed:'Delivery failed · open your inbox',unknown:'Delivery unconfirmed · no automatic resend',cancelled:'Alert cancelled'};
    if(!value.history.length)node(history,'p','No alerts yet. Run a preview, or let agents finish preparing an encounter.');
    value.history.forEach(function(item){var card=node(history,'article','');card.className='phone-alert-card';node(card,'strong',labels[item.status]||'Delivery status unavailable');node(card,'p',item.text);node(card,'p',new Date(item.createdAt).toLocaleString());
      if(item.jobId){var open=node(card,'button','Open secure review');open.type='button';open.className='small-btn';open.disabled=busy;open.addEventListener('click',function(){window.ENCOUNTER_INBOX_UI.openReview(item.jobId);});}
    });
  }
  async function refresh(){if(owner!==account())reset();if(busy||!account()||!window.SUPABASE_DEMO_BACKEND?.anonJwt)return;var ticket=++sequence;
    try{var result=await request();if(ticket===sequence)render(result);}catch(error){if(ticket===sequence){reset();say(error.message);}}
  }
  async function mutate(fields,success){if(busy||!data)return;busy=true;sequence++;var requestedOwner=account(),version=data.preferences.version;panel.querySelectorAll('button,select,input').forEach(function(n){n.disabled=true;});
    try{var result=await request({...fields,expectedVersion:version});if(account()===requestedOwner){busy=false;render(result);say(success);}}
    catch(error){busy=false;if(account()===requestedOwner){await refresh();say(error.message);}}
    finally{busy=false;if(data&&account()===requestedOwner)render(data);}
  }
  select('[data-mode]').addEventListener('change',function(){select('[data-alert-consent-wrap]').hidden=this.value!=='sms';});
  select('[data-preferences]').addEventListener('submit',function(event){event.preventDefault();mutate({action:'preferences',mode:select('[data-mode]').value,readyAlerts:select('[data-ready]').checked,pausedAlerts:select('[data-paused]').checked,quietHours:select('[data-quiet]').checked,timeZone:select('[data-zone]').value,consent:select('[data-alert-consent]').checked},'Alert preferences saved. Clinical review and signing still require you.');});
  select('[data-verify-start]').addEventListener('submit',function(event){event.preventDefault();var phone=select('[data-number]').value.trim(),consent=select('[data-verify-consent]').checked;select('[data-number]').value='';mutate({action:'verify-start',phone:phone,consent:consent},'Verification requested. Enter the code from your phone; encounter texts remain off until you enable them.');});
  select('[data-verify-check]').addEventListener('submit',function(event){event.preventDefault();var code=select('[data-code]').value.trim();select('[data-code]').value='';mutate({action:'verify-check',code:code},'Phone verified. Choose text delivery and agree to receive alerts to enable it.');});
  select('[data-forget]').addEventListener('click',function(){mutate({action:'forget-phone'},'Phone removed. Alerts now use preview mode.');});
  select('[data-test]').addEventListener('click',function(){mutate({action:'preview-test'},'Preview created. No text was sent.');});
  panel.addEventListener('toggle',function(){if(panel.open)refresh();});
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&dialog.open)refresh();});
  window.addEventListener('encounter-agent-progress',function(){if(dialog.open&&!busy)refresh();});
  window.addEventListener('pagehide',function(){clearInterval(poll);});
  window.PHONE_ALERTS_UI={refresh:refresh,reset:reset};
  reset();Promise.resolve(window.BACKEND_PATIENT_READY).then(function(){owner=account();refresh();poll=setInterval(function(){if(owner!==account())reset();if(!document.hidden&&dialog.open&&!busy)refresh();},30000);});
})();
