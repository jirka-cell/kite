/* ================================================================== *
 *  Kite check — scoring.js
 *  Data spotů + čistá logika. Načítá stránka i service worker.
 * ================================================================== */

var BASE_SPOTS = [
 { id:"medard",  name:"Medard",         sub:"Svatava / Sokolov",   km:25,  wg:377421,
   lat:50.1772, lon:12.5874, dirs:null },
 { id:"nechran", name:"Nechranice",     sub:"Vikletice",           km:55,  wg:2,
   lat:50.3533, lon:13.3933, dirs:[[200,340]] },
 { id:"lipno",   name:"Lipno",          sub:"Dolní Vltavice",      km:190, wg:1,
   lat:48.6973, lon:14.0756, dirs:[[200,340]] },
 { id:"darko",   name:"Velké Dářko",    sub:"Radostín",            km:200, wg:46,
   lat:49.6407, lon:15.8945, dirs:null },
 { id:"rozkos",  name:"Rozkoš",         sub:"Česká Skalice",       km:220, wg:4,
   lat:50.3726, lon:16.0606, dirs:[[290,200]] },
 { id:"barwald", name:"Bärwalder See",  sub:"Kitewiese, DE",       km:250, wg:59670,
   lat:51.3878, lon:14.5451, dirs:[[45,315]] },
 { id:"neusied", name:"Neusiedler See", sub:"Podersdorf, AT",      km:450, wg:33,
   lat:47.8661, lon:16.8348, dirs:null },
 { id:"rugen",   name:"Rügen",          sub:"Suhrendorf, DE",      km:500, wg:665105,
   lat:54.4676, lon:13.1383, dirs:null, sea:true },
 { id:"roseng",  name:"Rosengarten",    sub:"Greifswalder Bodden, DE", km:555, wg:null,
   lat:54.2650, lon:13.3960, dirs:[[45,160]], sea:true },
 { id:"garda",   name:"Lago di Garda",  sub:"Navene, IT",          km:620, wg:null,
   lat:45.7900, lon:10.8000, dirs:[[320,40],[150,210]], min:5.0,
   model:"meteofrance_seamless",
   verify:"https://www.windy.com/45.790/10.800?arome,45.790,10.800,11" }
];

var DEFAULT_CFG = {
  lang:"cs", mode:"kite", unit:"ms", tunit:"c",
  weight:98, home:"Karlovy Vary",
  hStart:6, hEnd:21, cape:1500, brief:true, sort:"wind",
  gear:{
    kite:[{s:"14",f:6.0,t:9.5},{s:"12",f:8.0,t:12.2},{s:"8",f:12.2,t:18.0}],
    ws:  [{s:"7.8",f:6.0,t:9.5},{s:"6.2",f:8.5,t:12.5},{s:"5.0",f:12.0,t:18.0}]
  },
  starTh:[6,9,12],
  hidden:{}, order:[], added:[], ov:{}
};

function loadCfg(){
  var c;
  try{ c = JSON.parse(localStorage.getItem("kite-cfg-v2")||"null"); }catch(e){ c=null; }
  var out = JSON.parse(JSON.stringify(DEFAULT_CFG));
  if(c) for(var k in c) out[k]=c[k];
  return out;
}
function saveCfg(cfg){ try{ localStorage.setItem("kite-cfg-v2", JSON.stringify(cfg)); }catch(e){} }

/* Efektivní seznam spotů: základ + přidané + overrides, bez skrytých */
function effSpots(cfg){
  var all = BASE_SPOTS.concat(cfg.added||[]);
  all = all.map(function(s){
    var o = (cfg.ov||{})[s.id]||{};
    var m = {}; for(var k in s) m[k]=s[k];
    if(o.dirs!==undefined) m.dirs=o.dirs;
    if(o.min!==undefined)  m.min=o.min;
    if(o.wg!==undefined)   m.wg=o.wg;
    if(o.km!==undefined)   m.km=o.km;
    return m;
  }).filter(function(s){ return !(cfg.hidden||{})[s.id]; });
  if(cfg.sort==="custom" && (cfg.order||[]).length){
    all.sort(function(a,b){
      var ia=cfg.order.indexOf(a.id), ib=cfg.order.indexOf(b.id);
      return (ia<0?99:ia)-(ib<0?99:ib);
    });
  }
  return all;
}

/* ---- sektory: null | [[a,b],...] ---- */
function inSector(d,dirs){
  if(!dirs||!dirs.length) return true;
  return dirs.some(function(s){ return s[0]<=s[1] ? (d>=s[0]&&d<=s[1]) : (d>=s[0]||d<=s[1]); });
}
function parseDirs(str){
  if(!str||!String(str).trim()) return null;
  var out=[];
  String(str).split(",").forEach(function(p){
    var m=p.trim().match(/^(\d{1,3})\s*[-–]\s*(\d{1,3})$/);
    if(m) out.push([+m[1]%360, +m[2]%360]);
  });
  return out.length?out:null;
}
function dirsToStr(dirs){
  if(!dirs) return "";
  return dirs.map(function(s){return s[0]+"–"+s[1]+"°";}).join(", ");
}

/* ---- hvězdy: prahy se přizpůsobí počtu kusů v kvéru ---- */
function starThFor(n){
  if(n<=1) return [6];
  var out=[]; for(var i=0;i<n;i++) out.push(+(6+i*(6/(n-1))).toFixed(1));
  return out;
}
function stars(mean, th){ var n=0; th.forEach(function(t){ if(mean>=t) n++; }); return n; }

/* ---- výběr velikosti ---- */
function pickGear(ms, gear){
  var fit = gear.filter(function(g){ return ms>=g.f && ms<=g.t; });
  if(!fit.length) return ms>gear[gear.length-1].t ? "!" : null;
  return fit[fit.length-1].s;
}

/* ---- jednotky ---- */
function convW(v,unit){ return unit==="kt"?v*1.9438 : unit==="kmh"?v*3.6 : v; }
function unitLbl(unit){ return unit==="kt"?"kt" : unit==="kmh"?"km/h" : "m/s"; }
function convT(v,tu){ return tu==="f" ? v*9/5+32 : v; }

/* ---- vyhodnocení dne ---- */
function assess(day, spot, cfg){
  var min = spot.min!=null?spot.min:6.0;
  var gear = cfg.gear[cfg.mode];
  var th = cfg.starTh||starThFor(gear.length);
  var hrs = day.filter(function(h){ return h.hour>=cfg.hStart && h.hour<=cfg.hEnd; });
  if(!hrs.length) return null;

  var ok = hrs.map(function(h){ return h.wind>=min-1 && inSector(h.dir,spot.dirs); });
  var runs=[], run=[];
  function flush(){ if(run.length>=2) runs.push(run); run=[]; }
  hrs.forEach(function(h,i){ ok[i]?run.push(h):flush(); }); flush();

  var peak = Math.max.apply(null,hrs.map(function(h){return h.wind;}));
  var capeMax = Math.max.apply(null,hrs.map(function(h){return h.cape;}));
  var showMax = Math.max.apply(null,hrs.map(function(h){return h.show;}));

  if(capeMax>cfg.cape || (showMax>0.3 && capeMax>800))
    return { v:"storm", runs:[], hrs:hrs, peak:peak, score:1 };

  if(!runs.length)
    return { v:"nic", noWind:peak<min-1, runs:[], hrs:hrs, peak:peak, score:Math.min(peak,5)/10 };

  var wins = runs.map(function(r){
    var n=r.length;
    var mean=r.reduce(function(a,x){return a+x.wind;},0)/n;
    var dir=r.reduce(function(a,x){return a+x.dir;},0)/n;
    return { from:r[0].hour, to:r[n-1].hour, mean:mean, dir:dir, n:n,
             g:pickGear(mean,gear), st:stars(mean,th) };
  }).sort(function(a,b){ return b.mean*b.n - a.mean*a.n; });

  var best=wins[0];
  var v = best.mean<min ? "mar" : "go";
  var score = (v==="go"?1000:400) + Math.min(best.mean,14)*30 + best.n*8 - Math.min(capeMax,2000)/20;
  return { v:v, runs:wins.slice(0,2), hrs:hrs, peak:peak, score:score };
}

/* ---- shoda modelů: rozptyl denních průměrů ---- */
function confidence(meanHourlySpread){
  if(meanHourlySpread==null) return null;
  return meanHourlySpread<1.5?"high":meanHourlySpread<3?"med":"low";
}

function compassP(d,lang){
  var cs=["S","SSV","SV","VSV","V","VJV","JV","JJV","J","JJZ","JZ","ZJZ","Z","ZSZ","SZ","SSZ"];
  var en=["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  var de=["N","NNO","NO","ONO","O","OSO","SO","SSO","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  var p=lang==="en"?en:lang==="de"?de:cs;
  return p[Math.round(d/22.5)%16];
}

/* ---- URL builders ---- */
function urlMain(spots){
  return "https://api.open-meteo.com/v1/forecast?latitude="+spots.map(function(s){return s.lat;}).join(",")+
    "&longitude="+spots.map(function(s){return s.lon;}).join(",")+
    "&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,showers,cape,temperature_2m,cloud_cover"+
    "&daily=sunset&wind_speed_unit=ms&timezone=Europe%2FPrague&forecast_days=4";
}
function urlModel(spots,model){ return urlMain(spots)+"&models="+model; }
function urlConf(spots){
  return "https://api.open-meteo.com/v1/forecast?latitude="+spots.map(function(s){return s.lat;}).join(",")+
    "&longitude="+spots.map(function(s){return s.lon;}).join(",")+
    "&hourly=wind_speed_10m&models=icon_seamless,gfs_seamless,ecmwf_ifs025"+
    "&wind_speed_unit=ms&timezone=Europe%2FPrague&forecast_days=4";
}
function urlMarine(spot){
  return "https://marine-api.open-meteo.com/v1/marine?latitude="+spot.lat+"&longitude="+spot.lon+
    "&daily=sea_surface_temperature_max&timezone=Europe%2FPrague&forecast_days=1";
}

/* ---- parsery ---- */
function parseLoc(loc){
  if(!loc||!loc.hourly||!loc.hourly.time) return {days:{},sunset:{}};
  var h=loc.hourly, days={};
  h.time.forEach(function(t,i){
    var d=t.slice(0,10); if(!days[d]) days[d]=[];
    days[d].push({ hour:+t.slice(11,13),
      wind:h.wind_speed_10m[i]||0, gust:h.wind_gusts_10m[i]||0,
      dir:h.wind_direction_10m[i]||0, rain:(h.precipitation||[])[i]||0,
      show:(h.showers||[])[i]||0, cape:(h.cape||[])[i]||0,
      temp:(h.temperature_2m||[])[i], cloud:(h.cloud_cover||[])[i] });
  });
  var sunset={};
  if(loc.daily&&loc.daily.time) loc.daily.time.forEach(function(d,i){ sunset[d]=(loc.daily.sunset||[])[i]; });
  return {days:days,sunset:sunset};
}
function parseConfLoc(loc,cfg){
  /* Průměrný HODINOVÝ rozptyl mezi modely. Denní průměry by schovaly
     případ, kdy se modely shodnou na síle, ale rozejdou v načasování
     (Garda: Pelér vs. Ora). */
  if(!loc||!loc.hourly||!loc.hourly.time) return {};
  var h=loc.hourly, acc={};
  var keys=Object.keys(h).filter(function(k){return k.indexOf("wind_speed_10m_")===0;});
  if(keys.length<2) return {};
  h.time.forEach(function(t,i){
    var d=t.slice(0,10), hr=+t.slice(11,13);
    if(hr<cfg.hStart||hr>cfg.hEnd) return;
    var vs=[]; keys.forEach(function(k){ var v=h[k][i]; if(v!=null) vs.push(v); });
    if(vs.length<2) return;
    var sp=Math.max.apply(null,vs)-Math.min.apply(null,vs);
    if(!acc[d]) acc[d]={s:0,n:0};
    acc[d].s+=sp; acc[d].n++;
  });
  var res={};
  for(var d in acc) res[d]= acc[d].n ? acc[d].s/acc[d].n : null;
  return res;
}

if(typeof module!=="undefined") module.exports={BASE_SPOTS:BASE_SPOTS,DEFAULT_CFG:DEFAULT_CFG,
  loadCfg:loadCfg,saveCfg:saveCfg,effSpots:effSpots,inSector:inSector,parseDirs:parseDirs,
  dirsToStr:dirsToStr,starThFor:starThFor,stars:stars,pickGear:pickGear,convW:convW,
  unitLbl:unitLbl,convT:convT,assess:assess,confidence:confidence,compassP:compassP,
  urlMain:urlMain,urlModel:urlModel,urlConf:urlConf,urlMarine:urlMarine,
  parseLoc:parseLoc,parseConfLoc:parseConfLoc};
