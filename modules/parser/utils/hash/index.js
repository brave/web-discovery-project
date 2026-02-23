/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import prob from "./prob.js";

// Prefilters — instant classification for unambiguous patterns
const RE_PURE_NUMBERS = /^\d+$/;
const RE_RESOLUTION = /^\d+x\d+$/;
const RE_UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/i;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_PERCENT_ENCODED = /%[0-9A-Fa-f]{2}/;

export class HashProb {
  constructor() {
    this.probHashLogM = prob.logM;
    this.classifierWeights = prob.classifierWeights;
    this.probHashChars = {};
    "abcdefghijklmnopqrstuvwxyz1234567890.- ".split("").forEach((e, idx) => {
      this.probHashChars[e] = idx;
    });
  }

  isHashProb(str) {
    if (!this.probHashLogM) {
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

  isHash(str) {
    // Do not consider small strings
    if (str.length < 6) {
      return false;
    }

    // URL-decode percent-encoded strings before classification
    if (str.includes('%') && RE_PERCENT_ENCODED.test(str)) {
      try { str = decodeURIComponent(str); } catch(e) { /* keep original */ }
      if (str.length < 6) {
        return false;
      }
    }

    // Instant false: known safe formats
    if (RE_PURE_NUMBERS.test(str)) return false;
    if (RE_RESOLUTION.test(str)) return false;
    if (RE_UK_POSTCODE.test(str)) return false;

    // Instant true: UUID is the one pattern the LR classifier sometimes misses
    if (RE_UUID.test(str)) return true;

    // Multi-feature logistic regression
    const bigramProb = this.isHashProb(str);
    const features = extractFeatures(str, bigramProb);
    const w = this.classifierWeights;

    const score = w[0]
      + w[1] * features.bigramProb
      + w[2] * features.entropy
      + w[3] * features.hexRatio
      + w[4] * features.vowelRatio
      + w[5] * features.transitions;

    const probability = 1 / (1 + Math.exp(-score));
    return probability > (w[6] ?? 0.5);
  }
}

/**
 * Extract all 5 features from a string in a single pass.
 * All features are O(n) in string length.
 */
function extractFeatures(str, bigramProb) {
  const lower = str.toLowerCase();
  const len = lower.length;

  // Character frequency counts for entropy + hex ratio + vowel ratio
  const freq = {};
  let hexCount = 0;
  let vowelCount = 0;
  let alphaCount = 0;
  let transitionCount = 0;

  // Previous character class: 0=letter, 1=digit, -1=other
  let prevClass = -1;

  for (let i = 0; i < len; i++) {
    const c = lower[i];
    const code = lower.charCodeAt(i);

    // Frequency counting for entropy
    freq[c] = (freq[c] || 0) + 1;

    // Hex character ratio
    if ((code >= 48 && code <= 57) ||  // 0-9
        (code >= 97 && code <= 102)) { // a-f
      hexCount++;
    }

    // Vowel ratio (among alphabetic chars)
    if (code >= 97 && code <= 122) { // a-z
      alphaCount++;
      if (c === 'a' || c === 'e' || c === 'i' || c === 'o' || c === 'u') {
        vowelCount++;
      }
    }

    // Char-class transitions (letter <-> digit)
    let curClass;
    if (code >= 97 && code <= 122) curClass = 0; // letter
    else if (code >= 48 && code <= 57) curClass = 1; // digit
    else curClass = -1; // other

    if (prevClass >= 0 && curClass >= 0 && prevClass !== curClass) {
      transitionCount++;
    }
    if (curClass >= 0) {
      prevClass = curClass;
    }
  }

  // Shannon entropy: -sum(p(c) * log2(p(c)))
  let entropy = 0;
  for (const c in freq) {
    const p = freq[c] / len;
    entropy -= p * Math.log2(p);
  }

  return {
    bigramProb,
    entropy,
    hexRatio: len > 0 ? hexCount / len : 0,
    vowelRatio: alphaCount > 0 ? vowelCount / alphaCount : 0,
    transitions: len > 1 ? transitionCount / (len - 1) : 0,
  };
}
