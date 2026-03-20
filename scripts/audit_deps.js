#!/usr/bin/env node
// Copyright (c) 2026 The Brave Authors. All rights reserved.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this file,
// You can obtain one at https://mozilla.org/MPL/2.0/.

'use strict'

const https = require('https')
const { execSync } = require('child_process')

const AUDIT_CONFIG_URL =
  'https://raw.githubusercontent.com/brave/audit-config/main/config.json'

function extractVulnerabilities(auditJson, ignoredAdvisories) {
  const found = []

  // npm 7+ format
  if (auditJson.vulnerabilities) {
    for (const v of Object.values(auditJson.vulnerabilities)) {
      for (const item of v.via) {
        if (typeof item === 'object' && item.url) {
          if (!ignoredAdvisories.includes(item.url)) {
            found.push(item.url)
          }
        }
      }
    }
  }

  // npm 6 format
  if (auditJson.advisories) {
    for (const v of Object.values(auditJson.advisories)) {
      if (!ignoredAdvisories.includes(v.url)) {
        found.push(v.url)
      }
    }
  }

  return found
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
      })
    }).on('error', reject)
  })
}

async function main() {
  const config = await fetchJson(AUDIT_CONFIG_URL)
  const ignoredAdvisories = config.ignore.npm.map((e) => e.advisory)

  if (ignoredAdvisories.length > 0) {
    console.log(`Ignoring npm advisories: ${ignoredAdvisories.join(', ')}`)
  }

  let auditOutput
  try {
    auditOutput = execSync('npm audit --json', { encoding: 'utf8' })
  } catch (err) {
    // npm audit exits non-zero when vulnerabilities exist; capture stdout anyway
    auditOutput = err.stdout
  }

  let auditJson
  try {
    auditJson = JSON.parse(auditOutput)
  } catch {
    console.error('npm audit did not return valid JSON')
    process.exit(1)
  }

  const unignored = extractVulnerabilities(auditJson, ignoredAdvisories)

  if (unignored.length > 0) {
    console.log('Audit failed — unignored vulnerabilities:')
    console.log(JSON.stringify(unignored, null, 2))
    process.exit(1)
  }

  console.log('Audit passed — no unignored vulnerabilities found')
}

module.exports = { extractVulnerabilities }

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
