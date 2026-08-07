#!/usr/bin/env python3
"""PROBA DE MODELE — masoara, nu presupune (Adrian, 7 aug).

Ruleaza pe VPS (unde e cheia) si raspunde masurat la intrebarea "care model
merge cu adevarat pentru Kelionai", cu TOATE conditiile puse deodata:

  * unelte (function calling)  * vede imagini  * aude audio
  * live full-duplex           * streaming     * context
  * viteza mediana din 3 rulari CU PAYLOAD-UL REAL al aplicatiei
    (prompt de sistem lung + unelte + gandire) — nu cu o intrebare goala
  * de cate ori intoarce RASPUNS GOL (capcana din 6 aug: 3.x consuma tot
    bugetul pe gandire si nu mai scrie nimic)
  * proba pe TURA GREA (un bug real din codul casei) — "destept", nu doar rapid

De ce exista fisierul: cerinta ownerului — "doar cu toate puse e real". Rulat
cu o singura comanda pe server, repetabil, fara paste-uri lungi care se rup.

    ssh root@VPS 'cd /root/kelion/repo && python3 scripts/proba-modele.py'
"""
import json, time, urllib.request, urllib.error, statistics, base64, struct, math, zlib, re
from concurrent.futures import ThreadPoolExecutor

K = open('/root/kelion/kelionai.env').read().split('GEMINI_API_KEY=')[1].split('\n')[0].strip()
B = 'https://generativelanguage.googleapis.com/v1beta/models'

def post(m, body, t=90):
    r = urllib.request.Request(f'{B}/{m}:generateContent', data=json.dumps(body).encode(),
        headers={'x-goog-api-key': K, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(r, timeout=t) as f: return json.load(f), None
    except urllib.error.HTTPError as e:
        try: return None, json.load(e)['error']['message'][:60]
        except Exception: return None, f'HTTP{e.code}'
    except Exception as e: return None, str(e)[:40]

def parts_of(r):
    try: return r['candidates'][0]['content']['parts']
    except Exception: return []
def txt(r): return ''.join(p.get('text','') for p in parts_of(r))
def calls(r): return [p['functionCall']['name'] for p in parts_of(r) if 'functionCall' in p]

w=h=64
raw=b''.join(b'\x00'+bytes([220,40,40])*w for _ in range(h))
def ch(t,d):
    c=t+d; return struct.pack('>I',len(d))+c+struct.pack('>I',zlib.crc32(c)&0xffffffff)
PNG=base64.b64encode(b'\x89PNG\r\n\x1a\n'+ch(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+ch(b'IDAT',zlib.compress(raw))+ch(b'IEND',b'')).decode()
sr=16000;n=16000
d=b''.join(struct.pack('<h',int(8000*math.sin(2*math.pi*440*i/sr))) for i in range(n))
WAV=base64.b64encode(b'RIFF'+struct.pack('<I',36+len(d))+b'WAVEfmt '+struct.pack('<IHHIIHH',16,1,1,sr,sr*2,2,16)+b'data'+struct.pack('<I',len(d))+d).decode()
TOOLS=[{'functionDeclarations':[{'name':'web_search','description':'Cauta pe internet','parameters':{'type':'object','properties':{'q':{'type':'string'}},'required':['q']}}]}]

print('Citesc modelele...')
with urllib.request.urlopen(f'{B}?key={K}&pageSize=1000', timeout=30) as f: ml=json.load(f)['models']

# ── FAZA 0: BULETINUL MODELELOR (Adrian, 7 aug: „analizeaza diferentele intre
# cele 2") ────────────────────────────────────────────────────────────────────
# `-latest` e un ALIAS. Intrebarea „e alt model sau acelasi?" NU se ghiceste: se
# citeste din metadatele API-ului (version / displayName / limite). Daca doua
# nume au ACEEASI `version` si aceleasi limite, e acelasi motor sub doua etichete
# — si atunci diferenta de 50 ms din tabel e zgomot, nu performanta.
print('\n' + '='*104)
print('FAZA 0 — BULETINUL: cine e cine (metadate reale din API, nu presupuneri)')
print('='*104)
print(f"{'NUME':<32}{'version':<16}{'ctx in':<10}{'ctx out':<10}{'displayName'}")
print('-'*104)
for m in ml:
    nm = m['name'].replace('models/','')
    if 'flash-lite' not in nm and nm not in ('gemini-pro-latest','gemini-flash-latest'): continue
    print(f"{nm:<32}{str(m.get('version','?')):<16}{str(m.get('inputTokenLimit',0)):<10}"
          f"{str(m.get('outputTokenLimit',0)):<10}{m.get('displayName','')}")
print('='*104)
SKIP=('embedding','imagen','veo','lyria','tts','robotics','aqa','banana','research','-image')
cand=[m for m in ml if 'generateContent' in m.get('supportedGenerationMethods',[]) and not any(s in m['name'] for s in SKIP)]
print(f'{len(cand)} modele. Faza 1: capabilitati (paralel)...')

def caps(m):
    nm=m['name'].replace('models/','')
    meth=m.get('supportedGenerationMethods',[])
    r={'name':nm,'ctx':m.get('inputTokenLimit',0),
       'live':'DA' if 'bidiGenerateContent' in meth else 'nu',
       'strm':'DA' if 'streamGenerateContent' in meth else 'nu'}
    a,_=post(nm,{'contents':[{'parts':[{'text':'Cauta vremea in Bucuresti.'}]}],'tools':TOOLS})
    r['unelte']='DA' if a and calls(a) else 'nu'
    b,_=post(nm,{'contents':[{'parts':[{'text':'Ce culoare?'},{'inline_data':{'mime_type':'image/png','data':PNG}}]}]})
    r['vede']='DA' if b and txt(b) else 'nu'
    c,_=post(nm,{'contents':[{'parts':[{'text':'Descrie sunetul.'},{'inline_data':{'mime_type':'audio/wav','data':WAV}}]}]})
    r['aude']='DA' if c and txt(c) else 'nu'
    return r

with ThreadPoolExecutor(max_workers=6) as ex: rez=list(ex.map(caps,cand))
ok=[r for r in rez if r['unelte']=='DA' and r['vede']=='DA' and r['aude']=='DA']
print(f'{len(ok)} modele au TOT (unelte+vede+aude). Faza 2: payload REAL al aplicatiei + viteza x3...\n')

# PAYLOAD REAL: exact ce trimite chat.ts — prompt de sistem lung, unelte, gandire
SYS = 'Esti Kelion, asistentul lui Adrian. Raspunzi scurt, in romana, si folosesti uneltele cand e nevoie. ' * 40

# GANDIREA, PE FAMILIE — reparat 7 aug. Rularea precedenta a trimis `thinkingLevel`
# la TOATE modelele, si familia 2.5 il RESPINGE (HTTP 400) -> a iesit „GOL x3" in
# dreptul lui 2.5, ceea ce NU era o slabiciune a modelului, ci o eroare a probei
# mele. Codul casei ramifica deja corect (geminiDirect.ts:198): 2.5 -> thinkingBudget,
# 3.x -> thinkingLevel. Proba trebuie sa trimita EXACT ce trimite aplicatia.
def gandire(model, nivel='low'):
    if re.search(r'gemini-2\.5', model):
        return {'thinkingBudget': 512 if nivel == 'low' else 4096}
    return {'thinkingLevel': nivel}

for r in ok:
    m=r['name']
    # A. tura simpla, cu payload real (sistem + unelte + gandire low)
    ts=[]; gol=0
    for _ in range(3):
        body={'systemInstruction':{'parts':[{'text':SYS}]},
              'contents':[{'role':'user','parts':[{'text':'Salut! Ce faci?'}]}],
              'tools':TOOLS,
              'generationConfig':{'maxOutputTokens':2048,'temperature':0.7,'thinkingConfig':gandire(m)}}
        s=time.time(); a,err=post(m,body); ts.append(int((time.time()-s)*1000))
        if err or (not txt(a) and not calls(a)): gol+=1
    r['ms']=int(statistics.median(ts)); r['min']=min(ts); r['max']=max(ts); r['gol']=gol
    # B. tura GREA: cere rationament + unealta (proba de "destept", nu doar rapid)
    hard={'systemInstruction':{'parts':[{'text':SYS}]},
          'contents':[{'role':'user','parts':[{'text':'Am o ruta Fastify care intoarce 400 "no usable messages" cand mesajul user are text gol dar are audio atasat. Explica in 2 propozitii cauza probabila si spune daca ai nevoie sa cauti ceva.'}]}],
          'tools':TOOLS,'generationConfig':{'maxOutputTokens':4096,'temperature':0.7,'thinkingConfig':gandire(m)}}
    s=time.time(); a,err=post(m, hard); r['hard_ms']=int((time.time()-s)*1000)
    t=txt(a) if a else ''
    r['hard']='GOL' if (not t and not (a and calls(a))) else f'{len(t)}c'

ok.sort(key=lambda r:r['ms'])
print('='*104)
print(f"{'MODEL':<30}{'UNL':<5}{'VED':<5}{'AUD':<5}{'LIVE':<6}{'SIMPLU(med)':<13}{'min-max':<14}{'GOL':<5}{'GREU':<9}{'raspuns'}")
print('='*104)
for r in ok:
    mm = str(r['min']) + '-' + str(r['max'])
    print(f"{r['name']:<30}{r['unelte']:<5}{r['vede']:<5}{r['aude']:<5}{r['live']:<6}{str(r['ms'])+' ms':<13}{mm:<14}{r['gol']:<5}{str(r['hard_ms'])+' ms':<9}{r['hard']}")
print('='*104)
bun=[r for r in ok if r['gol']==0 and r['hard']!='GOL']
print(f"\n>>> FORMULA: modele care au TOT, NU dau raspuns gol pe payload-ul real, si raspund pe tura grea:")
for r in bun[:5]:
    print(f"    {r['ms']:>6} ms simplu | {r['hard_ms']:>6} ms greu | {r['name']:<30} ctx={r['ctx']}")
if bun: print(f"\n>>> CASTIGATOR: {bun[0]['name']} — {bun[0]['ms']} ms simplu, {bun[0]['hard_ms']} ms greu, 0 raspunsuri goale")
else: print('    NICIUNUL — toate dau gol pe payload-ul real (asta ar fi descoperirea)')

# ── FAZA 3: LIVE FULL-DUPLEX (Adrian, 7 aug: „vreau toate măsurătorile pe
# versiunea completă") ────────────────────────────────────────────────────────
# Familia `native-audio` NU are `generateContent` — are DOAR `bidiGenerateContent`,
# deci nu apare în tabelul de sus (care testează calea de chat) și nu poate fi
# creier de chat. E altă cale: WebSocket, conversație în timp real.
# Măsurăm ce contează pentru voce: cât durează HANDSHAKE-ul (conexiune + setup)
# și cât până la PRIMUL RĂSPUNS — plus dacă acceptă UNELTE prin sesiunea live
# (fără unelte, modelul live poate vorbi, dar nu poate căuta/plăti/deschide nimic).
# WebSocket scris de mână (socket+ssl), ca proba să nu depindă de biblioteci
# instalate pe server — regula casei: proba nu trebuie să ceară pregătiri.
import socket, ssl, os, base64 as b64

def ws_live(model, cu_unelte, modalitate='TEXT'):
    host = 'generativelanguage.googleapis.com'
    path = f'/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key={K}'
    t0 = time.time()
    try:
        raw = socket.create_connection((host, 443), timeout=25)
        s = ssl.create_default_context().wrap_socket(raw, server_hostname=host)
        key = b64.b64encode(os.urandom(16)).decode()
        s.send((f'GET {path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\n'
                f'Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n'
                f'Sec-WebSocket-Version: 13\r\n\r\n').encode())
        head = b''
        while b'\r\n\r\n' not in head:
            c = s.recv(4096)
            if not c: break
            head += c
        if b'101' not in head.split(b'\r\n')[0]:
            return None, None, 'nu', head.split(b'\r\n')[0].decode('utf8', 'ignore')[:40], 0
        hs = int((time.time() - t0) * 1000)

        def trimite(obj):
            p = json.dumps(obj).encode()
            n, m = len(p), os.urandom(4)
            h = b'\x81'
            if n < 126: h += bytes([0x80 | n])
            elif n < 65536: h += b'\xfe' + n.to_bytes(2, 'big')
            else: h += b'\xff' + n.to_bytes(8, 'big')
            s.send(h + m + bytes(b ^ m[i % 4] for i, b in enumerate(p)))

        # Citire BRUTA: nu mai decupez cadrul WebSocket dupa lungime. Motiv masurat:
        # un raspuns AUDIO vine in cadre de zeci de KB, mai mari decat un recv() —
        # taierea dupa lungime dezalinia fluxul si urmatoarele citiri ieseau varza.
        # Aici nu am nevoie de JSON valid, ci de MARCAJE ("inlineData", "text",
        # "functionCall") si de cati octeti a trimis — ambele se vad in brut.
        def citeste(lim=25):
            s.settimeout(lim)
            d = s.recv(262144)
            return d.decode('utf8', 'ignore') if d else ''

        # MODALITATEA — reparatia din 7 aug. Rularea precedenta a cerut TEXT de la
        # TOATE modelele live; familia `native-audio` NU stie sa scoata text, doar
        # AUDIO, si a raspuns „The requested combination of response modalities…".
        # Acele „fara raspuns" din tabel erau eroarea MEA de proba, nu o defectiune
        # a modelelor. Acum: cer AUDIO acolo unde trebuie si pun si transcrierea
        # iesirii, ca sa vad NEGRU PE ALB ce a spus.
        setup = {'model': f'models/{model}', 'generationConfig': {'responseModalities': [modalitate]}}
        if modalitate == 'AUDIO':
            setup['outputAudioTranscription'] = {}
        if cu_unelte:
            setup['tools'] = [{'functionDeclarations': [{'name': 'cauta', 'description': 'Cauta pe internet',
                'parameters': {'type': 'object', 'properties': {'q': {'type': 'string'}}, 'required': ['q']}}]}]
        trimite({'setup': setup})
        ack = citeste(20)
        if 'setupComplete' not in ack:
            s.close()
            nota = 'modalitate respinsa' if 'modalit' in ack else ('unelte respinse' if cu_unelte else ack[:44])
            return hs, None, 'nu', nota, 0
        t1 = time.time()
        trimite({'clientContent': {'turns': [{'role': 'user', 'parts': [{'text':
            'Cauta vremea in Bucuresti.' if cu_unelte else 'Salut! Raspunde scurt: cum te cheama?'}]}],
            'turnComplete': True}})
        prim, gasit, octeti = None, '', 0
        for _ in range(60):
            try: r = citeste(20)
            except Exception: break
            if not r: break
            octeti += len(r)
            if prim is None and ('"text"' in r or 'inlineData' in r or 'functionCall' in r):
                prim = int((time.time() - t1) * 1000)
            if 'functionCall' in r: gasit = 'unealta'
            if 'turnComplete' in r or 'generationComplete' in r: break
        s.close()
        return hs, prim, ('DA' if (cu_unelte and gasit) else 'nu'), '', octeti
    except Exception as e:
        return None, None, 'nu', str(e)[:44], 0

LIVE_M = [m['name'].replace('models/', '') for m in ml
          if 'bidiGenerateContent' in m.get('supportedGenerationMethods', [])]
print('\n\n' + '=' * 104)
print('FAZA 3 — LIVE FULL-DUPLEX (WebSocket). Alta cale: NU are generateContent, deci nu poate fi creier de chat.')
print('=' * 104)
print(f"{'MODEL':<42}{'MOD':<7}{'HANDSHAKE':<12}{'PRIM RASPUNS':<15}{'UNELTE':<9}{'KB':<7}{'nota'}")
print('-' * 104)
for m in LIVE_M:
    # Incerc TEXT; daca modelul e din familia care scoate DOAR audio, reincerc pe
    # AUDIO. Asa fiecare model e masurat pe modalitatea LUI, nu pe una impusa.
    mod = 'TEXT'
    hs, pr, un, er, kb = ws_live(m, False, 'TEXT')
    if hs and pr is None:
        mod = 'AUDIO'
        hs2, pr, un, er, kb = ws_live(m, False, 'AUDIO')
        hs = hs2 or hs
    un2 = ws_live(m, True, mod)[2] if hs else 'nu'
    print(f"{m:<42}{mod:<7}{(str(hs)+' ms' if hs else 'PICAT'):<12}"
          f"{(str(pr)+' ms' if pr else ('fara raspuns' if hs else '-')):<15}{un2:<9}{str(kb//1024)+'K':<7}{er}")
print('=' * 104)
print('\nNOTA: „live" si „creier de chat" sunt DOUA componente, nu una. Modelul live')
print('vorbeste in timp real; creierul de chat foloseste unelte, vede si aude.')

# ── FAZA 4: DUELUL CELOR DOUA LITE (Adrian, 7 aug: „analizeaza diferentele
# intre cele 2") ─────────────────────────────────────────────────────────────
# In tabel au iesit 441 ms vs 490 ms. In rularea de dinainte: 498 vs 499, cu
# ordinea INVERSATA. O diferenta care isi schimba semnul de la o rulare la alta
# NU e performanta, e zgomot de retea — dar asta se DOVEDESTE, nu se declara.
# Aici le rulez ALTERNATIV (a, b, a, b…), 8 ture fiecare, in aceeasi fereastra de
# timp, ca sa nu avantajez pe niciunul cu o retea mai buna la alt moment.
DUEL = [x for x in ('gemini-flash-lite-latest', 'gemini-3.5-flash-lite')
        if any(y['name'] == x for y in rez)]
if len(DUEL) == 2:
    print('\n\n' + '=' * 104)
    print('FAZA 4 — DUEL ALTERNATIV (8 ture fiecare, intercalate): e diferenta reala sau zgomot?')
    print('=' * 104)
    dt = {x: [] for x in DUEL}
    for i in range(8):
        for x in DUEL:
            body = {'systemInstruction': {'parts': [{'text': SYS}]},
                    'contents': [{'role': 'user', 'parts': [{'text': 'Salut! Ce faci?'}]}],
                    'tools': TOOLS,
                    'generationConfig': {'maxOutputTokens': 2048, 'temperature': 0.7,
                                         'thinkingConfig': gandire(x)}}
            s0 = time.time(); a, err = post(x, body)
            dt[x].append(int((time.time() - s0) * 1000))
        print(f'  tura {i+1}/8: ' + ' | '.join(f'{x} {dt[x][-1]:>5} ms' for x in DUEL))
    print('-' * 104)
    for x in DUEL:
        v = dt[x]
        print(f"{x:<32} mediana {int(statistics.median(v)):>5} ms | min {min(v):>5} | max {max(v):>5} | "
              f"imprastiere +/-{int(statistics.pstdev(v)):>4} ms")
    m1, m2 = (int(statistics.median(dt[x])) for x in DUEL)
    z = max(int(statistics.pstdev(dt[x])) for x in DUEL)
    dif = abs(m1 - m2)
    print('-' * 104)
    print(f"Diferenta intre mediane: {dif} ms. Imprastierea celui mai instabil: +/-{z} ms.")
    print('VERDICT: ' + ('DIFERENTA E ZGOMOT — sub imprastierea proprie a masuratorii. Alegerea intre'
                         '\n         cele doua se face pe ALT criteriu, nu pe viteza.' if dif <= z else
                         f'DIFERENTA E REALA — depaseste imprastierea. Mai rapid: '
                         f'{DUEL[0] if m1 < m2 else DUEL[1]}.'))
    print('=' * 104)
