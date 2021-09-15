const base = require("./extension");
const urls = require("./common/urls");

module.exports = {
  ...base,
  settings: {
    ...base.settings,
    ...urls("production"),
    WDP_PATTERNS_SIGNING: true,
    WDP_ENV: "production",
  },
};
