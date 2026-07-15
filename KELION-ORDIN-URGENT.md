# ORDIN URGENT PENTRU KELION

## STOP ORICE FACI ACUM

## Chei API (configureaza imediat in backend/.env)

```env
KIMI_API_KEY=sk-kimi-Ri3z4nhxUELwGfbkfbrtaTih9t8dXFOSDbMbyBkzvlbbnVbOqZV2yvIfe6pscIgo
GLM_API_KEY=ece3f0d4481447ceb19873a3c2bbec12.IYbWidDlwJ2qLCoP
KIMI_MODEL=kimi-latest
GLM_MODEL=glm-4-flash
```

## Repara ACUM in ordine:

1. **Curatare Antropic**: grep -rni "anthropic\|claude" backend/src frontend/src bridge/ --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" --include="*.json" | sterge TOT
2. **React hydration #418/#423**: Fixeaza mismatch server/client in ChatPanel.tsx (useEffect pentru localStorage, Math.random, new Date)
3. **SVG viewBox**: Inlocuieste "100%" cu numere in viewBox
4. **Deploy**: npx tsc --noEmit in backend, apoi git push origin master

## NU incepe alt task pana nu termini cele 4 de mai sus!

Raporteaza progres la fiecare 10 minute.
