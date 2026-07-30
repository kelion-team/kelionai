# PROCEDURA PLĂȚILOR, DE LA A LA Z

Adrian, 30 iul: „scrie-i absolut toată procedura de la A la Z, și să pună chiar
secretele unde trebuie".

Documentul ăsta e scris ca să nu mai ții minte nimic și să nu mai cauți prin
portaluri. Fiecare pas spune **cine îl face** — tu sau aplicația — și **cum știi
că a mers**. Dacă un pas nu iese, sări la §7 („Când ceva nu merge").

---

## 0. CE CONSTRUIM, ÎN DOUĂ RÂNDURI

Userul apasă „adaugă credit" → primește un **cod unic** → plătește pe linkul tău
Revolut, cu codul în referință → aplicația vede plata și îi dă creditele
**singură**.

Banii intră direct la tine, în Revolut Pro. Aplicația doar **citește** ce a
intrat — nu poate muta, plăti sau scoate niciun ban.

---

## 1. CE E DEJA FĂCUT (nu ai ce face aici)

Scris, testat și publicat pe 30 iul:

| Bucata | Unde stă | Ce face |
|---|---|---|
| Codurile unice | `db.ts` → `creeazaCodPlata` | `KLN-XXXX-XXXX`, fără caractere confundabile (0/O, 1/I/L) |
| Istoricul | tabela `payment_codes` | cod, user, sumă, stare, referință bancară, data plății |
| Potrivirea | `db.ts` → `crediteazaDupaCod` | găsește codul în referință, chiar cu text în jur sau litere mici |
| Creditarea | `topUpUser` | idempotentă — aceeași plată **nu poate** credita de două ori |
| Cititorul | `services/openBanking.ts` | citește tranzacțiile din cont, din 5 în 5 minute |
| Starea | Admin → Bani | scrie dacă citirea merge; **nu tace** când nu poate citi |

**Nu trebuie să atingi niciun fișier.** Tot ce urmează sunt doar chei și clicuri.

---

## 2. LINKUL DE PLATĂ REVOLUT — 2 minute

**Cine:** tu (e contul tău).

1. Deschizi aplicația **Revolut** pe telefon.
2. Contul **Pro** → **Get paid** → **Payment link**.
3. Îl lași **fără sumă fixă** (ca userul să plătească exact cât cumpără).
4. **Copiază linkul.** Arată gen `https://revolut.me/…`.

**Cum știi că e bun:** îl deschizi într-un browser și vezi pagina de plată
Revolut, cu numele tău.

---

## 3. CHEILE DE CITIRE A CONTULUI — 5 minute

**Cine:** tu (cere identitatea și acordul tău — nimeni altcineva nu poate).

Portalul e **bankaccountdata.gocardless.com**. Atenție la capcană: `manage.` și
`developer.` sunt ALTE produse (plăți prin Direct Debit, respectiv documentație).
Ce ne trebuie e portalul de **Bank Account Data**, gratuit, care doar citește.

1. Intri pe **https://bankaccountdata.gocardless.com/**
2. La login: **pornește întâi comutatorul** „I agree to … Terms & Conditions" —
   până nu-l pornești, butoanele (inclusiv „Log in with Google") rămân moarte.
3. După login: **Developers → User Secrets → Create new**.
4. Copiază `Secret ID` și `Secret Key`.

**Cum știi că ești unde trebuie:** în bara de adresă scrie
`bankaccountdata.gocardless.com`, nu `manage.` și nu `developer.`.

---

## 4. LEGAREA CONTULUI REVOLUT — 3 minute

**Cine:** tu (consimțământul bancar e al tău, prin lege).

În același portal:

1. **Bank connections** (sau „Requisitions") → **Add / Connect a bank**.
2. Alegi **Revolut** din listă (id-ul lui e `REVOLUT_REVOGB21`).
3. Te duce pe pagina Revolut, unde **aprobi accesul de CITIRE**. Confirmi în
   aplicația de pe telefon.
4. La final îți dă un **Account ID** — un șir lung. Copiază-l.

**Cum știi că a mers:** contul apare în listă cu starea `LINKED`, iar Account
ID-ul e vizibil.

> **De reținut, ca să nu te ia prin surprindere:** consimțământul ăsta **expiră**
> (regula europeană PSD2 — între 30 și 90 de zile) și trebuie reînnoit de tine,
> cu aceiași pași. Aplicația **te anunță** când nu mai poate citi — vezi §6.

---

## 5. CHEILE ÎN GITHUB — 2 minute

**Cine:** tu. **Eu nu am unealtă care să scrie secrete în GitHub** — nici nu e
rău că nu am: sunt cheile tale.

Intri pe **https://github.com/kelion-team/kelionai/settings/secrets/actions**
→ **New repository secret**, de patru ori, cu numele **exact** de mai jos:

| Numele secretului | Ce pui în el |
|---|---|
| `REVOLUT_PAY_LINK` | linkul de la §2 |
| `GOCARDLESS_SECRET_ID` | de la §3 |
| `GOCARDLESS_SECRET_KEY` | de la §3 |
| `GOCARDLESS_ACCOUNT_ID` | de la §4 |

**Numele trebuie scrise identic.** Un nume greșit înseamnă cheie scrisă degeaba
— exact capcana din 30 iul, când `vps-set-env` avea o listă fixă de nume și
linkul Revolut cădea în gol. (Lista e reparată acum și le conține pe toate
patru; asta a fost verificat, nu presupus.)

---

## 6. DUCEREA CHEILOR PE SERVER — 0 minute pentru tine

**Cine:** aplicația. **Ăsta îl pot face eu** — îmi spui „dă drumul" și pornesc
publicarea cheilor.

Dacă vrei s-o faci tu:
**https://github.com/kelion-team/kelionai/actions/workflows/vps-set-env.yml**
→ **Run workflow** → lași „Repornește app-ul" pe **true**.

**Cum știi că a mers:** în jurnalul rulării scrie, pentru fiecare cheie,
`scris (N caractere) — valoarea NU se afișează`. Dacă o cheie lipsește din
listă, n-ai pus-o în GitHub sau ai greșit numele.

---

## 7. PROBA CĂ FUNCȚIONEAZĂ — 5 minute

1. Deschizi **Admin → Bani**. La „Citirea plăților Revolut" trebuie să scrie
   ✅ cu câte intrări a citit. Dacă e ⚠ galben, îți spune exact ce lipsește.
2. Intri cu un cont obișnuit (nu al tău de admin), apeși **adaugă credit**,
   alegi o sumă mică (£10).
3. Primești un cod, gen `KLN-AB23-CD45`.
4. Plătești pe linkul Revolut, **cu codul scris la referință/notă**.
5. În maximum **5 minute**, creditele apar singure în contul acelui user.

**Dacă nu apar:** te uiți iar la rândul din Admin → Bani. Acolo scrie de ce —
nu rămâne tăcut.

---

## 8. CE POATE MERGE PROST, ȘI CE ÎNSEAMNĂ

| Ce vezi | Ce înseamnă | Ce faci |
|---|---|---|
| „nu e configurat (lipsesc cheile GoCardless)" | cheile n-au ajuns în proces | refaci §5 și §6, cu numele exacte |
| „nu e legat contul" | lipsește `GOCARDLESS_ACCOUNT_ID` | refaci §4 |
| „nu pot citi tranzacțiile — consimțământul poate fi expirat" | au trecut cele 30-90 de zile | refaci §4 (doar reaprobarea) |
| plata a intrat, creditele nu | userul n-a scris codul, sau l-a scris greșit | i le dai din Admin → Utilizatori; plata apare oricum în istoric |
| butonul de credit spune că lipsește linkul | `REVOLUT_PAY_LINK` nu e pus | refaci §2 și §5 |

**Nicio plată nu se pierde.** Ce nu se potrivește automat rămâne în tabela
`payment_codes` și în extrasul tău Revolut — se rezolvă cu un click, nu se
evaporă.

---

## 9. DACĂ VREI SĂ SCAPI DE PAȘII 3-4-6 CU TOTUL

Cei doi pași cu portalul (§3, §4) sunt singurii enervanți, și singurii care se
repetă (consimțământul expiră). Există două alternative, ambele fără portal:

**(a) Prin email.** Aplicația **citește deja** cutia `contact@kelionai.app`
(modulul e scris și funcțional). Revolut trimite email la fiecare plată primită.
O singură regulă în Gmail — „de la Revolut → trimite la contact@kelionai.app" —
și potrivirea codului se face din email, nu din API bancar. **Zero conturi noi,
zero consimțământ care expiră.** Riscul: dacă Revolut schimbă formatul mailului,
potrivirea se poate strica — de-aia plasa „plăți neatribuite" rămâne.

**(b) Un procesator cu webhook** (Stripe, Paddle, Gumroad). Configurezi o
singură dată, nu expiră niciodată, dar are comision și e un intermediar în plus
între tine și banii tăi.

Codul de potrivire e același în toate variantele — se schimbă doar **de unde
află** aplicația că a intrat un ban.

---

## 10. CE FACE APLICAȚIA ȘI CE NU FACE, CU BANII TĂI

**Face:** citește tranzacțiile intrate, potrivește codul, dă creditele.

**NU face, prin construcție:**
- nu mișcă bani, nu plătește, nu scoate nimic din cont (accesul e doar de citire);
- nu creditează pe plăți în așteptare, care se pot întoarce — doar pe cele
  confirmate de bancă;
- nu creditează de două ori aceeași plată (index unic pe referința bancară);
- nu ghicește pe un cod stricat — mai bine „neatribuit" decât creditat greșit;
- nu-ți cere niciodată datele cardului, și nu le atinge.
