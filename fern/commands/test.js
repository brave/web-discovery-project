/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const path = require("path");

const Testem = require("testem");
const notifier = require("node-notifier");

const Reporter = require("../reporter");
const {
  configParameter,
  createBuildWatcher,
  getExtensionVersion,
  setConfigPath,
} = require("../common");

module.exports = (program) => {
  program
    .command(`test ${configParameter}`)
    .option("--lint", "Lint code")
    .option("--ci [output]", "Starts Testem in CI mode")
    .option("--keep-open", "do not close the browser after tests")
    .option("--grep [pattern]", "only run tests matching <pattern>")
    .option(
      "--fgrep [pattern]",
      "only run tests with file names matching <pattern>"
  )
    .option("-i --invert", "inverts --grep and --fgrep matches")
    .option("--environment <environment>")
    .option("--port [port]", "dev server port", 4300)
    .option("--firefox [firefox]", "Firefox path", "nightly")
    .option("--brave [brave]", "Brave path")
    .option("--no-build", "skip the build, run tests only")
    .option("-l --launchers [launchers]", "comma separted list of launchers")
    .option("-r --retries [retries]", "number of retries for failing tests")
    .option(
      "--extension-log [output]",
      "save extension logger messages to the file. When using with `run_tests_in_docker.sh`, the file should be in the directory `report`."
    )
    .action((configPath, options) => {
      process.env.ENVIRONMENT =
        process.env.ENVIRONMENT || options.environment || "development";
      process.env.INCLUDE_TESTS = "true";
      const cfg = setConfigPath(configPath);
      const CONFIG = cfg.CONFIG;
      const OUTPUT_PATH = cfg.OUTPUT_PATH;
      let watcher;

      // Enabled code linting
      process.env.ESLINT =
        options.lint ||
        (configPath || process.env.CONFIG_PATH).includes("unit-tests.js")
          ? "true"
          : "false";

      if (options.grep) {
        process.env.MOCHA_GREP = options.grep;
      }

      if (options.fgrep) {
        process.env.MOCHA_FGREP = options.fgrep;
      }

      if (options.invert) {
        process.env.MOCHA_INVERT = options.invert;
      }

      if (options.retries) {
        process.env.MOCHA_RETRIES = options.retries;
      }

      if (options.firefox) {
        process.env.FIREFOX_PATH = options.firefox;
      }

      if (options.brave) {
        process.env.BRAVE_PATH = options.brave;
      }

      if (options.keepOpen) {
        process.env.KEEP_OPEN = "true";
      }

      if (options.extensionLog) {
        process.env.EXTENSION_LOG = options.extensionLog;
      }

      process.env.OUTPUT_PATH = OUTPUT_PATH;

      process.env.AUTOSTART = "true";

      const testem = new Testem();
      const launchers = options.launchers;
      const serveFiles = [];

      if (CONFIG.testsBasePath) {
        serveFiles.push(
          path.resolve(
            process.cwd(),
            CONFIG.testsBasePath,
            "core",
            "content-tests.bundle.js"
          )
        );
      }

      let isRunning = false;

      getExtensionVersion("package", CONFIG).then((version) => {
        process.env.PACKAGE_VERSION = version;
        process.env.EXTENSION_VERSION = version;

        if (!process.env.VERSION) {
          process.env.VERSION = version;
        }

        if (options.ci) {
          const run = () => {
            const ciOptions = {
              debug: true,
              host: "localhost",
              port: "4200",
              launch: launchers || (CONFIG.testem_launchers_ci || []).join(","),
              reporter: Reporter,
              serve_files: serveFiles,
            };

            if (typeof options.ci === "string") {
              ciOptions.report_file = options.ci;
            }
            testem.startCI(ciOptions);
          };

          if (options.build) {
            watcher = createBuildWatcher(
              OUTPUT_PATH,
              Number(options.port),
              run
            );
          } else {
            run();
          }
        } else {
          watcher = createBuildWatcher(
            OUTPUT_PATH,
            Number(options.port),
            () => {
              try {
                notifier.notify({
                  title: "Fern",
                  message: "Build complete",
                  time: 1500,
                });

                if (!isRunning) {
                  testem.startDev({
                    debug: true,
                    query_params: options.grep
                      ? { grep: options.grep }
                      : undefined,
                    host: "localhost",
                    port: "4200",
                    launch:
                      launchers || (CONFIG.testem_launchers || []).join(","),
                    reporter: Reporter,
                    report_file: options.ci,
                    serve_files: serveFiles,
                  });

                  isRunning = true;
                } else {
                  testem.restart();
                }
              } catch (e) {
                console.error("Tests error:", e);
              }
            }
          );
        }

        if (!watcher) {
          return;
        }

        watcher.on("buildFailure", (err) => {
          const msg = `Build error - ${err}`;
          console.error(msg);
          notifier.notify({
            title: "Fern",
            message: msg,
            type: "warn",
            time: 3000,
          });
        });
      });
    });
};
