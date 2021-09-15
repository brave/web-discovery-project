/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import background from "../core/base/background";
import Manager from "./manager";
import config from "../core/config";
import prefs from "../core/prefs";
import logger from "./logger";

export default background({
  requiresServices: ["pacemaker"],
  init() {
    this.manager = new Manager();
    this.manager.init().catch((e) => {
      logger.error("Unexpected error when trying to initialize hpnv2", e);
    });
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
      state: prefs.get("hpn-query"),
    };
  },

  actions: {
    async send(...args) {
      return this.manager.send(...args);
    },
    async sendLegacy(msg) {
      const { action, payload, rp } = msg;
      if (action === "instant") {
        if (rp.startsWith(config.settings.ENDPOINT_SAFE_QUORUM_ENDPOINT)) {
          const path = rp.replace(
            config.settings.ENDPOINT_SAFE_QUORUM_ENDPOINT,
            ""
          );
          const res = await this.manager.send({
            action: "safe-browsing-quorum",
            path,
            payload,
            method: "GET",
          });
          const { result } = await res.json();
          if (result === undefined) {
            throw new Error(
              'Could not parse result from quorum server (expected "result" field)'
            );
          }
          return result;
        }

        throw new Error(`hpnv2: instant not implemented ${rp}`);
      }

      if (action === "extension-result-telemetry") {
        const res = await this.manager.send({
          action,
          payload: `q=${payload}`,
          method: "GET",
        });
        const text = await res.text();
        return text;
      }

      throw new Error(`Unknown legacy msg action ${action}`);
    },
    async sendInstantMessage(rp, payload) {
      const message = {
        action: "instant",
        type: "wdp",
        ts: "",
        ver: "1.5",
        payload,
        rp,
      };
      return this.actions.sendLegacy(message);
    },
    async sendTelemetry(msg) {
      return this.actions.send(msg);
    },
    async telemetry(msg) {
      return this.actions.sendTelemetry(msg);
    },

    /**
     * Provides an interface to the trusted clock in hpnv2.
     *
     * It provides a server synchronized, low-resolution clock (expect no
     * higher resolution than to the nearest minute).
     *
     * In hpnv2, the synchronization is needed to to eliminate drift (if the
     * system clock is unreliable on the user's machine) and to detect edge case
     * where the local system time jumps (typcially it jumps ahead, for example,
     * if a machine awakes from suspend).
     *
     * Warning: Be careful if "inSync" is false. You will still get an estimate
     * of the time, but if possible you should discard it and wait for the
     * clock to get in sync again.
     */
    getTime() {
      const { inSync, minutesSinceEpoch } =
        this.manager.trustedClock.checkTime();
      const msSinceEpoche = minutesSinceEpoch * 60 * 1000;
      const utcTimestamp = new Date(msSinceEpoche);
      return {
        inSync,
        minutesSinceEpoch,
        utcTimestamp,
      };
    },
  },
});
