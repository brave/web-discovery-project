/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const { execSync } = require("child_process");
const { join } = require("path");

const {
  setConfigPath,
  getExtensionVersion,
  configParameter,
} = require("../common");

function run(command) {
  // Make sure that binaries from `node_modules` are available in PATH.
  let PATH = join(__dirname, "..", "..", "node_modules", ".bin");
  if (process.env.PATH) {
    PATH += `:${process.env.PATH}`;
  }

  return execSync(command, {
    encoding: "utf-8",
    env: {
      ...process.env,
      PATH,
    },
  }).trim();
}

module.exports = (program) => {
  program.command(`pack ${configParameter}`).action((configPath) => {
    const cfg = setConfigPath(configPath);
    const CONFIG = cfg.CONFIG;

    getExtensionVersion("package", CONFIG)
      .then((version) => {
        process.env.PACKAGE_VERSION = version;
        process.env.EXTENSION_VERSION = version;

        if (!process.env.VERSION) {
          process.env.VERSION = version;
        }

        if (!CONFIG.pack) {
          throw new Error("Pack not defined in config file");
        }

        console.log(run(`bash -c "${CONFIG.pack}"`));
      })
      .catch((e) => {
        console.error("Something went wrong", e);
        process.exit(1);
      });
  });
};