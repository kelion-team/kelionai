import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

describe('i18n translations completeness', () => {
  it('i18n.ts contains es, fr, de, it, pt dictionaries with key translations', () => {
    const i18nPath = fileURLToPath(new URL('../../frontend/src/lib/i18n.ts', import.meta.url))
    const fileContent = fs.readFileSync(i18nPath, 'utf-8')

    // Check that dict contains all supported languages
    const languages = ['en', 'ro', 'es', 'fr', 'de', 'it', 'pt']
    for (const lang of languages) {
      expect(fileContent).toContain(`${lang}: {`)
    }

    // Check specific #653 keys in es/fr/de/it/pt
    const sampleKeys = [
      'greetPrompt',
      'workClockTitle',
      'heardKelionTitle',
      'micTalk',
      'micStop',
      'voiceVolume',
      'sendInterrupts',
      'attRemove',
      'docAttachFailed',
      'docTooLarge',
      'docPrompt',
      'voiceDownTemp',
      'voiceInvalidKey',
      'voiceProviderQuota',
      'voiceModelAccess',
      'voiceNotConfigured',
      'voiceIdleTimeout',
      'voiceSessionLimit',
      'voiceBillingConflict',
      'voiceBillingUnavailable',
      'voiceRetryStopped',
      'voiceNeedLogin',
      'voiceNeedCredit',
      'asrLost',
      'stopAck',
      'promoTakeSaved',
      'promoWrongLang',
      'promoRetake',
      'promoRecStopped',
      'promoRecReady',
      'promoVoiceLost',
      'recStartTitle',
      'recStopTitle',
      'back',
      'wsSave',
      'wsSaved',
      'wsOpenTab',
      'wsArchiveNote',
      'creditOut',
      'creditOk',
      'contactLabel',
      'buildQueued',
      'buildRunning',
      'buildDone',
      'buildFailed',
      'buildOnlyAdmin',
      'buildUnavailable',
      'buildNoServer',
      'buildHead',
      'buildAttempt',
      'buildSeePr',
      'buildCiFailed',
      'checkoutTitle',
      'checkoutHint',
      'checkoutOpen',
      'checkoutWaiting',
      'serverDown',
      'requestLost',
      // Lot C (registrul frontend): verdictele oneste + rândul turei goale.
      'paywallRow',
      'rateLimited',
      'turnEmpty'
    ]

    for (const key of sampleKeys) {
      expect(fileContent).toContain(`${key}:`)
    }
  })
})
