# UNELTELE LUI KELION — contract confirmat 100% (Adrian, 5 iulie 2026, ~21:50)

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
| `Bash` (curl + secretul punții) | coada de deploy (`/api/bridge/deploy-pending`), ordinele cu stadiile lor, erorile reale |
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

*Scris ca dovadă la cererea lui Adrian: „scrie exact sa ramina dovada ce primeste".*
