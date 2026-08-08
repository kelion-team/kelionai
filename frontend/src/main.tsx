import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startErrorReporting } from './lib/errorReport'

// Ochii lui Kelion pe F12: erorile browserului pleacă la server, iar Kelion le
// vede în context și diagnostichează real („de ce nu merge X?").
startErrorReporting()

createRoot(document.getElementById('root')!).render(<App />)
