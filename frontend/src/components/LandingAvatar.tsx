import AvatarScene from './AvatarScene'

// AVATARUL DE PE LANDING, ÎNCĂRCAT LENEȘ (11 aug — optimizare bundle): scoate
// three.js + @react-three din calea critică, ca TEXTUL landing-ului să apară
// instant pentru un vizitator nou, iar avatarul 3D să se strecoare după. Scena e
// comună cu Stage-ul (AvatarScene); aici doar încadrarea de landing: cameră mai
// apropiată, lumină-cheie ceva mai tare, fundal mereu. Vizual IDENTIC cu înainte.
export default function LandingAvatar() {
  return <AvatarScene camera={[0, 0.7, 2.4]} keyLight={1.7} />
}
