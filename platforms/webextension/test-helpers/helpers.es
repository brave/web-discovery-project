/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { browser } from "../globals";

export const wrap = (getObj) =>
  new Proxy(
    {},
    {
      get(target, name) {
        const obj = getObj();
        let prop = obj[name];

        if (typeof prop === "function") {
          prop = prop.bind(obj);
        }
        return prop;
      },
      set(target, name, value) {
        const obj = getObj();
        obj[name] = value;
        return true;
      },
    }
  );

const bgWindow = wrap(() => browser.extension.getBackgroundPage().window);
export const win = wrap(() => bgWindow);
export const WDP = wrap(() => bgWindow.WDP);
export const app = wrap(() => bgWindow.WDP.app);

export function getUrl(path) {
  return browser.runtime.getURL(path);
}

export const testServer = wrap(() => win.WDP.TestHelpers.testServer);
