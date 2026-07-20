/* Kite check — service worker */
var CACHE = "kitecheck-v3";
var SHELL = ["./","./index.html","./scoring.js","./manifest.webmanifest","./icon-192.png","./icon-512.png"];
importScripts("./scoring.js");

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

function runBrief(){
  var cfg=DEFAULT_CFG;
  var spots=BASE_SPOTS.filter(function(s){return !s.model;});
  return fetch(urlMain(spots)).then(function(r){return r.json();}).then(function(j){
    var arr=Array.isArray(j)?j:[j];
    var data=arr.map(parseLoc).map(function(x){return x.days;});
    var first=data.filter(function(d){return Object.keys(d).length;})[0];
    var dates=first?Object.keys(first).sort().slice(0,4):[];
    var s=morningSummary(data,dates,spots,cfg);
    if(!s.ride) return;
    return self.registration.showNotification("Kite check — "+s.title,
      {body:s.text,tag:"kite-morning",icon:"./icon-192.png",badge:"./icon-192.png"});
  }).catch(function(){});
}
self.addEventListener("periodicsync", function(e){ if(e.tag==="kite-morning") e.waitUntil(runBrief()); });
self.addEventListener("message", function(e){ if(e.data==="run-brief") e.waitUntil(runBrief()); });
self.addEventListener("notificationclick", function(e){
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type:"window"}).then(function(cl){
    for(var i=0;i<cl.length;i++) if("focus"in cl[i]) return cl[i].focus();
    if(self.clients.openWindow) return self.clients.openWindow("./");
  }));
});
