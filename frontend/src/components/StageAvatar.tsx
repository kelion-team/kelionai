import AvatarScene from './AvatarScene'

// AVATARUL STAGE, ÎNCĂRCAT LENEȘ (11 aug — optimizare bundle): tot three.js +
// @react-three (≈1 MB) stă în chunk-ul ăsta, adus DOAR când se randează scena,
// nu în încărcarea inițială. Interfața aplicației apare instant, avatarul se
// strecoară după (fallback-ul de Suspense e AvatarLoading, prin AvatarScene).
// Scena în sine e comună cu Landing-ul (AvatarScene) — aici doar încadrarea de
// scenă: cameră mai depărtată, transparență (peste monitor), fundal doar când
// monitorul e închis. Vizual IDENTIC cu înainte.
export default function StageAvatar({ monitorOn }: { readonly monitorOn: boolean }) {
  return <AvatarScene camera={[0, -0.25, 4.6]} showBg={!monitorOn} keyLight={1.6} gl={{ alpha: true }} />
}
