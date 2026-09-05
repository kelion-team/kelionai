# Integrarea GitHub pentru Admin → Constructor

Panoul Constructor citește dovezile GitHub prin integrarea dedicată,
exclusiv server-side. Publisherul separat efectuează automat merge-ul după
verificări; panoul nu cere aprobări manuale și nu execută merge/deploy.

## Configurare

1. Folosește identitatea GitHub dedicată citirii dovezilor numai în
   repository-ul configurat. Nu este necesar un al doilea cont pentru
   aprobarea manuală a PR-urilor.
2. Integrarea de citire necesită `Pull requests: read`, `Checks: read`, `Actions: read`,
   `Contents: read` și `Administration: read`; `Metadata: read` rămâne implicit.
   Validează tokenul pe toate endpointurile citite de integrare înainte de
   provisionare.
3. Salvează tokenul ca environment secret `production` cu numele
   `RELEASE_GITHUB_TOKEN`. Workflow-ul îl montează în container ca
   `GITHUB_RELEASE_OAUTH_TOKEN_FILE`. Nu folosi `GITHUB_TOKEN` al publisherului
   și nu expune tokenul în browser, worker, loguri sau chat.
4. Deschide Admin → Constructor. Panoul arată PR-ul, verificările, politica
   de review GitHub, starea merge-ului automat și următoarea etapă. Dacă integrarea lipsește
   sau GitHub nu răspunde, starea apare explicit; niciun buton nu pretinde
   succes.

Nu există buton sau endpoint pentru aprobarea manuală a publicării în Kelion.
Publisherul reverifică imediat înainte de merge identitatea PR-ului, head-ul,
controalele verzi și protecția ramurii. Pragul de review real din GitHub poate
fi zero; dacă este mai strict, rămâne obligatoriu și nu este ocolit. Erorile
de citire rămân stări necunoscute, nu permisiune de merge. Release-ul separat
continuă automat și declară finalizarea numai după dovada versiunii live.
