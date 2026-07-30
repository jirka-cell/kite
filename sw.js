/* ObozWind — service worker */
var CACHE = "obozwind-v4";
var SHELL = ["./","./index.html","./scoring.js","./manifest.webmanifest","./icon-192.png","./icon-512.png"];
self.addEventListener("install", function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(SHELL);}).then(function(){return self.skipWaiting();}));
});
self.addEventListener("activate", function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.map(function(k){ if(k!==CACHE) return caches.delete(k); }));
  }).then(function(){return self.clients.claim();}));
});
self.addEventListener("fetch", function(e){
  var u=e.request.url;
  if(u.indexOf("open-meteo.com")>=0||u.indexOf("windguru.cz")>=0) return;
  e.respondWith(caches.match(e.request).then(function(hit){return hit||fetch(e.request);}));
});

/* ---- ranní kontrola: běží NA POZADÍ v telefonu, bez serveru ---- */
importScripts("./scoring.js");
var CFGKEY="https://obozwind.local/cfg";
function readCfg(){
  return caches.open("obozwind-cfg").then(function(c){return c.match(CFGKEY);})
    .then(function(r){return r?r.json():null;});
}
function alreadyToday(){
  var today=new Date().toISOString().slice(0,10);
  return caches.open("obozwind-cfg").then(function(c){return c.match(CFGKEY+"-last");})
    .then(function(r){return r?r.text():null;}).then(function(last){return last===today;});
}
function markToday(){
  var today=new Date().toISOString().slice(0,10);
  return caches.open("obozwind-cfg").then(function(c){return c.put(CFGKEY+"-last",new Response(today));});
}
function runMorning(force){
  return readCfg().then(function(cfg){
    if(!cfg||!cfg.notify) return;
    var watched=BASE_SPOTS.concat(cfg.added||[]).filter(function(s){return (cfg.watch||{})[s.id];});
    if(!watched.length) return;
    return (force?Promise.resolve(false):alreadyToday()).then(function(done){
      if(done) return;
      return fetch(urlMain(watched.filter(function(s){return !s.model;}))).then(function(r){return r.json();}).then(function(j){
        var arr=Array.isArray(j)?j:[j];
        var data=arr.map(parseLoc);
        var first=data.filter(function(d){return Object.keys(d.days).length;})[0];
        var dates=first?Object.keys(first.days).sort().slice(0,4):[];
        var hits=morningCheck(data, dates, watched.filter(function(s){return !s.model;}), cfg);
        if(!hits.length) return;
        var names=hits.map(function(h){return h.name;}).join(", ");
        markToday();
        return self.registration.showNotification("ObozWind — jede to \uD83E\uDE81", {
          body: names+" \u2014 v p\u0159\u00ed\u0161t\u00edch dnech dob\u0159e fouk\u00e1.",
          tag:"obozwind-morning", icon:"./icon-192.png", badge:"./icon-192.png" });
      });
    });
  }).catch(function(){});
}
self.addEventListener("periodicsync", function(e){ if(e.tag==="obozwind-morning") e.waitUntil(runMorning(false)); });
self.addEventListener("message", function(e){ if(e.data==="run-morning") e.waitUntil(runMorning(true)); });
self.addEventListener("notificationclick", function(e){
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type:"window"}).then(function(cl){
    for(var i=0;i<cl.length;i++) if("focus"in cl[i]) return cl[i].focus();
    if(self.clients.openWindow) return self.clients.openWindow("./");
  }));
});
