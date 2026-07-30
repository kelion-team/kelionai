# ACCES ȘI OPERARE — tot ce-i trebuie cuiva care preia

Document scris la cererea lui Adrian (30 iul): „scrie absolut tot modul de
apelare a serverului, ca să aduc pe cineva care vrea să intre și să configureze".

**Despre parole:** valorile NU sunt aici și nu vor fi niciodată. Fișierul ăsta
trăiește în git, pe GitHub — o parolă scrisă în el e o parolă pierdută în ziua în
care repo-ul e văzut de altcineva. Documentul spune **unde stau** cheile și **cum
se pun**; valorile le dă Adrian, direct, în momentul potrivit. Oricine vine să
lucreze aici va cere exact același lucru.

---

## 1. CE E, PE SCURT

Asistent AI live (avatar 3D, voce, vedere, skill-uri Google), la **kelionai.app**.

- `backend/` — Node 22 + Fastify + TypeScript
- `frontend/` — React + Vite + TypeScript
- rulează într-un container Docker, pe VPS propriu
- publicarea se face din GitHub Actions, prin SSH

Documentul de arhitectură complet: **`AI-HANDOFF.md`** (fiecare rută, serviciu,
componentă, regulile de rutare a creierului, schema bazei, istoricul deciziilor).
Ce nu merge și ce nu e făcut: **`RAMAS-DE-FACUT.md`**.

---

## 2. SERVERUL

| | |
|---|---|
| Adresă | `164.68.120.87` |
| Utilizator | `root` |
| Autentificare | cheie SSH (nu parolă) |
| Cheia | secretul GitHub **`VPS_SSH_KEY`** (cheia privată, în întregime) |
| Folderul aplicației | `/root/kelion/` |
| Clona de cod | `/root/kelion/repo` |
| Fișierul cu chei | `/root/kelion/kelionai.env` (chmod 600) |
| Secretul punții | `/root/kelion/bridge-secret.txt` |

### Conectare directă

```bash
ssh -i <cheia-privata> -o StrictHostKeyChecking=no root@164.68.120.87
```

Cheia privată o are Adrian; e aceeași valoare care stă în secretul `VPS_SSH_KEY`.

### Conectare FĂRĂ să ai cheia local (recomandat)

Nu-ți trebuie cheia pe calculatorul tău. Există workflow-uri care rulează comenzi
pe server, cu cheia luată din secretele repo-ului:

| Workflow | La ce e |
|---|---|
| `vps-run` | rulează o comandă bash oarecare, ca root |
| `vps-enter` | intră în containerul aplicației |
| `vps-diag` | diagnostic complet (stare container, disc, memorie, loguri) |
| `vps-probe` | verifică dacă aplicația răspunde |
| `vps-keys` | listează CE chei există în env (numele, nu valorile) |
| `vps-set-env` | scrie cheile din GitHub Secrets în env-ul de pe VPS |
| `vps-set-key` | scrie o singură cheie |
| `vps-key-setup` | pune o cheie SSH nouă pe server |

Se pornesc din **Actions → workflow-ul dorit → Run workflow**.

---

## 3. CUM AJUNGE CODUL ÎN PRODUCȚIE

```
ramură → PR → merge în master → workflow „deploy" → VPS → verificare anti-fantomă
```

Workflow-ul `deploy` (`.github/workflows/deploy.yml`):

1. se conectează prin SSH la `root@164.68.120.87`;
2. în `/root/kelion/repo` face `git fetch origin master`;
3. **rulează scriptul de publicare din `origin/master`, dintr-o copie în `/tmp`** —
   nu din clonă. Motivul e o pană reală („deploy fantomă"): dacă rulezi scriptul
   din clona locală, poți publica o versiune mai veche decât master, iar
   verificarea de după ar valida versiunea greșită;
4. la final verifică **anti-fantomă**: `/api/version` de pe live trebuie să fie
   EXACT sha-ul din `origin/master`, iar `/health` trebuie să dea 200. Dacă nu,
   publicarea pică — nu se declară „gata" ceva nepublicat.

**Regula de aur a proiectului:** producția = `master`, mereu în sincron. Nimic nu
are voie să publice cod mai vechi decât `origin/master`.

### Proba, oricând, din orice terminal

```bash
curl -s https://kelionai.app/api/version   # {"v":"<sha>","at":"..."}
curl -s -o /dev/null -w "%{http_code}\n" https://kelionai.app/health   # 200
git rev-parse --short origin/master        # trebuie să fie ACELAȘI sha
```

---

## 4. CHEILE (nume, rol — valorile la Adrian)

Trăiesc în `/root/kelion/kelionai.env` pe server, și în **GitHub → Settings →
Secrets and variables → Actions** ca sursă.

**Drumul unei chei noi:** o pui în GitHub Secrets → rulezi `vps-set-env` → ea
ajunge în env și containerul repornește ca s-o încarce.

> **Capcana care a costat o zi (30 iul):** workflow-ul `vps-set-env` are o
> **listă fixă de nume** în bucla care scrie. O cheie care nu e în listă se pune
> degeaba în GitHub — workflow-ul zice „succes" și cheia nu ajunge nicăieri. Dacă
> adaugi o cheie nouă, **adaug-o în trei locuri** din `vps-set-env.yml`: blocul
> `env:`, lista buclei, și instrucțiunile din capul fișierului.

### Obligatorii (fără ele aplicația nu pornește sau nu funcționează)

| Cheie | Fără ea |
|---|---|
| `DATABASE_URL` | nu pornește — conturi, credite, istoric, toate |
| `SESSION_SECRET` | nimeni nu poate rămâne logat |
| `OPENROUTER_API_KEY` | **creierul** — nu răspunde nimic |
| `OPENAI_API_KEY` | vocea live (Realtime), TTS, transcrierea |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | login cu Google |

### Utile

`GEMINI_API_KEY` (creier de rezervă + vedere) · `SERPER_API_KEY` (căutare web) ·
`GOOGLE_MAPS_KEY` (hărți) · `GOOGLE_TTS_API_KEY` + `GOOGLE_SERVICE_ACCOUNT_JSON`
(voce Chirp 3 HD) · `MAIL_USER` / `MAIL_PASS` (cutia contact@) ·
`GITHUB_TOKEN` (Kelion publică singur; fin-granulat, doar acest repo) ·
`BRIDGE_SECRET` (raportările constructorului — **aceeași valoare** trebuie să fie
și în `/root/kelion/bridge-secret.txt`)

### Plăți (starea de la 30 iul)

`REVOLUT_PAY_LINK` · `GOCARDLESS_SECRET_ID` · `GOCARDLESS_SECRET_KEY` ·
`GOCARDLESS_ACCOUNT_ID` — vezi **`PROCEDURA-PLATI.md`** pentru ce face fiecare și
de unde se iau. Stripe a fost scos pe 30 iul.

### Cum vezi ce chei are procesul ACUM

Admin → Tokenuri → tabelul „Ce chei vede serverul CHIAR ACUM": pentru fiecare
cheie spune dacă e prezentă, **câte caractere are** (0 = prezentă dar goală) și
**sub ce nume** a fost găsită. **Nu afișează niciodată valori** — nici trunchiate.
Arată și ora pornirii procesului: o cheie scrisă DUPĂ acea oră nu e încărcată
până la repornirea containerului.

---

## 5. PORȚILE DE CALITATE (rulează-le înainte de orice publicare)

```bash
cd backend  && npm ci && npm run typecheck && npm test
cd frontend && npm ci && npm run build          # tsc -b && vite build
node scripts/verifica-sintaxa.mjs               # marcaje de conflict, CSS, JSON
node scripts/verifica-exporturi.mjs             # exporturi fără utilizator
npx jscpd backend/src frontend/src --threshold 0.0001   # cod duplicat
```

**Atenție la o capcană dovedită (30 iul):** `npx tsc --noEmit -p tsconfig.json`
NU e același lucru cu `npm run build` la frontend (`tsc -b && vite build`).
Verificarea greșită a lăsat o eroare de tip să treacă și a blocat publicarea 25
de minute. **Rulează exact comenzile npm de mai sus**, nu variante.

Referință: 261 de teste, 0 duplicat, 0 exporturi orfane — starea la 30 iul.

---

## 6. CÂND CEVA NU MERGE

| Simptom | Unde te uiți întâi |
|---|---|
| situl nu răspunde | `vps-diag` (container pornit? disc plin?) apoi `vps-probe` |
| răspunde dar dă 502 | containerul repornește după publicare — așteaptă ~1 min |
| chatul nu răspunde nimic | Admin → Bani: soldul OpenRouter; apoi jurnalul, caută `[CREIER]` și `[CHAT MUT]` |
| „nu execută ce cer" | jurnal `[CREIER]` — spune dacă a căzut pe model gratuit și de ce |
| o cheie „lipsește" deși ai pus-o | Admin → Tokenuri (vezi §4) + verifică lista din `vps-set-env` |
| publicarea nu ajunge live | Actions → deploy; verificarea anti-fantomă spune ce nu s-a potrivit |

Jurnalul aplicației:
```bash
docker logs --tail 200 <container>     # prin vps-run sau ssh direct
```
Sau din aplicație: Admin → Jurnale (ultimele erori și avertismente).

---

## 7. RECUPERARE

Punctele de recuperare sunt tag-uri git, oglindite pe VPS ca `.bundle` și
`.tar.gz`. Se văd și se creează din **Admin → Recuperare**, iar restaurarea aduce
`master` la starea aleasă printr-un commit nou — deci publicarea pornește singură.

---

## 8. REGULILE DE LUCRU ALE PROIECTULUI

Sunt în **`CLAUDE.md`**, scrise după eșecuri reale, nu din teorie. Cele patru care
contează cel mai mult:

1. O valoare care nu vine dintr-o măsurătoare reușită se scrie „nu pot verifica" —
   niciodată o cifră sau un verdict. (Un eșec de citire afișat ca fapt a costat o
   zi întreagă, de cinci ori în forme diferite.)
2. Când Adrian contrazice un raport, primul loc de căutat e **codul care a produs
   raportul**, nu sistemul lui. A avut dreptate de fiecare dată.
3. Nicio operație în masă pe ceva ce n-ai privit. (`git add -A` pe un merge cu
   conflicte a comis marcaje `<<<<<<<` în cod care rula; un script de ștergere
   necontrolat a tăiat 1524 de linii dintr-un fișier.)
4. Înainte să-i ceri ceva de făcut manual, dovedește din cod sau de pe live că e
   chiar necesar. Timpul lui nu e locul unde se testează ipoteze.

Și convenția care ține totul legat: **dacă schimbi codul, actualizezi
`AI-HANDOFF.md` înainte să închizi.** Nu există alt mecanism — convenția asta E
mecanismul.
