#!/usr/bin/env node

const program = require("commander");
const colors = require("colors");

// register sub-commands
require("./fern/commands/build")(program);
require("./fern/commands/lint")(program);
require("./fern/commands/pack")(program);
require("./fern/commands/serve")(program);
require("./fern/commands/test")(program);

(() => {
  colors.setTheme({
    silly: "rainbow",
    input: "grey",
    verbose: "cyan",
    prompt: "grey",
    info: "green",
    data: "grey",
    help: "cyan",
    warn: "yellow",
    debug: "blue",
    error: "red",
  });

  program.parse(process.argv);
})();
