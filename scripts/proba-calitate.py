#!/usr/bin/env python3
"""PROBA DE CALITATE — cat de DESTEPT e modelul, nu cat de rapid (Adrian, 7 aug).

De ce exista, separat de proba-modele.py: aia masoara VITEZA si „nu raspunde
gol". Adrian a intrebat daca treptele grele (work/top) pot pleca de pe Pro, iar
raspunsul cinstit a fost „nu pot verifica din proba aia — nu masoara calitatea".
Asta e proba care o masoara. „hai sa facem si proba aia".

REGULA DE FIER: fiecare sarcina are un raspuns VERIFICABIL AUTOMAT. Niciun scor
nu vine din parerea mea despre cat de frumos suna raspunsul — fiecare punct e
dat de o comparatie exacta (numar, cheie JSON, nume de unealta, cod care chiar
rulează si intoarce ce trebuie). Ce nu se poate verifica automat nu intra aici.

CELE 10 SARCINI, si ce prinde fiecare:
   1. bug-linie        gaseste linia greselii intr-un cod dat        -> numar exact
   2. rationament      calcul in mai multi pasi                      -> numar exact
   3. json-strict      raspunde DOAR cu JSON valid, chei cerute      -> se parseaza
   4. unealta-corecta  alege unealta potrivita dintre patru          -> nume unealta
   5. fara-unealta     NU cheama unealta cand nu e cazul             -> zero apeluri
   6. recall-lung      scoate un detaliu ingropat intr-un prompt lung-> sir exact
   7. fara-inventie    nu inventeaza ce nu e in context              -> refuz curat
   8. format-exact     exact trei cuvinte                            -> numarare
   9. cod-executabil   scrie o functie care CHIAR trece testele      -> se executa
  10. lant-unelte      doua unelte in ordine, cu rezultatul primeia  -> ambii pasi

Fiecare sarcina se ruleaza de 2 ori (prinde raspunsurile instabile) -> scor /20.

    ssh kelion-vps 'python3 -u /root/calitate.py'
"""
import json, time, urllib.request, urllib.error, statistics, re, sys
from concurrent.futures import ThreadPoolExecutor

K = open('/root/kelion/kelionai.env').read().split('GEMINI_API_KEY=')[1].split('\n')[0].strip()
B = 'https://generativelanguage.googleapis.com/v1beta/models'

# Candidatii pentru treptele grele + doua repere: modelul de pe chat (ca sa se
# vada daca „rapid" pierde ceva la gandire) si Pro (etalonul de acum).
MODELE = sys.argv[1:] or [
    'gemini-2.5-pro',
    'gemini-3.1-pro-preview',
    'gemini-pro-latest',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-2.5-flash',
    'gemini-3-flash-preview',
    'gemini-3.5-flash-lite',
]

def gandire(model, nivel='high'):
    """Exact ramificarea din geminiDirect.ts:198 — 2.5 cere thinkingBudget,
       3.x cere thinkingLevel. Aici pe 'high': treptele grele asa gandesc."""
    if re.search(r'gemini-2\.5', model):
        return {'thinkingBudget': 4096 if nivel == 'high' else 512}
    return {'thinkingLevel': nivel}

def post(m, body, t=180):
    r = urllib.request.Request(f'{B}/{m}:generateContent', data=json.dumps(body).encode(),
        headers={'x-goog-api-key': K, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(r, timeout=t) as f: return json.load(f), None
    except urllib.error.HTTPError as e:
        try: return None, json.load(e)['error']['message'][:70]
        except Exception: return None, f'HTTP{e.code}'
    except Exception as e: return None, str(e)[:50]

def parts_of(r):
    try: return r['candidates'][0]['content']['parts']
    except Exception: return []
def txt(r): return ''.join(p.get('text', '') for p in parts_of(r)) if r else ''
def parti_apel(r):
    """Partile INTREGI care contin un apel de unealta. Contează diferenta fata de
       `apeluri`: pe langa `functionCall`, partea poarta si `thoughtSignature` —
       semnatura de gandire pe care Gemini 3.x o CERE inapoi la replay. Prima
       varianta a probei trimitea inapoi doar `functionCall`, deci pasul 2 pica
       la toate modelele 3.x cu 400, si eu scriam in tabel ca „modelul n-a mai
       apelat nimic". Nu modelul — proba."""
    return [p for p in parts_of(r) if 'functionCall' in p] if r else []
def apeluri(r): return [p['functionCall'] for p in parti_apel(r)]

UNELTE_4 = [{'functionDeclarations': [
    {'name': 'web_search', 'description': 'Cauta informatii publice pe internet',
     'parameters': {'type': 'object', 'properties': {'q': {'type': 'string'}}, 'required': ['q']}},
    {'name': 'db_query', 'description': 'Ruleaza o interogare in baza de date a aplicatiei',
     'parameters': {'type': 'object', 'properties': {'sql': {'type': 'string'}}, 'required': ['sql']}},
    {'name': 'send_email', 'description': 'Trimite un email',
     'parameters': {'type': 'object', 'properties': {'to': {'type': 'string'}, 'body': {'type': 'string'}},
                    'required': ['to', 'body']}},
    {'name': 'open_url', 'description': 'Deschide o adresa in browserul utilizatorului',
     'parameters': {'type': 'object', 'properties': {'url': {'type': 'string'}}, 'required': ['url']}},
]}]

# Prompt de sistem LUNG, ca cel real, cu un detaliu unic ingropat la mijloc.
_umplutura = 'Esti Kelion, asistentul lui Adrian. Raspunzi scurt, in romana, si folosesti uneltele cand e nevoie. '
SYS_LUNG = (_umplutura * 25 + 'Codul de sala al depozitului este QX-7734. ' + _umplutura * 25)

COD_CU_BUG = """1  function ultimulElement(a) {
2    if (!a) return null
3    let i = 0
4    let ultim = null
5    while (i <= a.length) {
6      ultim = a[i]
7      i++
8    }
9    return ultim
10 }"""

def primul_numar(t):
    m = re.search(r'-?\d+', (t or '').replace('.', '').replace(',', ''))
    return int(m.group()) if m else None

def cuvinte(t):
    return [w for w in re.sub(r'[^\wăâîșşțţĂÂÎȘŞȚŢ ]', ' ', (t or '')).split() if w]

def cod_din(t):
    """Scoate codul dintre ``` daca modelul a pus garduri; altfel textul brut.
       Eticheta de limbaj era prinsa doar pentru 'python' — la ```json ramanea
       cuvantul 'json' lipit de continut. Acum se accepta orice eticheta."""
    m = re.search(r'```[a-zA-Z0-9_+-]*\s*(.*?)```', t or '', re.S)
    return (m.group(1) if m else (t or '')).strip()

def ruleaza_functia(cod):
    """Executa codul DOAR daca e o functie pura: fara import, fara acces la
       fisiere/sistem, fara nume magice. Un cod care nu trece filtrul e picat,
       nu rulat — nu execut orice pe serverul lui Adrian."""
    interzis = ('import', '__', 'open(', 'exec(', 'eval(', 'compile(', 'globals', 'locals',
                'subprocess', 'socket', 'os.', 'sys.')
    if any(x in cod for x in interzis): return False, 'cod refuzat de filtrul de siguranta'
    ns = {'__builtins__': {'len': len, 'max': max, 'min': min, 'sorted': sorted, 'range': range,
                           'str': str, 'list': list, 'enumerate': enumerate, 'sum': sum}}
    try:
        exec(cod, ns)
        f = ns.get('f')
        if not callable(f): return False, 'nu a definit f'
        # A treia intrare e cea care CONTEAZA: doua cuvinte DIFERITE de aceeasi
        # lungime. Prima varianta a probei avea aici 'egal egal' — cu doua cuvinte
        # identice, regula „la egalitate, primul" nu se putea verifica deloc, si o
        # implementare gresita (sorted(...)[-1]) trecea. Cu 'abc xyz', trece doar
        # cine chiar pastreaza primul.
        for intrare, asteptat in (('ana are mere', 'mere'), ('a bb ccc dd', 'ccc'),
                                  ('abc xyz', 'abc'), ('ccc a bb', 'ccc')):
            if f(intrare) != asteptat: return False, f'f({intrare!r}) != {asteptat!r}'
        return True, ''
    except Exception as e:
        return False, f'a crapat: {str(e)[:40]}'

# ── CELE 10 SARCINI ──────────────────────────────────────────────────────────
# Fiecare: cum se cere (cerere) si cum se verifica (verifica) — automat, exact.

def s_bug(m):
    a, _ = post(m, {'contents': [{'role': 'user', 'parts': [{'text':
        f'Codul de mai jos intoarce mereu `undefined` in loc de ultimul element.\n\n{COD_CU_BUG}\n\n'
        'Pe ce linie e greseala? Raspunde DOAR cu numarul liniei, nimic altceva.'}]}],
        'generationConfig': {'maxOutputTokens': 8192, 'thinkingConfig': gandire(m)}})
    return primul_numar(txt(a)) == 5, txt(a)[:40]

def s_rationament(m):
    a, _ = post(m, {'contents': [{'role': 'user', 'parts': [{'text':
        'Un server proceseaza 3 cereri pe secunda. La 09:00 sunt 4 servere pornite. La fiecare 20 de minute '
        'se adauga inca un server, care incepe sa lucreze exact in minutul adaugarii. Cate cereri s-au '
        'procesat in total intre 09:00 si 10:00? Raspunde DOAR cu numarul.'}]}],
        'generationConfig': {'maxOutputTokens': 8192, 'thinkingConfig': gandire(m)}})
    return primul_numar(txt(a)) == 54000, txt(a)[:40]

def s_json(m):
    a, _ = post(m, {'contents': [{'role': 'user', 'parts': [{'text':
        'Raspunde DOAR cu un obiect JSON valid, fara text in jur si fara garduri de cod, cu exact aceste '
        'chei: "oras" (string) = Bucuresti, "populatie" (numar intreg) = 1716961, "capitala" (boolean) = true.'}]}],
        'generationConfig': {'maxOutputTokens': 8192, 'thinkingConfig': gandire(m)}})
    # STRICT, INTENTIONAT: cererea spune „fara garduri de cod". Deci se parseaza
    # textul BRUT — cine pune ``` a incalcat instructiunea, si exact asta masoara
    # sarcina. (Prima varianta scotea gardurile inainte de parsare, adica ierta
    # fix greseala pe care o testa — si o ierta inconsecvent, doar la ```python.)
    try:
        o = json.loads(txt(a).strip())
        ok = o.get('oras') == 'Bucuresti' and o.get('populatie') == 1716961 and o.get('capitala') is True
        return ok, str(o)[:40]
    except Exception:
        return False, txt(a)[:40].replace('\n', '\\n')

def s_unealta(m):
    a, _ = post(m, {'contents': [{'role': 'user', 'parts': [{'text':
        'Cati utilizatori s-au inregistrat luna trecuta? Datele sunt in baza noastra de date.'}]}],
        'tools': UNELTE_4, 'generationConfig': {'maxOutputTokens': 8192, 'thinkingConfig': gandire(m)}})
    ap = apeluri(a)
    return bool(ap) and ap[0]['name'] == 'db_query', (ap[0]['name'] if ap else 'niciun apel')

def s_fara_unealta(m):
    a, _ = post(m, {'contents': [{'role': 'user', 'parts': [{'text':
        'Explica-mi in doua propozitii ce inseamna latenta intr-o aplicatie web.'}]}],
        'tools': UNELTE_4, 'generationConfig': {'maxOutputTokens': 8192, 'thinkingConfig': gandire(m)}})
    ap = apeluri(a)
    return (not ap) and len(txt(a)) > 20, (ap[0]['name'] if ap else f'{len(txt(a))}c')

def s_recall(m):
    a, _ = post(m, {'systemInstruction': {'parts': [{'text': SYS_LUNG}]},
        'contents': [{'role': 'user', 'parts': [{'text': 'Care e codul de sala al depozitului?'}]}],
        'generationConfig': {'maxOutputTokens': 8192, 'thinkingConfig': gandire(m)}})
    return 'QX-7734' in txt(a).upper(), txt(a)[:40]

def s_fara_inventie(m):
    a, _ = post(m, {'systemInstruction': {'parts': [{'text': SYS_LUNG}]},
        'contents': [{'role': 'user', 'parts': [{'text':
            'Conform STRICT instructiunilor tale de sistem, care e numarul de telefon al depozitului?'}]}],
        'generationConfig': {'maxOutputTokens': 8192, 'thinkingConfig': gandire(m)}})
    t = txt(a)
    # CE MASURAM DE FAPT: a inventat un numar sau nu. Prima varianta cerea in plus
    # ca refuzul sa fie formulat cu anumite verbe („nu apare/nu exista/nu am") si
    # pica raspunsuri perfect corecte ca „instructiunile mele NU CONTIN un numar"
    # sau „NU MENTIONEAZA" — adica modelul facea exact ce trebuie si eu il taiam.
    # Acum: pica DOAR daca a scos un numar de telefon din burta (>= 6 cifre).
    numere = re.findall(r'(?:\+?\d[\d .\-()]{4,}\d|\b\d{6,}\b)', t)
    inventat = any(len(re.sub(r'\D', '', n)) >= 6 for n in numere)
    neaga = bool(re.search(r'\bnu\b', t, re.I))
    return (not inventat) and neaga and len(t) > 5, t[:40]

def s_format(m):
    a, _ = post(m, {'contents': [{'role': 'user', 'parts': [{'text':
        'Descrie ce face soarele folosind EXACT trei cuvinte. Fara punctuatie, fara alte explicatii.'}]}],
        'generationConfig': {'maxOutputTokens': 8192, 'thinkingConfig': gandire(m)}})
    w = cuvinte(txt(a))
    return len(w) == 3, ' '.join(w)[:40]

def s_cod(m):
    a, _ = post(m, {'contents': [{'role': 'user', 'parts': [{'text':
        'Scrie o functie Python numita `f(s)` care primeste un sir de cuvinte separate prin spatiu si '
        'intoarce cel mai lung cuvant; la egalitate, primul aparut. Fara import, fara explicatii, DOAR codul.'}]}],
        'generationConfig': {'maxOutputTokens': 8192, 'thinkingConfig': gandire(m)}})
    ok, motiv = ruleaza_functia(cod_din(txt(a)))
    return ok, (motiv or 'trece testele')[:40]

LANT_CERERE = {'role': 'user', 'parts': [{'text':
    'Cauta pe internet care e capitala Australiei, apoi trimite rezultatul pe email la adrian@example.com.'}]}

def lant_pasi(m, pastreaza_semnatura=True):
    """Tura reala cu doua unelte. `pastreaza_semnatura` exista ca sa se poata
       proba A/B exact ce cere API-ul la replay — vezi diagnosticul de la final."""
    cfg = {'maxOutputTokens': 8192, 'thinkingConfig': gandire(m)}
    a, e1 = post(m, {'contents': [LANT_CERERE], 'tools': UNELTE_4, 'generationConfig': cfg})
    parti = parti_apel(a)
    if not parti or parti[0]['functionCall']['name'] != 'web_search':
        return False, f'pasul 1: {(parti[0]["functionCall"]["name"] if parti else (e1 or "niciun apel"))}'
    p0 = dict(parti[0]) if pastreaza_semnatura else {'functionCall': parti[0]['functionCall']}
    b, e2 = post(m, {'contents': [LANT_CERERE,
        {'role': 'model', 'parts': [p0]},
        {'role': 'user', 'parts': [{'functionResponse': {'name': 'web_search',
            'response': {'rezultat': 'Capitala Australiei este Canberra.'}}}]}],
        'tools': UNELTE_4, 'generationConfig': cfg})
    ap2 = apeluri(b)
    if not ap2 or ap2[0]['name'] != 'send_email':
        # EROAREA SE ARATA, nu se inghite. Prima varianta scria doar „niciun apel",
        # ceea ce arunca vina pe model cand de fapt cererea fusese respinsa cu 400.
        return False, f'pasul 2: {(ap2[0]["name"] if ap2 else (e2 or "niciun apel"))}'
    return 'canberra' in json.dumps(ap2[0].get('args', {})).lower(), 'ambii pasi'

def s_lant(m): return lant_pasi(m, True)

SARCINI = [('bug-linie', s_bug), ('rationament', s_rationament), ('json-strict', s_json),
           ('unealta-corecta', s_unealta), ('fara-unealta', s_fara_unealta), ('recall-lung', s_recall),
           ('fara-inventie', s_fara_inventie), ('format-exact', s_format), ('cod-executabil', s_cod),
           ('lant-unelte', s_lant)]
RULARI = 2

def probeaza(m):
    scor, timpi, detaliu = 0, [], {}
    for nume, fn in SARCINI:
        treceri = 0
        for _ in range(RULARI):
            t0 = time.time()
            try: ok, nota = fn(m)
            except Exception as e: ok, nota = False, str(e)[:40]
            timpi.append(int((time.time() - t0) * 1000))
            if ok: treceri += 1; scor += 1
        detaliu[nume] = (treceri, nota)
    return {'model': m, 'scor': scor, 'ms': int(statistics.median(timpi)), 'max': max(timpi), 'det': detaliu}

print(f'Proba de CALITATE pe {len(MODELE)} modele x {len(SARCINI)} sarcini x {RULARI} rulari '
      f'= {len(MODELE)*len(SARCINI)*RULARI} cereri. Gandire: high.\n')
with ThreadPoolExecutor(max_workers=4) as ex: rez = list(ex.map(probeaza, MODELE))
rez.sort(key=lambda r: (-r['scor'], r['ms']))

TOTAL = len(SARCINI) * RULARI
print('=' * 104)
print(f"{'MODEL':<28}{'SCOR':<10}{'timp median':<14}{'cel mai lent':<15}{'unde a picat'}")
print('=' * 104)
for r in rez:
    picate = [n for n, (t, _) in r['det'].items() if t < RULARI]
    print(f"{r['model']:<28}{str(r['scor'])+'/'+str(TOTAL):<10}{str(r['ms'])+' ms':<14}"
          f"{str(r['max'])+' ms':<15}{', '.join(picate) if picate else '— nimic'}")
print('=' * 104)

print('\nDETALIU (cate din cele 2 rulari au trecut, si ce a raspuns ultima data):')
for r in rez:
    print(f"\n  {r['model']}  —  {r['scor']}/{TOTAL}")
    for nume, _ in SARCINI:
        t, nota = r['det'][nume]
        print(f"    {'OK ' if t == RULARI else ('1/2' if t else 'PICA')}  {nume:<18} {nota}")

# ── DIAGNOSTIC A/B: SEMNATURA DE GANDIRE (7 aug) ─────────────────────────────
# La prima rulare, pasul 2 al lantului de unelte a picat la TOATE modelele 3.x si
# a trecut la 2.5. Cand 7 din 8 pica la fel, primul suspect e proba, nu modelele —
# si asa a fost: retrimiteam doar `functionCall`, fara `thoughtSignature`.
# Aici se probeaza A/B, pe acelasi model, aceeasi cerere: o data CU semnatura,
# o data FARA. Diferenta dintre cele doua linii e dovada, cu eroarea la vedere.
#
# DE CE CONTEAZA DINCOLO DE PROBA: `geminiDirect.ts` capteaza semnatura (linia
# 253, cu comentariul „Gemini 3.x cere semnatura inapoi la replay") dar NU o
# trimite inapoi cand reconstruieste cererea (linia 171). Daca A/B-ul de mai jos
# arata ce cred eu ca arata, atunci ORICE sarcina in doi pasi cu unelte e rupta
# in aplicatie pe modelele 3.x — adica exact pe ce e acum chatul.
print('\n\n' + '=' * 104)
print('DIAGNOSTIC — semnatura de gandire la replay (CU vs FARA), pe acelasi model si aceeasi cerere')
print('=' * 104)
for m in [x for x in MODELE if not re.search(r'gemini-2\.5', x)][:3] + \
         [x for x in MODELE if re.search(r'gemini-2\.5', x)][:1]:
    cu_ok, cu_nota = lant_pasi(m, True)
    fara_ok, fara_nota = lant_pasi(m, False)
    print(f"  {m}")
    print(f"      CU semnatura : {'TRECE' if cu_ok else 'PICA'}  — {cu_nota}")
    print(f"      FARA         : {'TRECE' if fara_ok else 'PICA'}  — {fara_nota}")
print('=' * 104)

print('\n' + '=' * 104)
best = rez[0]
print(f">>> CEL MAI BUN LA CALITATE: {best['model']} — {best['scor']}/{TOTAL}, timp median {best['ms']} ms")
egali = [r for r in rez if r['scor'] == best['scor']]
if len(egali) > 1:
    rapid = min(egali, key=lambda r: r['ms'])
    print(f">>> LA SCOR EGAL ({best['scor']}/{TOTAL}), CEL MAI RAPID: {rapid['model']} — {rapid['ms']} ms median")
print('\nCE NU MASOARA proba asta, ca sa nu se citeasca mai mult decat scrie: stilul, tonul,')
print('si sarcinile lungi de tip agent (zeci de pasi cu unelte). Masoara exact cele 10 lucruri')
print('de mai sus, fiecare cu verificare automata — niciun punct nu vine dintr-o parere.')
print('=' * 104)
