# UNELTELE LUI KELION — contract confirmat 100% (Adrian, 5 iulie 2026, ~21:50)

## REGULA 0 — DECIZIA E LA ADRIAN (declarată de el, 5 iul ~21:55)
Nimic din acest contract nu se aplică pe serverele lui fără ordinul lui explicit.
Claude pregătește, testează și dovedește; **Adrian decide când și ce intră live.**
Orice autonomie primită de Kelion e sub aceeași lege: decizia finală, întotdeauna,
e a lui Adrian — uneltele îl servesc, nu-l înlocuiesc.

Cerința lui Adrian, cuvânt cu cuvânt: **„DA tot ce are nevoie. Confirma cerinta ca o faci 100%."**
și **„ochii și mâinile LUI, nu ale tale."**

Acest fișier e dovada scrisă a ce primește Kelion. Nimic de aici nu se taie.
Livrat de Claude (laptop), verificat cu teste — orice punct nelivrat = neîndeplinit.

---

## 1. OCHII LUI — Kelion vede singur starea REALĂ (nu rezumate primite de-a gata)

Creierul lui Kelion (Claude pe VPS, `kelion-bridge-linux.mjs`) primește **unelte proprii
de citire**, pe care le rulează EL, când vrea EL:

| Unealta | Ce vede cu ea |
|---|---|
| `Bash` (git) | starea reală a repo-ului: `git status`, `git log`, ramuri, conflicte, index blocat |
| `Bash` (curl + secretul punții) | coada de deploy (`/api/bridge/deploy-pending`), ordinele cu stadiile lor, erorile reale, regenerează codurile QR (`/api/bridge/upload-app`) |
| `Read` / `Grep` / `Glob` | orice fișier din `/root/kelion` și din clona repo: cod, jurnale, configurări |
| Jurnalele systemd | de ce a picat un serviciu: `journalctl -u kelion-deployer`, `-u kelion-builder` |

**Definiția lui „văd":** Kelion nu mai ghicește din text de chat — rulează comanda și
citește ieșirea brută, exact ca un operator uman.

## 2. MÂINILE LUI — Kelion decide și acționează SINGUR

| Situația | Ce face singur, fără să întrebe |
|---|---|
| Deploy picat pe CONFLICT de merge | NU buclează pe „ok". Inspectează cu git, apoi DECIDE: reconstruiește pe master proaspăt SAU aruncă ramura dacă e duplicat |
| Index git înțepenit (`resolve your current index first`) | `git merge --abort` / `git reset --merge` — deblochează singur |
| Ordin duplicat (același lucru de 2 ori) | îl aruncă și spune cinstit „era deja făcut" |
| Regenerare coduri QR (la cerere sau automat la deploy) | folosește unealta internă de regenerare QR pentru toate platformele |
| Serviciu picat (builder/deployer) | citește jurnalul, raportează cauza REALĂ, propune/execută repornirea |
| Orice reparație de cod | `[EXECUT]` la constructor (există deja) — rămâne |

## 3. GARDURILE (singurele limite — restul e al lui)

- **NU** `git push --force` pe master; **NU** ștergeri de date/istoric.
- **NU** publică în producție fără poarta lui Adrian („da") — poarta RĂMÂNE.
- **NU** scoate secrete (chei, tokenuri, parole) în chat sau în cod.
- Orice acțiune a lui = vizibilă pe monitor (transparență totală).

## 4. SISTEMUL DIN JUR (confirmat în același pachet)

- **Registru de ordine cu ciclu de viață complet**: primită → preluată → în lucru →
  gata → publicată / picată / certificată — `work_orders` cu stadii noi + raport
  la cerere (`composeOrdersReport`, scris + testat în `backend/src/services/orders.ts`).
- **Metoda de unicat**: același ordin nu se mai construiește de două ori
  (`isDuplicateOrder`, testat).
- **Decizie automată la eșec de deploy**: conflict → reconstruit/aruncat, NU re-cozat
  orb (`decideDeployFailure`, testat — mesajul către Adrian nu mai cere „ok" fals).
- **Feedback în creier** (LIVRAT DEJA, live pe master): rezultatul agenților re-cheamă
  creierul (`reportToAdmin` + `feedback.ts`, 19/19 teste) — Kelion primește rezultatul,
  nu doar îl afișează.
- **Constructorul trimite DOVADA** (`proof` la ready-deploy) — cod pe master,
  activare pe VPS prin pasul SSH.

## 5. CUM SE LIVREAZĂ (traseu)

1. `kelion-bridge-linux.mjs` — creierul pornit cu unelte + instruit CE unelte are
   și CÂND să le folosească (inclusiv regulile de decizie de la pct. 2).
2. Backend (`orders.ts` + legături în `bridge.ts`/`chat.ts` + `db.ts`) — prin
   pipeline-ul normal de deploy (poarta „da").
3. Fișierele VPS (creier + constructor cu proof) — instalate prin SSH-ul lui Adrian,
   pas cu pas, cu verificare la fiecare pas (ca la schimbul constructorului SDK).

## 6. DOVADA DE ACCEPTARE (cum știm că e făcut, nu povestit)

- [ ] Kelion, întrebat „ce e în coada de deploy?", răspunde cu starea REALĂ citită de el (nu „nu văd").
- [ ] La un deploy picat pe conflict: Kelion inspectează, decide singur (rebuild/drop), NU cere „ok" în buclă.
- [ ] Index git blocat: Kelion îl deblochează singur și anunță ce a făcut.
- [ ] Ordin duplicat: refuzat cu motiv, nu construit a doua oară.
- [ ] Raport complet de ordine cu stadii, la cerere, în chat.
- [ ] Mesajele „gata" vin cu DOVADA build/tester atașată.

---

## 7. SPECIFICAȚIA TEHNICĂ EXACTĂ (dovada „înainte / după")

### ÎNAINTE (starea de azi — orbirea, dovedită în cod)
`bridge/kelion-bridge-linux.mjs`, linia 52:
```js
// Text answer only: no tools, no file access, no edit permissions.
const args = ['-p', '--output-format', 'text']
```
Creierul lui Kelion = Claude pe VPS pornit FĂRĂ nicio unealtă. Nu poate rula git,
nu poate citi fișiere, nu poate vedea jurnale. De-aia „nu vede și nu decide".

### DUPĂ (ce primește — exact)
```js
const args = ['-p', '--output-format', 'text',
  '--allowedTools', 'Bash,Read,Grep,Glob',
  '--add-dir', '/root/kelion']
```
plus preambulul lui completat cu secțiunea UNELTELE TALE PROPRII:
- git pe clona serverului: status/log/branch/diff, `merge --abort`, `reset --merge`
- curl la punte cu secretul din `/root/kelion/bridge-secret.txt`:
  deploy-pending, workorders (registru cu stadii), activity
- `journalctl -u kelion-deployer / kelion-builder / kelion-paznic` — cauza reală
- Read/Grep/Glob pe `/root/kelion` (repo, jurnale, configurări)
- regulile de decizie: conflict → inspectează + decide (rebuild/drop); index blocat
  → deblochează singur; duplicat → aruncă cu motiv; NICIODATĂ buclă pe „ok"
- gardurile de la pct. 3 scrise în preambul, cuvânt cu cuvânt

*Scris ca dovadă la cererea lui Adrian: „scrie exact sa ramina dovada ce primeste".*

---

## 8. LECȚIA BUCLEI-CHEIE (Adrian, 14 iul: „învață-l ce trebuie și de ce, să nu mai greșească")

**Ce a greșit Kelion (dovada reală).** Un release aprobat nu s-a putut publica pentru că
tokenul GitHub nu avea dreptul `Pull requests: write` (403 la deschiderea PR-ului).
În loc să OPREASCĂ și să spună clar de ce, constructorul a reîncercat publicarea la
FIECARE 20s, ore în șir — a ars din abonament și a declanșat `deploy.yml` în lanț.
Regula „NU buclă pe «ok»" (§2) exista, dar DOAR pentru conflicte de merge; calea de
publicare nu avea lesă deloc.

**De ce e greșeală (nu doar un bug).** O buclă oarbă e mai rea decât un eșec cinstit:
consumă resurse, ascunde cauza reală și nu-l lasă pe Adrian să vadă ce trebuie făcut.
Iar cauza-rădăcină aici — scope-ul unei chei — Kelion NU o poate repara singur; a insista
în buclă e muncă inutilă pe o problemă care oricum se termină la „cere-i lui Adrian".

**Regula permanentă (generalizează §2 la ORICE cale, nu doar merge):**
1. **Aceeași eroare de 2× → OPRIRE, nu retry orb.** Orice buclă (publicare, deploy,
   reparație, verificator) numără eșecurile; la al 2-lea eșec pe același lucru se oprește
   definitiv și marchează starea (ex. release → `failed` prin `POST /api/bridge/release-failed`).
2. **La un blocaj de CHEIE/permisiune, dă DIAGNOSTIC clar, nu buclă.** Spune exact ce
   lipsește și cum se repară: „tokenul nu are `Pull requests: write` — dă-i-l în
   github.com/settings/tokens?type=beta și repune-l prin vps-keys". O singură dată, clar.
3. **Ce ține de o credențială e ÎNTOTDEAUNA la Adrian.** Kelion nu-și emite/rescopează
   propria cheie GitHub. Treaba lui = un diagnostic corect + O cerere clară, nu insistență.
4. **Verifică LIVE, nu din memorie.** „Publicarea merge de obicei" nu e dovadă — o
   dependență de cheie e fragilă și se re-verifică (vezi `kelion-github publish`, care acum
   numește 403-ul de PR și 401/403-ul de merge cu pasul exact de reparare).

**Unde e prins acum în cod (ca să nu depindă doar de bunăvoința creierului):**
`deployApproved()` din `kelion-builder-server.mjs` are contor de eșecuri
(`DEPLOY_MAX_ATTEMPTS=2`) + `blockRelease()`; backendul are `POST /api/bridge/release-failed`.
Deterministul oprește bucla; regula de aici îl învață pe creier DE CE, ca să reacționeze
la fel oriunde apare un tipar nou, înainte să existe cod pentru el.
