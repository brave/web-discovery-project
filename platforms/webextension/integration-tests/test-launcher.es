/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { chrome } from "../globals";

export default function (indexFilePath, { grep, autostart, invert, retries }) {
  let url = `/modules/${indexFilePath}?autostart=${autostart}`;

  if (invert === "true") {
    url = `${url}&invert=true`;
  }

  if (grep) {
    url = `${url}&grep=${grep}`;
  }

  if (retries) {
    url = `${url}&retries=${grep}`;
  }

  return chrome.runtime.getURL(url);
}
