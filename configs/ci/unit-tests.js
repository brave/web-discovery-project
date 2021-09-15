/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const urls = require("../common/urls");

module.exports = {
  platform: "webextension",
  format: "system",
  brocfile: "Brocfile.node.js",
  baseURL: "/",
  testsBasePath: "./build/",
  testem_launchers: ["unit-node"],
  testem_launchers_ci: ["unit-node"],
  settings: {
    ...urls("brave.com"),
    id: "brave@brave.com",
    name: "Brave",
  },
  default_prefs: {},
  bundles: [],
};
