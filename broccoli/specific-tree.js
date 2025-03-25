/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const fs = require("fs");
const path = require("path");
const Funnel = require("broccoli-funnel");
const Source = require("broccoli-source");
const MergeTrees = require("broccoli-merge-trees");
const writeFile = require("broccoli-file-creator");
const buildConfig = require("./config");

// Public key for a non-existent private key used to form the
// following static extension ID for development purposes: olooapeelpgjekinbmklbmhbkijanpic
const devManifestKey = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAy+raRuzyIAHCSgCFRNSDRMoKWZx8YY8b4BfepG90e2vWfhPtNTZiEmtWtwSMKwD7kc/0rBQEXa2LzAfoGwFU5FrhApb0CPpw96OE8FeU9L8b9Fws938IOoMHmc75z0GcUhk+njlZhauqdji6qu7Pq8dEuz+YeCFp2tL6ax3TwAuBatKPDsFpsNivl6Y1Ll+eRV7Ss6DQLVQHBextMu03TQYAdotWvoige/9oLLz385oBiCnsxCrevbmqAJB3Hx37Cya3UX71pJJw4gEUsmdzNKRcCsJwwmt3eV0Bg1GPPGgb24HIHRKAUjyXRAbSx8cpSLlt7aKCcrX5Vp5ZMij34QIDAQAB";

function getSpecificsTree() {
  const specificTree = new Funnel(
    new Source.WatchedDir(`specific/${buildConfig.specific}`),
    {
      exclude: ["**/locale"],
    }
  );

  if (buildConfig.environment === "development") {
    const manifestPath = path.join("specific", buildConfig.specific, "manifest.json");

    if (fs.existsSync(manifestPath)) {
      const rawContent = fs.readFileSync(manifestPath, 'utf8');
      const manifestContent = JSON.parse(rawContent);

      manifestContent.key = devManifestKey;

      const manifestFile = writeFile(
        "manifest.json",
        JSON.stringify(manifestContent, null, 2)
      );

      return new MergeTrees([specificTree, manifestFile], {
        overwrite: true,
      });
    }
  }
  return specificTree;
}

module.exports = getSpecificsTree();
