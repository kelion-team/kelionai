# Integrarea GitHub pentru Admin → Constructor

Panoul Constructor nu trimite administratorul la un link GitHub care poate fi
neautentificat. El citește și cere acțiuni GitHub printr-o integrare OAuth
dedicată, exclusiv server-side.

## Configurare

1. Creează o aplicație OAuth GitHub pentru Kelion și autorizează un cont care
   are drept de review/merge numai în repository-ul configurat.
2. Salvează tokenul rezultat în secret store, montat în container ca
   `GITHUB_RELEASE_OAUTH_TOKEN_FILE`. Nu folosi `GITHUB_TOKEN` al publisherului
   și nu expune tokenul în browser, worker, loguri sau chat.
3. Acordă strict permisiunile necesare: `Pull requests: write`, `Checks: read`
   și `Contents: write`. Regula de branch protection rămâne autoritatea finală.
4. Deschide Admin → Constructor. Panoul arată PR-ul, verificările, review-ul,
   disponibilitatea de merge și următoarea acțiune. Dacă integrarea lipsește
   sau GitHub nu răspunde, starea apare explicit; niciun buton nu pretinde
   succes.

Butonul **Aprobă în Keleon** solicită un review GitHub în numele identității
OAuth configurate. Butonul **Integrează în master** devine disponibil numai
după ce verificările și review-ul sunt raportate verzi de GitHub. GitHub poate
refuza în continuare acțiunea prin politici de protecție; Kelion afișează acel
refuz, nu îl ocolește. Deploy-ul rămâne flux separat, cu dovadă live.
