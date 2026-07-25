# AUDIT FUNCȚIONAL COMPLET — KELIONAI

Cerut de Adrian: „identifică tot ce știe aplicația să facă, tabel complet, în dreapta dacă funcționează sau nu."

**Actualizat 25 iulie 2026, dimineața.** Baza e auditul din 24 iul (seara) — rândurile neatinse de-atunci sunt marcate 🔍 (nu re-verificate azi, presupuse valabile din verificarea anterioară). Rândurile schimbate azi au dovada la zi. Adăugate azi: 15 defecte noi găsite de auditul complet al procedurii de chat (agent dedicat, doar citire cod) + criza reală din noapte (buclă email, voce-pe-zgomot, procese-zombie vii).

---

## TABEL COMPLET — STARE REALĂ ACUM

### 💬 Chat & Creier
| Funcție | Status | Detaliu |
|---|---|---|
| Chat principal (streaming, unelte) | ✅ Funcțional | 🔍 |
| Istoric chat + reluare sesiune întreruptă | ❌ **STRICAT** | Descoperit azi: la reconectare mid-tură, `readTurnFrom` (sseReplay.ts:135) se oprește la ce era deja în buffer și închide stream-ul curat — userul crede că a primit răspunsul COMPLET, de fapt e trunchiat la jumătate, tăcut, fără eroare |
| Escaladare automată chat→creier | ⚠️ **FUNCȚIONEAZĂ, DAR GREȘIT** | `taskDifficulty` (openrouter.ts:140) e potrivire de cuvinte-cheie/lungime text, NU raționament — exact ce ai identificat corect. O cerere scurtă dar grea poate rămâne pe modelul rapid; una lungă dar simplă poate escalada degeaba |
| Creierul de escaladare (work-tier) | ✅ **SCHIMBAT AZI pe Fable 5** | `anthropic/claude-fable-5`, verificat live: gândește real (reasoning_tokens confirmați), răspuns corect ($0,0077/apel — de reținut, mai scump ca Sonnet) |
| „Stop" (scris/vorbit) | ❌ **STRICAT** | Descoperit azi: clientul trimite „stop" la server crezând că există un handler de oprire — NU EXISTĂ. Serverul rulează o tură COMPLETĂ de creier (cost debitat!) pe un răspuns pe care userul nu-l vede niciodată |
| Memorie automată per user | ✅ Funcțional | 🔍 |
| Notițe | ✅ Funcțional | 🔍 |
| Afișare pe monitor | ✅ Funcțional | 🔍 |
| Navigare în aplicație prin comandă | ✅ **REPARAT** | voiceprints/gesturi/tokenuri adăugate în enum |
| Gesturi avatar comandate de creier | ✅ Funcțional | 🔍 |
| Generare imagini | ✅ Funcțional | 🔍 |
| Browser autonom (9 unelte) | ✅ Implementat | 🔍 |
| Clip promo din chat scris | ⚠️ **REPARAT PARȚIAL** | Emite `{promo}` acum (era mort pe 24 iul) — DAR scripturile peste ~5000 caractere (clipuri 5-10 min) sunt tăiate tăcut la jumătate de `/api/tts` |

### 🛠️ Skill-uri (18 unelte)
| Funcție | Status | Detaliu |
|---|---|---|
| Căutare web, vreme, hărți, direcții, YouTube, Wikipedia, traduceri, valute, oră | ✅ Funcționale | 🔍 |
| Gmail, Calendar, Drive, Tasks, Contacts | ✅ Cod complet + chei valide | 🔍 cer login Google, netestabil fără el |

### 🎙️ Voce & Full-Duplex
| Funcție | Status | Detaliu |
|---|---|---|
| Voce live full-duplex (OpenAI Realtime) | ✅ Funcțional | cheie OpenAI validă (HTTP 200, verificat azi) |
| Vocea îți răspundea în RUSĂ fără ca cineva să vorbească | ❌→✅ **CRIZĂ REZOLVATĂ AZI-NOAPTE** | Cauză reală: VAD-ul semantic răspundea la ZGOMOT, nu doar la vorbire. Fix: instrucțiune „fără vorbire clară → taci" + `VAD_EAGERNESS=low`, deployat și verificat în container. Nu am cum să confirm 100% fără un test live al tău |
| Unelte în voce (vedere, creier, imagini, skill-uri) | ⚠️ **FUNCȚIONEAZĂ, DAR FĂRĂ PLATĂ** | **Descoperire nouă, gravă:** spre deosebire de chat scris (care blochează la 0 credite și debitează fiecare unealtă), vocea NU verifică soldul și NU debitează nimic — un user cu 0 credite poate vorbi/genera imagini/căuta web nelimitat, pe banii tăi, invizibil în tabul Bani |
| Escaladare voce (`ask_brain`) | ❌→✅ **REPARAT AZI** | Avea persona proprie, hardcodată în română pentru toți userii („dublurile" pe care le-ai bănuit corect) — acum folosește EXACT persona din scris + limba reală a userului |
| Vederea (`look`) din voce | ⚠️ **BUG NOU GĂSIT** | Dacă userul închide camera, unealta trimite ultimul cadru salvat înainte de închidere — Kelion descrie cu încredere o scenă veche de minute, în loc să spună „nu am camera deschisă" |
| Limbă: admin=română blocat | ✅ Live, întărit azi | ancorare per-tură + reminder de sistem |
| Limbă: regula „niciodată rusă" | ❌ **OCOLIBILĂ** | Lista de limbi din Setări (UI) oferă 27 de limbi, inclusiv rusă — un singur click al userului o persistă și o transformă în lock ABSOLUT, ocolind garda din detecția automată |
| Voce unică masculină (ash) | ✅ Live | 🔍 |
| TTS rezervă | ✅ Funcțional | 🔍 |
| LiveKit | 🗑️ **ȘTERS din aplicație** | decizia ta, 24 iul — nu mai există în cod, nu mai e „neconfigurat", e absent |

### 👁️ Vedere
| Funcție | Status | Detaliu |
|---|---|---|
| Vedere în chat scris | ✅ Implementat | 🔍 |
| Vedere în voce | ⚠️ Vezi bug-ul „cadru vechi" mai sus | |
| Verificare vizuală admin (screenshot+AI) | ✅ **REPARAT** | migrat pe OpenRouter, nu mai depinde de cheia Gemini lipsă |

### 💰 Plăți & Credite
| Funcție | Status | Detaliu |
|---|---|---|
| Cumpărare credite | ✅ Funcțional | 🔍 |
| Sold + istoric + reîncărcare automată | ✅ Funcțional | 🔍 |
| Webhook Stripe (calea semnată) | ✅ **REPARAT** | `STRIPE_WEBHOOK_SECRET` pus pe VPS azi-noapte — nu mai e pe fallback |
| Vânzare credite admin, payout | ✅ Cod complet | 🔍 |
| Circuit închis (pungă→card virtual→AI) | ⚠️ Blocat extern | așteaptă încă aprobarea Stripe Issuing (nu ține de cod) |
| Alimentare automată OpenRouter | ✅ ACTIVATĂ | sold real acum: **$5,46** (verificat live, API) |
| Vocea și uneltele ei consumă bani fără gardă | ❌ Vezi rândul de la Voce | risc real de bani, nu doar cosmetic |

### 🛡️ Admin Panel
| Funcție | Status | Detaliu |
|---|---|---|
| Finanțe, costuri, tranzacții, solduri | ✅ Funcțional | 🔍 |
| Utilizatori | ✅ Funcțional | 🔍 |
| Vizitatori + chat vizitatori | ✅ Funcțional | 🔍 |
| Store-uri | ✅ Funcțional | 🔍 |
| Cereri neacoperite (gaps) | ✅ Funcțional | 🔍 |
| Gesturi | ✅ Funcțional | 🔍 |
| Mailbox + auto-reply contact | ❌→✅ **CRIZĂ REZOLVATĂ AZI-NOAPTE** | Emailul funcționa, dar răspundea automat propriilor alerte (`alerts@kelionai.app` → buclă „Stimate client"). Cauza reală: procese-zombie VII din 20 iul (nu doar mascate — omorâte azi cu kill -9). Gardă nouă: niciun expeditor `@kelionai.app`/tehnic nu mai primește auto-reply |
| Mesaje contact (salvare DB) | ✅ Funcțional | 🔍 |

### 🔐 Autentificare & Legal
| Funcție | Status | Detaliu |
|---|---|---|
| Login Google, signup, sesiuni | ✅ Funcțional | 🔍 |
| Pagini legale | ✅ Funcționale | 🔍 |
| Ștergere cont GDPR | ✅ **REPARAT** | acoperă acum și transactions/billing_events/voiceprints |
| Amprentă vocală (voiceprint) | ⚠️ Nefolosit | tot 0 rânduri în producție — task deschis, nerezolvat încă |

### 🔧 Utilitare
| Funcție | Status | Detaliu |
|---|---|---|
| /api/version, /health | ✅ Funcționale | verificat live acum |
| /api/greet, /api/route, /api/meserii | ✅ Funcționale | 🔍 |

---

## CE E SPART ACUM, ÎN ORDINEA GRAVITĂȚII

1. ❌ Vocea consumă bani nelimitat, fără plată, invizibil (money leak real)
2. ❌ „Stop" arde un apel de creier pe server, degeaba, pe costul tău
3. ❌ Reluarea unei ture întrerupte trunchiază răspunsul, fără să spună
4. ❌ Regula „niciodată rusă" ocolibilă dintr-un click din Setări
5. ⚠️ „Look" din voce poate minți despre ce vede, cu camera închisă
6. ⚠️ Escaladarea automată e euristică de cuvinte, nu raționament real
7. ⚠️ Clipuri promo lungi (5-10 min) tăiate tăcut la jumătate

Astea sunt reale, verificate în cod azi, nu presupuneri. Le repar pe rând, cu dovadă live la fiecare — încep cu #1 și #2, cele care te costă bani direct chiar acum.
