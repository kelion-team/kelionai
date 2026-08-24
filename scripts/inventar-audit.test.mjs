import test from 'node:test'
import assert from 'node:assert/strict'
import { amprentaInventar, clasificaFisier, duplicariActiveNejustificate } from './inventar-audit.mjs'

test('clasifică toate familiile relevante fără a ascunde fișiere necunoscute', () => {
  assert.equal(clasificaFisier('backend/src/index.ts'), 'cod')
  assert.equal(clasificaFisier('backend/src/index.test.ts'), 'teste')
  assert.equal(clasificaFisier('.github/workflows/ci.yml'), 'configuratie')
  assert.equal(clasificaFisier('deploy/systemd/worker.timer'), 'configuratie')
  assert.equal(clasificaFisier('frontend/.gitignore'), 'configuratie')
  assert.equal(clasificaFisier('frontend/public/.well-known/apple-app-site-association'), 'configuratie')
  assert.equal(clasificaFisier('ios/ios/App/App/App.entitlements'), 'configuratie')
  assert.equal(clasificaFisier('frontend/public/model.glb'), 'activ-binar')
  assert.equal(clasificaFisier('frontend/public/downloads/app.apk'), 'livrabil-binar')
  assert.equal(clasificaFisier('android/gradle/wrapper/gradle-wrapper.jar'), 'dependente-blocate')
  assert.equal(clasificaFisier('android/gradle/verification-keyring.gpg'), 'dependente-blocate')
  assert.equal(clasificaFisier('android/gradle/verification-keyring.keys'), 'dependente-blocate')
  assert.equal(clasificaFisier('secrets/verification-keyring.gpg'), 'necunoscut')
  assert.equal(clasificaFisier('secrets/verification-keyring.keys'), 'necunoscut')
  assert.equal(clasificaFisier('fisier.fara-clasa'), 'necunoscut')
})

test('amprenta este deterministă și sensibilă la conținut', () => {
  const a = { cale: 'a.ts', categorie: 'cod', octeti: 1, sha256: 'a'.repeat(64) }
  const b = { cale: 'b.ts', categorie: 'cod', octeti: 1, sha256: 'b'.repeat(64) }
  assert.equal(amprentaInventar([a, b]), amprentaInventar([b, a]))
  assert.notEqual(amprentaInventar([a, b]), amprentaInventar([a, { ...b, sha256: 'c'.repeat(64) }]))
})

test('respinge active duplicate, exceptând variantele cerute de platformă', () => {
  const activ = (cale, sha256) => ({ cale, categorie: 'activ-binar', octeti: 1, sha256 })
  expectDuplicates(
    duplicariActiveNejustificate([
      activ('frontend/public/logo.png', 'a'.repeat(64)),
      activ('docs/logo/logo.png', 'a'.repeat(64)),
    ]),
    1,
  )
  expectDuplicates(
    duplicariActiveNejustificate([
      activ('desktop/src-tauri/icons/ios/AppIcon-a.png', 'b'.repeat(64)),
      activ('desktop/src-tauri/icons/ios/AppIcon-b.png', 'b'.repeat(64)),
    ]),
    0,
  )
})

function expectDuplicates(actual, count) {
  assert.equal(actual.length, count)
}
