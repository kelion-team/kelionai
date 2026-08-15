#!/usr/bin/env bash
# PORȚILE PE VPS — verificarea PR-urilor pe fierul lui Adrian.
#
# Adrian, 31 iul: „nu poți corecta modul de lucru, pică de fiecare dată" și
# „adică ce să fac, ce să primesc?".
#   Ce face el: nimic.
#   Ce primește: pe fiecare PR, un comentariu cu verdictul porților, scris de
#   mașina lui, care chiar a rulat testele.
#
# DE CE EXISTĂ: `pr-verify.yml` a picat de 31 de ori la rând, în 3-11 secunde,
# cu `runner_id: 0` și loguri 404 — GitHub Actions e blocat pe factura
# organizației. A picat pe cod, pe un fișier de configurare și pe un fișier de
# text deopotrivă. Roșul ăla nu spune nimic despre lucrare. Până se deblochează
# factura, singura dovadă că o lucrare e bună stă într-un mesaj de chat de la un
# AI, pe care Adrian trebuie să-l creadă pe cuvânt. Ăsta e modul de lucru defect,
# și el are dreptate să-l reproșeze.
#
# Tiparul e cel deja dovedit în casa asta: publicarea merge printr-un cron pe
# VPS care întreabă GitHub de sha-ul lui master — COMPLET independentă de
# Actions, motiv pentru care aplicația s-a publicat azi în timp ce CI-ul era
# mort. Aceeași idee, mutată de pe publicare pe verificare.
#
# Cost: zero. Mașina e plătită oricum, porțile nu cheamă niciun model AI.
#
# PROBĂ FĂRĂ SĂ PUBLICE NIMIC (rulabil oriunde, nu doar pe VPS):
#   PORTI_PR_USCAT=1 PORTI_PR_LOCAL=/cale/spre/repo deploy/porti-pr.sh
# Rulează porțile pe copia locală și tipărește raportul în loc să comenteze.
set -u

USCAT=${PORTI_PR_USCAT:-}      # 1 = nu comenta, doar tipărește
LOCAL=${PORTI_PR_LOCAL:-}      # cale de repo gata pregătit (probă); gol = pe VPS

REPO=/root/kelion/repo
LUCRU=/root/kelion/porti-pr
STARE=/root/kelion/porti-pr.vazute
LACAT=/root/kelion/porti-pr.lock
ENVFILE=/root/kelion/kelionai.env
GH=https://api.github.com/repos/kelion-team/kelionai

# ── PORȚILE ─────────────────────────────────────────────────────────────────
# Aceleași ca în .github/workflows/pr-verify.yml. Dacă acolo se adaugă una nouă,
# se adaugă și aici — altfel „TRECE" de pe VPS începe să mintă, iar un verdict
# care minte e mai rău decât niciun verdict.
ruleaza_portile() {
  local dir=$1
  R_TIPURI=PICĂ; R_TESTE=PICĂ; R_BUILD=PICĂ
  R_DUP=PICĂ; R_EXP=PICĂ; R_SINT=PICĂ; R_BOOT=PICĂ; R_BUT=PICĂ; R_LACAT=PICĂ; DETALII=''

  ( cd "$dir/backend" && { npm ci --no-audit --no-fund || npm install --no-audit --no-fund; } ) >/dev/null 2>&1
  ( cd "$dir/backend" && npx tsc --noEmit ) >/dev/null 2>&1 && R_TIPURI=TRECE

  local ies
  # Culorile ANSI se CURĂȚĂ înainte de orice verdict. Dovadă (2 aug, PR #661,
  # sha 47b70eb): vitest a scris „Tests 844 passed (844)" — dar colorat,
  # adică „Tests \e[22m \e[1m\e[32m844 passed", iar grep-ul de mai jos nu
  # vedea numărul după „Tests" prin coduri. Condiția de TRECE nu se putea
  # împlini NICIODATĂ pe ieșire colorată; doar cea de PICĂ trecea prin coduri.
  # Exact regula 1: o citire picată (sumar de neparsat) dădea verdict „PICĂ".
  ies=$( cd "$dir/backend" && npx vitest run 2>&1 | tail -30 | sed 's/\x1b\[[0-9;]*m//g' )
  # „passed" ȘI zero „failed": un fișier picat printre 40 verzi tot e PICĂ.
  if echo "$ies" | grep -qE '^\s*Tests +[0-9]+ passed' && ! echo "$ies" | grep -qiE '[0-9]+ failed'; then
    R_TESTE=TRECE
  fi
  DETALII=$(echo "$ies" | grep -E 'Test Files|Tests ' | sed 's/  */ /g; s/^ //' | tr '\n' ' ')

  ( cd "$dir/frontend" && npm install --no-audit --no-fund ) >/dev/null 2>&1
  ( cd "$dir/frontend" && npm run build ) >/dev/null 2>&1 && R_BUILD=TRECE

  ( cd "$dir" && npx --yes jscpd --threshold 0.0001 ) >/dev/null 2>&1 && R_DUP=TRECE
  ( cd "$dir" && node scripts/verifica-exporturi.mjs ) >/dev/null 2>&1 && R_EXP=TRECE
  ( cd "$dir" && node scripts/verifica-sintaxa.mjs ) >/dev/null 2>&1 && R_SINT=TRECE
  # DOUĂ PORȚI CARE LIPSEAU, prinse pe viu în 14 aug (noaptea): (1) bara de
  # deploy din #1122 a intrat pe master cu AMBELE apeluri în gol (rute fără
  # prefix) și verdictul a fost TRECE — verifica-butoane ar fi prins-o; (2)
  # lacătul Gemini a zăcut CRĂPAT pe master (ReferenceError la orice rulare,
  # din merge-ul 83167b36) și tot TRECE se posta — lacătul nu rula nicăieri
  # în poarta asta. Ce nu se măsoară aici nu există pentru verdict.
  ( cd "$dir" && node scripts/verifica-butoane.mjs ) >/dev/null 2>&1 && R_BUT=TRECE
  ( cd "$dir" && node scripts/verifica-gemini.mjs ) >/dev/null 2>&1 && R_LACAT=TRECE

  # BOOTUL PE DIST, CU NODE CURAT — poarta care lipsea când a căzut producția
  # (2 aug, 93be3a6): un ciclu de importuri a omorât bootul cu ReferenceError,
  # iar tsc + vitest + build erau TOATE verzi — transformele lor de module nu
  # sunt Node-ul containerului. Singura dovadă că aplicația chiar pornește e
  # să o pornești: build de emisie + `node dist/index.js` pe un port liber;
  # „Server listening" în 20s = TRECE. Fără env — aplicația pornește și goală
  # (dovedit), iar poarta măsoară BOOTUL, nu configurarea.
  R_BOOT=PICĂ
  if ( cd "$dir/backend" && npm run build ) >/dev/null 2>&1; then
    # 2 încercări × 45s, nu una × 20s: primul boot de după un build proaspăt
    # încarcă tot graful de module LA RECE — măsurat (15 aug, 03:35): 1 atârnare
    # mută din 13 booturi locale, fix pe primul de după build; poarta rulează
    # MEREU exact cazul ăsta (clonă+ci+build reci), pe mașina pe care lucrează
    # simultan și constructorul. 20s măsura frigul mașinii, nu bootul — PICĂ
    # fals pe #1142 cu tsc+teste+build toate verzi. O aplicație chiar ruptă
    # (ciclul de importuri din 2 aug) pică și din 2 încercări a 45s.
    # 3 ÎNCERCĂRI, nu 2 (15 aug, după-amiaza): TREI PICĂ false într-o singură
    # zi (b1e5126, 9689fbb, 79055bb) — de fiecare dată 9/9 restul verzi și
    # bootul local TRECE din PRIMA cu exact comanda asta; VPS-ul duce simultan
    # constructorul + poarta + deploy-ul, iar 2×45s tot pierdea booturi reci
    # sub sarcină. O aplicație chiar ruptă pică identic și din 3.
    for _incercare in 1 2 3; do
      ( cd "$dir/backend" && PORT=18099 timeout 45 node dist/index.js 2>&1 | grep -qm1 'Server listening' ) && { R_BOOT=TRECE; break; }
    done
  fi

  # ── P19: SE DESCHIDE ÎN BROWSER, NU DOAR PORNEȘTE (owner, 15 aug: „nu te
  # comporți ca un QA inginer soft, și nu livrezi aplicația reparată") ────────
  # Până azi porțile dovedeau că aplicația compilează și pornește — nimeni n-o
  # DESCHIDEA într-un browser înainte de merge; primele ochi pe pagină erau ai
  # ownerului. Acum: instanța bootează în fundal CU frontend-ul servit, iar
  # Chromium (Playwright, cache-uit pe gazdă) o deschide real: 200 + randare
  # (nu ecran alb) + zero erori de browser + /manual viu. Fără browser pe
  # mașina porții → NEPROBAT (spus, nu inventat) — nu blochează verdictul;
  # PICĂ (aplicația nu se deschide) blochează, exact ca restul porților.
  R_E2E=NEPROBAT
  if [ "$R_BOOT" = 'TRECE' ]; then
    ( cd "$dir/backend" && npx playwright install chromium ) >/dev/null 2>&1 || true
    # SERVESTE_FRONTEND=1: fără el, servirea SPA e oprită (doar config.isProd o
    # pornea, iar prod cere secretele pe care poarta nu le are) și pagina dă
    # 404 — ambele prinse chiar de primele rulări locale ale probei.
    ( cd "$dir/backend" && SERVESTE_FRONTEND=1 PORT=18099 FRONTEND_DIST="$dir/frontend/dist" node dist/index.js > "$dir/e2e-boot.log" 2>&1 & echo $! > "$dir/e2e.pid" )
    local _s
    for _s in $(seq 1 30); do
      grep -q 'Server listening' "$dir/e2e-boot.log" 2>/dev/null && break
      sleep 1
    done
    if grep -q 'Server listening' "$dir/e2e-boot.log" 2>/dev/null; then
      ( cd "$dir/backend" && SMOKE_URL=http://127.0.0.1:18099 timeout 90 node e2e-smoke.mjs ) > "$dir/e2e.log" 2>&1
      local cod_e2e=$?
      if [ "$cod_e2e" -eq 0 ]; then R_E2E=TRECE
      elif [ "$cod_e2e" -eq 2 ]; then R_E2E=NEPROBAT
      else R_E2E=PICĂ; fi
    fi
    kill "$(cat "$dir/e2e.pid" 2>/dev/null)" >/dev/null 2>&1 || true
    rm -f "$dir/e2e.pid"
  fi

  VERDICT=TRECE
  local r
  for r in "$R_TIPURI" "$R_TESTE" "$R_BUILD" "$R_DUP" "$R_EXP" "$R_SINT" "$R_BOOT" "$R_BUT" "$R_LACAT" "$R_E2E"; do
    [ "$r" = 'PICĂ' ] && VERDICT=PICĂ
  done
}

# ── RAPORTUL ────────────────────────────────────────────────────────────────
# Scrie CE s-a măsurat și DE UNDE vine verdictul. Un „TRECE" care nu spune pe ce
# mașină a rulat e exact genul de verdict nemăsurat care ne-a costat (regula 1).
scrie_raportul() {
  local sha=$1
  ico() { [ "$1" = 'TRECE' ] && printf '✅' || printf '❌'; }
  cat <<RAPORT
## Porți rulate pe VPS — \`${sha:0:7}\`

| poartă | rezultat |
|---|---|
| backend — \`tsc --noEmit\` | $(ico "$R_TIPURI") $R_TIPURI |
| backend — \`vitest run\` | $(ico "$R_TESTE") $R_TESTE |
| backend — bootul pe \`dist\` (Node curat) | $(ico "$R_BOOT") $R_BOOT |
| frontend — \`npm run build\` | $(ico "$R_BUILD") $R_BUILD |
| cod duplicat (jscpd) | $(ico "$R_DUP") $R_DUP |
| exporturi fără utilizator | $(ico "$R_EXP") $R_EXP |
| sintaxă CSS + JSON | $(ico "$R_SINT") $R_SINT |
| butoane ↔ rute (frontend ↔ backend) | $(ico "$R_BUT") $R_BUT |
| lacătul Gemini | $(ico "$R_LACAT") $R_LACAT |
| se deschide în browser (E2E Chromium) | $([ "$R_E2E" = 'TRECE' ] && printf '✅' || { [ "$R_E2E" = 'NEPROBAT' ] && printf '⚪' || printf '❌'; }) $R_E2E |

**VERDICT: $VERDICT**

<sub>$DETALII</sub>

---

Rulat pe VPS-ul propriu, nu pe GitHub Actions — acolo jobul moare în 3-11
secunde cu \`runner_id: 0\` și loguri 404, fiindcă facturarea organizației e
blocată. Verificarea asta nu depinde de ea și nu costă nimic în plus.

---
_Generated by [Claude Code](https://claude.ai/code)_
RAPORT
}

# ── PROBĂ USCATĂ ────────────────────────────────────────────────────────────
# Rulează porțile pe o copie locală și tipărește raportul. Nu atinge GitHub, nu
# atinge VPS-ul. Există ca scriptul să poată fi DOVEDIT, nu doar scris.
if [ -n "$USCAT" ]; then
  [ -z "$LOCAL" ] && { echo "PORTI_PR_USCAT cere și PORTI_PR_LOCAL=/cale/spre/repo"; exit 2; }
  ruleaza_portile "$LOCAL"
  scrie_raportul "$(git -C "$LOCAL" rev-parse HEAD 2>/dev/null || echo 0000000)"
  exit 0
fi

TOKEN=$(grep '^GITHUB_TOKEN=' "$ENVFILE" 2>/dev/null | head -1 | cut -d= -f2-)
[ -z "$TOKEN" ] && { echo "fără GITHUB_TOKEN în $ENVFILE — nu pot citi PR-urile"; exit 0; }

# ── SINGUR PE RÂND ──────────────────────────────────────────────────────────
# `npm ci` + teste + build durează minute; cronul bate la 10. Fără lacăt, două
# rulări s-ar suprapune pe mașina care ține și producția.
exec 9>"$LACAT"
flock -n 9 || { echo "rulează deja o verificare — ies"; exit 0; }

# ── NU CĂLCĂM PRODUCȚIA ─────────────────────────────────────────────────────
# Verificarea e utilă, dar niciodată mai importantă decât aplicația care
# răspunde clienților. Mașină deja încărcată → amânăm; cronul revine.
# Pragul e pe media de 15 min, ca la services/resurse.ts și din același motiv:
# pe 1 minut ar sări la fiecare build și n-ar rula niciodată.
NUCLEE=$(nproc 2>/dev/null || echo 1)
INCARCARE=$(awk -v n="$NUCLEE" '{printf "%d", ($3/n)*100}' /proc/loadavg 2>/dev/null || echo 0)
if [ "${INCARCARE:-0}" -ge 200 ]; then
  echo "VPS încărcat ${INCARCARE}% — amân, revin la următorul cron"
  exit 0
fi

gh() { curl -s -m 30 -H "Authorization: Bearer $TOKEN" -H 'Accept: application/vnd.github+json' "$@"; }

# PR-urile deschise, „număr sha" pe linie. Parsat cu python3, NU cu grep: în
# JSON-ul unui PR sunt mai multe câmpuri `sha` (head, base, _links), iar un
# grep le-ar amesteca și am verifica alt commit decât cel din PR.
# claude/* se procesează PRIMELE în ciclu (15 aug, măsurat: lista GitHub vine
# „cel mai nou primul", deci PR-ul constructorului din același ciclu se gata și
# se ÎMBINA înaintea verdictului meu — PR-ul claude rămânea veșnic „în urmă",
# 5 depășiri la rând). Cu claude întâi: verdictul și fast-track-ul lui se
# execută pe master-ul de la începutul ciclului, iar constructorul — mașină,
# re-încearcă singur — se aduce la zi după, nu invers.
PRURI=$(gh "$GH/pulls?state=open&per_page=20" | python3 -c '
import json, sys
try:
    prs = list(json.load(sys.stdin))
    prs.sort(key=lambda p: 0 if str(p["head"]["ref"]).startswith("claude/") else 1)
    for p in prs:
        print(p["number"], p["head"]["sha"], p["head"]["ref"])
except Exception:
    pass
')
[ -z "$PRURI" ] && { echo "niciun PR deschis"; exit 0; }

touch "$STARE"

while read -r NUMAR SHA REF; do
  [ -z "${NUMAR:-}" ] && continue
  # Un sha se verifică o SINGURĂ dată. Altfel cronul ar comenta la fiecare 10
  # minute pe același commit — zgomot peste zgomot, exact ce-i reproșează
  # Adrian X-ului roșu.
  grep -qx "$SHA" "$STARE" && continue

  echo "── PR #$NUMAR @ ${SHA:0:7} ──"
  rm -rf "$LUCRU"; mkdir -p "$LUCRU"
  git -C "$LUCRU" init --quiet
  git -C "$LUCRU" remote add origin "https://x-access-token:$TOKEN@github.com/kelion-team/kelionai.git"
  # refs/pull/N/head e calea canonică: merge și dacă PR-ul vine din fork.
  if ! git -C "$LUCRU" fetch --quiet --depth 1 origin "refs/pull/$NUMAR/head"; then
    echo "nu pot aduce PR #$NUMAR"; continue
  fi
  git -C "$LUCRU" checkout --quiet FETCH_HEAD

  # Ce am adus chiar e ce credeam? Între listare și fetch poate apărea un push.
  ADUS=$(git -C "$LUCRU" rev-parse HEAD)
  if [ "$ADUS" != "$SHA" ]; then
    echo "PR #$NUMAR s-a mișcat ($SHA → $ADUS) — îl las pe următorul cron"; continue
  fi

  ruleaza_portile "$LUCRU"
  PAYLOAD=$(scrie_raportul "$SHA" | python3 -c 'import json,sys; print(json.dumps({"body": sys.stdin.read()}))')
  gh -X POST -H 'content-type: application/json' -d "$PAYLOAD" "$GH/issues/$NUMAR/comments" >/dev/null

  # ── VERDICTUL DEVINE UN CHECK PE PR, nu doar un comentariu (Adrian, 7 aug:
  # „aceleași fantome… nu repari?") ──────────────────────────────────────────
  # Până acum, singurele checkuri de pe PR erau cele două joburi GitHub Actions
  # care NU pornesc niciodată: măsurat pe run 31223561134 — `runner_id: 0`,
  # `runner_name` gol, job creat și terminat în 3 secunde, loguri 404. Nu e o
  # eroare de cod: niciun runner nu i s-a alocat vreodată (repo privat, minute
  # blocate). Rezultatul: PR-ul arăta ROȘU la fiecare push, cu notificări pe
  # telefonul ownerului, în timp ce verdictul ADEVĂRAT stătea într-un comentariu
  # mai jos. Acum verdictul real urcă și ca stare de commit, deci PR-ul arată
  # ce e — verde când porțile trec, roșu când chiar pică ceva.
  if [ "$VERDICT" = TRECE ]; then STARE_GH=success; else STARE_GH=failure; fi
  gh -X POST -H 'content-type: application/json' \
    -d "{\"state\":\"$STARE_GH\",\"context\":\"porti-vps\",\"description\":\"Porți rulate pe VPS: $VERDICT\",\"target_url\":\"https://github.com/kelion-team/kelionai/pull/$NUMAR\"}" \
    "$GH/statuses/$SHA" >/dev/null

  # ── AUTO-ÎMBINARE PE VERDE: CONSTRUCTOR ȘI CLAUDE (Adrian, 10 aug: „după ce
  # face PR să fie capabil să dea PR-ul; totul prin master"; EXTINS 15 aug la
  # claude/* prin DECIZIA ownerului — „Fast-track în poartă" — după livelock-ul
  # măsurat: 4 verdicte verzi la rând pe #1158 depășite de banda constructorului
  # în secundele dintre verdict și îmbinare; sub bandă 24/7, „claude/* le îmbină
  # omul" însemna „nu se îmbină niciodată") ────────────────────────────────────
  # Poarta REALĂ (asta) decide, nu Actions-ul mort: PR-ul (kelion/job-* sau
  # claude/*) se îmbină SINGUR doar când porțile trec PE SHA-UL LA ZI cu master
  # (garda behind_by de mai jos); unul rupt (VERDICT PICĂ) NU se poate îmbina.
  # Veto-ul ownerului rămâne întreg: pauza de operațiuni oprește toată banda,
  # iar anunțul santinelei în panou rămâne. PR-urile OMULUI nu se ating.
  case "$REF" in
    kelion/*|claude/*)
      if [ "$VERDICT" = TRECE ]; then
        # ── LA ZI CU MASTER ÎNAINTE DE ÎMBINARE (14 aug, noaptea: job-254 și
        # job-256, VERZI fiecare pe sha-ul LUI, au stivuit două declarații
        # `const zgomot` în logGazda.ts la îmbinarea textuală — master a rămas
        # NECOMPILABIL, iar poarta n-avea cum să vadă: rulase pe ramuri, nu pe
        # rezultatul îmbinării; același tipar rupsese și lacătul Gemini la
        # merge-ul 83167b36). Un PR rămas în urmă NU se mai îmbină orbește:
        # îl aducem la zi (update-branch) și ciclul următor re-rulează porțile
        # chiar pe rezultatul îmbinării (sha-ul nou). Master primește DOAR ce
        # s-a măsurat — „producția = master, 100% în sinc" cere exact asta.
        IN_URMA=$(gh "$GH/compare/master...$SHA" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("behind_by", 0))' 2>/dev/null || echo 0)
        case "$IN_URMA" in ''|*[!0-9]*) IN_URMA=0;; esac
        if [ "$IN_URMA" -gt 0 ]; then
          gh -X PUT -H 'content-type: application/json' -d '{}' "$GH/pulls/$NUMAR/update-branch" >/dev/null || true
          echo "PR #$NUMAR (constructor): verde dar cu $IN_URMA comituri ÎN URMA master → adus la zi; porțile re-rulează pe sha-ul nou la ciclul următor"
          # Sha-ul ăsta E procesat (gate + comentariu + stare) — îl însemnăm,
          # altfel un update-branch EȘUAT l-ar re-procesa la fiecare ciclu
          # (comentarii duplicate — exact zgomotul pe care fișierul îl previne).
          echo "$SHA" >> "$STARE"
          continue
        fi
        REZM=$(gh -X PUT -H 'content-type: application/json' -d '{"merge_method":"merge"}' "$GH/pulls/$NUMAR/merge")
        if echo "$REZM" | grep -q '"merged": *true'; then
          echo "PR #$NUMAR (constructor): VERDE → îmbinat automat în master"
        else
          # ── CONFLICTUL NU MAI ATÂRNĂ MUT (owner, 14 aug: „analizezi la maxim
          # ca să nu mai pice PR") ────────────────────────────────────────────
          # Cazul văzut LIVE la #1103: ROIUL a născut mai multe PR-uri pe
          # aceeași cauză; primul îmbinat mută master-ul, frații rămân în
          # CONFLICT — verzi pe porți, dar neîmbinabili — și atârnau deschiși
          # PE VECI, fără niciun semn (poarta procesează un sha o singură
          # dată). De-acum: dacă GitHub spune „mergeable: false", PR-ul se
          # ÎNCHIDE cu motivul scris + calea de reluare (butonul «reia» al
          # ordinului reconstruiește pe master PROASPĂT — dacă fix-ul n-a
          # intrat deja prin fratele îmbinat). Eșecurile TRANZITORII (rate
          # limit, 5xx) NU închid nimic — rămân pentru owner, ca înainte.
          MERGEABLE=$(gh "$GH/pulls/$NUMAR" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("mergeable"))' 2>/dev/null)
          # Închiderea-pe-conflict e DOAR pentru roiul constructorului (frații
          # aceluiași val, cu butonul «reia»); un claude/* în conflict se LASĂ
          # deschis — îl unește sesiunea/omul cu ochii, nu-l aruncă nimeni.
          case "$REF" in claude/*) MERGEABLE=lasat ;; esac
          if [ "$MERGEABLE" = "False" ]; then
            CORP="Porțile au trecut, dar PR-ul e în CONFLICT cu master (alt PR a intrat între timp — de obicei un frate din același val de auto-vindecare care a rezolvat deja cauza). Îl închid ca să nu atârne mut.\n\nDacă fix-ul ăsta chiar mai e necesar: apasă «reia» pe ordinul lui în panoul Constructor — se reconstruiește pe master proaspăt și vine ca PR nou, îmbinabil.\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_"
            PAYLOAD_C=$(python3 -c 'import json,sys; print(json.dumps({"body": sys.argv[1].replace("\\n", "\n")}))' "$CORP")
            gh -X POST -H 'content-type: application/json' -d "$PAYLOAD_C" "$GH/issues/$NUMAR/comments" >/dev/null
            gh -X PATCH -H 'content-type: application/json' -d '{"state":"closed"}' "$GH/pulls/$NUMAR" >/dev/null
            echo "PR #$NUMAR (constructor): verde dar în CONFLICT cu master → închis cu motiv + calea de reluare"
          else
            echo "PR #$NUMAR (constructor): verde, dar îmbinarea a eșuat tranzitoriu (rămâne pentru owner): $(echo "$REZM" | tr -d '\n' | head -c 140)"
          fi
        fi
      else
        echo "PR #$NUMAR (constructor): VERDICT PICĂ → NU se îmbină, rămâne deschis cu problema anunțată"
      fi
      ;;
  esac

  echo "$SHA" >> "$STARE"
  echo "PR #$NUMAR: $VERDICT (comentat + stare $STARE_GH pe commit)"
done <<<"$PRURI"

# Fișierul de stare rămâne mic: ultimele 200 de sha-uri sunt mai mult decât destul.
tail -200 "$STARE" > "$STARE.tmp" 2>/dev/null && mv "$STARE.tmp" "$STARE"
rm -rf "$LUCRU"
