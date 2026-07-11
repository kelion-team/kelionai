import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installErrLog } from './lib/errlog.ts'

// Primul lucru, înaintea oricărui render: erorile de consolă se jurnalizează
// pe server ca Kelion să le poată deschide permanent (ordin Adrian, 11 iul).
installErrLog()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
