const base = require("./extension");
const urls = require("./common/urls");

module.exports = {
  ...base,
  specific: "node",
  format: "common",
  brocfile: "Brocfile.brave.js",
  pack: "npm pack",
  settings: {
    ...base.settings,
    ...urls("production"),
    WDP_PATTERNS_SIGNING: true,
    WDP_ENV: "production",
  },
  default_prefs: {
    ...base.default_prefs,
    "logger.hpnv2.level": "debug",
    "logger.web-discovery-project.level": "debug",
    "showConsoleLogs": true,
  },
};
