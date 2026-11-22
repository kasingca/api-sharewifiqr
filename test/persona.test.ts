import assert from 'node:assert/strict'
import test from 'node:test'
import { portalDestination } from '../src/persona.ts'

test('portal routing uses the active account role and the admin configuration', () => {
  assert.equal(portalDestination({ role: 'customer', status: 'active' }, false), '/customer')
  assert.equal(portalDestination({ role: 'admin', status: 'active' }, true), '/admin')
  assert.equal(portalDestination({ role: 'admin', status: 'active' }, false), undefined)
  assert.equal(portalDestination({ role: 'admin', status: 'paused' }, true), undefined)
  assert.equal(portalDestination({ role: 'customer', status: 'paused' }, true), undefined)
})
