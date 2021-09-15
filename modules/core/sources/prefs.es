/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { getPref, setPref, hasPref, clearPref, init } from "../platform/prefs";
import config from "./config";

export default {
  /**
   * Get a value from preferences db
   * @param {string}  pref - preference identifier
   * @param {*=}      defautlValue - returned value in case pref is not defined
   */
  get(pref, defaultValue) {
    let value = defaultValue;
    if (config.default_prefs) {
      value =
        typeof config.default_prefs[pref] === "undefined"
          ? defaultValue
          : config.default_prefs[pref];
    }
    return getPref(pref, value);
  },
  /**
   * Set a value in preferences db
   * @param {string}  pref - preference identifier
   * @param {*=}      value
   */
  set: setPref,

  /**
   * Check if there is a value in preferences db
   * @param {string}  pref - preference identifier
   */
  has: hasPref,
  /**
   * Clear value in preferences db
   * @param {string}  pref - preference identifier
   */
  clear: clearPref,

  /**
   * Set a value of type object in preferences db
   * @param {string}  pref - preference identifier
   */
  getObject(key, ...rest) {
    return JSON.parse(this.get(key, "{}", ...rest));
  },

  /**
   * Set a value in preferences db
   * @param {string}  pref - preference identifier
   * @param {object|function}
   */
  setObject(key, value, ...rest) {
    if (value instanceof Function) {
      const prevValue = this.getObject(key);
      const newValue = value(prevValue);
      this.setObject(key, newValue, ...rest);
    } else if (typeof value === "object") {
      this.set(key, JSON.stringify(value), ...rest);
    } else {
      throw new TypeError();
    }
  },

  init,
};
