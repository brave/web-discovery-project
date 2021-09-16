const base = require("./extension");
const urls = require("./common/urls");

module.exports = {
  ...base,
  settings: {
    ...base.settings,
    ...urls("sandbox"),
    WDP_PATTERNS_SIGNING: true,
    WDP_ENV: "sandbox",
  },
  default_prefs: {
    ...base.default_prefs,
    "logger.hpnv2.level": "debug",
    "logger.web-discovery-project.level": "debug",
  },
};
