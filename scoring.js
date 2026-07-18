/* ================================================================== *
 *  scoring.js — čistá logika, žádný DOM.
 *  Načítá ji stránka (<script src>) i service worker (importScripts),
 *  aby ranní notifikace počítala přesně totéž co appka.
 * ================================================================== */

var MIN_RIDE = 6.0, MIN_MARGINAL = 5.0;
var SIZING = [ {size:14,from:6.0,to:9.5}, {size:12,from:8.0,to:12.2}, {size:8,from:12.2,to:18.0} ];
var CAPE_WATCH = 800, CAPE_ALARM = 1500, RAIN_FLAG = 0.3;
var H_START = 6, H_END = 21;
var SCALE_MAX = 16;

/* dirs [od°,do°] po směru hod. ručiček = sektor, ze kterého MUSÍ foukat.
   null = sektor neznám → hradbu neuplatňuji. wg = Windguru spot ID. */
var SPOTS = [
 { id:"medard",  name:"Medard",         sub:"Svatava / Sokolov",  km:25,  wg:377421,
   lat:50.1772, lon:12.5874, dirs:null, guess:false,
   flag:"Sektor neznám → směr se nehodnotí. Vstup je na místě sporný: cedule zakazují, lidi tam jezdí." },
 { id:"nechran", name:"Nechranice",     sub:"Vikletice",          km:55,  wg:2,
   lat:50.3533, lon:13.3933, dirs:[200,340], guess:true,
   flag:"Sektor Z–SZ je odhad z tvaru nádrže — oprav mě." },
 { id:"lipno",   name:"Lipno",          sub:"Dolní Vltavice",     km:190, wg:1,
   lat:48.6973, lon:14.0756, dirs:[200,340], guess:true,
   flag:"Sektor odhad." },
 { id:"darko",   name:"Velké Dářko",    sub:"Radostín, Vysočina", km:200, wg:46,
   lat:49.6407, lon:15.8945, dirs:null, guess:false,
   flag:"Sektor neznám → směr se nehodnotí. Obklopeno stromy → poryvy budou horší, než model ukáže." },
 { id:"rozkos",  name:"Rozkoš",         sub:"Česká Skalice",      km:220, wg:4,
   lat:50.3726, lon:16.0606, dirs:[290,200], guess:false,
   flag:"Sektor vylučuje Z a JZ — to je doložené varování, ne odhad." },
 { id:"barwald", name:"Bärwalder See",  sub:"Kitewiese, DE",      km:250, wg:59670,
   lat:51.3878, lon:14.5451, dirs:[45,315], guess:false,
   flag:"Vyloučen severní výsek SZ–SV (315–45°) — offshore od pláže. Kitezóna vytyčená bójemi, mimo ni pokuta do 100 €. Uhyst v koupací sezóně zavřený." },
 { id:"neusied", name:"Neusiedler See", sub:"Podersdorf, AT",     km:450, wg:33,
   lat:47.8661, lon:16.8348, dirs:null, guess:false,
   flag:"Sektor neznám → směr se nehodnotí. Souřadnice = Nordstrand." },
 { id:"rugen",   name:"Rügen",          sub:"Suhrendorf / Ummanz",km:500, wg:665105,
   lat:54.4676, lon:13.1383, dirs:null, guess:false,
   flag:"Sektor neznám → směr se nehodnotí. Mělčina, stojatá voda. Vícedenní, ne jednodenní." }
];

function inSector(d,s){ if(!s) return true; return s[0]<=s[1] ? (d>=s[0]&&d<=s[1]) : (d>=s[0]||d<=s[1]); }
function compass(d){
  var p=["S","SSV","SV","VSV","V","VJV","JV","JJV","J","JJZ","JZ","ZJZ","Z","ZSZ","SZ","SSZ"];
  return p[Math.round(d/22.5)%16];
}
function starCount(mean){ return mean>=12?3 : mean>=9?2 : mean>=6?1 : 0; }
function pickKite(ms){
  var f=SIZING.filter(function(k){return ms>=k.from&&ms<=k.to;});
  if(!f.length) return ms>18?"moc":null;
  return f[f.length-1].size;
}

function assess(day, spot){
  var hrs = day.filter(function(h){ return h.hour>=H_START && h.hour<=H_END; });
  if(!hrs.length) return null;
  var ok = hrs.map(function(h){ return h.wind>=MIN_MARGINAL && inSector(h.dir,spot.dirs); });
  var best=null, run=[];
  function flush(){ if(run.length>=2 && (!best||run.length>best.length)) best=run; run=[]; }
  hrs.forEach(function(h,i){ ok[i]?run.push(h):flush(); });
  flush();
  var peak = Math.max.apply(null,hrs.map(function(h){return h.wind;}));
  if(!best) return { v:"nic", label: peak<MIN_MARGINAL?"Nefouká":"Špatný směr",
                     peak:peak, hrs:hrs, w:null, score:peak };
  var n=best.length;
  var mean = best.reduce(function(s,h){return s+h.wind;},0)/n;
  var gust = best.reduce(function(s,h){return s+h.gust;},0)/n;
  var gf = gust/mean;
  var dir = best.reduce(function(s,h){return s+h.dir;},0)/n;
  var rain = Math.max.apply(null,best.map(function(h){return h.rain;}));
  var show = Math.max.apply(null,best.map(function(h){return h.show;}));
  var cape = Math.max.apply(null,best.map(function(h){return h.cape;}));
  var kite = pickKite(mean);
  var kiteGust = pickKite(gust);
  var v,label;
  if(cape>CAPE_ALARM || (show>RAIN_FLAG && cape>CAPE_WATCH)){ v="boure"; label="Konvekce"; }
  else if(mean<MIN_RIDE){ v="hranicni"; label="Hraniční"; }
  else if(kiteGust!==kite){ v="jede"; label="Jede, poryvy o kite níž"; }
  else { v="jede"; label="Jede"; }
  var score = (v==="jede"?1000:v==="hranicni"?400:0) + Math.min(mean,14)*30 + n*8
            - Math.min(cape,2000)/20;
  return { v:v, label:label, score:score, hrs:hrs, peak:peak,
           w:{ from:best[0].hour, to:best[n-1].hour, mean:mean, gf:gf, dir:dir,
               rain:rain, show:show, cape:cape, kite:kite, kiteGust:kiteGust } };
}

/* URL na Open-Meteo pro všech osm spotů */
function buildUrl(){
  var lat=SPOTS.map(function(s){return s.lat;}).join(",");
  var lon=SPOTS.map(function(s){return s.lon;}).join(",");
  return "https://api.open-meteo.com/v1/forecast?latitude="+lat+"&longitude="+lon+
    "&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,showers,cape"+
    "&models=icon_seamless&wind_speed_unit=ms&timezone=Europe%2FPrague&forecast_days=4";
}

/* Odpověď API → pole {spotIndex: {datum: [hodiny]}} */
function parseForecast(json){
  var arr = Array.isArray(json)?json:[json];
  return arr.map(function(loc){
    var h=loc.hourly, days={};
    h.time.forEach(function(t,i){
      var d=t.slice(0,10); if(!days[d]) days[d]=[];
      days[d].push({ hour:+t.slice(11,13),
        wind:h.wind_speed_10m[i]||0, gust:h.wind_gusts_10m[i]||0,
        dir:h.wind_direction_10m[i]||0, rain:h.precipitation[i]||0,
        show:h.showers?(h.showers[i]||0):0, cape:h.cape?(h.cape[i]||0):0 });
    });
    return days;
  });
}

/* Seřazené spoty pro daný den (nebo přes všechny dny, když date=null) */
function rank(dataBySpot, dates, date){
  return SPOTS.map(function(s,i){
    if(date){
      var a = assess((dataBySpot[i]||{})[date]||[], s);
      return { s:s, best:a, score:a?a.score:0 };
    }
    var days = dates.map(function(d){ return assess((dataBySpot[i]||{})[d]||[], s); });
    var best = days.reduce(function(a,b){ return (b&&(!a||b.score>a.score))?b:a; }, null);
    return { s:s, days:days, best:best, score: best?best.score:0 };
  }).sort(function(a,b){ return b.score-a.score || a.s.km-b.s.km; });
}

/* Jednořádkové shrnutí pro notifikaci: nejlepší jedoucí spot dnes+zítra */
function morningSummary(dataBySpot, dates){
  var pick=null;
  for(var di=0; di<Math.min(2,dates.length); di++){
    var r = rank(dataBySpot, dates, dates[di]);
    for(var i=0;i<r.length;i++){
      if(r[i].best && r[i].best.v==="jede"){
        pick={ spot:r[i].s, a:r[i].best, dayIdx:di }; break;
      }
    }
    if(pick) break;
  }
  if(!pick) return { ride:false, text:"Zatím nikam — žádný jedoucí den v příštích dvou dnech." };
  var w=pick.a.w, dayLabel = pick.dayIdx===0 ? "dnes" : "zítra";
  var stars = "★".repeat(starCount(w.mean));
  return { ride:true,
    title: pick.spot.name+" "+stars+" — "+dayLabel,
    text: w.from+"–"+w.to+"h · "+w.mean.toFixed(1)+" m/s · "+compass(w.dir)+
          " · "+(w.kite==="moc"?"<8":w.kite)+" m² · "+pick.spot.km+" km" };
}

if(typeof module!=="undefined") module.exports = {
  SPOTS:SPOTS, assess:assess, rank:rank, buildUrl:buildUrl,
  parseForecast:parseForecast, morningSummary:morningSummary,
  starCount:starCount, pickKite:pickKite, compass:compass, inSector:inSector,
  SCALE_MAX:SCALE_MAX, MIN_RIDE:MIN_RIDE, MIN_MARGINAL:MIN_MARGINAL,
  CAPE_WATCH:CAPE_WATCH, CAPE_ALARM:CAPE_ALARM, RAIN_FLAG:RAIN_FLAG };
