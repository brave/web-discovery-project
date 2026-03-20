const { strict: assert } = require('assert')
const { extractVulnerabilities } = require('../scripts/audit_deps.js')

describe('extractVulnerabilities', () => {
  it('returns empty array when there are no vulnerabilities', () => {
    const auditJson = { vulnerabilities: {} }
    const ignored = []
    assert.deepEqual(extractVulnerabilities(auditJson, ignored), [])
  })

  it('returns advisory URL for a non-ignored vulnerability', () => {
    const url = 'https://github.com/advisories/GHSA-1234-5678-abcd'
    const auditJson = {
      vulnerabilities: {
        foo: { via: [{ url }] }
      }
    }
    assert.deepEqual(extractVulnerabilities(auditJson, []), [url])
  })

  it('filters out ignored advisory URLs', () => {
    const url = 'https://github.com/advisories/GHSA-1234-5678-abcd'
    const auditJson = {
      vulnerabilities: {
        foo: { via: [{ url }] }
      }
    }
    assert.deepEqual(extractVulnerabilities(auditJson, [url]), [])
  })

  it('skips via entries that are strings (transitive references)', () => {
    const auditJson = {
      vulnerabilities: {
        foo: { via: ['bar'] }
      }
    }
    assert.deepEqual(extractVulnerabilities(auditJson, []), [])
  })

  it('handles npm 6 advisories format', () => {
    const url = 'https://github.com/advisories/GHSA-1234-5678-abcd'
    const auditJson = {
      advisories: {
        123: { url }
      }
    }
    assert.deepEqual(extractVulnerabilities(auditJson, []), [url])
  })

  it('filters out ignored advisories in npm 6 format', () => {
    const url = 'https://github.com/advisories/GHSA-1234-5678-abcd'
    const auditJson = {
      advisories: {
        123: { url }
      }
    }
    assert.deepEqual(extractVulnerabilities(auditJson, [url]), [])
  })
})
