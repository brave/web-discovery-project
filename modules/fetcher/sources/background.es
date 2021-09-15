/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import background from "../core/base/background";
import inject from "../core/kord/inject";
import Manager from "./manager";
import logger from "./logger";

export default background({
  requiresServices: ["pacemaker"],
  webDiscoveryProject: inject.module("web-discovery-project"),

  async init() {
    this.manager = new Manager(this.webDiscoveryProject);
    try {
      await this.manager.init();
    } catch (ex) {
      logger.error("Unexpected error when trying to initialize fetcher", ex);
    }
  },

  unload() {
    if (this.manager) {
      this.manager.unload();
      this.manager = null;
    }
  },

  status() {
    return {
      visible: true,
    };
  },

  actions: {},
});
