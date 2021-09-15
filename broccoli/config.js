/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const fs = require("fs");
const path = require("path");

const configFilePath = process.env.CONFIG_PATH;
console.log("Configuration file:", configFilePath);

const buildConfig = require(path.resolve(configFilePath));

if (!buildConfig.modules) {
  buildConfig.modules = fs
    .readdirSync(path.join(".", "modules"))
    .filter((dir) =>
      fs.lstatSync(path.join(".", "modules", dir)).isDirectory()
    );
}

buildConfig.environment = process.env.ENVIRONMENT || "development";
buildConfig.isBeta = process.env.BETA === "True";

buildConfig.EXTENSION_VERSION = process.env.EXTENSION_VERSION;
buildConfig.VERSION = process.env.VERSION;

if (process.env.EXTENSION_LOG) {
  buildConfig.EXTENSION_LOG = process.env.EXTENSION_LOG;
}

module.exports = buildConfig;
