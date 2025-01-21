/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const fs = require("fs");
const path = require("path");

// Monkey-patch load_brocfile.js to use require() instead of esmRequire(). ESM
// doesn't work well on Node 22. See:
// https://github.com/broccolijs/broccoli/pull/499

try {
  const filePath = path.join("node_modules/broccoli/dist/load_brocfile.js");
  let content = fs.readFileSync(filePath, "utf8");
  const originalContent = content;

  // Comment out ESM-related lines
  content = content.replace(
    /^\s*(const esm_1 = __importDefault\(require\("esm"\)\));/m,
    "// $1;"
  );
  content = content.replace(
    /^\s*(const esmRequire = esm_1\.default\(module\));/m,
    "// $1;"
  );

  // Replace esmRequire with require
  content = content.replace(
    /brocfile = esmRequire\(brocfilePath\);/,
    "brocfile = require(brocfilePath);"
  );

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content);
    console.log("Successfully patched load_brocfile.js");
  }
} catch (error) {
  console.error("Error patching load_brocfile.js:", error);
  process.exit(1);
}
