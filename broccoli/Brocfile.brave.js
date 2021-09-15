/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const Funnel = require('broccoli-funnel');
const MergeTrees = require('broccoli-merge-trees');
const broccoliSource = require('broccoli-source');

const WatchedDir = broccoliSource.WatchedDir;

const modules = require('./modules-tree');

const specific = new WatchedDir('specific/node');

const srcTree = new MergeTrees([
  specific,
  modules.modules,
  modules.bundles,
  modules.wasm,
], { overwrite: true });

const outputTree = new MergeTrees([
  srcTree,
  modules.styleTests,
], { overwrite: true });

// Output
module.exports = new Funnel(outputTree, {
  exclude: ['**/vendor/!(react.js|react-dom.js)'],
});
