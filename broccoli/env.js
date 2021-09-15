/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const env = (process.env.ENVIRONMENT || "development").toUpperCase();

module.exports = {
  [env]: true,
  INCLUDE_TESTS: process.env.INCLUDE_TESTS,
  SOURCE_MAPS: !(process.env.SOURCE_MAPS === "false"),
  DEBUG_PAGES: !(process.env.SOURCE_DEBUG === "false"),
};
