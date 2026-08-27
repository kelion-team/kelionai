# Integrarea GitHub pentru Admin → Constructor

Panoul Constructor nu trimite administratorul la un link GitHub care poate fi
neautentificat. El citește și cere acțiuni GitHub printr-o integrare OAuth
dedicată, exclusiv server-side.

## Configurare

1. Autorizează o identitate GitHub user-bound dedicată review-ului, diferită de
   autorul PR-urilor Constructor și cu rol `write` numai în repository-ul
   configurat.
2. Acordă strict `Pull requests: write`, `Checks: read`, `Actions: read`,
   `Contents: read` și `Administration: read`; `Metadata: read` rămâne implicit.
   Validează tokenul pe toate endpointurile citite de integrare înainte de
   provisionare.
3. Salvează tokenul ca environment secret `production` cu numele
   `RELEASE_GITHUB_TOKEN`. Workflow-ul îl montează în container ca
   `GITHUB_RELEASE_OAUTH_TOKEN_FILE`. Nu folosi `GITHUB_TOKEN` al publisherului
   și nu expune tokenul în browser, worker, loguri sau chat.
4. Deschide Admin → Constructor. Panoul arată PR-ul, verificările, review-ul,
   disponibilitatea de merge și următoarea acțiune. Dacă integrarea lipsește
   sau GitHub nu răspunde, starea apare explicit; niciun buton nu pretinde
   succes.

Butonul **Aprobă în Keleon** solicită un review GitHub în numele identității
configurate. Butonul **Integrează în master** devine disponibil numai
după ce verificările și review-ul sunt raportate verzi de GitHub. GitHub poate
refuza în continuare acțiunea prin politici de protecție; Kelion afișează acel
refuz, nu îl ocolește. Deploy-ul rămâne flux separat, cu dovadă live.
