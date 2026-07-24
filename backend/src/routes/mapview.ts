import type { FastifyInstance } from 'fastify'
import { osrmRoute } from '../services/google.js'

// Renders a real, embeddable route map (Leaflet + OpenStreetMap tiles + the OSRM
// driving route line). Same-origin, no Google key — so it always loads in the
// monitor iframe (unlike a google.com/maps directions link, which refuses).
export async function mapviewRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { from?: string; to?: string } }>('/api/route', async (req, reply) => {
    const from = (req.query.from ?? '').split(',').map(Number)
    const to = (req.query.to ?? '').split(',').map(Number)
    const ok = from.length === 2 && to.length === 2 && [...from, ...to].every((n) => Number.isFinite(n))
    let coords: [number, number][] = ok ? [[from[0], from[1]], [to[0], to[1]]] : []
    if (ok) {
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
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>html,body,#map{height:100%;margin:0;background:#0b0d12}
#hud{position:absolute;z-index:1000;left:12px;bottom:12px;background:rgba(12,14,20,.82);color:#eaf0ff;
font:600 14px system-ui,sans-serif;padding:8px 12px;border-radius:12px;border:1px solid #2a3350}
#recenter{position:absolute;z-index:1000;right:12px;bottom:12px;background:rgba(12,14,20,.82);color:#eaf0ff;
border:1px solid #2a3350;border-radius:999px;padding:8px 14px;font:600 13px system-ui;cursor:pointer}</style></head>
<body><div id="map"></div><div id="hud" style="display:none"></div><button id="recenter">Urmărește mașina ↺</button>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var c=${JSON.stringify(coords)};
var map=L.map('map',{zoomControl:true});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
var dest=null;
if(c.length>1){
  var line=L.polyline(c,{color:'#6ea8fe',weight:6,opacity:.9}).addTo(map);
  L.marker(c[0]).addTo(map).bindPopup('Start');
  dest=c[c.length-1];
  L.marker(dest).addTo(map).bindPopup('Destinație');
  map.fitBounds(line.getBounds(),{padding:[30,30]});
}else{map.setView([44.43,26.10],6);}

// ── Live position: a blue dot for the car + a remaining-distance readout.
// IMPLICIT arătăm TOT traseul (fitBounds mai sus), NU zoom pe mașină — altfel
// GPS-ul acoperea ruta la prima poziție și userul vedea doar un punct (bug
// raportat de Adrian). Urmărirea mașinii (zoom + centrare) e OPȚIONALĂ: butonul
// „Urmărește mașina" o pornește (util când chiar conduci), pan-ul o oprește.
var carDot=null,following=false;
var hud=document.getElementById('hud'),btn=document.getElementById('recenter');
function haversineKm(a,b){var R=6371,d2r=Math.PI/180;
 var dLat=(b[0]-a[0])*d2r,dLon=(b[1]-a[1])*d2r;
 var s=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(a[0]*d2r)*Math.cos(b[0]*d2r)*Math.sin(dLon/2)*Math.sin(dLon/2);
 return R*2*Math.atan2(Math.sqrt(s),Math.sqrt(1-s));}
map.on('dragstart',function(){following=false;});
btn.onclick=function(){following=true;if(carDot)map.setView(carDot.getLatLng(),15);};
function onPos(p){
  var pos=[p.coords.latitude,p.coords.longitude];
  if(!carDot){
    carDot=L.circleMarker(pos,{radius:9,color:'#fff',weight:3,fillColor:'#2b6cff',fillOpacity:1}).addTo(map);
  }else{carDot.setLatLng(pos);}
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
  })
}
