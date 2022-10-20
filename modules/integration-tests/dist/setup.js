/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* global TAP */

mocha.setup({
  ui: "bdd",
  timeout: 20000,
  reporter: TAP,
});

console.log(mocha.options);

window.TESTS = {};
