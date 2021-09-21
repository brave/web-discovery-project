/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* eslint func-names: 'off' */

import prefs from "../core/prefs";
import background from "../core/base/background";
import WebDiscoveryProject from "./web-discovery-project";
import history from "../core/history-service";
import inject from "../core/kord/inject";
import WebRequest from "../core/webrequest";
import logger from "./logger";

/**
 * @namespace web-discovery-project
 * @class Background
 */
export default background({
  requiresServices: ["pacemaker"],

  hpn: inject.module("hpnv2"),

  /**
   * @method enabled
   * @return pref
   */
  enabled() {
    return prefs.get("modules.web-discovery-project.enabled", true);
  },

  /**
   * @method init
   */
  init(settings) {
    // Protection: By default, skip all wdp listeners.
    // Only allow it if the user has not opted out
    // and if wdp is fully initialized.
    //
    // (Note: Opt-out is clear, but the reason why it is also disabled
    //  during initialization is mainly to prevent any race conditions
    //  that we would otherwise had to deal with. Startup should
    //  not take too long, anyway.)
    this.collecting = false;
    this.settings = settings;

    this.webDiscoveryProject = WebDiscoveryProject;
    WebDiscoveryProject.hpn = this.hpn;

    const pendingInit = (this._pendingInits || Promise.resolve()).then(() => {
      if (!this.enabled()) {
        // The module is technically loaded, but wdp will not collect any data.
        this.active = true;
        this.collecting = false;
        return undefined;
      }

      return WebDiscoveryProject.init().then(() => {
        this.onHeadersReceivedListener = (...args) =>
          WebDiscoveryProject.httpObserver.observeActivity(...args);
        WebRequest.onHeadersReceived.addListener(
          this.onHeadersReceivedListener,
          {
            urls: ["*://*/*"],
          },
          ["responseHeaders"]
        );

        if (history && history.onVisitRemoved) {
          this.onVisitRemovedListener = (...args) =>
            WebDiscoveryProject.onVisitRemoved(...args);
          history.onVisitRemoved.addListener(this.onVisitRemovedListener);
        }

        this.active = true;
        this.collecting = true;
      });
    });
    this._pendingInits = pendingInit.catch(() => {});
    return pendingInit;
  },

  unload() {
    this.collecting = false;

    if (this.active) {
      this.active = false;

      if (this.onVisitRemovedListener) {
        history.onVisitRemoved.removeListener(this.onVisitRemovedListener);
        this.onVisitRemovedListener = undefined;
      }

      if (this.onHeadersReceivedListener) {
        WebRequest.onHeadersReceived.removeListener(
          this.onHeadersReceivedListener
        );
        this.onHeadersReceivedListener = undefined;
      }

      WebDiscoveryProject.unload();
    }
  },

  async reload() {
    await this._pendingInits;
    this.unload();
    await this.init(this.settings);
  },

  status() {
    if (this.active) {
      return {
        visible: true,
        state: true,
      };
    }
    return undefined;
  },

  events: {
    "core:mouse-down": function onMouseDown(...args) {
      if (this.collecting) {
        WebDiscoveryProject.captureMouseClickPage(...args);
      }
    },
    "content:location-change": function onLocationChange(...args) {
      logger.log("PCN: got location change:", this.collecting, ...args);
      if (this.collecting) {
        // Only forward it to the onLocation change if the frameID is type 0.

        // We need to find a better way,
        // to not trigger on-location change for requests which are not main_document.
        WebDiscoveryProject.listener.onLocationChange(...args);
      }
    },
  },

  actions: {
    anonymousHttpGet(url, overrideHeaders) {
      return WebDiscoveryProject.doublefetchHandler.anonymousHttpGet(
        url,
        overrideHeaders
      );
    },

    /**
     * Check whether there is some state for this url.
     * @param  {String}  url
     * @return {Boolean}     true if a state object exists.
     */
    isProcessingUrl(url) {
      return WebDiscoveryProject.state.v[url] !== undefined;
    },

    /**
     * Add some data to the metadata for a url under the specified key. If data
     * already exists, we will merge it, overwriting any duplicates.
     *
     * @param {String} url
     * @param {String} key  object key under-which to add this data
     * @param {Object} data data to add
     * @returns {Promise} Resolves if data was added, rejects if we have no state
     * for this url.
     */
    addDataToUrl(url, key, data) {
      if (WebDiscoveryProject.state.v[url]) {
        WebDiscoveryProject.state.v[url][key] = Object.keys(data).reduce(
          (acc, val) => {
            acc[val] = data[val];
            return acc;
          },
          WebDiscoveryProject.state.v[url][key] || {}
        );
        return Promise.resolve();
      }
      return Promise.reject();
    },

    telemetry(payload, instantPush) {
      WebDiscoveryProject.telemetry(payload, instantPush);
    },

    "wdp:keypress": function onKeyPress(...args) {
      if (this.collecting) {
        WebDiscoveryProject.captureKeyPressPage(...args);
      }
    },
    "wdp:mousemove": function onMouseMove(...args) {
      if (this.collecting) {
        WebDiscoveryProject.captureMouseMovePage(...args);
      }
    },
    "wdp:scroll": function onScroll(...args) {
      if (this.collecting) {
        WebDiscoveryProject.captureScrollPage(...args);
      }
    },
    "wdp:copy": function onCopy(...args) {
      if (this.collecting) {
        WebDiscoveryProject.captureCopyPage(...args);
      }
    },

    contentScriptTopAds() {},

    jsRedirect({ url, location } = { url: undefined, location: undefined }) {
      WebDiscoveryProject.httpCache[url] = {
        status: 301,
        time: WebDiscoveryProject.counter,
        location,
      };
    },

    adClick(message) {
      const ads = message.ads;
      Object.keys(ads).forEach((eachAd) => {
        WebDiscoveryProject.adDetails[eachAd] = ads[eachAd];
      });
    },
  },
});
