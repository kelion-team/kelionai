import test from 'node:test'
import assert from 'node:assert/strict'
import { integerBuild } from './appstore-build.mjs'

test('build number iOS este un întreg pozitiv și limitat', () => {
  assert.equal(integerBuild('42', 'build_number'), 42)
  assert.throws(() => integerBuild('0', 'build_number'), /invalid/)
  assert.throws(() => integerBuild('1.2', 'build_number'), /invalid/)
  assert.throws(() => integerBuild('999999999999', 'build_number'), /invalid/)
})
