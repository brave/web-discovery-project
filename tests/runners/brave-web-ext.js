const runner = require("./test-runner-common");
const BraveBrowser = require("./launchers/brave-web-ext").Browser;

runner.run(new BraveBrowser());
