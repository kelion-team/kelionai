import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { cerAdmin } from '../session.js'
import { gasesteAgent, cheamaAgent } from '../services/agentiKelion.js'
import { addMemory, searchMemories } from '../db.js'
import { dateSimbol, rezumatPentruAgent } from '../services/piete.js'
import { config } from '../config.js'

// ── CENTRUL DE TRANZACȚIONARE (Adrian, 4 aug: „să fie reală, cu tot ce există
// pe piață, cu grafice cu tot, învățarea lui Kelion reală, nu povești — ca un
// centru din Londra/America") ────────────────────────────────────────────────
//
// CE E, cinstit:
//  • CRYPTO intraday REAL (Binance public, fără cheie): preț viu, lumânări pe
//    1m/15m/1h/4h/1d — desenate în grafic adevărat pe pagină.
//  • PREȚUL LA MILISECUNDĂ (9 aug, ownerul: „datele trebuie reale total la
//    miime de secundă… real ca în live"): pe crypto, pagina se abonează DIRECT
//    la fluxul public de tranzacții Binance (WebSocket @trade) — prețul se
//    mișcă la FIECARE tranzacție executată pe bursă, cu timestamp-ul în ms al
//    bursei afișat. Dacă fluxul pică, pagina o SPUNE și rămâne pe împrospătarea
//    la 10s (nu tace, nu minte).
//  • ACȚIUNI + INDICI pe date ZILNICE reale (Stooq, fără cheie): AAPL.US,
//    TSLA.US, ^SPX, ^DJI, ^DAX... — tot cu grafic.
//  • ÎNVĂȚAREA REALĂ a lui Kelion: fiecare analiză se salvează în memoria lui
//    cu prețul din clipa aia; la următoarea analiză pe același simbol primește
//    CE A ZIS ATUNCI + PREȚUL DE-ACUM și e obligat să-și judece apelurile.
// CE NU E, la fel de cinstit:
//  • EXECUȚIE — niciun broker legat; pagina nu plasează ordine și o spune.
//  • Intraday pe bursele clasice (Londra/NY tick-cu-tick) — aia se vinde doar
//    cu abonament de date (cheie); când ownerul alege furnizorul, se leagă.
//
// Contract de eșec: sursa necitibilă → eroarea verbatim, nu cifre inventate.

/** ── NIVELURILE SE VĂD PE GRAFIC (9 aug, ownerul: „ce spune trebuie să arate
 *  clar pe grafic") ──────────────────────────────────────────────────────────
 *  Agentul e pus să-și încheie răspunsul cu un rând mașină-citibil:
 *      NIVELURI: intrare=65100; stop=64300; tinta=66800
 *  Funcția asta îl extrage tolerant (`;` sau `,`, spații, majuscule) și
 *  întoarce perechile nume→valoare pe care pagina le DESENEAZĂ ca linii pe
 *  lumânări. Fără rând sau „NIVELURI: -" → listă goală (nu se inventează).
 *  PURĂ și exportată — se probează pe texte reale, fără agent. */
export function extrageNiveluri(text: string, pretCurent?: number): { nume: string; valoare: number }[] {
  // Revizia (9 aug): virgula era luată drept separator de perechi → „intrare=65,100"
  // ieșea 65 (linie GREȘITĂ pe grafic); prima apariție a „NIVELURI" în proză
  // îngropa rândul real; boldul markdown și monedele stricau potrivirea.
  const curat = String(text ?? '').replace(/[*_`]/g, '')
  const aparitii = [...curat.matchAll(/NIVELURI\s*:?\s*([^\n]*)/gi)]
  for (let a = aparitii.length - 1; a >= 0; a--) {
    const rand = aparitii[a][1] ?? ''
    const out: { nume: string; valoare: number }[] = []
    // Întâi TĂIEM rândul în perechi (audit 9 aug: captura de valoare trecea
    // peste granițele perechii — „intrare=65,100, stop=…" înghițea „65,100, "
    // → NaN → intrarea și stopul DISPĂREAU tăcut, rămânea doar ținta): `;`
    // desparte mereu; virgula desparte DOAR când urmează un nume (literă),
    // nu cifre — „76,42" rămâne întreg, „65,100, stop" se taie la a doua.
    for (const segment of rand.split(/;|,(?=\s*[^\d\s.,])/)) {
      const p = /([a-zăâîșțşţ_ -]+?)\s*=\s*[~≈$€£]?\s*([0-9][0-9.,\s]*)/i.exec(segment)
      if (!p) continue
      const valoare = normalizeazaNumar(p[2], pretCurent)
      if (valoare === null) continue
      out.push({ nume: p[1].trim().toLowerCase().normalize('NFC'), valoare })
      if (out.length >= 8) break
    }
    if (out.length) return out // rândul cerut e „LA FINAL" — ultima apariție validă câștigă
  }
  return []
}

/** „65,100" / „65.100,50" / „65 100" → numărul REAL: grupele de 3 sunt mii,
 *  ultima grupă scurtă e zecimale. `pretCurent` (dacă e dat) dezambiguizează
 *  „X.YYY": pe DOGE la 0.123, „0.123" e preț zecimal, nu 123 (audit 9 aug —
 *  liniile false de ~1000× pe grafic). PURĂ — probată pe formate reale. */
export function normalizeazaNumar(brut: string, pretCurent?: number): number | null {
  const t = String(brut ?? '').trim().replace(/\s+/g, '').replace(/[.,]+$/, '')
  if (!t) return null
  let s = t
  if (/^\d{1,3}([.,]\d{3})+([.,]\d{1,2})?$/.test(t)) {
    // separatori de mii cu (poate) zecimale la coadă
    const m = t.match(/^(.*?)([.,](\d{1,2}))?$/)
    const intreg = (m?.[1] ?? t).replace(/[.,]/g, '')
    s = m?.[3] ? `${intreg}.${m[3]}` : intreg
    // DEZAMBIGUIZAREA „X.YYY" (un singur grup de 3): poate fi mii europene
    // (66.800 pe BTC) sau preț zecimal (0.123 pe DOGE). Regulile, în ordine:
    const unGrup = /^(\d{1,3})[.,](\d{3})$/.exec(t)
    if (unGrup) {
      const caMii = Number(s)
      const caZecimal = Number(`${unGrup[1]}.${unGrup[2]}`)
      // 1. Partea întreagă 0 nu e notație de mii în NICIO convenție.
      if (unGrup[1] === '0') return caZecimal > 0 ? caZecimal : null
      // 2. Cu prețul REAL în mână, câștigă interpretarea din același ordin de
      //    mărime cu el — asta e și singura care se poate DESENA pe grafic.
      if (typeof pretCurent === 'number' && Number.isFinite(pretCurent) && pretCurent > 0) {
        const dMii = Math.abs(Math.log10(caMii / pretCurent))
        const dZecimal = Math.abs(Math.log10(caZecimal / pretCurent))
        return dZecimal < dMii ? caZecimal : caMii
      }
      // 3. Fără context: o singură cifră întreagă (1.085) e mai degrabă preț
      //    zecimal de altcoin; 2-3 cifre (66.800) rămân mii europene (dovedit
      //    pe BTC, testul de mai jos).
      if (unGrup[1].length === 1) return caZecimal
    }
  } else {
    s = t.replace(',', '.')
  }
  const v = Number(s)
  return Number.isFinite(v) && v > 0 ? v : null
}

// ── POINTERII DE INDICAȚIE (10 aug, ownerul: „el când explică trebuie să arate
// clar pe monitor ce zice, adică poziționează pointeri de indicație") ─────────
// Chatul REAL cheamă unealta `arata_pe_grafic` cu punctele lui; frame-ul {semne}
// ajunge în pagină și fiecare punct devine o linie SOLIDĂ colorată cu săgeată +
// vorbele lui, desenată FIX pe preț. Aici curățăm ce vine de la creier: doar
// prețuri reale (>0), tip din setul permis (altfel 'nota'), etichetă tăiată,
// maximum 8. PURĂ și exportată — se probează fără browser (tranzactiiSemne.test).
export interface SemnGrafic {
  pret: number
  tip: string
  text: string
}
const TIPURI_SEMN = new Set(['suport', 'rezistenta', 'intrare', 'stop', 'tinta', 'nota'])
export function curataSemne(puncte: unknown): SemnGrafic[] {
  const arr = Array.isArray(puncte) ? puncte : []
  const out: SemnGrafic[] = []
  for (const p of arr) {
    const o = (p ?? {}) as { pret?: unknown; tip?: unknown; text?: unknown }
    const pret = Number(o.pret)
    if (!Number.isFinite(pret) || pret <= 0) continue
    // Diacriticele se scapă (rezistență→rezistenta, țintă→tinta) ca tipul să prindă.
    const tipBrut = String(o.tip ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    const tip = TIPURI_SEMN.has(tipBrut) ? tipBrut : 'nota'
    const text = String(o.text ?? '').trim().slice(0, 60)
    out.push({ pret, tip, text })
    if (out.length >= 8) break
  }
  return out
}

/** Instrucțiunea comună prin care agentul își face nivelurile DESENABILE. */
const CERE_NIVELURI =
  `\nLA FINAL, OBLIGATORIU, pe un rând separat, scrie nivelurile tale numerice în formatul exact: ` +
  `"NIVELURI: intrare=...; stop=...; tinta=...; suport=...; rezistenta=..." — DOAR cele care există ` +
  `în analiza ta, cu cifre REALE din date (fără altele). Dacă nu ai niciun nivel, scrie "NIVELURI: -". ` +
  `Rândul ăsta se DESENEAZĂ pe graficul omului — de-aia trebuie exact formatul.`

function adminul(req: FastifyRequest, reply: FastifyReply): { email: string } | null {
  // Gardul de admin, o singură sursă (cerAdmin, session.ts): 401 pe sesiune
  // moartă, 403 DOAR pe rol (regula din 9 aug).
  return cerAdmin(req, reply)
}

function paginaTranzactii(): string {
  // GRAFIC PROFESIONAL (9 aug, ownerul: „rudimentară aplicația… ieși în net și
  // construiește soluția real funcțională"): motorul open-source al graficelor
  // TradingView (lightweight-charts v5, Apache-2.0), VENDORED pe domeniul
  // nostru (/lwc/ — aceeași lecție ca Leaflet: nimic de pe CDN-uri străine).
  // Lumânarea CURENTĂ se mișcă LIVE din fluxul kline al bursei; prețul bate la
  // fiecare tranzacție (@trade, milisecunda bursei); nivelurile lui Kelion din
  // chat/analiză se desenează ca LINII DE PREȚ cu etichetă pe axă
  // (createPriceLine) — „ce spune trebuie să arate clar pe grafic".
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kelion — Centrul de Tranzacționare</title>
<script src="/lwc/lightweight-charts.standalone.production.js"></script>
<style>
 /* Terminal întunecat, familia #0b1020 — accente DOAR pentru direcție (verde/roșu). */
 *{box-sizing:border-box;margin:0;padding:0}
 html,body{height:100%}
 body{height:100dvh;overflow:hidden;display:flex;flex-direction:column;background:#0b1020;color:#e8ecf6;font:14px/1.45 system-ui,'Segoe UI',Roboto,sans-serif}
 button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
 :focus-visible{outline:2px solid #7aa2ff;outline-offset:2px;border-radius:4px}
 .sus{color:#4ade80}.jos{color:#f87171}.rau{color:#f87171}

 /* Bara de sus: simbol + acțiuni + preț mare + 24h + ieșire */
 .bara{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;padding:.45rem .75rem;border-bottom:1px solid #1c2440;background:#0e1428;flex:0 0 auto}
 .marca{font-size:.7rem;font-weight:600;letter-spacing:.14em;color:#8b93ad;white-space:nowrap}
 .marca em{font-style:normal;color:#e8ecf6;margin-left:.35em}
 #s{width:9.5rem;padding:.38rem .55rem;background:#0b1020;border:1px solid #2a3550;border-radius:4px;color:#e8ecf6;font:600 .85rem ui-monospace,Menlo,Consolas,monospace;text-transform:uppercase;letter-spacing:.04em}
 #s:focus{outline:none;border-color:#8b93ad}
 .btn{padding:.38rem .7rem;border:1px solid #2a3550;border-radius:4px;background:#111830;font-size:.8rem;white-space:nowrap}
 .btn:hover{border-color:#3d4c78;background:#161f3a}
 .btn:disabled{opacity:.45;cursor:default}
 .btn.lucreaza::after{content:'';display:inline-block;width:.7rem;height:.7rem;border:2px solid #8b93ad;border-top-color:#e8ecf6;border-radius:50%;margin-left:.4rem;vertical-align:-2px;animation:rot 1s linear infinite}
 @keyframes rot{to{transform:rotate(360deg)}}
 .gol{flex:1 1 auto}
 .pret{font:700 1.35rem/1 ui-monospace,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
 .var{font:600 .8rem ui-monospace,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;color:#8b93ad}

 /* Rândul de chips: simboluri stânga, intervale dreapta */
 .rand{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:.28rem .75rem;border-bottom:1px solid #1c2440;background:#0b1020;flex:0 0 auto;overflow-x:auto}
 .chips{display:flex;gap:.2rem;flex:0 0 auto}
 .chip,.int{padding:.24rem .55rem;border-radius:3px;border:1px solid transparent;font:600 .74rem ui-monospace,Menlo,Consolas,monospace;color:#8b93ad}
 .chip:hover,.int:hover{color:#e8ecf6;background:#141b33}
 .chip.activ,.int.activ{color:#e8ecf6;background:#1c2440;border-color:#2a3550}
 .int:disabled{opacity:.3;cursor:default;background:none;color:#8b93ad}

 /* Graficul umple tot restul; legenda, panoul de niveluri și scheletul plutesc peste el */
 #graf{position:relative;flex:1 1 auto;min-height:0;background:#0b1020}
 #leg{position:absolute;top:.5rem;left:.65rem;z-index:3;pointer-events:none;font:11px/1.55 ui-monospace,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;color:#8b93ad;white-space:pre}
 #leg .lg1{color:#e8ecf6;font-weight:700;letter-spacing:.05em}
 #leg .ma{color:#eab308}#leg .em{color:#60a5fa}
 #nivele{position:absolute;top:.5rem;right:4.4rem;z-index:4;display:none;background:#0e1428e6;border:1px solid #1c2440;border-radius:4px;padding:.4rem .55rem;font:11px/1.65 ui-monospace,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;max-width:15rem}
 .nivTitlu{color:#8b93ad;letter-spacing:.06em;margin-bottom:.1rem}
 .nivRand{display:flex;align-items:center;gap:.45rem}
 .nivRand .pic{width:.55rem;height:2px;flex:0 0 auto}
 .nivVal{margin-left:auto;padding-left:.7rem}
 .btnMic{margin-top:.3rem;padding:.14rem .45rem;border:1px solid #2a3550;border-radius:3px;font-size:10px;color:#8b93ad}
 .btnMic:hover{color:#e8ecf6;border-color:#3d4c78}
 /* Scheletul: feedback vizibil cât se încarcă; la eșec rămâne și spune cauza. */
 #schelet{position:absolute;inset:0;z-index:5;background:#0e1428;display:flex;align-items:center;justify-content:center;text-align:center;padding:1rem;transition:opacity .25s,visibility .25s}
 #schelet.gata{opacity:0;visibility:hidden}
 #schelet::before{content:'';position:absolute;inset:15% 5% 10%;background:repeating-linear-gradient(90deg,#141b33 0 10px,transparent 10px 24px);opacity:.55;border-radius:4px}
 #schelet::after{content:'';position:absolute;inset:0;background:linear-gradient(100deg,transparent 35%,#ffffff10 50%,transparent 65%) no-repeat;background-size:200% 100%;animation:sclipire 1.4s linear infinite}
 #schelet.esec::after{animation:none;background:none}
 #scheletText{position:relative;z-index:1;color:#8b93ad;font-size:.9rem;max-width:34rem;background:#0e1428ee;padding:.4rem .7rem;border-radius:4px}
 #schelet.esec #scheletText{color:#f87171}
 @keyframes sclipire{from{background-position:120% 0}to{background-position:-120% 0}}

 /* Bara de status: subțire, monospace, doar stări MĂSURATE */
 .status{display:flex;align-items:center;gap:.6rem;padding:.26rem .75rem;border-top:1px solid #1c2440;background:#0e1428;font:11px ui-monospace,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;color:#8b93ad;flex:0 0 auto;white-space:nowrap;overflow:hidden}
 .dot{font-size:9px;flex:0 0 auto}
 .dot.live{color:#4ade80;animation:puls 1.6s ease-in-out infinite}
 .dot.zilnic{color:#eab308}.dot.rau{color:#f87171}.dot.gri{color:#8b93ad}
 #stText{overflow:hidden;text-overflow:ellipsis}
 #stSursa,#stOra{flex:0 0 auto}
 .disc{color:#5b6482;flex:0 0 auto}
 .doarcitit{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

 /* Voalul + sertarul de analiză (dreapta, overlay, scrollabil) */
 #voal{position:fixed;inset:0;background:#00000066;opacity:0;visibility:hidden;transition:opacity .2s,visibility .2s;z-index:25}
 #voal.deschis{opacity:1;visibility:visible}
 #sertar{position:fixed;top:0;right:0;bottom:0;width:min(420px,94vw);background:#0e1428;border-left:1px solid #2a3550;box-shadow:-14px 0 34px #00000090;transform:translateX(102%);visibility:hidden;transition:transform .18s ease,visibility .18s;z-index:30;display:flex;flex-direction:column}
 #sertar.deschis{transform:none;visibility:visible}
 .sertarCap{display:flex;align-items:flex-start;justify-content:space-between;gap:.6rem;padding:.7rem .9rem;border-bottom:1px solid #1c2440;flex:0 0 auto}
 .sertarCap strong{font-size:.9rem}
 .anMeta{font:11px ui-monospace,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;color:#8b93ad;margin-top:.15rem}
 .anCorp{flex:1 1 auto;overflow-y:auto;padding:.8rem .9rem 1.2rem;font-size:.84rem;line-height:1.55;color:#c7cfe2}
 .md h3{font-size:.78rem;letter-spacing:.05em;text-transform:uppercase;color:#e8ecf6;margin:.9rem 0 .35rem;border-bottom:1px solid #1c2440;padding-bottom:.25rem}
 .md p{margin:.4rem 0}
 .md ul{margin:.35rem 0 .5rem 1.1rem}
 .md li{margin:.2rem 0}
 .md strong{color:#e8ecf6}
 .notaMd{color:#8b93ad;font-size:.76rem;border-left:2px solid #2a3550;padding-left:.55rem;margin-top:.8rem}
 .asteapta{color:#8b93ad;animation:puls 1.6s ease-in-out infinite}
 .sk{height:.85rem;border-radius:3px;background:linear-gradient(100deg,#1a2340 40%,#232e52 50%,#1a2340 60%);background-size:200% 100%;animation:sclipire 1.4s linear infinite;margin:.5rem 0}
 .sk.scurt{width:60%}
 @keyframes puls{50%{opacity:.45}}
 @media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style></head><body>
<header class="bara">
 <span class="marca">KELION<em>CENTRUL DE TRANZACȚIONARE</em></span>
 <input id="s" value="BTCUSDT" spellcheck="false" autocomplete="off" aria-label="Simbolul urmărit — Enter pornește urmărirea" placeholder="BTCUSDT · AAPL.US · ^SPX">
 <button id="v" class="btn" title="Pornește urmărirea simbolului: preț live tranzacție-cu-tranzacție (crypto) sau lumânări zilnice (bursă clasică)">Urmărește</button>
 <button id="an" class="btn" title="Analiza completă a lui Kelion — nivelurile apar pe grafic">Analiza lui Kelion</button>
 <span class="gol"></span>
 <span id="p" class="pret" aria-label="Prețul curent">—</span>
 <span id="var" class="var">—</span>
 <button id="iesire" class="btn" title="Închide Centrul și întoarce-te la Kelion (Esc)" aria-label="Ieșire din Centrul de Tranzacționare, tasta Esc">✕ Ieșire</button>
</header>
<nav class="rand" aria-label="Simboluri și intervale">
 <div class="chips" id="chips" role="group" aria-label="Simboluri">
  <button class="chip" aria-pressed="false">BTCUSDT</button><button class="chip" aria-pressed="false">ETHUSDT</button><button class="chip" aria-pressed="false">SOLUSDT</button>
  <button class="chip" aria-pressed="false">AAPL.US</button><button class="chip" aria-pressed="false">TSLA.US</button><button class="chip" aria-pressed="false">NVDA.US</button>
  <button class="chip" aria-pressed="false">^SPX</button><button class="chip" aria-pressed="false">^DJI</button><button class="chip" aria-pressed="false">^DAX</button>
 </div>
 <div class="chips" id="iv" role="group" aria-label="Intervalul lumânărilor">
  <button class="int" aria-pressed="false">1m</button><button class="int" aria-pressed="false">15m</button><button class="int activ" aria-pressed="true">1h</button><button class="int" aria-pressed="false">4h</button><button class="int" aria-pressed="false">1d</button>
 </div>
</nav>
<main id="graf">
 <div id="leg" aria-hidden="true"></div>
 <div id="nivele"></div>
 <div id="schelet"><span id="scheletText">se încarcă lumânările…</span></div>
</main>
<footer class="status">
 <span id="stDot" class="dot gri" aria-hidden="true">●</span>
 <span id="stText">aștept prima citire…</span>
 <span id="stSursa"></span>
 <span id="stOra"></span>
 <span class="gol"></span>
 <span class="disc">nu plasează ordine, nu promite câștiguri</span>
</footer>
<span id="anunt" class="doarcitit" aria-live="polite"></span>
<div id="voal"></div>
<aside id="sertar" role="dialog" aria-modal="true" aria-labelledby="sertarTitlu" aria-hidden="true">
 <div class="sertarCap">
  <div><strong id="sertarTitlu">Analiza lui Kelion</strong><div id="anMeta" class="anMeta">—</div></div>
  <button id="anInchide" class="btn" title="Închide analiza (Esc)" aria-label="Închide sertarul de analiză, tasta Esc">✕</button>
 </div>
 <div id="anCorp" class="anCorp md" tabindex="0" aria-label="Textul analizei"><p class="notaMd">Apasă „Analiza lui Kelion" pentru analiza completă (regim, niveluri, scenarii cu invalidare, riscul întâi). Nivelurile se desenează pe grafic.</p></div>
</aside>
<script>
 // ── Referințe + stare (var-uri simple, funcții numite — fără framework) ──────
 var s=document.getElementById('s'), p=document.getElementById('p'), va=document.getElementById('var');
 var v=document.getElementById('v'), an=document.getElementById('an'), iesire=document.getElementById('iesire');
 var leg=document.getElementById('leg'), nivelePanou=document.getElementById('nivele');
 var stDot=document.getElementById('stDot'), stText=document.getElementById('stText');
 var stSursa=document.getElementById('stSursa'), stOra=document.getElementById('stOra');
 var sertar=document.getElementById('sertar'), anCorp=document.getElementById('anCorp');
 var anMeta=document.getElementById('anMeta'), anInchide=document.getElementById('anInchide');
 var voal=document.getElementById('voal'), anunt=document.getElementById('anunt');
 var schelet=document.getElementById('schelet'), scheletText=document.getElementById('scheletText');
 var interval='1h', intervalAfisat='1h', ws=null, ceas=null, pretVechi=0, simbolCurent='';
 var primaIncarcare=true, reconectDelay=1000, primaTranzactie=false, eZilnic=false, subCrosshair=false;
 var sertarDeschis=false, cronometruAnaliza=null, ultimulAnunt='', graficMort=false;
 // Precizia dedusă din prețul REAL, aplicată peste tot (audit 9 aug: DOGE la 0.123)
 var precizie=2;
 var liniile=[]; // liniile de preț (nivelurile lui Kelion) desenate acum
 var ultim={c:null,v:null,m:null,e:null}; // ultima lumânare/volum/medii — legenda fără crosshair
 var CULV_SUS='#4ade8048', CULV_JOS='#f8717148'; // volum cu opacitate, direcțional

 // ── Utilitare oneste: nimic afișat fără măsurătoare ──────────────────────────
 function esc(t){ return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
 // Starea din bara de jos vine DOAR din măsurători; cititorul de ecran e
 // anunțat separat și DOAR la schimbare de text — nu la fiecare tranzacție.
 function stare(fel,text){
   stDot.className='dot '+fel; stText.textContent=text;
   if(text!==ultimulAnunt){ anunt.textContent=text; ultimulAnunt=text; }
 }
 // Scheletul de peste grafic: la eșec rămâne, spune cauza reală și că
 // reîncercarea e automată (pollul de 10s) — nu tace, nu minte.
 function arataSchelet(text){ if(graficMort) return; schelet.classList.remove('gata','esec'); scheletText.textContent=text; }
 function ascundeSchelet(){ if(graficMort) return; schelet.classList.add('gata'); }
 function scheletEsec(text){ schelet.classList.remove('gata'); schelet.classList.add('esec'); scheletText.textContent=text; }
 function zecimale(x){ var t=String(x); var i=t.indexOf('.'); return i<0?2:Math.min(8,t.length-i-1); }
 function fmtNr(x,zec){
   if(typeof x!=='number'||!isFinite(x)) return '—';
   return x.toLocaleString('en-US',{minimumFractionDigits:zec,maximumFractionDigits:zec});
 }
 function fmtVol(x){
   if(typeof x!=='number'||!isFinite(x)) return '';
   if(x>=1e9) return (x/1e9).toFixed(2)+'B';
   if(x>=1e6) return (x/1e6).toFixed(2)+'M';
   if(x>=1e3) return (x/1e3).toFixed(1)+'K';
   return String(Math.round(x*100)/100);
 }
 function eCripto(sim){ return /^[A-Z0-9]{5,}$/.test(sim) && sim.indexOf('.')<0 && sim.indexOf('^')<0; }
 function oraMs(t){ var d=new Date(t); function z(n,l){ return String(n).padStart(l||2,'0'); }
   return z(d.getHours())+':'+z(d.getMinutes())+':'+z(d.getSeconds())+'.'+z(d.getMilliseconds(),3); }
 function sma(l,n){ var out=[],ac=0,i; for(i=0;i<l.length;i++){ ac+=l[i].inchis; if(i>=n)ac-=l[i-n].inchis;
   if(i>=n-1)out.push({time:Math.floor(l[i].t/1000),value:ac/n}); } return out; }
 function ema(l,n){ var out=[],k=2/(n+1),e=null,i; for(i=0;i<l.length;i++){ e=e===null?l[i].inchis:l[i].inchis*k+e*(1-k);
   if(i>=n-1)out.push({time:Math.floor(l[i].t/1000),value:e}); } return out; }

 // ── Ieșirea: comportamentul EXISTENT păstrat (postMessage în iframe / '/'). ──
 function inchideCentrul(){
   if(window.top!==window.self){ try{ window.parent.postMessage({kelion:'inchide-tranzactii'},'*'); }catch(e){} }
   else { location.href='/'; }
 }
 iesire.onclick=inchideCentrul;
 // Esc închide întâi sertarul (dacă e deschis), abia apoi Centrul — altfel o
 // analiză deschisă te-ar arunca afară din pagină fără să vrei.
 document.addEventListener('keydown',function(ev){
   if(ev.key!=='Escape') return;
   if(sertarDeschis) inchideSertar();
   else inchideCentrul();
 });

 // ── Graficul: lightweight-charts v5 (motorul TradingView, VENDORED la /lwc) ──
 var chart=null, serie=null, vol=null, ma20=null, ema50=null;
 try{
   chart=LightweightCharts.createChart(document.getElementById('graf'),{
     layout:{background:{color:'#0b1020'},textColor:'#8b93ad',fontSize:11},
     grid:{vertLines:{color:'#121936'},horzLines:{color:'#121936'}},
     timeScale:{timeVisible:true,secondsVisible:false,borderColor:'#1c2440'},
     rightPriceScale:{borderColor:'#1c2440'},
     crosshair:{mode:0,vertLine:{labelBackgroundColor:'#1c2440'},horzLine:{labelBackgroundColor:'#1c2440'}},
     autoSize:true
   });
   serie=chart.addSeries(LightweightCharts.CandlestickSeries,{upColor:'#4ade80',downColor:'#f87171',wickUpColor:'#4ade80',wickDownColor:'#f87171',borderVisible:false});
   vol=chart.addSeries(LightweightCharts.HistogramSeries,{priceFormat:{type:'volume'},priceScaleId:'',lastValueVisible:false,priceLineVisible:false});
   vol.priceScale().applyOptions({scaleMargins:{top:0.82,bottom:0}});
   chart.priceScale('right').applyOptions({scaleMargins:{top:0.08,bottom:0.24}});
   ma20=chart.addSeries(LightweightCharts.LineSeries,{color:'#eab308',lineWidth:1,lastValueVisible:false,priceLineVisible:false});
   ema50=chart.addSeries(LightweightCharts.LineSeries,{color:'#60a5fa',lineWidth:1,lastValueVisible:false,priceLineVisible:false});
   chart.subscribeCrosshairMove(cuCrosshair);
 }catch(e){
   // Biblioteca lipsă NU omoară pagina: totul merge fără grafic și cauza se SPUNE.
   graficMort=true;
   scheletEsec('graficul nu s-a putut porni ('+(e&&e.message?e.message:'biblioteca /lwc nu s-a încărcat')+') — datele și analiza merg în continuare; reîncarcă pagina pentru grafic');
   stare('rau','graficul nu s-a putut porni ('+(e&&e.message?e.message:'biblioteca /lwc nu s-a încărcat')+') — restul paginii merge');
 }

 // ── Legenda OHLC: la crosshair valorile de sub cursor, altfel ultima lumânare ─
 function scrieLegenda(c,vb,m,e2){
   if(!c||c.open===undefined){ leg.innerHTML=''; return; }
   var cls=c.close>=c.open?'sus':'jos';
   var pct=c.open?((c.close-c.open)/c.open*100):0;
   var h='<div class="lg1">'+esc(simbolCurent||s.value.toUpperCase())+' · '+esc(intervalAfisat)+'</div>';
   h+='<div class="'+cls+'">O '+fmtNr(c.open,precizie)+'  H '+fmtNr(c.high,precizie)+'  L '+fmtNr(c.low,precizie)
     +'  C '+fmtNr(c.close,precizie)+'  '+(pct>=0?'+':'')+pct.toFixed(2)+'%'
     +(typeof vb==='number'?('  V '+fmtVol(vb)):'')+'</div>';
   h+='<div><span class="ma">MA20 '+(typeof m==='number'?fmtNr(m,precizie):'—')+'</span>'
     +'  <span class="em">EMA50 '+(typeof e2==='number'?fmtNr(e2,precizie):'—')+'</span></div>';
   leg.innerHTML=h;
 }
 // PUNCTUL DE SUB CURSOR — trimis creierului (ownerul, 10 aug: „kelion trebuie
 // să vadă când pun mouse-ul exact peste orice poziție din grafic"). Iframe-ul e
 // SINGURUL care vede ÎN interiorul graficului: din aplicație, elementFromPoint
 // vede doar <iframe>, nu lumânarea. Aici avem punctul exact (par.seriesData).
 var pesteCursor=null;
 function cuCrosshair(par){
   var d=par&&par.seriesData?par.seriesData.get(serie):null;
   if(!d||d.open===undefined){ subCrosshair=false; pesteCursor=null; scrieLegenda(ultim.c,ultim.v,ultim.m,ultim.e); raporteazaAcum(); return; }
   subCrosshair=true;
   var vb=par.seriesData.get(vol), m=par.seriesData.get(ma20), e2=par.seriesData.get(ema50);
   pesteCursor={ t:(typeof d.time==='number'?d.time*1000:String(d.time)), o:d.open, h:d.high, l:d.low, c:d.close,
     vol:(vb&&typeof vb.value==='number')?vb.value:null, ma20:(m&&typeof m.value==='number')?m.value:null, ema50:(e2&&typeof e2.value==='number')?e2.value:null };
   scrieLegenda(d, vb?vb.value:null, m?m.value:null, e2?e2.value:null);
   raporteazaAcum();
 }

 // ── Nivelurile lui Kelion: linii de preț + panou-legendă cu „curăță liniile" ──
 function culoareNivel(nume){
   if(nume.indexOf('intrare')>=0||nume.indexOf('cumpar')>=0) return '#4ade80';
   if(nume.indexOf('stop')>=0) return '#f87171';
   if(nume.indexOf('tint')>=0||nume.indexOf('țint')>=0||nume.indexOf('iesire')>=0||nume.indexOf('ieșire')>=0) return '#60a5fa';
   if(nume.indexOf('suport')>=0) return '#eab308';
   if(nume.indexOf('rezist')>=0) return '#c084fc';
   return '#b9c2da';
 }
 function aratNiveluri(niveluri){
   var i;
   if(serie){ for(i=0;i<liniile.length;i++){ try{serie.removePriceLine(liniile[i]);}catch(e){} } }
   liniile=[];
   if(!niveluri||!niveluri.length){ nivelePanou.style.display='none'; nivelePanou.innerHTML=''; return; }
   var h='<div class="nivTitlu">NIVELURILE LUI KELION</div>';
   for(i=0;i<niveluri.length;i++){
     var n=niveluri[i], cul=culoareNivel(n.nume);
     if(serie) liniile.push(serie.createPriceLine({price:n.valoare,color:cul,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:n.nume}));
     h+='<div class="nivRand"><span class="pic" style="background:'+cul+'"></span>'+esc(n.nume)
       +'<span class="nivVal">'+fmtNr(n.valoare,zecimale(n.valoare))+'</span></div>';
   }
   h+='<button id="nivCurata" class="btnMic">curăță liniile</button>';
   nivelePanou.innerHTML=h; nivelePanou.style.display='block'; // și fără grafic pornit, valorile tot se văd
   document.getElementById('nivCurata').onclick=function(){ aratNiveluri([]); };
 }

 // ── POINTERII DE INDICAȚIE (10 aug, ownerul: „el când explică trebuie să arate
 // clar pe monitor ce zice, adică poziționează pointeri de indicație") ─────────
 // Vin din chatul REAL (unealta arata_pe_grafic → frame {semne}). Fiecare punct e
 // o linie SOLIDĂ, mai groasă, colorată, cu SĂGEATĂ + vorbele lui Kelion, fix pe
 // preț. Ținute separat de nivelurile din analiză, curățate independent.
 var semnele=[]; // liniile-pointer desenate acum
 function culoareSemn(tip){
   if(tip==='intrare') return '#4ade80';
   if(tip==='stop') return '#f87171';
   if(tip==='tinta') return '#60a5fa';
   if(tip==='suport') return '#eab308';
   if(tip==='rezistenta') return '#c084fc';
   return '#7aa2ff';
 }
 function sagetaSemn(tip){
   if(tip==='suport'||tip==='intrare') return '▲ ';
   if(tip==='rezistenta'||tip==='stop') return '▼ ';
   if(tip==='tinta') return '◆ ';
   return '➤ ';
 }
 function aratSemne(lista){
   var i;
   if(serie){ for(i=0;i<semnele.length;i++){ try{serie.removePriceLine(semnele[i]);}catch(e){} } }
   semnele=[];
   if(!lista||!lista.length) return;
   for(i=0;i<lista.length;i++){
     var sm=lista[i]||{}, pr=Number(sm.pret);
     if(!isFinite(pr)||pr<=0) continue;
     var cul=culoareSemn(sm.tip), et=(sagetaSemn(sm.tip)+String(sm.text||sm.tip||'')).slice(0,44);
     if(serie) semnele.push(serie.createPriceLine({price:pr,color:cul,lineWidth:2,lineStyle:0,axisLabelVisible:true,title:et}));
   }
 }

 // ── Datele reale (poll 10s): grafic + preț + sursă; eroarea se SPUNE în status ─
 function marcheazaIntervale(){
   document.querySelectorAll('.int').forEach(function(b){
     var oprit=eZilnic&&b.textContent!=='1d';
     b.disabled=oprit;
     b.title=oprit?'bursă clasică: doar lumânări zilnice (intraday cere abonament de date)':'';
     var activ=eZilnic?b.textContent==='1d':b.textContent===interval;
     b.classList.toggle('activ',activ);
     b.setAttribute('aria-pressed',activ?'true':'false');
   });
 }
 function marcheazaChips(){
   document.querySelectorAll('.chip').forEach(function(b){
     var activ=b.textContent===simbolCurent;
     b.classList.toggle('activ',activ);
     b.setAttribute('aria-pressed',activ?'true':'false');
   });
 }
 async function pret(){
   try{
     // Pollul citește simbolul URMĂRIT, nu câmpul editabil — cât timp tastezi
     // un simbol nou, împrospătarea de 10s nu pleacă cu text pe jumătate scris.
     var r=await fetch('/api/tranzactii/date?simbol='+encodeURIComponent(simbolCurent||s.value)+'&interval='+encodeURIComponent(interval));
     var j=await r.json();
     if(j.error){
       p.textContent='—'; va.textContent='—'; va.className='var'; stare('rau',j.error);
       if(primaIncarcare) scheletEsec('nu am putut citi datele: '+j.error+' — reîncerc automat la 10s');
       return;
     }
     if(primaIncarcare) precizie=zecimale(j.pret);
     // Cu fluxul de tranzacții pornit, prețul îl scrie DOAR bursa — pollul nu-l calcă.
     if(!ws||!primaTranzactie) p.textContent=fmtNr(Number(j.pret),precizie);
     var v24=Number(j.variatie24h);
     va.textContent=(v24>=0?'+':'')+v24.toFixed(2)+'% 24h';
     va.className='var '+(v24>=0?'sus':'jos');
     stSursa.textContent='· '+j.sursa;
     intervalAfisat=String(j.interval||interval);
     // Autoritatea e SURSA măsurată, nu forma simbolului (lecția GOOGL/EURUSD:
     // sursa zilnică omoară fluxul viu, altfel rămâne un socket zombi cu etichetă LIVE).
     eZilnic=String(j.sursa||'').indexOf('Stooq')>=0;
     if(eZilnic&&ws) opresteViu();
     marcheazaIntervale();
     if(eZilnic&&!ws){
       stare('zilnic','bursă clasică: lumânări ZILNICE reale (intraday cere abonament de date)');
       stOra.textContent='· actualizat '+oraMs(Date.now());
     } else if(!ws){
       stOra.textContent='· actualizat '+oraMs(Date.now());
     } else if(!primaTranzactie){
       stare('gri','lumânări încărcate ('+j.sursa+') · aștept prima tranzacție din fluxul live…');
     }
     if(serie){
       // Cu fluxul kline viu NU rescriem lumânările (ți-ar reseta zoomul);
       // mediile și volumul (serii de linii) se pot împrospăta oricând.
       if(primaIncarcare||eZilnic||!ws){
         serie.setData(j.lumanari.map(function(c){ return {time:Math.floor(c.t/1000),open:c.deschis,high:c.maxim,low:c.minim,close:c.inchis}; }));
         vol.setData(j.lumanari.map(function(c){ return {time:Math.floor(c.t/1000),value:c.volum,color:c.inchis>=c.deschis?CULV_SUS:CULV_JOS}; }));
         var uc=j.lumanari[j.lumanari.length-1];
         if(uc){ ultim.c={open:uc.deschis,high:uc.maxim,low:uc.minim,close:uc.inchis}; ultim.v=uc.volum; }
       }
       var sm=sma(j.lumanari,20), em=ema(j.lumanari,50);
       ma20.setData(sm); ema50.setData(em);
       ultim.m=sm.length?sm[sm.length-1].value:null;
       ultim.e=em.length?em[em.length-1].value:null;
       if(primaIncarcare){
         serie.applyOptions({priceFormat:{type:'price',precision:precizie,minMove:Math.pow(10,-precizie)}});
         chart.timeScale().fitContent();
       }
       if(!subCrosshair) scrieLegenda(ultim.c,ultim.v,ultim.m,ultim.e);
       ascundeSchelet();
     }
     primaIncarcare=false;
   }catch(e){
     var msg=(e&&e.message?e.message:String(e));
     // Eroarea de rețea se SPUNE — dar nu acoperă un flux live care încă bate.
     if(ws&&primaTranzactie){ stare('rau','împrospătarea REST a picat ('+msg+') — fluxul live încă bate'); }
     else{
       stare('rau','rețea: '+msg);
       if(primaIncarcare) scheletEsec('rețea: '+msg+' — reîncerc automat la 10s');
     }
   }
 }

 // ── LIVE crypto: un socket, două fluxuri — @trade (ms-ul bursei) + @kline ────
 function opresteViu(){ if(ws){ try{ws.close();}catch(e){} ws=null; } }
 function pornesteViu(sim){
   opresteViu();
   if(!eCripto(sim)) return;
   try{
     var st=sim.toLowerCase();
     var w=new WebSocket('wss://stream.binance.com:9443/stream?streams='+st+'@trade/'+st+'@kline_'+interval);
     ws=w; primaTranzactie=false; pretVechi=0;
     stare('gri','mă conectez la fluxul live Binance…');
     w.onopen=function(){ reconectDelay=1000; };
     w.onmessage=function(ev){ try{
       var m=JSON.parse(ev.data); var d=(m&&m.data)||{};
       if(d.e==='trade'){
         var nou=Number(d.p);
         if(nou>0){
           primaTranzactie=true;
           p.textContent=fmtNr(nou,precizie);
           p.className='pret '+(pretVechi&&nou<pretVechi?'jos':'sus');
           pretVechi=nou;
           stare('live','LIVE · flux Binance, tranzacție cu tranzacție');
           stOra.textContent='· ultima: '+oraMs(d.T)+' (ms bursă)';
         }
       } else if(d.e==='kline'&&d.k){
         var k=d.k, tt=Math.floor(k.t/1000);
         if(serie) serie.update({time:tt,open:Number(k.o),high:Number(k.h),low:Number(k.l),close:Number(k.c)});
         if(vol) vol.update({time:tt,value:Number(k.v),color:Number(k.c)>=Number(k.o)?CULV_SUS:CULV_JOS});
         ultim.c={open:Number(k.o),high:Number(k.h),low:Number(k.l),close:Number(k.c)}; ultim.v=Number(k.v);
         if(!subCrosshair) scrieLegenda(ultim.c,ultim.v,ultim.m,ultim.e);
       }
     }catch(e){} };
     w.onerror=function(){ if(ws===w) stare('rau','fluxul live a picat — rămân pe împrospătarea la 10s'); };
     // Fluxul mort nu are voie să tacă sub eticheta „LIVE": reconectare cu backoff.
     w.onclose=function(){ if(ws===w){ ws=null;
       if(simbolCurent&&eCripto(simbolCurent)){
         stare('rau','fluxul live s-a închis — reconectez în '+Math.round(reconectDelay/1000)+'s…');
         setTimeout(function(){ if(!ws&&simbolCurent&&eCripto(simbolCurent)){ void pret(); pornesteViu(simbolCurent); } }, reconectDelay);
         reconectDelay=Math.min(reconectDelay*2,30000);
       }
     } };
   }catch(e){ stare('rau','fluxul live nu a pornit ('+e+') — împrospătare la 10s'); }
 }

 // ── Urmărirea: simbol nou → grafic curat, niveluri șterse, flux repornit ─────
 function urmareste(){
   var sim=s.value.toUpperCase().trim();
   if(!sim){ s.focus(); return; }
   s.value=sim;
   if(sim!==simbolCurent){ simbolCurent=sim; primaIncarcare=true; aratNiveluri([]); aratSemne([]); } // nivelurile/pointerii vechi ar minți pe alt simbol
   marcheazaChips();
   if(primaIncarcare){ arataSchelet('se încarcă '+sim+' ('+interval+')…'); stare('gri','încarc '+sim+'…'); }
   if(ceas) clearInterval(ceas);
   void pret(); ceas=setInterval(pret,10000);
   pornesteViu(sim);
 }
 v.onclick=urmareste;
 s.addEventListener('keydown',function(ev){ if(ev.key==='Enter') urmareste(); });
 document.querySelectorAll('.chip').forEach(function(b){ b.onclick=function(){ s.value=b.textContent; urmareste(); }; });
 document.querySelectorAll('.int').forEach(function(b){ b.onclick=function(){
   if(b.disabled) return;
   interval=b.textContent; intervalAfisat=interval; primaIncarcare=true;
   marcheazaIntervale(); urmareste();
 }; });

 // ── Markdown SIGUR, de mână: escape întâi, apoi doar ###/**/liste. Fără biblioteci. ─
 function bold(l){ return l.replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>'); }
 function mdSigur(text){
   var linii=esc(text).split(/\\r?\\n/), h='', inLista=false, par=[], i, l, titlu, item;
   function gataPar(){ if(par.length){ h+='<p>'+par.join('<br>')+'</p>'; par=[]; } }
   function gataLista(){ if(inLista){ h+='</ul>'; inLista=false; } }
   for(i=0;i<linii.length;i++){
     l=linii[i].trim();
     titlu=/^#{1,4}\\s+(.*)$/.exec(l);
     item=/^[*\\-•]\\s+(.*)$/.exec(l); // „**bold" la început de rând NU e listă: după * unic trebuie spațiu
     if(titlu){ gataPar(); gataLista(); h+='<h3>'+bold(titlu[1])+'</h3>'; }
     else if(item){ gataPar(); if(!inLista){ h+='<ul>'; inLista=true; } h+='<li>'+bold(item[1])+'</li>'; }
     else if(!l){ gataPar(); gataLista(); }
     else { gataLista(); par.push(bold(l)); } // liniile consecutive rămân UN paragraf
   }
   gataPar(); gataLista();
   return h;
 }

 // ── Sertarul de analiză (focusul intră la deschidere, iese ÎNAINTE de aria-hidden) ─
 function deschideSertar(){
   sertar.classList.add('deschis'); voal.classList.add('deschis');
   sertar.setAttribute('aria-hidden','false'); sertarDeschis=true;
   anInchide.focus();
 }
 function inchideSertar(){
   an.focus();
   sertar.classList.remove('deschis'); voal.classList.remove('deschis');
   sertar.setAttribute('aria-hidden','true'); sertarDeschis=false;
 }
 anInchide.onclick=inchideSertar;
 voal.onclick=inchideSertar;
 an.onclick=async function(){
   if(an.disabled) return;
   // Analiza pleacă pe SIMBOLUL DE PE GRAFIC, nu pe câmpul editabil (audit 9 aug),
   // iar la desen răspunsul se verifică din nou contra ecranului.
   var simbolAnalizat=simbolCurent||s.value.toUpperCase().trim();
   an.disabled=true; an.classList.add('lucreaza'); an.setAttribute('aria-busy','true');
   deschideSertar();
   anMeta.textContent=simbolAnalizat+' · interval '+interval;
   // Așteptare de 30–60s: schelet + cronometru de secunde, ca să se VADĂ lucrul.
   var start=Date.now();
   anCorp.innerHTML='<div class="sk"></div><div class="sk"></div><div class="sk scurt"></div>'
     +'<p class="asteapta" id="gandeste">Kelion citește piața și memoria apelurilor lui… 0s (durează ~30–60 s)</p>'
     +'<div class="sk"></div><div class="sk scurt"></div>';
   anCorp.scrollTop=0;
   cronometruAnaliza=setInterval(function(){
     var g=document.getElementById('gandeste');
     if(g) g.textContent='Kelion citește piața și memoria apelurilor lui… '+Math.round((Date.now()-start)/1000)+'s (durează ~30–60 s)';
   },1000);
   try{
     var r=await fetch('/api/tranzactii/analiza',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({simbol:simbolAnalizat,interval:interval})});
     var j=await r.json();
     if(j.error){ anCorp.innerHTML='<p class="rau">'+esc(j.error)+'</p>'; }
     else{
       anMeta.textContent=String(j.simbol)+' · preț la analiză: '+String(j.pret)+(j.sursa?' · '+String(j.sursa):'');
       var h=mdSigur(String(j.analiza));
       if(j.niveluri&&j.niveluri.length){
         if(String(j.simbol).toUpperCase()===String(simbolCurent).toUpperCase()){
           aratNiveluri(j.niveluri);
           h+='<p class="notaMd">Cele '+j.niveluri.length+' niveluri sunt desenate pe grafic (panoul din dreapta-sus le arată cu valori).</p>';
         } else {
           h+='<p class="notaMd">Nivelurile sunt pentru '+esc(String(j.simbol))+' — graficul arată '+esc(simbolCurent)+', nu le desenez.</p>';
         }
       }
       anCorp.innerHTML=h;
     }
   }catch(e){ anCorp.innerHTML='<p class="rau">rețea: '+esc(String(e&&e.message?e.message:e))+'</p>'; }
   clearInterval(cronometruAnaliza);
   an.disabled=false; an.classList.remove('lucreaza'); an.removeAttribute('aria-busy');
 };

 // (chatul NU există pe pagină — decizia ownerului din 10 aug: chatul e cel REAL al aplicației)
 // ── ZONA DE CONTEXT (10 aug, ownerul: „orice funcție deschisă dă mesaj
 // creierului cu ce se lucrează") ─────────────────────────────────────────────
 // Pagina își raportează starea către aplicație (Stage → chatul REAL o
 // ancorează), și primește înapoi nivelurile din răspunsurile chatului.
 var ultimRaport=0, raportPlanificat=null;
 // Raport imediat dar throttled (~150ms): hover-ul pe grafic e des; nu inundăm
 // aplicația, dar creierul are mereu ULTIMUL punct de sub cursor când e întrebat.
 function raporteazaAcum(){
   if(window.top===window.self) return;
   var acum=Date.now();
   if(acum-ultimRaport<150){ if(!raportPlanificat){ raportPlanificat=setTimeout(function(){ raportPlanificat=null; raporteazaAcum(); },160); } return; }
   raporteazaStarea();
 }
 function raporteazaStarea(){
   if(window.top===window.self) return; // pe pagina de sine stătătoare n-are cui
   ultimRaport=Date.now();
   try{
     window.parent.postMessage({kelion:'tranzactii-stare',simbol:simbolCurent||s.value.toUpperCase(),
       pret:(function(){var n=Number(String(p.textContent).replace(/,/g,'')); return isFinite(n)&&n>0?n:null;})(),
       interval:interval,sursa:stSursa.textContent.replace(/^·\\s*/,''),peste:pesteCursor},'*');
   }catch(e){}
 }
 setInterval(raporteazaStarea,5000);
 window.addEventListener('message',function(ev){
   var d=ev.data||{};
   if(!d||!d.date) return;
   var acelasiSimbol=String(d.date.simbol||'').toUpperCase()===String(simbolCurent).toUpperCase();
   if(d.kelion==='niveluri'){
     if(!acelasiSimbol) return; // pe alt simbol ar minți
     aratNiveluri(d.date.lista||[]);
   } else if(d.kelion==='semne'){
     if(!acelasiSimbol) return; // pointerii pe alt simbol ar minți
     aratSemne(d.date.lista||[]);
   }
 });

 urmareste();
</script></body></html>`
}

export async function tranzactiiRoutes(app: FastifyInstance): Promise<void> {
  // Pagina — DOAR admin (agentul e doar-admin, panoul la fel).
  app.get('/api/tranzactii', async (req, reply) => {
    if (!adminul(req, reply)) return { error: 'forbidden' }
    reply.header('Content-Type', 'text/html; charset=utf-8')
    reply.header('Cache-Control', 'no-store')
    return paginaTranzactii()
  })

  // Datele reale ale unui simbol (graficul + prețul viu). DOAR admin.
  app.get('/api/tranzactii/date', async (req, reply) => {
    if (!adminul(req, reply)) return { error: 'forbidden' }
    const q = req.query as { simbol?: string; interval?: string }
    return dateSimbol(String(q.simbol ?? 'BTCUSDT'), String(q.interval ?? '1h'))
  })

  // (Ruta /api/tranzactii/jurnal a fost SCOASĂ pe 10 aug: chatul paginii nu
  // mai există, iar chatul REAL scrie direct în memoria 'tranzactii' din
  // chat.ts, la finalul turei ancorate — un singur drum viu, nu două.)

  // Analiza cu ÎNVĂȚARE REALĂ: agentul primește analizele lui anterioare pe
  // simbol + prețul de-acum (își judecă apelurile), iar verdictul nou se
  // salvează în memorie cu prețul lui — bucla de învățare e închisă. DOAR admin.
  app.post('/api/tranzactii/analiza', async (req, reply) => {
    if (!adminul(req, reply)) return { error: 'forbidden' }
    const b = req.body as { simbol?: string; interval?: string } | null
    const d = await dateSimbol(String(b?.simbol ?? 'BTCUSDT'), String(b?.interval ?? '1h'))
    // STATUS PE MĂSURA ADEVĂRULUI (măsurat 8 aug): cele trei ieșiri de mai jos
    // răspundeau 200 cu `{error:…}` — un apelant care se uită la `res.ok`
    // primea „a mers" pentru o analiză care nu există. Al cincilea caz din
    // aceeași familie; acum eșecul se vede și din status, nu doar din corp.
    if ('error' in d) return reply.code(502).send(d)
    const agent = gasesteAgent('tranzactii')
    if (!agent) return reply.code(503).send({ error: 'agentul tranzactii lipsește din roster' })
    const vechi = await searchMemories(config.adminEmail, 'tranzactii', [d.simbol], 3)
    const istoria = vechi.length
      ? `\nANALIZELE TALE ANTERIOARE pe ${d.simbol} (cu prețul de atunci în paranteza [pret ...]) — judecă-le scurt față de prețul de ACUM (${d.pret}): ce ai nimerit, ce ai ratat, ce înveți:\n` +
        vechi.map((m) => `---\n${m.content.slice(0, 700)}`).join('\n')
      : ''
    try {
      const r = await cheamaAgent(
        agent,
        `Analizează piața pe datele de mai jos, ca un trader avansat, cu riscul întâi.\n` +
          `Structura cerută: 1) Regimul pieței (trend/range, pe ce dovezi din cifre); 2) Niveluri importante ` +
          `(suport/rezistență din minime/maxime reale); 3) Scenarii (dacă… atunci…, cu invalidare clară); ` +
          `4) Riscul (mărimea poziției ca % din capital, unde stă stopul, raport risc/câștig); 5) Ce NU se vede în date; ` +
          `6) JUDECATA apelurilor tale vechi (dacă există mai jos).\n` +
          `Fără promisiuni, fără „sigur". Datele:\n${rezumatPentruAgent(d)}${istoria}${CERE_NIVELURI}`,
        true,
      )
      const zi = new Date().toISOString().slice(0, 16).replace('T', ' ')
      await addMemory(config.adminEmail, `[tranzactii ${zi}] ${d.simbol} [pret ${d.pret}, ${d.interval}]: ${r.text.slice(0, 900)}`, 'tranzactii')
      return { analiza: r.text, simbol: d.simbol, pret: d.pret, sursa: d.sursa, niveluri: extrageNiveluri(r.text, Number(d.pret)) }
    } catch (e) {
      return reply
        .code(502)
        .send({ error: `agentul n-a răspuns: ${e instanceof Error ? e.message.slice(0, 150) : String(e)}` })
    }
  })
}
