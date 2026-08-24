const LOW_BATTERY_THRESHOLD = 0.3

export function offlineInstallRisks(
  networkHint: string,
  battery: { level: number; charging: boolean } | null,
): Array<'data_saver' | 'metered_or_slow' | 'low_battery'> {
  const normalizedNetwork = networkHint.trim().toLowerCase()
  const risks: Array<'data_saver' | 'metered_or_slow' | 'low_battery'> = []
  if (normalizedNetwork === 'save-data') risks.push('data_saver')
  else if (/^(cellular|slow-2g|2g|3g)$/.test(normalizedNetwork)) risks.push('metered_or_slow')
  if (battery && !battery.charging && battery.level < LOW_BATTERY_THRESHOLD) risks.push('low_battery')
  return risks
}
