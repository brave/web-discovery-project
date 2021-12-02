/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const IDBKeyRange = require("fake-indexeddb/lib/FDBKeyRange");
const indexedDB = require("fake-indexeddb");

global.indexedDB = indexedDB;
global.IDBKeyRange = IDBKeyRange;

async function getInitDexie() {
  const Dexie = await import("dexie");

  function initDexie(name) {
    return new Dexie(name, {
      indexedDB,
      IDBKeyRange,
    });
  }

  initDexie.__proto__.delete = Dexie.delete;
  initDexie.__proto__.exists = Dexie.exists;


  return 
}
module.exports = {
  "platform/lib/dexie": {
    default: () => getInitDexie,
  },
};
