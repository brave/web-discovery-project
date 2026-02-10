# npm Audit Fix - web-ext Upgrade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade web-ext from 7.12.0 to 9.2.0 to resolve moderate SSRF vulnerability (CVE in request package)

**Architecture:** Direct dependency upgrade with verification testing. The vulnerability chain is: request → sign-addon → web-ext. Upgrading web-ext to 9.x removes the deprecated request dependency. No breaking API changes affect our usage since we use the programmatic API (not config files).

**Tech Stack:** npm, web-ext 9.2.0, Node.js 18+

**Security Context:** Addresses GHSA-p8p7-x288-28g6 (Server-Side Request Forgery) in request@<=2.88.2. While the package is deprecated and the risk is moderate (CVSS 6.1), upgrading eliminates the vulnerability entirely.

---

## Analysis Summary

**Current state:**
- web-ext@7.12.0 depends on sign-addon which depends on deprecated request package
- 3 moderate vulnerabilities reported (all in the request → sign-addon → web-ext chain)
- npm audit suggests upgrading to web-ext@9.2.0

**Breaking changes review (v7.12.0 → v9.2.0):**
- Config file format change (.js → .cjs/.mjs): Does NOT affect us - we don't use config files
- Node.js 18+ requirement: SATISFIED (current: v24.11.1, npm: 11.6.2)
- API usage: Our programmatic usage via `webExt.cmd.run()` remains unchanged

**Usage in codebase:**
- `tests/runners/launchers/brave-web-ext.js:40` - uses dynamic import
- `tests/runners/launchers/firefox-web-ext.js:1` - uses require()
- `package.json:14` - CLI usage in npm script
- `configs/extension.js:12` - CLI usage for build command

---

## Task 1: Verify Current Test Baseline

**Files:**
- No modifications needed

**Step 1: Run integration tests with current version**

Run the same tests that CI runs to establish baseline:

```bash
npm test -- configs/ci/integration-tests.js -l brave-web-ext --grep UtilityRegression -i
```

Expected: Tests should pass (or document current failures unrelated to web-ext)

**Step 2: Test Firefox launcher**

```bash
npm test -- configs/ci/integration-tests.js -l firefox-web-ext --grep UtilityRegression -i
```

Expected: Tests pass or document baseline state

**Step 3: Document baseline**

Create a baseline record:

```bash
echo "Baseline tests completed at $(date)" > /tmp/baseline-$(date +%Y%m%d).txt
```

**Step 4: Commit baseline documentation**

```bash
git add docs/plans/2026-02-10-npm-audit-web-ext-upgrade.md
git commit -m "docs: add npm audit web-ext upgrade plan"
```

---

## Task 2: Upgrade web-ext Dependency

**Files:**
- Modify: `package.json:117`
- Modify: `package-lock.json` (via npm install)

**Step 1: Update package.json version**

In `package.json`, change line 117:

```json
    "web-ext": "9.2.0",
```

**Step 2: Install new version**

```bash
npm install
```

Expected: npm successfully installs web-ext@9.2.0 and updates package-lock.json

**Step 3: Verify audit results**

```bash
npm audit
```

Expected: The 3 moderate vulnerabilities (request, sign-addon, web-ext) should be resolved. Output should show 0 vulnerabilities.

**Step 4: Check installed version**

```bash
npx web-ext --version
```

Expected: Output shows version 9.2.0

**Step 5: Commit the upgrade**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): upgrade web-ext from 7.12.0 to 9.2.0

Resolves npm audit vulnerabilities:
- GHSA-p8p7-x288-28g6 (SSRF in request package)
- Eliminates deprecated request dependency chain

Breaking changes review:
- Config file format change does not affect us (no config files)
- Node.js 18+ requirement satisfied (using v24)
- Programmatic API usage unchanged"
```

---

## Task 3: Verify CLI Usage Works

**Files:**
- No modifications needed

**Step 1: Test npm start:brave script**

Set environment variable and test:

```bash
export BRAVE_PATH="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
npm run build-dev
```

Expected: Build completes successfully

**Step 2: Verify web-ext CLI in build script**

```bash
npm run build && npx web-ext build --source-dir build --artifacts-dir . --overwrite-dest
```

Expected: Extension builds successfully, creates .zip artifact

**Step 3: Test manual CLI invocation**

```bash
npx web-ext lint --source-dir=./build
```

Expected: web-ext runs successfully (may report lint issues, but command works)

---

## Task 4: Verify Programmatic API - Brave Launcher

**Files:**
- Test: `tests/runners/launchers/brave-web-ext.js`

**Step 1: Run unit test for brave launcher**

```bash
npm test -- tests/runners/launchers/brave-web-ext.js
```

Expected: Test passes or runs without import/API errors

**Step 2: Run integration tests with brave-web-ext**

```bash
npm test -- configs/ci/integration-tests.js -l brave-web-ext --grep UtilityRegression -i
```

Expected: Tests pass with same results as baseline (Task 1)

**Step 3: Verify dynamic import works**

Check that the ESM import at line 40 works correctly with v9:

```bash
node -e "import('web-ext').then(w => console.log('Import successful:', w.default.cmd.run ? 'API available' : 'API missing'))"
```

Expected: Output shows "Import successful: API available"

---

## Task 5: Verify Programmatic API - Firefox Launcher

**Files:**
- Test: `tests/runners/launchers/firefox-web-ext.js`

**Step 1: Run integration tests with firefox-web-ext**

```bash
npm test -- configs/ci/integration-tests.js -l firefox-web-ext --grep UtilityRegression -i
```

Expected: Tests pass with same results as baseline

**Step 2: Verify require() import works**

Check that CommonJS require at line 1 works with v9:

```bash
node -e "const w = require('web-ext'); console.log('Require successful:', w.cmd.run ? 'API available' : 'API missing')"
```

Expected: Output shows "Require successful: API available"

**Step 3: Verify Firefox prefs handling**

Run a quick smoke test:

```bash
npm test -- tests/runners/launchers/firefox-web-ext.js
```

Expected: No errors related to prefs or API changes

---

## Task 6: Run Full Test Suite

**Files:**
- No modifications needed

**Step 1: Run complete integration test suite**

```bash
npm test -- configs/ci/integration-tests.js
```

Expected: All tests pass (or same baseline failures as Task 1)

**Step 2: Run content script tests**

```bash
npm test -- modules/content-script-tests/tests/integration/content-script-test.es
```

Expected: Tests pass

**Step 3: Run web-discovery-project tests**

```bash
npm test -- modules/web-discovery-project/tests/integration/web-discovery-project-test.es
```

Expected: Tests pass

**Step 4: Document test results**

```bash
echo "Full test suite completed successfully at $(date)" >> /tmp/baseline-$(date +%Y%m%d).txt
```

---

## Task 7: Verify Regression Tests (CI Simulation)

**Files:**
- No modifications needed

**Step 1: Run regression tests**

Simulate CI environment:

```bash
npm test -- configs/ci/integration-tests.js -l brave-web-ext --grep UtilityRegression -i
```

Expected: Tests pass

**Step 2: Verify no new warnings**

Check for deprecation warnings:

```bash
npm test -- configs/ci/integration-tests.js -l brave-web-ext 2>&1 | grep -i "deprecat"
```

Expected: No new deprecation warnings related to web-ext

**Step 3: Final audit check**

```bash
npm audit
```

Expected: 0 vulnerabilities

**Step 4: Commit test verification**

```bash
git commit --allow-empty -m "test: verify web-ext 9.2.0 upgrade compatibility

All integration tests pass:
- brave-web-ext launcher works
- firefox-web-ext launcher works
- CLI usage functional
- npm audit clean (0 vulnerabilities)"
```

---

## Task 8: Update Documentation (Optional)

**Files:**
- Modify: `README.md` (if web-ext version is mentioned)
- Modify: `.github/workflows/*.yml` (if Node version needs update)

**Step 1: Check if README mentions web-ext version**

```bash
grep -n "web-ext" README.md | grep -i "version\|7.12"
```

Expected: If found, update to 9.2.0; if not found, no changes needed

**Step 2: Verify CI Node version**

```bash
grep -n "node" .github/workflows/integration-tests.yml
```

Expected: Should be using Node 18+ (currently ubuntu-24.04 includes Node 20+)

**Step 3: Commit documentation updates if any**

```bash
git add README.md .github/workflows/*.yml
git commit -m "docs: update web-ext references to 9.2.0" || echo "No docs to update"
```

---

## Task 9: Final Verification and Cleanup

**Files:**
- No modifications needed

**Step 1: Clean install verification**

```bash
rm -rf node_modules package-lock.json
npm install
```

Expected: Clean install succeeds

**Step 2: Final audit**

```bash
npm audit
```

Expected: 0 vulnerabilities reported

**Step 3: Build verification**

```bash
npm run build
```

Expected: Production build succeeds

**Step 4: Tag completion**

```bash
git tag -a npm-audit-fix-web-ext-v9.2.0 -m "Fix: Upgrade web-ext to 9.2.0, resolve SSRF vulnerabilities"
```

---

## Rollback Plan

If issues arise during testing:

```bash
# Rollback to 7.12.0
git checkout HEAD~1 package.json package-lock.json
npm install
npm test
```

## Success Criteria

- [ ] npm audit reports 0 vulnerabilities
- [ ] All integration tests pass
- [ ] Both brave-web-ext and firefox-web-ext launchers work
- [ ] CLI commands (npm scripts) work
- [ ] No new errors or warnings in test output
- [ ] Clean install works

## Notes

- The upgrade is low-risk because we only use the programmatic API (`webExt.cmd.run()`)
- Config file breaking changes don't affect us (we don't use config files)
- Node.js requirement already met
- The vulnerability is moderate (not critical), but good security hygiene to fix
