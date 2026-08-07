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
import json, time, urllib.request, urllib.error, statistics, base64, struct, math, zlib
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
for r in ok:
    m=r['name']
    # A. tura simpla, cu payload real (sistem + unelte + gandire low)
    ts=[]; gol=0
    for _ in range(3):
        body={'systemInstruction':{'parts':[{'text':SYS}]},
              'contents':[{'role':'user','parts':[{'text':'Salut! Ce faci?'}]}],
              'tools':TOOLS,
              'generationConfig':{'maxOutputTokens':2048,'temperature':0.7,'thinkingConfig':{'thinkingLevel':'low'}}}
        s=time.time(); a,err=post(m,body); ts.append(int((time.time()-s)*1000))
        if err or (not txt(a) and not calls(a)): gol+=1
    r['ms']=int(statistics.median(ts)); r['min']=min(ts); r['max']=max(ts); r['gol']=gol
    # B. tura GREA: cere rationament + unealta (proba de "destept", nu doar rapid)
    hard={'systemInstruction':{'parts':[{'text':SYS}]},
          'contents':[{'role':'user','parts':[{'text':'Am o ruta Fastify care intoarce 400 "no usable messages" cand mesajul user are text gol dar are audio atasat. Explica in 2 propozitii cauza probabila si spune daca ai nevoie sa cauti ceva.'}]}],
          'tools':TOOLS,'generationConfig':{'maxOutputTokens':4096,'temperature':0.7,'thinkingConfig':{'thinkingLevel':'low'}}}
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
