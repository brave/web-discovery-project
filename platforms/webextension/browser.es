/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { window, chrome, browser } from "./globals";
import windows from "./windows";

export * from "./tabs";
export * from "./windows";

let currentWindow = null;
const windowsMap = new Map();

export function getWindow() {
  return currentWindow;
}

export function isTabURL() {
  return false;
}

export function getLocale() {
  return window.navigator.language || window.navigator.userLanguage;
}

const windowObservers = new WeakMap();

export function addWindowObserver(fn) {
  if (windows === undefined) {
    return;
  }
  const observer = {
    open: (win) => fn(win, "opened"),
    focus: (windowId) => {
      const win = windowsMap.get(windowId) || { id: windowId };
      return fn(win, "focused");
    },
    close: (windowId) => fn({ id: windowId }, "closed"),
  };
  windowObservers.set(fn, observer);
  windows.onCreated.addListener(observer.open);
  windows.onFocusChanged.addListener(observer.focus);
  windows.onRemoved.addListener(observer.close);
}

export function removeWindowObserver(fn) {
  if (windows === undefined) {
    return;
  }
  const observer = windowObservers.get(fn);
  windows.onCreated.removeListener(observer.open);
  windows.onFocusChanged.removeListener(observer.focus);
  windows.onRemoved.removeListener(observer.close);
}

function windowObserver(win, event) {
  if (event === "opened") {
    windowsMap.set(win.id, win);
  }
  if (event === "closed") {
    windowsMap.delete(win.id);
  }
  if (event === "focused") {
    currentWindow = windowsMap.get(win.id) || currentWindow;
  }
  if (win.focused) {
    currentWindow = win;
  }
}

if (windows !== undefined) {
  addWindowObserver(windowObserver);
  windows.getAll((wins) =>
    wins.forEach((win) => windowObserver(win, "opened"))
  );
} else {
  currentWindow = window;
  windowsMap.set(undefined, window);
}

export function forEachWindow(fn) {
  return [...windowsMap.values()].map((win) => {
    let ret;
    try {
      ret = fn(win);
    } catch (e) {
      //
    }
    return ret;
  });
}

export function getActiveTab() {
  return browser.tabs
    .query({ active: true, currentWindow: true })
    .then((result) => {
      if (result.length === 0) {
        throw new Error("Result of query for active tab is undefined");
      }

      const tab = result[0];
      return {
        id: tab.id,
        url: tab.url,
      };
    });
}

export function isPrivateMode(win) {
  if (!win) {
    throw new Error("isPrivateMode was called without a window object");
  }
  return win.incognito || chrome.extension.inIncognitoContext;
}
