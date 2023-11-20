/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const fs = require("fs");
const path = require("path");
const Funnel = require("broccoli-funnel");
const MergeTrees = require("broccoli-merge-trees");
const Babel = require("broccoli-babel-transpiler");
const broccoliSource = require("broccoli-source");

const WatchedDir = broccoliSource.WatchedDir;
const writeFile = require("broccoli-file-creator");
const env = require("./env");

const buildConfig = require("./config");
const modulesList = require("./modules/modules-list");
const contentScriptsImport = require("./modules/content-script-imports");
const contentTestsImport = require("./modules/content-tests-imports");
const integrationTestsImport = require("./modules/integration-tests-imports");

const getBundlesTree = require("./modules/bundles-tree");
const getDistTree = require("./modules/dist-tree");

const modulesTree = new WatchedDir("modules");

const targets = buildConfig.buildTargets || {
  firefox: 80,
};

const babelOptions = {
  babel: {
    babelrc: false,
    presets: [
      [
        "@babel/env",
        {
          targets,
          modules: false,
          exclude: [
            "@babel/plugin-transform-template-literals",
            "@babel/plugin-transform-regenerator",
          ],
        },
      ],
      ["@babel/typescript"],
    ],
    compact: false,
    sourceMaps: false,
    plugins: [
      "@babel/plugin-proposal-class-properties",
      "@babel/plugin-transform-optional-chaining",
      ...(buildConfig.babelPlugins || []),
      ...(buildConfig.format === "common"
        ? ["@babel/plugin-transform-modules-commonjs"]
        : []),
      ...(buildConfig.format === "system"
        ? [
            "@babel/plugin-transform-modules-systemjs",
            "@babel/plugin-proposal-dynamic-import",
          ]
        : []),
    ],
  },
  throwUnlessParallelizable: true,
  filterExtensions: ["es", "ts", "js"],
};

function getPlatformFunnel() {
  return new Funnel(new WatchedDir("platforms/"), {
    exclude: ["**/tests/**/*"],
  });
}

const dirs = (p) =>
  fs.readdirSync(p).filter((f) => fs.statSync(path.join(p, f)).isDirectory());

function getPlatformTree() {
  const platformName = buildConfig.platform;
  let platform = getPlatformFunnel();

  platform = new Babel(platform, { ...babelOptions });
  const platforms = dirs("./platforms");

  return new MergeTrees([
    new Funnel(platform, {
      srcDir: platformName,
      destDir: "platform",
    }),
    ...platforms.map(
      (p) =>
        new Funnel(platform, {
          srcDir: p,
          destDir: `platform-${p}`,
        }),
    ),
  ]);
}

function getSourceFunnel() {
  return new Funnel(modulesTree, {
    include: buildConfig.modules.map(
      (name) => `${name}/sources/**/*.{es,ts,js}`,
    ),
    getDestinationPath(_path) {
      return _path.replace("/sources", "");
    },
  });
}

function getSourceTree() {
  let sources = getSourceFunnel();
  const config = writeFile(
    "core/config.es",
    `export default ${JSON.stringify(buildConfig, null, 2)}`,
  );

  const includeTests = env.INCLUDE_TESTS;

  sources = new MergeTrees([
    sources,
    config,
    contentScriptsImport,
    includeTests ? contentTestsImport : new MergeTrees([]),
    includeTests ? integrationTestsImport : new MergeTrees([]),
    new Funnel(modulesList, { destDir: "core/app" }),
  ]);

  const moduleTestsTree = new Funnel(modulesTree, {
    include: buildConfig.modules.map((name) => `${name}/tests/**/*.es`),
    getDestinationPath(_path) {
      return _path.replace("/tests", "");
    },
  });

  const transpiledSources = new Babel(sources, { ...babelOptions });
  const transpiledModuleTestsTree = new Babel(
    new Funnel(moduleTestsTree, { destDir: "tests" }),
    { ...babelOptions },
  );

  const sourceTrees = [transpiledSources];

  const exclude = ["**/*.jshint.js"];

  if (includeTests) {
    sourceTrees.push(transpiledModuleTestsTree);
  } else {
    exclude.push("**/content-tests.bundle*");
    exclude.push("**/integration-tests.bundle*");
  }

  return new Funnel(new MergeTrees(sourceTrees), {
    exclude,
  });
}

const sourceTreeOptions = {};
const sourceTree = new MergeTrees(
  [getPlatformTree(), getSourceTree()],
  sourceTreeOptions,
);

const staticTree = new MergeTrees([getDistTree(modulesTree)]);

const { bundlesTree, wasmTree } = getBundlesTree(
  new MergeTrees([sourceTree, staticTree]),
);

module.exports = {
  static: staticTree,
  modules: sourceTree,
  bundles: bundlesTree,
  wasm: wasmTree,
};
