/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Ends with *.wdp.brave.software or *.wdp.brave.com (and wdp-public)
const regexpMatcher = /(?:(?:wdp|wdp-public)[.]brave[.](?:software|com))$/;

// Do not remove headers for these
const whitelist = new Set(); // Not need for exceptions

export function isSafeToRemoveHeaders(hostname) {
  return regexpMatcher.test(hostname) && !whitelist.has(hostname);
}
