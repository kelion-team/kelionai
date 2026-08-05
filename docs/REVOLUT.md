# Ghid & Cerințe Integrare Revolut (Kelion AI)

Acest document descrie starea integrării Revolut în Kelion AI și pașii necesari pentru ca sistemul de încasări și creditare automată să fie 100% funcțional.

---

## 1. Starea actuală a sistemului (Ce este deja construit)

- **Coduri unice de reîncărcare**: Aplicația generează automat coduri unice de forma `KLN-XXXX-XXXX` (fără caractere ambiguu/confundabile) pentru fiecare cerere de creditare.
- **Interfață Utilizator (`WalletButton.tsx`)**: Modalul de plată afișează codul unic, buton de copiere rapidă și redirecționare către linkul de plată Revolut Pro.
- **Creditare Automată (`crediteazaDupaCod`)**: Funcție idempotentă pe backend care procesează tranzacțiile noi, caută codul `KLN-XXXX-XXXX` în referința/nota plății și alocă soldul o singură dată.
- **Open Banking / PSD2 (`openBanking.ts`)**: Serviciul de fundal interoghează contul Revolut la fiecare 5 minute pentru tranzacții noi de intrare.

---

## 2. Ce TREBUIE pentru Revolut (Cerințe activare)

Pentru ca sistemul să încaseze bani de la clienți și să le crediteze automat contul, sunt necesare următoarele două elemente:

### A. Link de plată Revolut Pro (`REVOLUT_PAY_LINK`)
- **De unde se obține**: Din aplicația mobilă Revolut (Secțiunea **Pro** → **Get paid / Încasează** → **Payment link / Link de plată**, lăsat fără sumă fixă).
- **Unde se configurează**: Se adaugă în secretele aplicației sub cheia `REVOLUT_PAY_LINK` (folosind unealta `secret_pune` sau din interfața GitHub Secrets).
- **Efect**: Deblochează butonul de plată din frontend.

### B. Autorizare Open Banking / PSD2
- **De ce este nevoie**: Cadrul bancar european PSD2 impune autorizarea citirii tranzacțiilor direct de către titularul de cont.
- **Acțiune necesară de la titular (Adrian)**: O dată la 30-90 zile, titularul contului Revolut validează conexiunea din aplicația mobilă Revolut de pe telefon.
- **Efect**: Permite aplicației Kelion AI să citească plățile primite și să extragă codul de creditare din referința plății.

---

## 3. Fluxul complet pentru client

1. Clientul apasă **„Adaugă credit”** în Kelion AI.
2. Aplicația îi generează codul unic `KLN-XXXX-XXXX`.
3. Clientul deschide linkul de plată Revolut Pro și efectuează plata, trecând la **Notă / Referință** codul `KLN-XXXX-XXXX`.
4. În maximum 5 minute, Kelion AI citește plata prin Open Banking, identifică codul și îi alocă soldul în cont.
