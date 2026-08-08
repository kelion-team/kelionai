# KELION — AUDIT COMPLET al proiectului aprobat

> Audit al `KELION-CREIER-UNIC.md` (proiectul aprobat) față de **codul real, live**.
> Fiecare verdict e verificat în sursă (file:line), nu din auto-declarația specului.
> Data: 29 iulie 2026. Metodă: două echipe independente pe cod + verificare live pe producție.

## 0. Starea LIVE (măsurată)
| Verificare | Rezultat |
|---|---|
| `/api/version` | **`9c95568`** (== master, cel mai nou) |
| `/health` | **200** |
| frontend `/` | **200** |
| creier — modele disponibile (`/api/models/catalog`) | **98 chat / 84 work** (raționament + unelte, inclusiv Claude opus/haiku/fable plătite) |
| Teste (CI) | **16 fișiere / 76 cazuri, verzi** |

## 1. Verdict pe secțiunile proiectului aprobat

| Secțiune | Verdict | Dovada (file:line) |
|---|:--:|---|
| **§1** un creier, fără dispecer, fără duplicare | ✅* | chat + voce → același `runOrchestrator` (`chat.ts:1901`, `voiceBrainTurn.ts:41`); definiții unelte din sursă unică, importate, fără redefinire inline (`realtime.ts:25-39`) |
| **§2** ține TOATE funcțiile (69) | ✅ | `brainCapabilities.ts` 69 capabilități (66 chat / 31 voce); fiecare are handler real; zero adormite/neatinse |
| **§3** ancorat în realitate | ✅ | chat: timp+GPS+monitor+anti-inventare (`chat.ts:1420-1500,884,962`); voce: timp+GPS+anti-inventare (`realtime.ts:116-157`, `services/realtime.ts:103-106`) |
| **§4** auto-instalare dependențe (prin constructor) | ✅ | instrucțiunea OWNER în `chat.ts` (SYSTEM_PROMPT): pachet lipsă → editează package.json/Dockerfile prin build_software → PR → rebuild; interzis apt live arbitrar |
| **§5** paznicul de completitudine | ✅* | `brainCapabilities.test.ts` rulează în CI (`pr-verify.yml:26`); verifică integritatea registrului + google-vs-cod-real + numere + liste adormite |
| **§6** vocea = același creier, COMPLET | ✅* | persona rutează TOT ce are conținut prin `ask_brain`; direct rămân doar acțiunile de dispozitiv + vorbele goale (`services/realtime.ts:73-84`) |
| **§7** tabelul de dovezi (`KELION-DOVEZI.md`) | ✅ | 8 rânduri verificate față de handlere reale — toate corecte, netstale |
| **Autonomia** — de la cerere la deploy final, pe AMBELE rute | ✅ | chat + voce au acum repo_write/open_pr/merge_pr + run_runbook/status/log + request_repair (`chat.ts:1765`, `realtime.ts:264-275,314-320`) |

`*` = ✅ cu observații oneste (vezi §3 Riscuri).

## 2. Detaliu pe verificări cheie

**Un creier (§1):** ambele căi principale trec prin `runOrchestrator` — chat la `chat.ts:1901`, voce prin `voiceBrainTurn` (`realtime.ts:353` → `voiceBrainTurn.ts:41`), cu aceeași personă (`SYSTEM_PROMPT`), același model (Gemini-direct/`resolveModel('work')`) și aceeași poartă a faptei (`deedGate`). Definițiile uneltelor vin dintr-o sursă unică (importate, nu duplicate).

**Autonomia, ambele rute:** paritate confirmată — vocea (`ask_brain`, admin-gated) are acum EXACT aceleași unelte de constructor/ops ca scrisul; executorii cheamă aceiași `repoWrite/repoOpenPR/repoMergePR` (`github.ts`) + `runRunbook/status/log` + `requestRepair` (`runbooks.ts`). Constructorul deschide PR și NU se auto-merge-uiește (`constructor-agent.mjs`, „Merge-ul rămâne la Adrian"); merge-ul îl dă ownerul sau Kelion prin `repo_merge_pr`.

**Deploy final:** `deploy.yml` pornește pe push în master + `workflow_dispatch`; garda **anti-phantom** (`deploy.yml:58-80`) cere live `/api/version`==sha master ȘI `/health`==200, altfel job roșu → live rămâne pe versiunea veche. Producția e protejată.

**Securitate:** lacăt admin global (`index.ts:160-168`, `adminLock.ts`); vocea cere `adminUnlocked` (amprentă) pentru uneltele de constructor (`realtime.ts:259`); comutatorul STOP (`isOpsPaused`) blochează repo_write/open_pr/merge_pr + run_runbook + coada constructorului; paywall pe sesiunea de voce ca la chat (`realtime.ts:64-73`).

**Bani:** costul uneltelor de voce se debitează (`settle()` → `recordCost`+`debitWallet`); minutele de voce se taxează pe `/api/realtime/tick`.

## 3. GAPS / RISCURI (oneste, ranked)

| # | Nivel | Ce | Recomandare |
|---|---|---|---|
| 1 | **MED (bani)** | **Taxarea minutelor de voce e „pe încrederea clientului"**: WebRTC curge direct browser↔OpenAI; serverul taxează doar când clientul trimite `/tick`. Un client care nu trimite tick vorbește pe cheia platformei **negratuit**; o deconectare bruscă pierde ultimul minut. Nu există watchdog de sesiune pe server. | Watchdog server-side pe durata sesiunii (heartbeat obligatoriu → tăiere la lipsă), sau facturare pe durata reală a apelului OpenAI. |
| 2 | LOW (bani) | **Debit „fire-and-forget"** (`void debitWallet`): un eșec de DB pierde taxa tăcut, fără reîncercare/reconciliere. | Coadă de reconciliere / jurnal de debite eșuate. |
| 3 | LOW (cod mort) | **`services/voiceBrainTools.ts` e NECABLAT** — importat doar de testul lui; calea live re-implementează executorul inline (`execIntrospection`). | Ori îl cablez și scot duplicarea de dispatch, ori îl șterg cu tot cu test. |
| 4 | LOW (arhitectură) | **Dispatch-ul executorilor e duplicat** (chat `runTool` vs voce `execIntrospection`) — definițiile-s unice, dispatch-ul nu, deci pot diverge tăcut. | Un dispatcher comun, injectat în ambele rute. |
| 5 | INFO | **Paznicul sub-acoperă**: verifică riguros doar suprafața google + existența runbook-urilor față de cod; un rând din registru în afara `google` fără handler ar trece verde. Numerele sunt hardcodate (prind schimbări, nu handlere lipsă). | Extinde paznicul: pentru fiecare capabilitate non-google, asertează că există un case în `runTool`/`execIntrospection`. |
| 6 | INFO (prin design) | **`repo_merge_pr`/`run_runbook` ocolesc CI** (ordinul tău explicit); pr-verify e doar informativ, nu blochează merge-ul. Autonomia poate împinge direct în producție; frânele sunt STOP + anti-phantom. | — (decizia ta; notat ca să nu pară scăpare) |
| 7 | INFO | **`ask_brain` în-tură pe CHAT** folosește `brainComplete` (fără unelte), nu orchestratorul — asimetrie minoră față de voce (care are unelte). | Uniformizare opțională. |
| 8 | INFO | **Plafon voce = 31 unelte** (măsurat OpenAI); 38 de capabilități de chat sunt pe voce doar prin escaladarea `ask_brain`, nu directe. „Ce poate scrisul poate și vocea" e adevărat prin escaladare, nu direct. | — (limită reală a platformei) |

## 4. Livrat în această sesiune (tot LIVE, cu sha)
| Livrare | PR | sha live |
|---|---|---|
| GPS „pune-mă pe hartă" | #514 | `deb12e8` |
| §6 vocea = același creier (cereri grele) | #515 | `3f11d51` |
| Audio pe căști Bluetooth | #516 | `9211629` |
| §1 fără duplicare + §7 tabelul de dovezi | #517 | `7dd3ac3` |
| §4 auto-instalare prin constructor | #518 | `9241b71` |
| §6 COMPLET (tot ce are conținut prin creier) | #519 | `a3285a6` |
| Fără forțarea uneltei („face ce vrea el, hardcodat") | #520 | `f06486c` |
| Autonomie completă pe voce → deploy final | #521 | `9c95568` |

## 5. Ce RĂMÂNE (cere acțiunea ta, nu cod)
- **Testele tale LIVE** — voce, cameră, GPS, email real, și o cerere de autonomie „de la cerere la deploy" pe voce: codul e livrat și dovedit, efectul pe dispozitivul tău îl confirmi tu.
- **Scope-uri Google noi** (Photos, YouTube personal) — buton „Conectează Google".
- **Deciziile din §3 Riscuri** — mai ales #1 (taxarea minutelor de voce): spune dacă vrei watchdog-ul pe server; îl fac.

## 6. Concluzie onestă
Proiectul aprobat e, **în cod, complet și live pe toate secțiunile** (§1–§7 + autonomia pe ambele rute), verificat file:line și pe producție (`9c95568`, health 200). Nu e nimic „adormit ascuns" pe secțiunile mari. Ce rămâne sunt: **verificările tale live** (singurele pe care nu le pot face eu, cer dispozitivul/sesiunea ta) și **câteva riscuri reale** (mai ales taxarea minutelor de voce) pe care ți le pun pe masă cinstit, cu recomandare — nu ascunse sub „gata".
