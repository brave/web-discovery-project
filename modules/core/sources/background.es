/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* eslint no-param-reassign: 'off' */

import events from "./events";
import LocationChangeObserver from "../platform/location-change-observer";
import ContentCommunicationManager from "../platform/content-communication-manager";
import FastContentAppStateInjecter from "../platform/fast-content-app-state-injection";
import background from "./base/background";
import logger from "./logger";
import providesServices from "./services";
import {
  enableRequestSanitizer,
  disableRequestSanitizer,
} from "./request-sanitizer";

/**
 * @module core
 * @namespace core
 * @class Background
 */
export default background({
  requiresServices: ["pacemaker"],
  providesServices,

  init(settings) {
    enableRequestSanitizer();

    this.settings = settings;

    this.bm = new ContentCommunicationManager();
    this.bm.init();

    this.mm = new LocationChangeObserver();
    this.mm.init();

    this.appStateInjecter = new FastContentAppStateInjecter();
    this.appStateInjecter.init(this.app);

    logger.init();
  },

  unload() {
    disableRequestSanitizer();

    this.bm.unload();
    this.mm.unload();
    this.appStateInjecter.unload();
    logger.unload();
  },

  events: {
    "core:tab_select": function onTabSelect({ url, incognito, id }) {
      events.pub("core.location_change", url, incognito, id);
    },
    "content:location-change": function onLocationChange({
      url,
      isPrivate,
      tabId,
    }) {
      events.pub("core.location_change", url, isPrivate, tabId);
    },
    prefchange: function onPrefChange(pref) {
      if (pref.startsWith("modules.") && pref.endsWith(".enabled")) {
        this.actions.refreshAppState(this.app);
      }
    },
  },

  actions: {
    recordMouseDown(...args) {
      events.pub("core:mouse-down", ...args);
    },

    /**
     * publish an event using events.pub
     * @param  {String}    evtChannel channel name
     * @param  {...[objects]} args       arguments to sent
     */
    publishEvent(evtChannel, ...args) {
      events.pub(evtChannel, ...args);
    },

    restart() {
      return this.app.extensionRestart();
    },

    status() {
      return this.app.status();
    },

    enableModule(moduleName) {
      return this.app.enableModule(moduleName);
    },

    disableModule(moduleName) {
      this.app.disableModule(moduleName);
    },

    callContentAction(module, action, target, ...args) {
      return this.bm.callContentAction(module, action, target, ...args);
    },

    click(url, selector) {
      return this.bm.callContentAction("core", "click", { url }, selector);
    },

    queryHTML(url, selector, attribute, options = {}) {
      return this.bm.callContentAction(
        "core",
        "queryHTML",
        { url },
        selector,
        attribute,
        options
      );
    },

    getHTML(url) {
      return this.bm.callContentAction("core", "getHTML", { url });
    },

    refreshAppState() {
      this.appStateInjecter.shareAppState(this.app);
    },
  },
});
