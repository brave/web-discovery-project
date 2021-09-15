/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const subprojects = {
  // Define bundles
  chai: {
    src: "node_modules/chai",
    include: ["chai.js"],
    dest: "vendor",
  },
  "chai-dom": {
    src: "node_modules/chai-dom",
    include: ["chai-dom.js"],
    dest: "vendor",
  },
  mocha: {
    src: "node_modules/mocha",
    include: ["mocha.css", "mocha.js"],
    dest: "vendor",
  },
  sinon: {
    src: "node_modules/sinon/pkg",
    include: ["sinon.js"],
    dest: "vendor",
  },
  "sinon-chai": {
    src: "node_modules/sinon-chai/lib",
    include: ["sinon-chai.js"],
    dest: "vendor",
  },
};

module.exports = (modules) => {
  const result = [];
  modules.forEach((m) => {
    if (subprojects[m] === undefined) {
      throw new Error(`Could not find subproject: ${m}`);
    }
    result.push(subprojects[m]);
  });
  return result;
};
