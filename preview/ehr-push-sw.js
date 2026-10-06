/* Notifications only: no chart cache, credentials, clinical fetch or approval action. */
'use strict';
self.addEventListener('install',function(event){event.waitUntil(self.skipWaiting());});
self.addEventListener('activate',function(event){event.waitUntil(self.clients.claim());});
self.addEventListener('push',function(event){
  // Even an unexpected payload cannot display patient data or redirect outside this EHR.
  event.waitUntil(self.registration.showNotification('KidneyCare EHR',{
    body:'A review needs your attention. Sign in to your EHR.',
    icon:new URL('push-icon-192.png',self.registration.scope).href,
    badge:new URL('push-icon-192.png',self.registration.scope).href,
    tag:'ehr-review',renotify:false
  }));
});
self.addEventListener('notificationclick',function(event){
  event.notification.close();
  event.waitUntil((async function(){
    var target=new URL('#inbox',self.registration.scope).href;
    var windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(var client of windows){var url=new URL(client.url),scope=new URL(self.registration.scope);
      if(url.origin===scope.origin&&url.pathname.startsWith(scope.pathname)){
        try{await client.navigate(target);await client.focus();return;}catch(_){}
      }
    }
    await self.clients.openWindow(target);
  })());
});
