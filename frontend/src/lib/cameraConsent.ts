const CAMERA_IMAGE_INTENT =
  /\b(ce vezi|uit[ăa]-te|prive[șs]te|arat[ăa]-mi ce vezi|look|what (?:do|can) you see|show me what you see|mira|qu[ée] ves|regarde|que vois-tu|sieh|was siehst du|guarda|cosa vedi|olha|o que v[êe]s|camera)\b/i

export function cameraImageRequested(text: string): boolean {
  return CAMERA_IMAGE_INTENT.test(text)
}

export function cameraActivationAllowed(alreadyActive: boolean, askConsent: () => boolean): boolean {
  return alreadyActive || askConsent()
}
