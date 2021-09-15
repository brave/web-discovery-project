/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import platform from "../platform/platform";

export { getResourceUrl } from "../platform/platform";

export function notImplemented() {
  throw new Error("Not implemented");
}

export const isFirefox = platform.isFirefox;
export const isChromium = platform.isChromium;
export const isEdge = platform.isEdge;
export const platformName = platform.platformName;
export const isWebExtension = platformName === "webextension";
export const product = "BRAVE";
