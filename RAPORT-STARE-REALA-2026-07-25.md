# RAPORT STARE REALĂ — KELIONAI (25 iulie 2026, dimineața)

Inventar din COD (grep pe uneltele reale) + starea live verificată azi. Fără cosmetică.

## CE POATE APELA KELION DIN CHAT (unelte reale oferite creierului)

Chatul are ~45 de unelte. Vocea are 23. Mai jos, fiecare, cu status real.

### 🔧 Skill-uri de bază (chat + voce)
| Funcție | În CHAT | În VOCE | Status real |
|---|---|---|---|
| Căutare web | ✅ | ✅ | Funcțional (OpenRouter, fără cheie separată) |
| Vremea | ✅ | ✅ | Funcțional (Open-Meteo, gratuit) |
| Hărți / căutare loc | ✅ | ✅ | Funcțional (OSM, gratuit) |
| Direcții / traseu / GPS | ✅ | ✅ | Funcțional; „unde sunt" cere permisiunea de locație a browserului |
| YouTube | ✅ | ✅ | Funcțional |
| Wikipedia | ✅ | ✅ | Funcțional |
| Traduceri | ✅ | ✅ | Funcțional |
| Conversie valutară | ✅ | ✅ | Funcțional |
| Ora / fus orar | ✅ | ✅ | Funcțional |

### 📧 Google (Gmail/Calendar/Drive/Tasks/Contacts) — 9 unelte
| Funcție | În CHAT | În VOCE | Status real |
|---|---|---|---|
| Citește / trimite email | ✅ | ✅ | Cod complet. **Se deblochează la LOGIN acum** (schimbare deployată azi: loginul cere toate drepturile din prima; reconectează-te cu Google) |
| Calendar (citește / creează) | ✅ | ✅ | idem — login unic deblochează tot |
| Drive, Tasks, Contacts | ✅ | ✅ | idem |

### 🧠 Creier + autonomie
| Funcție | În CHAT | În VOCE | Status real |
|---|---|---|---|
| Escaladare la creierul greu (ask_brain, Fable 5 + raționament) | ✅ | ✅ | Deployat azi; OpenAI acceptă sesiunea (201) |
| Generare imagini | ✅ | ✅ | Funcțional (OpenRouter) |
| Vedere (cameră / poză) | ✅ | ✅ (look) | Funcțional |
| Context / memorie în conversație | ✅ | ✅ | Voce reparată azi (injectam memoria+istoricul; pornea oarbă) |
| Notițe (salvează/listează/șterge) | ✅ | ❌ | **Lipsește în VOCE** |
| Memorie lungă (listează/uită) | ✅ | ❌ | **Lipsește în VOCE** |
| Gesturi avatar | ✅ | ❌ | **Lipsește în VOCE** |
| Schimbă rolul activ (meseria) | ✅ | ❌ | **Lipsește în VOCE** |
| Navigare în aplicație (open_app_view) | ✅ | ✅ | Funcțional |
| Afișare pe monitor (pagini/documente) | ✅ | ✅ (parțial) | show_document doar în chat |
| Browser autonom (9 unelte) | ✅ | ❌ | Doar în chat (vocea n-are ecran de citit) |
| Citește propriul cod (admin) | ✅ | ❌ | Doar în chat |
| Clip promo (admin) | ✅ | ❌ | Doar în chat |
| Cost real (admin) | ✅ | ❌ | Doar în chat |

### 💰 Bani
| Funcție | Status real |
|---|---|
| Paywall + debitare (chat + voce) | Deployat azi. **Adminul se debitează REAL acum** (nu mai e scutit) |
| Sold + reîncărcare automată | Funcțional |
| Circuit unic (o singură pungă → card → AI) | ⚠️ Așteaptă aprobarea Stripe Issuing (extern, 1-3 zile) |
| OpenAI = vocea, OpenRouter = creierul | Corect (2 funcții fizic diferite, nu dublă taxare) |

### 🛡️ Admin (module — toate randează cu date reale, verificat în captura ta)
Finanțe, Costuri, Tranzacții, Utilizatori, Vizitatori, Chat live, Istoric, Cereri neacoperite, Gesturi, Magazine, Inbox/Mailbox, Leads, Chei/Token-checks, Modele, Circuitul banilor, Depunere, Payout, Vânzare credite, Traduceri, Verificare vizuală.

## CE E CU ADEVĂRAT NEACTIVAT / DE FĂCUT (onest)

1. **VOCEA nu are toate uneltele chatului** — îi lipsesc: notițe, memorie, gesturi, schimbare rol. (Restul le are.) — DE ADĂUGAT pentru paritate completă.
2. **Google skills** — cod complet, se activează la reloginare (schimbarea de azi). Până te reloghezi, dau „neconectat".
3. **Circuitul unic de bani** — blocat de aprobarea Stripe (extern).
4. **Vocea (sunet: robotic/sacadat)** — cauza de rădăcină reparată azi (sesiunea era ignorată de OpenAI); confirmarea finală cere urechea ta după reîncărcare.
5. **Mesaje de sistem** (paywall/erori) doar în ro/en, nu în toate limbile.

## URMĂTORUL PAS pe care îl execut, dacă spui
Aduc VOCEA la paritate cu CHATUL — toate uneltele (notițe, memorie, gesturi, rol) apelabile și din voce. Apoi verific fiecare, una câte una, live.
