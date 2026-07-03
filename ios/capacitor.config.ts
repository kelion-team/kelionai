import type { CapacitorConfig } from '@capacitor/cli'

// Kelionai iOS — the same thin-shell architecture as Windows/Android: the
// native app loads the LIVE web app, so every deploy reaches iPhone users
// instantly with no App Store re-submission. Only the shell (icon, permissions)
// ever needs a rebuild.
const config: CapacitorConfig = {
  appId: 'app.kelionai.ios',
  appName: 'Kelionai',
  webDir: 'www',
  server: {
    url: 'https://kelionai.app',
    allowNavigation: ['kelionai.app', 'accounts.google.com'],
  },
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#0b0a14',
  },
}

export default config
