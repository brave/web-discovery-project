/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const urls = require("../common/urls");

module.exports = {
  platform: "webextension",
  specific: "web-discovery-project",
  baseURL: "/modules/",
  testsBasePath: "./build/modules",
  settings: {
    ...urls("sandbox"),
    channel: "99",
    ALLOWED_COUNTRY_CODES: [
      "de",
      "at",
      "ch",
      "es",
      "us",
      "fr",
      "nl",
      "gb",
      "it",
      "se",
    ],
    WDP_CHANNEL: "test",
  },
  default_prefs: {},
  modules: [
    "content-script-tests",
    "core",
    "hpnv2",
    "web-discovery-project",
    "integration-tests",
    "webextension-specific",
    "webrequest-pipeline",
  ],
  bundles: [
    "core/content-script.bundle.js",
    "core/content-tests.bundle.js",
    "hpnv2/worker.asmjs.bundle.js",
    "hpnv2/worker.wasm.bundle.js",
    "integration-tests/run.bundle.js",
    "webextension-specific/app.bundle.js",
  ],
  builderDefault: {
    globalDeps: {
      chai: "chai",
    },
  },
};
