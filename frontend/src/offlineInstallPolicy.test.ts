import { describe, expect, it } from 'vitest'
import { offlineInstallRisks } from './lib/offlineInstallPolicy'

describe('offline kit download consent policy', () => {
  it('requires extra consent for data saver and low uncharged battery', () => {
    expect(offlineInstallRisks('save-data', { level: 0.19, charging: false }))
      .toEqual(['data_saver', 'low_battery'])
  })

  it('treats cellular and slow effective connections as risky', () => {
    expect(offlineInstallRisks('cellular', null)).toEqual(['metered_or_slow'])
    expect(offlineInstallRisks('3g', { level: 0.8, charging: false })).toEqual(['metered_or_slow'])
  })

  it('does not add an extra gate on Wi-Fi or a charging device', () => {
    expect(offlineInstallRisks('wifi', { level: 0.1, charging: true })).toEqual([])
    expect(offlineInstallRisks('4g', null)).toEqual([])
  })
})
