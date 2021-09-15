/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { chrome } from "./globals";

const PERMISSIONS = {
  WEB_REQUEST: "webRequest",
  WEB_REQUEST_BLOCKING: "webRequestBlocking",
};

export default {
  PERMISSIONS,
  contains: (permissions) =>
    new Promise((resolve) => {
      chrome.permissions.contains({ permissions }, resolve);
    }),
};
