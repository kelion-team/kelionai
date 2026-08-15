import { describe, it, expect } from 'vitest'
import { esteModelGeneralGreu, versiune, maiNou } from './modelAutoUpgrade'

describe('modelAutoUpgrade - validare candidați slot greu', () => {
  it('respinge modelele specializate și EAP (video, audio, image, eap, lite etc.)', () => {
    expect(esteModelGeneralGreu('gemini-3.7-flash-video-understanding-eap')).toBe(false)
    expect(esteModelGeneralGreu('gemini-3.1-flash-live-preview')).toBe(false)
    expect(esteModelGeneralGreu('gemini-3.1-flash-image')).toBe(false)
    expect(esteModelGeneralGreu('gemini-2.5-flash-native-audio-preview-12-2025')).toBe(false)
    expect(esteModelGeneralGreu('gemini-2.5-flash-lite')).toBe(false)
    expect(esteModelGeneralGreu('gemini-2.0-flash-lite-preview-02-05')).toBe(false)
    expect(esteModelGeneralGreu('gemini-1.5-flash-8b-tuning')).toBe(false)
  })

  it('acceptă doar modelele generale din familia flash', () => {
    expect(esteModelGeneralGreu('gemini-3.5-flash')).toBe(true)
    expect(esteModelGeneralGreu('gemini-3.7-flash')).toBe(true)
    expect(esteModelGeneralGreu('gemini-3-flash-preview')).toBe(true)
    expect(esteModelGeneralGreu('gemini-2.0-flash')).toBe(true)
    expect(esteModelGeneralGreu('gemini-1.5-flash-002')).toBe(true)
  })

  it('extrage versiunea doar pentru modele generale și compară corect', () => {
    expect(versiune('gemini-3.7-flash-video-understanding-eap')).toBeNull()
    expect(versiune('gemini-3.5-flash')).toEqual([3, 5])
    expect(versiune('gemini-3.7-flash')).toEqual([3, 7])

    const v35 = versiune('gemini-3.5-flash')!
    const v37 = versiune('gemini-3.7-flash')!
    expect(maiNou(v37, v35)).toBe(true)
    expect(maiNou(v35, v37)).toBe(false)
  })
})
