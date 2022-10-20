/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import chai from "chai";
import { app, wrap } from "../../platform/test-helpers/helpers";
import { wait } from "../../core/helpers/wait";

export * from "../../platform/test-helpers/helpers";
export { wait, waitFor } from "../../core/helpers/wait";

export { testPageSources } from "../../platform/integration-tests/test-page-sources";

// Re-export some browser utils
export { closeTab, newTab, updateTab, getTab } from "../../platform/tabs";

/**
 * The following helpers are platform independents and can be implemented
 * directly in core.
 */

export const Events = wrap(() => app.events);

export const prefs = wrap(() => app.prefs);

export const sleep = wait;

export function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export const expect = chai.expect;
export { chai };
