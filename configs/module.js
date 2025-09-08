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
};
