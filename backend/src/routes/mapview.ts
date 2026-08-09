import type { FastifyInstance } from 'fastify'
import { osrmRoute } from '../services/google.js'

// Renders a real, embeddable map (Leaflet + OpenStreetMap tiles) SAME-ORIGIN.
// Two modes on the same page:
//   /api/route?from=lat,lon&to=lat,lon → the OSRM driving route line
//   /api/route?punct=lat,lon&nume=…    → one place with a marker (maps_search)
//
// TOTUL DE PE DOMENIUL NOSTRU (8 aug, ownerul: harta de pe openstreetmap.org
// apărea „întotdeauna" ca pagină prăbușită în Chrome-ul lui — un iframe de pe
// alt domeniu poate fi ucis de orice blocant/extensie; măsurat: anteturile OSM
// și ale noastre sunt curate, deci moartea vine din browserul lui). Pagina și
// Leaflet (frontend/public/leaflet/, copia 1.9.4) se servesc de la noi — un
// cadru same-origin nu are ce să-i omoare.
//
// ȘI PIESELE, TOT DE LA NOI (9 aug, ownerul: „orice afișare de hărți nu
// funcționează" — a doua oară, după schimbarea OSM→CartoDB). MĂSURAT: pagina,
// Leaflet, marcajele — toate 200 de pe domeniul nostru; SINGURA resursă externă
// rămasă erau piesele (întâi tile.openstreetmap.org, apoi basemaps.cartocdn.com)
// — și ambele au picat la el ⇒ numitorul comun e că browserul/rețeaua lui
// blochează CDN-uri străine de hartă. Așa că piesele trec acum prin NOI:
// /api/tile/{z}/{x}/{y} ia piesa de la CartoDB PE SERVER (măsurat 9 aug:
// CartoDB răspunde 200 și de la IP de datacenter — spre deosebire de OSM, care
// blochează datacenter-ele) și o dă browserului de pe kelionai.app. Zero
// domenii străine în pagină. Cache în memorie ca să nu batem CartoDB la
// fiecare zoom (piesele de hartă sunt statice cu lunile).
const PIESE_SURSA = 'https://basemaps.cartocdn.com/rastertiles/voyager'
const pieseCache = new Map<string, Buffer>() // cheie z/x/y@r — LRU simplu
const PIESE_CACHE_MAX = 600 // ~15-35 MB la 25-60 KB/piesă — plafonat conștient
export async function mapviewRoutes(app: FastifyInstance): Promise<void> {
  // Proxy-ul de piese: /api/tile/12/2048/1362 sau /api/tile/12/2048/1362@2x
  // (retina). Doar cifre + opțional @2x — nimic altceva nu pleacă spre CartoDB.
  app.get<{ Params: { z: string; x: string; y: string } }>('/api/tile/:z/:x/:y', async (req, reply) => {
    const { z, x, y } = req.params
    if (!/^\d{1,2}$/.test(z) || !/^\d{1,7}$/.test(x) || !/^\d{1,7}(@2x)?$/.test(y))
      return reply.code(400).send({ error: 'bad_tile' })
    const cheie = `${z}/${x}/${y}`
    const dinCache = pieseCache.get(cheie)
    if (dinCache) {
      // LRU: re-inserarea o mută la coadă (cea mai recentă).
      pieseCache.delete(cheie)
      pieseCache.set(cheie, dinCache)
      return reply.type('image/png').header('Cache-Control', 'public, max-age=86400').send(dinCache)
    }
    try {
      const r = await fetch(`${PIESE_SURSA}/${z}/${x}/${y}.png`, {
        headers: { 'user-agent': 'kelionai.app tile proxy (contact@kelionai.app)' },
        signal: AbortSignal.timeout(8000),
      })
      if (!r.ok) return reply.code(502).send({ error: `tile_upstream_${r.status}` })
      const buf = Buffer.from(await r.arrayBuffer())
      pieseCache.set(cheie, buf)
      if (pieseCache.size > PIESE_CACHE_MAX) {
        // Scoatem cea mai VECHE intrare (primul element al Map-ului = LRU).
        const primaCheie = pieseCache.keys().next().value
        if (primaCheie !== undefined) pieseCache.delete(primaCheie)
      }
      return reply.type('image/png').header('Cache-Control', 'public, max-age=86400').send(buf)
    } catch {
      // Rețeaua serverului a picat spre CartoDB — 502, ca tileerror să vorbească.
      return reply.code(502).send({ error: 'tile_unreachable' })
    }
  })
  app.get<{ Querystring: { from?: string; to?: string; punct?: string; nume?: string } }>(
    '/api/route',
    async (req, reply) => {
      const from = (req.query.from ?? '').split(',').map(Number)
      const to = (req.query.to ?? '').split(',').map(Number)
      const punct = (req.query.punct ?? '').split(',').map(Number)
      const areTraseu = from.length === 2 && to.length === 2 && [...from, ...to].every((n) => Number.isFinite(n))
      const arePunct = punct.length === 2 && punct.every((n) => Number.isFinite(n))
      // Numele locului apare în popup — text pur, tăiat scurt (intră în HTML).
      const nume = (req.query.nume ?? '').slice(0, 120)
      let coords: [number, number][] = areTraseu ? [[from[0], from[1]], [to[0], to[1]]] : []
      if (areTraseu) {
        // OSRM wants lon,lat; returns geometry as [lon,lat] pairs. Falls through
        // the server chain (demo → FOSSGIS) so a rate-limited demo never leaves
        // the map without its route line.
        const j = (await osrmRoute(from[1], from[0], to[1], to[0], 'overview=full&geometries=geojson')) as {
          routes?: { geometry?: { coordinates?: [number, number][] } }[]
        } | null
        const g = j?.routes?.[0]?.geometry?.coordinates
        if (g && g.length > 1) coords = g.map(([lon, lat]) => [lat, lon])
      }
      const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/leaflet/leaflet.css">
<style>html,body{height:100%;width:100%;margin:0;padding:0;background:#0b0d12;overflow:hidden}
#map{height:100vh;min-height:100vh;width:100vw;margin:0;padding:0;background:#0b0d12}
#hud{position:absolute;z-index:1000;left:12px;bottom:12px;background:rgba(12,14,20,.82);color:#eaf0ff;
font:600 14px system-ui,sans-serif;padding:8px 12px;border-radius:12px;border:1px solid #2a3350}
/* TOP-right, NOT bottom-right: the corner avatar sits there and covers the button
   (Adrian, Jul 24: "images and buttons overlap"). */
#recenter{position:absolute;z-index:1000;right:12px;top:12px;background:rgba(12,14,20,.82);color:#eaf0ff;
border:1px solid #2a3350;border-radius:999px;padding:8px 14px;font:600 13px system-ui;cursor:pointer}</style></head>
<body><div id="map"></div><div id="hud" style="display:none"></div><button id="recenter">Urmărește mașina ↺</button>
<script src="/leaflet/leaflet.js"></script>
<script>
var c=${JSON.stringify(coords)};
var punct=${JSON.stringify(arePunct ? [punct[0], punct[1]] : null)};
var nume=${JSON.stringify(nume)};
var map=L.map('map',{zoomControl:true});
var hud=document.getElementById('hud');
var strat=L.tileLayer('/api/tile/{z}/{x}/{y}{r}',{maxZoom:19,attribution:'© OpenStreetMap contributors © CartoDB'}).addTo(map);
/* PIESE NEVENITE = SPUS, NU MASCAT: piesele vin acum de pe DOMENIUL NOSTRU
   (/api/tile → proxy spre CartoDB pe server). Dacă tot nu vin, cauza e serverul
   nostru sau rețeaua ta spre kelionai.app — HUD-ul o spune, nu lasă gri mut. */
var pieseCazute=0,hudPiese=false;
strat.on('tileerror',function(){
  pieseCazute++;
  if(pieseCazute===4){hud.style.display='block';hudPiese=true;
    hud.textContent='Piesele de hartă nu se încarcă de la kelionai.app/api/tile — serverul nu ajunge la sursa de hărți sau rețeaua ta blochează cererea';}
});
strat.on('tileload',function(){
  if(hudPiese){hud.style.display='none';hudPiese=false;}
  pieseCazute=0;
});
var dest=null;
if(c.length>1){
  var line=L.polyline(c,{color:'#6ea8fe',weight:6,opacity:.9}).addTo(map);
  L.marker(c[0]).addTo(map).bindPopup('Start');
  dest=c[c.length-1];
  L.marker(dest).addTo(map).bindPopup('Destinație');
  map.fitBounds(line.getBounds(),{padding:[30,30]});
}else if(punct){
  /* MODUL PUNCT (maps_search): un loc, un marcaj, numele în popup — ca TEXT,
     nu HTML: cadrul e same-origin acum, un nume venit din query nu are voie
     să injecteze nimic. */
  var m=L.marker(punct).addTo(map);
  if(nume){var el=document.createElement('div');el.textContent=nume;m.bindPopup(el).openPopup();}
  map.setView(punct,14);
}else{
  /* FĂRĂ LOC INVENTAT (8 aug, ownerul: „fără date hardcodate gps, doar real")
     — aici stătea un setView pe București [44.43,26.10]: o hartă fără traseu
     arăta tăcut România, oriunde ai fi fost. Acum: lumea întreagă până vine
     fixul GPS REAL (watchPosition, mai jos), apoi centrare pe el. */
  map.setView([20,0],2);
}

// ── Live position: a blue dot for the car + a remaining-distance readout.
// BY DEFAULT we show the WHOLE route (fitBounds above), NOT a zoom on the car —
// otherwise the GPS covered the route at the first position and the user saw
// just a dot (bug reported by Adrian). Car tracking (zoom + centering) is
// OPTIONAL: the "Urmărește mașina" button starts it (useful while actually
// driving), panning stops it.
var carDot=null,following=false;
var btn=document.getElementById('recenter');
function haversineKm(a,b){var R=6371,d2r=Math.PI/180;
 var dLat=(b[0]-a[0])*d2r,dLon=(b[1]-a[1])*d2r;
 var s=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(a[0]*d2r)*Math.cos(b[0]*d2r)*Math.sin(dLon/2)*Math.sin(dLon/2);
 return R*2*Math.atan2(Math.sqrt(s),Math.sqrt(1-s));}
map.on('dragstart',function(){following=false;});
btn.onclick=function(){following=true;if(carDot)map.setView(carDot.getLatLng(),15);};
function onPos(p){
  var pos=[p.coords.latitude,p.coords.longitude];
  var primulFix=!carDot;
  if(!carDot){
    carDot=L.circleMarker(pos,{radius:9,color:'#fff',weight:3,fillColor:'#2b6cff',fillOpacity:1}).addTo(map);
  }else{carDot.setLatLng(pos);}
  /* Fără traseu și fără punct căutat, primul fix REAL centrează harta —
     locul tău, nu unul scris în cod. */
  if(primulFix&&!dest&&!punct){map.setView(pos,14);}
  if(dest){var km=haversineKm(pos,dest);
    hud.style.display='block';
    hud.textContent=(km<1?Math.round(km*1000)+' m':km.toFixed(1)+' km')+' până la destinație';}
  if(following){map.setView(pos,map.getZoom()<13?15:map.getZoom(),{animate:true});}
}
if(navigator.geolocation){
  navigator.geolocation.watchPosition(onPos,function(){},{enableHighAccuracy:true,maximumAge:2000,timeout:15000});
}
</script></body></html>`
      return reply.type('text/html; charset=utf-8').send(html)
    },
  )
}
