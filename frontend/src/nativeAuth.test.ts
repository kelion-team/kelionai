import { describe, expect, it } from 'vitest'
import { nativeCallbackParameters, usesTauriSecureStore, validateNativeAuthorizeUrl } from './lib/nativeAuth'

const token = 'A'.repeat(43)
const state = 'B'.repeat(32)

describe('native auth protocol boundary', () => {
  it('acceptă numai authorize first-party cu request opac unic', () => {
    expect(validateNativeAuthorizeUrl(`https://kelionai.app/auth/native/authorize?request=${token}`)).toContain('/auth/native/authorize?request=')
    expect(() => validateNativeAuthorizeUrl(`https://evil.test/auth/native/authorize?request=${token}`)).toThrow(/invalid/)
    expect(() => validateNativeAuthorizeUrl(`https://kelionai.app/auth/native/authorize?request=${token}&next=https://evil.test`)).toThrow(/invalid/)
  })

  it('separă strict callbackurile iOS, Kelion desktop și Constructor desktop', () => {
    expect(nativeCallbackParameters(`https://kelionai.app/auth/native/complete?code=${token}&state=${state}`, 'ios')).toEqual({ code: token, state })
    expect(nativeCallbackParameters(`kelionai://auth/native/complete?code=${token}&state=${state}`, 'desktop')).toEqual({ code: token, state })
    expect(nativeCallbackParameters(`kelionai://auth/native/complete?code=${token}&state=${state}&token=leak`, 'desktop')).toBeNull()
    expect(nativeCallbackParameters(`https://kelionai.app/auth/native/complete?code=${token}&state=${state}`, 'desktop')).toBeNull()
    expect(nativeCallbackParameters(`kelion-constructor://auth/native/complete?code=${token}&state=${state}`, 'constructor-desktop')).toEqual({ code: token, state })
    expect(nativeCallbackParameters(`kelionai://auth/native/complete?code=${token}&state=${state}`, 'constructor-desktop')).toBeNull()
  })

  it('folosește același secure store Tauri pentru ambele aplicații desktop', () => {
    expect(usesTauriSecureStore('desktop')).toBe(true)
    expect(usesTauriSecureStore('constructor-desktop')).toBe(true)
    expect(usesTauriSecureStore('ios')).toBe(false)
    expect(usesTauriSecureStore(null)).toBe(false)
  })
})
