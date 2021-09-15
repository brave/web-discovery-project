/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const Funnel = require("broccoli-funnel");

const buildConfig = require("../config");
const env = require("../env");
const SystemBuilder = require("./broccoli-webpack");
const MergeTrees = require("broccoli-merge-trees");

var BroccoliDebug = require('broccoli-debug');

const bundleFiles = buildConfig.bundles;
const prefix = "modules";

function getBundlesTree(modulesTree) {
  const excludeBundles = new Set();

  let excludedBundleFiles;
  if (typeof bundleFiles === "undefined") {
    excludedBundleFiles = [];
  } else if (bundleFiles.length === 0) {
    excludedBundleFiles = ["**/*"];
  } else {
    excludedBundleFiles = Array.from(excludeBundles);
  }

  const input = new Funnel(modulesTree, {
    destDir: prefix,
    exclude: excludedBundleFiles,
  });

  const buildConfigBundler = buildConfig.bundler || {};

  const builderConfig = {
    externals: buildConfigBundler.externals || [],
    globalDeps: buildConfigBundler.globalDeps || {},
    sourceMaps: env.SOURCE_MAPS,
    lowResSourceMaps: false,
    sourceMapContents: env.SOURCE_MAPS,
    // required in case source module format is not esmb
    globalName: "WebDiscoveryProjectGlobal",
    rollup: true,
  };

  const bundles = new SystemBuilder(input, {
      builderConfig: buildConfig.builderDefault || builderConfig,
      bundleConfigs: buildConfig.bundleConfigs || {},
    });

  const bundlesTree = new Funnel(bundles,
    {
      srcDir: prefix,
      allowEmpty: true,
    }
  );

  const wasmTree = new Funnel(bundles, {
    exclude: ['modules/**/*'],
  });

  return { bundlesTree, wasmTree };
}

module.exports = getBundlesTree;
