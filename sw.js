/* Service worker — offline cache appky + ranní notifikace */
var CACHE = "kitecheck-v1";
var SHELL = ["./", "./index.html", "./scoring.js", "./manifest.webmanifest",
             "./icon-192.png", "./icon-512.png"];

importScripts("./scoring.js");

self.addEventListener("install", function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(SHELL); }).then(function(){ return self.skipWaiting(); }));
});

self.addEventListener("activate", function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.map(function(k){ if(k!==CACHE) return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

/* App shell cache-first, data (open-meteo) network-first bez cache */
self.addEventListener("fetch", function(e){
  var url = e.request.url;
  if(url.indexOf("api.open-meteo.com")>=0 || url.indexOf("windguru.cz")>=0) return; /* data jdou po síti */
  e.respondWith(
    caches.match(e.request).then(function(hit){ return hit || fetch(e.request); })
  );
});

/* Ranní brief. Periodic Background Sync ho spustí ~jednou denně, když
   prohlížeč uzná za vhodné (přesný čas negarantuje — viz index.html). */
function runMorningBrief(){
  return fetch(buildUrl()).then(function(r){ return r.json(); }).then(function(j){
    var data = parseForecast(j);
    var dates = Object.keys(data[0]).sort().slice(0,4);
    var s = morningSummary(data, dates);
    /* neotravuj, když není kam jet — pošli jen jednou za den i tak? Ne: mlčíme. */
    if(!s.ride) return;
    return self.registration.showNotification("Kite check — " + s.title, {
      body: s.text, tag: "kite-morning", icon: "./icon-192.png", badge: "./icon-192.png"
    });
  }).catch(function(){ /* offline ráno = mlč */ });
}

self.addEventListener("periodicsync", function(e){
  if(e.tag==="kite-morning") e.waitUntil(runMorningBrief());
});

/* Ruční spuštění ze stránky (tlačítko „Zkusit teď") */
self.addEventListener("message", function(e){
  if(e.data==="run-brief") e.waitUntil(runMorningBrief());
});

/* Klik na notifikaci → otevři appku */
self.addEventListener("notificationclick", function(e){
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type:"window"}).then(function(cl){
    for(var i=0;i<cl.length;i++){ if("focus" in cl[i]) return cl[i].focus(); }
    if(self.clients.openWindow) return self.clients.openWindow("./");
  }));
});
