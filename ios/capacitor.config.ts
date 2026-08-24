import type { CapacitorConfig } from '@capacitor/cli'
import { readFileSync } from 'node:fs'

const product = JSON.parse(readFileSync(new URL('../config/product.json', import.meta.url), 'utf8')) as Record<string, unknown>
if (typeof product.iosBundleId !== 'string' || typeof product.appName !== 'string') {
  throw new Error('config/product.json nu definește identitatea iOS')
}

// Bundle-ul web este construit și copiat local înainte de `cap sync`. Nu seta
// `server.url`/`allowNavigation`: acestea ar muta tot codul de încredere într-o
// pagină remote și ar permite autentificarea Google în WKWebView.
const config: CapacitorConfig = {
  appId: product.iosBundleId,
  appName: product.appName,
  webDir: 'native-dist',
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#0b0a14',
  },
}

export default config
