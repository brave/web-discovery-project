/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as browser from "../core/browser";
import * as gzip from "../core/gzip";
import webrequest from "../core/webrequest";
import * as http from "../core/http";
import testServer from "../tests/core/http-server";
import events from "../core/events";

export default function (window) {
  Object.assign(window.WDP, {
    TestHelpers: {
      events,
      testServer,
      browser,
      gzip,
      http,
      webrequest,
    },
  });
}
