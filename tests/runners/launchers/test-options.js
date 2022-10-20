module.exports = function getOptionsUrl() {
  // Special data url to pass options
  return `data:text/plain,${JSON.stringify({
    grep: process.env.MOCHA_GREP || "",
    autostart: "true",
    invert: process.env.MOCHA_INVERT || "false",
    retries: process.env.MOCHA_RETRIES || 1,
  })}`;
};
