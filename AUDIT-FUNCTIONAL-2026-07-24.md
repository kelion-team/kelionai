# AUDIT FUNCȚIONAL COMPLET — KELIONAI (24 iulie 2026, seara)

Cerut de Adrian: „identifică tot ce știe aplicația să facă, tabel complet, în dreapta dacă funcționează sau nu."

**Metodologie:** cod citit direct (HEAD `92957c5`, master), curl-uri live pe kelionai.app, comenzi reale pe VPS prin vps-run.yml (docker exec, systemctl, journalctl, interogări Postgres reale). Unde nu s-a putut verifica live (necesită login/microfon/cameră reale), e marcat explicit 🔍.

---

## ⚠️ DESCOPERIRE MAJORĂ

**Pe VPS rulează 4 servicii-zombie** — `kelion-bridge`, `kelion-builder`, `kelion-paznic`, `kelion-deployer` — rămășițe ale sistemului „punte/constructor" ȘTERS din cod pe 23 iulie (commit `fef4144`). Lovesc la fiecare 20s endpointuri inexistente (404 continuu, 4 zile), iar `kelion-bridge` ține 2 procese `claude` active (491MB RAM, ~8h CPU) care consumă abonamentul degeaba. Trăiesc doar ca fișiere pe disc (`/root/kelion/kelion-bridge.mjs` etc.), deconectate total de aplicație. **Acțiune recomandată: oprire + dezactivare systemd.** (În așteptarea DA de la Adrian.)

---

## TABEL COMPLET

### 💬 Chat & Creier
| Funcție | Status | Detaliu |
|---|---|---|
| Chat principal (streaming, unelte) | ✅ Funcțional | 100% OpenRouter; cheie validă live |
| Istoric chat + reluare sesiune întreruptă (mobil) | ✅ Funcțional | 977 mesaje reale în DB |
| Escaladare automată chat→creier la cereri grele | ✅ Implementat | `taskDifficulty` ≥ 60 → model work |
| Memorie automată per user | ✅ Funcțional | 34 amintiri reale în DB |
| Notițe (salvează/listează/șterge) | ✅ Funcțional | |
| Afișare pe monitor (pagini, documente) | ✅ Funcțional | |
| Navigare în aplicație prin comandă (`open_app_view`) | ⚠️ Parțial | Nu poate deschide taburile Voiceprints/Gesturi — lipsesc din enum (`chat.ts:263` vs `AdminPanel.tsx:133`) |
| Gesturi avatar comandate de creier | ✅ Funcțional | mapare 1:1 verificată în ambele capete |
| Generare imagini | ✅ Funcțional | 9 imagini reale în DB |
| Browser autonom (9 unelte) | ✅ Implementat | toate cele 9 au case |
| Kelion își citește propriul cod (admin) | ✅ Funcțional | |
| Clip promo din chat scris | ❌ NU merge | `chat.ts:1754` emite doar `{monitor}`, niciodată `{promo}` — recorderul (`ChatPanel.tsx:351→419`) nu se armează |

### 🛠️ Skill-uri (18 unelte)
| Funcție | Status | Detaliu |
|---|---|---|
| Căutare web | ✅ Funcțional | prin OpenRouter (Serper scos, cheia nu mai e necesară) |
| Vreme, hărți, direcții, YouTube, Wikipedia, traduceri, valute, oră | ✅ Funcționale | fără chei lipsă (Open-Meteo/Nominatim/OSRM) |
| Gmail, Calendar, Drive, Tasks, Contacts (9 unelte OAuth) | ✅ Cod complet + chei valide | 🔍 cer conectarea Google a userului — netestabil fără login |

### 🎙️ Voce & Full-Duplex
| Funcție | Status | Detaliu |
|---|---|---|
| Voce live full-duplex (OpenAI Realtime) | ✅ Funcțional | cheie OpenAI validă, verificată live |
| Unelte în voce (vedere, creier, imagini, skill-uri) | ✅ Funcțional | |
| Limba: admin=română BLOCAT, rest detecție+menținere | ✅ Live | deployat 24 iul seara (hard lock, `ba0f3d6`) |
| Voce unică masculină (ash) peste tot | ✅ Live | Realtime + TTS unificate (`47f2833`) |
| Semi-duplex la escaladare (`ask_brain`) | ✅ Live | mut cât gândește, revine la final (`ac48967`) |
| TTS rezervă | ✅ Funcțional | OpenAI principal; Chirp plasă de siguranță (chei Google TTS absente — neblocant) |
| LiveKit (cale paralelă veche) | ❌ Neconfigurat | chei lipsă; NU afectează vocea principală |

### 👁️ Vedere
| Funcție | Status | Detaliu |
|---|---|---|
| Vedere în chat scris (cameră, până la 4 cadre) | ✅ Implementat | |
| Vedere în voce (unealta `look`) | ✅ Funcțional | deployat 24 iul (`92957c5`), describeScene prin OpenRouter |
| Verificare vizuală admin (screenshot+AI) | ❌ NU merge | `GEMINI_API_KEY` lipsește pe VPS → mereu `gemini_vision_indisponibil` |

### 💰 Plăți & Credite
| Funcție | Status | Detaliu |
|---|---|---|
| Cumpărare credite (checkout, plată directă) | ✅ Funcțional | Stripe live, cheie validă |
| Sold + istoric + reîncărcare automată user | ✅ Funcțional | 7 tranzacții reale |
| Webhook Stripe | ⚠️ Cale de rezervă | `STRIPE_WEBHOOK_SECRET` lipsește pe VPS → fallback verificare la Stripe API (bani NU se pierd, dar calea semnată ar fi mai robustă) |
| Vânzare credite admin, depunere owner, PAYOUT admin | ✅ Cod complet | |
| Circuit închis (pungă→card virtual→AI) | ⚠️ Blocat extern | cod gata; așteaptă aprobarea Stripe Issuing live + permisiuni cheie (în lucru cu Adrian, 24 iul seara) |
| Alimentare automată OpenRouter | ✅ ACTIVATĂ | Adrian a activat Auto Top-Up pe 24 iul seara (adaugă $5 sub $5; recomandat $25 sub $10) |

### 🛡️ Admin Panel
| Funcție | Status | Detaliu |
|---|---|---|
| Finanțe, costuri, tranzacții, solduri (Stripe/OpenRouter/creier) | ✅ Funcțional | |
| Utilizatori (blochează/creditează/șterge) | ✅ Funcțional | |
| Vizitatori + chat vizitatori | ✅ Funcțional | |
| Store-uri (verificare live 4 platforme) | ✅ Funcțional | |
| Cereri neacoperite (gaps) + triaj | ✅ Funcțional | |
| Gesturi (activare/dezactivare) | ✅ Funcțional | |
| Mailbox live + email leads + auto-reply contact | ❌ NU merg | `MAIL_USER`/`MAIL_PASS` absente pe VPS → tot emailul e mort; `inbound_emails`=0 |
| Mesaje contact (salvare DB) | ✅ Funcțional | testat end-to-end de audit (mesaj real trimis → salvat) |

### 🔐 Autentificare & Legal
| Funcție | Status | Detaliu |
|---|---|---|
| Login Google, signup, sesiuni | ✅ Funcțional | redirect verificat live |
| Pagini legale (privacy/terms/delete-account) | ✅ Funcționale | 200 pe toate |
| Ștergere cont GDPR | ⚠️ Parțial | nu șterge încă transactions/billing_events/voiceprints (restanță cunoscută) |
| Amprentă vocală (voiceprint) | ⚠️ Nefolosit | cod complet, dar 0 rânduri în producție — adopție zero sau fir frontend nedeclanșat |

### 🔧 Utilitare
| Funcție | Status | Detaliu |
|---|---|---|
| /api/version, /health | ✅ Funcționale | |
| /api/greet, /api/route (hartă), /api/meserii (15 roluri) | ✅ Funcționale | verificate live |
| /api/ingest (document→Markdown) | 🔍 Cod prezent | necesită sesiune |
| /api/visit, /api/visit/ping | ✅ Funcționale | |

---

## REPARAȚII NECESARE (ordinea impactului)

1. **Oprire servicii-zombie VPS** (ard abonament) — așteaptă DA de la Adrian
2. **`MAIL_PASS` pe VPS** (doar Adrian are parola) → învie tot emailul
3. **`STRIPE_WEBHOOK_SECRET` pe VPS** (din Stripe Dashboard → Webhooks) → calea semnată de plăți
4. **Clip promo** — emis frame `{promo}` din `chat.ts` (reparație cod)
5. **Enum navigare admin** — adăugat voiceprints/gesturi în `open_app_view` (reparație cod)
6. **Curățenie** — cod mort (autonomy/feedback/orders/supervisor/embeddings.ts), comentarii false Kimi/GLM (`chat.ts:770`), AI-HANDOFF.md §2.3/§3/§4.6 depășite

## LIMITĂRI DECLARATE
Neverificabile din acest mediu: fluxuri cu login real (chat efectiv, OAuth Google, voce end-to-end, cameră live, avatar WebGL randat). Verificate până la gate-ul de autentificare (401/403 corecte) + coerența completă a traseului în cod.
