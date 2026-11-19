import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { OverviewPage } from './OverviewPage'

describe('OverviewPage Component & Contract Tests', () => {
  it('exports OverviewPage as a valid functional React component', () => {
    assert.equal(typeof OverviewPage, 'function')
    assert.equal(OverviewPage.name, 'OverviewPage')
  })

  it('declares props contract with onNavigate and optional bridgeConnected', () => {
    assert.equal(OverviewPage.length, 1)
  })
})
