#!/usr/bin/env bash
# PROBA MODELELOR — gândește sau nu gândește, măsurat, în afara lui Kelion.
#
# Adrian, 31 iul: „ești convins că întoarce goale? poți face proba în afara
# Kelion și să demonstrezi asta?" — apoi, după o primă variantă slabă:
# „nu simulate, eu vreau model să raționeze, să gândească" și „vreau să știu
# sigur CE ÎNTOARCE".
#
# Prima variantă cerea modelului să răspundă „MERGE". Aia dovedea că e viu, nu
# că gândește — deci nu dovedea nimic util. Acum primește TREI probe cu răspuns
# exact, verificabil mecanic, și se tipărește RĂSPUNSUL LUI, nu doar verdictul.
#
# DE CE EXISTĂ: catalogul spune ce EXISTĂ, nu ce FUNCȚIONEAZĂ. Pe 31 iul,
# `nemotron-3-super-120b:free` arăta impecabil pe hârtie (120B, 262k, unelte) și
# întorcea HTTP 200 gol la 11 ordine din 11. Eu îi recomandam Ultra toată ziua
# din aceeași fișă tehnică — adică exact felul de dovadă care ne păcălise deja.
#
# „În afara Kelion", literal: curl direct la OpenRouter. Fără backend, fără
# orchestrator, fără nicio unealtă de-a lui pe traseu. Dacă un model pică aici,
# pică oriunde; dacă merge aici, vinovată e aplicația, nu modelul.
#
# RULARE PE VPS (acolo e cheia — nu trebuie scrisă nicăieri):
#   bash /root/kelion/repo/deploy/proba-modele.sh
# Oriunde altundeva, cu cheia în mediu:
#   OPENROUTER_API_KEY=... bash deploy/proba-modele.sh
# Un singur model:
#   bash deploy/proba-modele.sh nvidia/nemotron-3-ultra-550b-a55b:free
# Trimite tabelul pe email (folosit de deploy.sh):
#   bash deploy/proba-modele.sh --email
set -u

EMAIL=0
ARGS=()
for a in "$@"; do [ "$a" = "--email" ] && EMAIL=1 || ARGS+=("$a"); done

ENVFILE=${ENVFILE:-/root/kelion/kelionai.env}
KEY=${OPENROUTER_API_KEY:-}
[ -z "$KEY" ] && KEY=$(grep -E '^OPENROUTER_(API_)?KEY=' "$ENVFILE" 2>/dev/null | head -1 | cut -d= -f2-)
if [ -z "$KEY" ]; then
  echo "Fără cheie OpenRouter. Pune OPENROUTER_API_KEY în mediu sau rulează pe VPS ($ENVFILE)."
  exit 2
fi

# Lista din CATALOGUL LIVE, nu scrisă de mână: un id inventat ar da 404 și ar
# arăta exact ca un model defect. Doar gratuite, doar cu unelte declarate.
if [ ${#ARGS[@]} -gt 0 ]; then
  MODELE="${ARGS[*]}"
else
  MODELE=$(curl -s -m 30 https://openrouter.ai/api/v1/models | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)["data"]
except Exception:
    sys.exit(0)
for m in d:
    if m["id"].endswith(":free") and "tools" in (m.get("supported_parameters") or []):
        print(m["id"], m.get("context_length") or 0)
' | sort -k2 -nr | awk '{print $1}')
fi
[ -z "$MODELE" ] && { echo "n-am putut citi catalogul"; exit 1; }

# ── CELE TREI PROBE ─────────────────────────────────────────────────────────
# Fiecare are UN singur răspuns corect, verificabil fără judecată de-a mea.
#
# 1. RAȚIONAMENT ÎN PAȘI. Aritmetică pe ceas + fus orar. Nu se poate ghici din
#    tipar: trebuie ținute trei lucruri în cap și adunate în ordine.
#    14:35 + 3h50m = 18:25; +2h fus = 20:25.
P1='Un tren pleaca la 14:35 si merge 3 ore si 50 de minute. Destinatia e intr-un fus orar cu 2 ore INAINTE. La ce ora LOCALA ajunge? Gandeste pas cu pas, apoi scrie pe ultima linie doar ora, in formatul HH:MM.'
A1='20:25'
# 2. CAPCANĂ DE LOGICĂ. „Toți A sunt B, unii B sunt C" NU implică „unii A sunt
#    C". Un model care merge pe tipar răspunde DA. Unul care raționează, NU.
P2='Toate pisicile sunt animale. Unele animale sunt maro. Rezulta LOGIC ca unele pisici sunt maro? Explica scurt, apoi scrie pe ultima linie doar DA sau NU.'
A2='NU'
# 3. CITIT DE COD. Trebuie urmărit ce face codul, nu ce pare să facă.
#    [1,2,3] filtrat > 1 → [2,3]; map *2 → [4,6]; sumă = 10.
P3='In JavaScript: const a=[1,2,3]; const b=a.filter(x=>x>1).map(x=>x*2); console.log(b.reduce((s,x)=>s+x,0)); Ce se afiseaza? Gandeste, apoi scrie pe ultima linie doar numarul.'
A3='10'
# 4. PROBA GREA (Adrian: „dă-i ceva extrem de greu și complicat și vezi cum
#    abordează"). Trei constrângeri care se leagă între ele, plus una de
#    divizibilitate — nu se poate ghici, nu se poate scoate din memorie, și
#    trebuie căutat sistematic prin cazuri.
#    h = 2u ; h+t+u = 12  →  t = 12−3u ; numărul divizibil cu 4.
#    u=1→291 (nu) · u=2→462 (nu) · u=3→633 (nu) · u=4→804 (804/4=201, DA)
#    u=0 ar da h=0, deci n-ar mai fi număr de trei cifre. Soluție UNICĂ: 804.
#    Un model care „sare la răspuns" ratează; unul care enumerează, nimerește.
P4='Gaseste TOATE numerele naturale de exact 3 cifre care indeplinesc simultan: (a) suma cifrelor este 12; (b) cifra sutelor este dublul cifrei unitatilor; (c) numarul este divizibil cu 4. Arata rationamentul complet, caz cu caz. Pe ultima linie scrie doar numerele gasite, separate prin virgula.'
A4='804'

cere() { # model, prompt
  curl -s -m 120 https://openrouter.ai/api/v1/chat/completions \
    -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
    -d "$(python3 -c '
import json, sys
print(json.dumps({
  "model": sys.argv[1],
  "max_tokens": 2000,
  # Raționamentul se cere EXPLICIT: modelele cu gândire internă nu gândesc
  # decât dacă li se spune, iar fără el proba ar măsura altceva.
  "reasoning": {"effort": "medium"},
  "usage": {"include": True},
  "messages": [{"role": "user", "content": sys.argv[2]}],
}))' "$1" "$2")" 2>/dev/null
}

REZULTAT=$(
printf "%-48s %5s %6s %5s %5s %6s %8s  %s\n" MODEL CEAS LOGICA COD GREA SCOR GANDIRE "ULTIMA LINIE INTOARSA"
printf '%.0s─' $(seq 1 120); echo

for M in $MODELE; do
  R1=$(cere "$M" "$P1"); R2=$(cere "$M" "$P2"); R3=$(cere "$M" "$P3"); R4=$(cere "$M" "$P4")
  # CUM ABORDEAZĂ, nu doar ce nimerește (Adrian: „vezi cum abordează"): când se
  # probează UN singur model, se tipărește raționamentul lui întreg la proba
  # grea. Pe toate mododelele deodată ar fi un zid de text, deci acolo doar tabel.
  DETALIU=0; [ ${#ARGS[@]} -eq 1 ] && DETALIU=1
  MODEL="$M" AW1="$A1" AW2="$A2" AW3="$A3" AW4="$A4" DETALIU="$DETALIU" python3 -c '
import json, os, sys, re

def citeste(raw):
    """(text, tokeni_gandire, eroare) — la esec spune EROARE, nu inventeaza."""
    try:
        j = json.loads(raw)
    except Exception:
        return "", 0, "raspuns neparsabil"
    if isinstance(j, dict) and "error" in j:
        err = j["error"]
        return "", 0, str(err.get("message", err) if isinstance(err, dict) else err)[:44]
    ch = (j.get("choices") or [{}])[0]
    msg = ch.get("message") or {}
    txt = (msg.get("content") or "").strip()
    u = j.get("usage") or {}
    gand = u.get("completion_tokens_details", {}).get("reasoning_tokens") or 0
    if not txt and not gand:
        return "", 0, ""   # 200 gol — cazul super-120b
    return txt, gand, ""

def ultima(t):
    linii = [l.strip() for l in t.splitlines() if l.strip()]
    return linii[-1] if linii else ""

def corect(t, asteptat):
    if not t: return "GOL"
    # Curatam ornamentele (punct, stelute, ghilimele, spatii) cu o expresie
    # regulata, NU cu strip pe o lista de caractere: lista ar trebui sa contina
    # un apostrof, iar apostroful inchide sirul shell in care traieste scriptul
    # asta. Un detaliu de sintaxa care a rupt fisierul o data deja.
    u = re.sub(r"[^A-Z0-9:,]", "", ultima(t).upper())
    if re.sub(r"[^A-Z0-9:,]", "", asteptat.upper()) in u: return "DA"
    # Poate a scris explicatia dupa raspuns — cautam si in ultimele 200 de car.
    return "DA" if asteptat.upper() in t[-200:].upper() else "NU"

t1, g1, e1 = citeste(sys.argv[1])
t2, g2, e2 = citeste(sys.argv[2])
t3, g3, e3 = citeste(sys.argv[3])
t4, g4, e4 = citeste(sys.argv[4])
er = e1 or e2 or e3 or e4
if er:
    print("%-48s %5s %5s %5s %5s %6s %8s  %s" % (os.environ["MODEL"], "?", "?", "?", "?", "-", "-", "EROARE: " + er))
else:
    c = [corect(t, os.environ[k]) for t, k in ((t1,"AW1"), (t2,"AW2"), (t3,"AW3"), (t4,"AW4"))]
    scor = sum(1 for x in c if x == "DA")
    gand = max(g1, g2, g3, g4)
    # CE INTOARCE, literal — cerinta lui: "vreau sa stiu sigur ce intoarce".
    proba = ultima(t4) or ultima(t1) or "(nimic)"
    print("%-48s %5s %5s %5s %5s %5d/4 %8s  %s" % (
        os.environ["MODEL"], c[0], c[1], c[2], c[3], scor,
        (str(gand) + "tk") if gand else "nu",
        proba[:36]))
    # CUM ABORDEAZA — rationamentul intreg la proba grea, cand se probeaza
    # un singur model. Asta a cerut: sa VADA cum lucreaza, nu doar daca nimereste.
    if os.environ.get("DETALIU") == "1":
        print()
        print("─" * 120)
        print("CUM A ABORDAT PROBA GREA (raspuns integral, netaiat):")
        print("─" * 120)
        print(t4 if t4 else "(nimic — model mut)")
        print("─" * 120)
        print("Raspuns corect: 804 (unic). Verificare: 8=2x4, 8+0+4=12, 804/4=201.")
' "$R1" "$R2" "$R3" "$R4"
done

echo
echo "CEAS   = 14:35 + 3h50m + 2h fus  → 20:25   (rationament in pasi)"
echo "LOGICA = «toate pisicile sunt animale, unele animale sunt maro» → NU   (capcana: tiparul zice DA)"
echo "COD    = [1,2,3].filter(>1).map(*2).reduce(+)  → 10   (citit de cod)"
echo "GANDIRE= tokeni de rationament intern raportati de furnizor"
echo
echo "Masurat direct la OpenRouter. Fara backendul Kelion pe traseu."
)

echo "$REZULTAT"

if [ "$EMAIL" = "1" ]; then
  BRIDGE=$(grep '^BRIDGE_SECRET=' "$ENVFILE" 2>/dev/null | head -1 | cut -d= -f2-)
  [ -n "$BRIDGE" ] && python3 -c '
import json, os, sys, urllib.request
corp = sys.stdin.read()
d = json.dumps({"key": "proba_modele", "subject": "[Kelion] Proba modelelor free: cine gandeste, cine nu",
                "body": corp}).encode()
r = urllib.request.Request("http://127.0.0.1:8080/api/ops/alert", data=d,
    headers={"content-type": "application/json", "x-bridge-secret": os.environ["B"]})
try:
    urllib.request.urlopen(r, timeout=15).read()
except Exception as e:
    print("email nereusit:", e)
' <<<"$REZULTAT" B="$BRIDGE" || true
fi
