// Sursa canonică semantică → clip RPM, consumată de backend și frontend.
// Orice gest nou se adaugă o singură dată aici, ca filtrarea adminului și
// redarea avatarului să nu poată diverge.
export const GESTURE_TO_CLIP: Readonly<Record<string, string>> = Object.freeze({
  salut: 'expresie-1',
  'arata-inainte': 'expresie-2',
  uimire: 'expresie-3',
  dezamagire: 'expresie-4',
  nedumerire: 'expresie-5',
  victorie: 'expresie-6',
  multumire: 'expresie-7',
  surpriza: 'expresie-8',
  'stai-putin': 'expresie-9',
  ganditor: 'expresie-10',
  aprobare: 'expresie-11',
  entuziasm: 'expresie-12',
  'acord-discret': 'expresie-13',
  plecaciune: 'expresie-14',
  dans: 'dans',
  salute: 'expresie-1',
  raiseRightHand: 'expresie-13',
  pointMonitor: 'expresie-2',
})
