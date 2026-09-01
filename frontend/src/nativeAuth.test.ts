import { describe, expect, it } from 'vitest'
import { nativeCallbackParameters, validateNativeAuthorizeUrl } from './lib/nativeAuth'

const token = 'A'.repeat(43)
const state = 'B'.repeat(32)

describe('native auth protocol boundary', () => {
  it('acceptă numai authorize first-party cu request opac unic', () => {
    expect(validateNativeAuthorizeUrl(`https://kelionai.app/auth/native/authorize?request=${token}`)).toContain('/auth/native/authorize?request=')
    expect(() => validateNativeAuthorizeUrl(`https://evil.test/auth/native/authorize?request=${token}`)).toThrow(/invalid/)
    expect(() => validateNativeAuthorizeUrl(`https://kelionai.app/auth/native/authorize?request=${token}&next=https://evil.test`)).toThrow(/invalid/)
  })

  it('separă strict callbackurile iOS și desktop și refuză parametri suplimentari', () => {
    expect(nativeCallbackParameters(`https://kelionai.app/auth/native/complete?code=${token}&state=${state}`, 'ios')).toEqual({ code: token, state })
    expect(nativeCallbackParameters(`kelionai://auth/native/complete?code=${token}&state=${state}`, 'desktop')).toEqual({ code: token, state })
    expect(nativeCallbackParameters(`kelionai://auth/native/complete?code=${token}&state=${state}&token=leak`, 'desktop')).toBeNull()
    expect(nativeCallbackParameters(`https://kelionai.app/auth/native/complete?code=${token}&state=${state}`, 'desktop')).toBeNull()
  })
})
