const buildConfig = require("./broccoli/config");
const brocfile = buildConfig.brocfile || "Brocfile." + buildConfig.platform;
const platformBrocfile = require("./broccoli/" + brocfile);
module.exports = platformBrocfile;
