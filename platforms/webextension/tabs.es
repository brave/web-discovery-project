/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { chrome } from "./globals";

export function newTab(url, { focus = true } = {}) {
  let resolver;
  const promise = new Promise((resolve) => {
    resolver = resolve;
  });
  chrome.tabs.create({ url, active: focus }, (tab) => {
    resolver(tab.id);
  });
  return promise;
}

export function closeTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.onRemoved.addListener(function onTabRemoved(id) {
      if (id === tabId) {
        resolve();
        chrome.tabs.onRemoved.removeListener(onTabRemoved);
      }
    });
    // QUESTION: somehow callback to tabs.remove fire too fast so we use onRemove listener
    const removePromise = chrome.tabs.remove(Number(tabId), () => {
      if (chrome.runtime.lastError) {
        reject(
          new Error(
            `tab with id '${tabId}' is missing, probably already closed.`
          )
        );
      }
    });

    if (removePromise && removePromise.catch) {
      removePromise.catch(reject);
    }
  });
}

export function getCurrentTab(id) {
  const windowId =
    typeof id === "number" ? id : chrome.windows.WINDOW_ID_CURRENT;
  return new Promise((resolve) =>
    chrome.tabs.query({ windowId, active: true }, ([tab]) => resolve(tab))
  );
}

export async function updateTab(tabId, _updateInfo) {
  let id = tabId;
  let updateInfo = _updateInfo;
  if (typeof id !== "number") {
    const tab = await getCurrentTab();
    id = tab.id;
    updateInfo = tabId;
  }
  return new Promise((resolve) => {
    chrome.tabs.update(id, updateInfo, resolve);
  });
}

export function getTab(tabId) {
  return new Promise((resolve, reject) => {
    if (typeof tabId !== "number") {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) =>
        resolve(tabs && tabs[0])
      );
      return;
    }
    chrome.tabs.get(tabId, (tab) => {
      if (tab) {
        resolve(tab);
      } else {
        reject(new Error("tab not found"));
      }
    });
  });
}

export function query(queryInfo) {
  return new Promise((resolve) => {
    chrome.tabs.query(queryInfo, resolve);
  });
}

export function reloadTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.reload(tabId, resolve);
  });
}

export function findTabs(url) {
  return new Promise((resolve) =>
    chrome.tabs.query({ url }, (tabs) =>
      resolve(chrome.runtime.lastError ? [] : tabs)
    )
  );
}

export default (chrome && chrome.tabs) || undefined;
