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
