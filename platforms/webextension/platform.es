/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { chrome } from "./globals";

function checkUserAgent(pattern) {
  try {
    return navigator.userAgent.indexOf(pattern) !== -1;
  } catch (e) {
    return false;
  }
}

const def = {
  isFirefox: checkUserAgent("Firefox"),
  isChromium: checkUserAgent("Chrome"),
  isEdge: checkUserAgent("Edge"),
  platformName: "webextension",
};

export default def;

export function getResourceUrl(path) {
  return chrome.runtime.getURL(`modules/${path}`.replace(/\/+/g, "/"));
}
