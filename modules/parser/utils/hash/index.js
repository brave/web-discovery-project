/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import prob from "./prob.js";

export class HashProb {
  constructor() {
    this.probHashLogM = prob.logM;
    this.probHashThreshold = prob.thresh;
    this.probHashChars = {};
    "abcdefghijklmnopqrstuvwxyz1234567890.- ".split("").forEach((e, idx) => {
      this.probHashChars[e] = idx;
    });
  }

  _update(data) {
    this.probHashLogM = data.logM;
    this.probHashThreshold = data.thresh;
  }

  isHashProb(str) {
    if (!this.probHashLogM || !this.probHashThreshold) {
      return 0;
    }
    let logProb = 0.0;
    let transC = 0;
    str = str.toLowerCase().replace(/[^a-z0-9.\- ]/g, "");
    for (let i = 0; i < str.length - 1; i += 1) {
      const pos1 = this.probHashChars[str[i]];
      const pos2 = this.probHashChars[str[i + 1]];

      logProb += this.probHashLogM[pos1][pos2];
      transC += 1;
    }
    if (transC > 0) {
      return Math.exp(logProb / transC);
    }
    return Math.exp(logProb);
  }

  isHash(str, thresh) {
    const p = this.isHashProb(str);
    return p < (thresh || this.probHashThreshold);
  }
}
