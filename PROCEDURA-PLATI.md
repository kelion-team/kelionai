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

**Cine:** de pe 30 iul, **Kelion** — vezi §9. Îi spui cheia, o pune el, criptat,
și ți-o confirmă cu numele și lungimea, niciodată cu valoarea. Ce urmează aici e
calea manuală, dacă vrei s-o faci tu.

Intri pe **https://github.com/kelion-team/kelionai/settings/secrets/actions**
→ **New repository secret**, de patru ori, cu numele **exact** de mai jos:

| Numele secretului | Ce pui în el |
|---|---|
| `REVOLUT_PAY_LINK` | linkul de la §2 |
| `GOCARDLESS_SECRET_ID` | de la §3 |
| `GOCARDLESS_SECRET_KEY` | de la §3 |
| `GOCARDLESS_ACCOUNT_ID` | de la §4 |

**Numele trebuie scrise identic** — codul caută cheia sub numele ăla.

**Capcana listei fixe a dispărut de tot (30 iul).** `vps-set-env` avea o listă de
nume scrisă de mână; o cheie care nu era în ea se scria în GitHub și **nu ajungea
niciodată pe server**, fără niciun semn — exact ce a pățit `REVOLUT_PAY_LINK`.
Acum workflow-ul ia **toate** secretele de la GitHub, deci o cheie nouă nu mai
poate cădea în gol.

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

## 9. CINE FACE SETĂRILE: EL, NU TU

**30 iul, cerința ta:** „să creeze secretele și să le pună unde trebuie, e al meu
și îi permit full acces."

Kelion are de acum trei unelte, pe scris și pe voce:

| Unealta | Ce face |
|---|---|
| `secret_lista` | vede ce chei există (doar **numele** — GitHub nu dă valorile nimănui) |
| `secret_pune` | scrie o cheie în secretele repo-ului, **criptată** |
| `secret_publica` | o duce pe server și repornește aplicația |

Deci pașii §5 și §6 de mai sus **nu mai sunt treaba ta**: îi spui ce vrei
configurat, el o face și îți raportează **numele cheii și starea**. Le-am lăsat
scrise ca să le poți face tu oricând, nu fiindcă trebuie.

**Ce nu se întâmplă, prin construcție:** valoarea unei chei nu se repetă în chat,
nu ajunge pe monitor, nu se scrie într-un fișier din repo, nu apare în niciun
jurnal — se raportează numele și câte caractere are. Un număr de card e refuzat
din start, oricine ar cere-o.

**Ce rămâne al tău:** cheia pe care doar Revolut o poate emite. Aia i-o dai o
singură dată, iar el o pune unde trebuie. **Nu prin email** — plata nu se
citește din inbox (30 iul: „ce ai făcut cu email scoți imediat").

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
