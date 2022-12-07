const path = require("path");
const getOptionsUrl = require("./test-options");

exports.Browser = class BraveBrowser {
  constructor() {
    this.brave = null;
  }

  async run({
    configFilePath = process.env.CONFIG_PATH,
    config,
    outputPath = process.env.OUTPUT_PATH || "./build",
    bravePath = process.env.BRAVE_PATH,
    sourceDir,
    braveProfile,
    keepProfileChanges = false,
  } = {}) {
    if (config === undefined) {
      config = require(path.resolve(configFilePath));
    }

    if (sourceDir === undefined) {
      sourceDir =
        config.platform === "firefox"
          ? path.resolve(outputPath, config.settings.id)
          : path.resolve(outputPath);
    }

    const options = {
      chromiumBinary: bravePath,
      chromiumProfile: braveProfile,
      noReload: true,
      sourceDir,
      artifactsDir: sourceDir,
      startUrl: getOptionsUrl(),
      keepProfileChanges,
      target: "chromium",
    };

    const webExt = await import("web-ext");
    const runner = await webExt.default.cmd.run(options, {
      getValidatedManifest() {
        return {
          name: "",
          version: "",
        };
      },
    });

    this.brave = runner.extensionRunners[0];
    this.reloadAllExtensions = runner.reloadAllExtensions.bind(runner);
  }

  async unload() {
    if (this.brave) {
      await this.brave.exit();
      this.brave = null;
    }
  }
};
