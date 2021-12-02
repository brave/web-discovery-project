/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const Plugin = require("broccoli-plugin");
const path = require("path");
const glob = require("glob");
const webpack = require("webpack");

const env = require("../env");

module.exports = class BroccoliWebpack extends Plugin {
  constructor(inputNode, options = {}) {
    super([inputNode], {
      annotation: options.annotation,
    });

    this.builderConfig = options.builderConfig || {
      globalDeps: {},
    };
  }

  build() {
    const inputPath = this.inputPaths[0];
    const outputPath = this.outputPath;

    console.log(
      "*********************** Bundling Process Started *******************************"
    );
    const bundles = glob.sync("**/*.bundle.js", {
      cwd: inputPath,
      follow: true,
    });
    const bundleBuildCounter = bundles.length;
    const entries = {};

    if (bundleBuildCounter === 0) {
      return Promise.resolve();
    }

    bundles.forEach((bundle) => {
      entries[bundle] = path.join(inputPath, bundle);
    });

    return new Promise((resolve, reject) => {
      const t1 = new Date().getTime();

      const compiler = webpack({
        mode: env.DEVELOPMENT ? "development" : "production",
        entry: entries,
        devtool: false,
        output: {
          filename: "[name]",
          path: outputPath,
          webassemblyModuleFilename: "star.wasm"
        },
        experiments: {
          syncWebAssembly: true,
        },
        resolve: {
          symlinks: false,
          modules: [path.resolve(process.cwd(), "node_modules")],
          fallback: {
            fs: false,
            path: require.resolve("path-browserify"),
          },
        },
        externals: this.builderConfig.globalDeps,
        optimization: {
          minimize: !!env.PROD,
        },
      });

      compiler.run((error, stats) => {
        try {
          if (error || stats.hasErrors()) {
            console.log(stats.toString({ colors: true }));
            return reject();
          }

          const t2 = new Date().getTime();
          console.dir(`Built: took ${(t2 - t1) / 1000} seconds`, {
            colors: true,
          });

          console.log(Object.keys(entries).join("\n"));
          console.dir(
            `${bundleBuildCounter} bundle(s) has(have) been created`,
            {
              colors: true,
            }
          );
          console.log(
            "*********************** Bundling Process Finished *******************************"
          );
          return resolve();
        } finally {
          compiler.close((closeErr) => {
            console.log("Closed webpack compiler", closeErr);
          });
        }
      });
    });
  }
};
