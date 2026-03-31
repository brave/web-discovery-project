#!/usr/bin/env node
// Copyright (c) 2026 The Brave Authors. All rights reserved.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this file,
// You can obtain one at https://mozilla.org/MPL/2.0/.

'use strict'

const { execSync } = require('child_process')

const AUDIT_CONFIG_URL =
  'https://raw.githubusercontent.com/brave/audit-config/main/config.json'

function extractVulnerabilities(auditJson, ignoredAdvisories) {
  return Object.values(auditJson.vulnerabilities ?? {})
    .flatMap((v) => v.via)
    .filter((item) => typeof item === 'object' && item.url)
    .map((item) => item.url)
    .filter((url) => !ignoredAdvisories.includes(url))
    .filter((url, i, arr) => arr.indexOf(url) === i)
}

async function fetchIgnoredAdvisories() {
  const res = await fetch(AUDIT_CONFIG_URL)
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${AUDIT_CONFIG_URL}`)
  const config = await res.json()
  return config.ignore.npm.map((e) => e.advisory)
}

function runNpmAudit() {
  let output
  try {
    output = execSync('npm audit --json', { encoding: 'utf8' })
  } catch (err) {
    // npm audit exits non-zero when vulnerabilities exist; capture stdout anyway
    output = err.stdout
  }
  try {
    return JSON.parse(output)
  } catch {
    console.error('npm audit did not return valid JSON')
    process.exit(1)
  }
}

async function main() {
  const ignoredAdvisories = await fetchIgnoredAdvisories()

  if (ignoredAdvisories.length > 0) {
    console.log(`Ignoring npm advisories: ${ignoredAdvisories.join(', ')}`)
  }

  const auditJson = runNpmAudit()
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
