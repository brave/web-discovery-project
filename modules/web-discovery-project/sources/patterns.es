/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import logger from "./logger";
import { sanitizeUrl } from "../core/sanitizer";

function expectString(arg) {
  if (typeof arg !== "string") {
    throw new Error(`Expected string argument but got: ${arg}`);
  }
}

function expectInteger(arg) {
  if (typeof arg !== "number" || arg % 1 !== 0) {
    throw new Error(`Expected integer argument but got: ${arg}`);
  }
}

function expectBoolean(arg) {
  if (arg !== true && arg !== false) {
    throw new Error(`Expected boolean argument but got: ${arg}`);
  }
}

/**
 * A list of predefined string transformations that can be specified
 * in the DSL in the "transforms" definition.
 *
 * Notes:
 * - All transformations are stateless and must be free of side-effects.
 * - If a single steps return "null", the following steps will
 *   not be executed.
 * - The first argument is the current value (the accumulator),
 *   but extra parameters can be defined in the DSL; these will be
 *   passed to the function as additional arguments.
 *
 * Preventing remote code execution
 * --------------------------------
 *
 * The predefined functions need to be carefully checked. To illustrate
 * the threat model, let us look at a constructed example first:
 *
 *   badIdea: (x, param) => eval(param)
 *
 * Now, if an attacker compromises the servers and gets control to push
 * malicious pattern updates, the function could be exploited:
 *
 * ["badIdea", "<some code that the client will execute>"].
 *
 * Be careful not to introduce a function that allows an attack
 * like that. That is why it is so important to keep the function free
 * of side-effects!
 *
 * ----------------------------------------------------------------------
 *
 * Additional warnings:
 *
 * 1) Do not allow DoS (be careful when looping; if possible avoid any loops):
 *
 * As long as the functions are free of side-effects, the worst possible
 * attack would be denial-of-service (in other words, someone could push a
 * rule that results in an infinite loop). So, also be careful when using
 * explicit loops - there should be no need for it anyway.
 * Best keep the transformations simple.
 *
 * 2) Do not trust the parameters:
 *
 * Note that an attacker will be able to control the arguments passed
 * into the function:
 * - extra parameters are under direct control (as they are taken
 *   from the rule definitions)
 * - the first parameter (the accumulator) is more difficult to
 *   control but expect that it is prudent to assume that it can
 *   be controlled as well (e.g., if a user can be tricked to visit
 *   any website where the attacker can control text)
 *
 * As long as you avoid side-effects and loops, critical exploits
 * are not possible, but again there are DoS type attacks.
 *
 * For instance, if you are writing a rule with an parameter that will
 * be used as a regular expression, be careful. What will happen if the
 * attacker pushes a rule with a long regular expression that may lead
 * to exponential backtracking? Think about these kind of attacks and
 * about mitigations (e.g. reject overly long parameters).
 * Again, it is best to keep the functions simple to avoid any surprises.
 *
 * ----------------------------------------------------------------------
 *
 * Error handling:
 *
 * 1) Throwing an exception is supported. In that case, expect the whole
 *    rule to be skipped (no message will be sent). In other words, reserve
 *    it for unexpected cases.
 * 2) Returning "null"/"undefined" has the semantic of stopping the
 *    execution without an error. It is still possible that a
 *    message will be sent, but with a missing value.
 */
const TRANSFORMS = new Map(
  Object.entries({
    /**
     * Extracts a given query parameter and decodes it.
     *
     * Example ["queryParam", "foo"]:
     * - "https://example.test/path?foo=bar+baz" -> "bar baz"
     * - "/example.test/path?foo=bar+baz" -> "bar baz"
     * - "/example.test/path" -> null
     * - "This is a string but not an URL" -> null
     */
    queryParam: (x, queryParam) => {
      expectString(x);
      expectString(queryParam);
      try {
        // we only need the query parameter, but to handle relative
        // URLs we have to pass a base URL (any domain will work)
        return new URL(x, "http://x").searchParams.get(queryParam);
      } catch (e) {
        return null;
      }
    },

    /**
     * Given a URL, it runs a set of extra checks to filter out
     * parts that may be sensitive (i.e. keeping only the hostname),
     * or even drop it completely.
     */
    maskU: (x) => {
      expectString(x);
      try {
        return sanitizeUrl(x).safeUrl;
      } catch (e) {
        return null;
      }
    },

    split: (x, splitON, arrPos) => {
      expectString(x);
      expectString(splitON);
      expectInteger(arrPos);

      const parts = x.split(splitON);
      if (parts.length === 1) {
        return null;
      }
      return parts[arrPos] ?? null;
    },

    trySplit: (x, splitON, arrPos) => {
      expectString(x);
      expectString(splitON);
      expectInteger(arrPos);

      return x.split(splitON)[arrPos] || x;
    },

    decodeURIComponent: (x) => {
      expectString(x);
      try {
        return decodeURIComponent(x);
      } catch (e) {
        return null;
      }
    },

    tryDecodeURIComponent: (x) => {
      expectString(x);
      try {
        return decodeURIComponent(x);
      } catch (e) {
        return x;
      }
    },

    /**
     * Takes a JSON string object, parses it and extract the data under the
     * given path. By default, it will only extract safe types (strings,
     * numbers, booleans), mostly to prevent accidentally extracting
     * more than intended.
     */
    json: (x, path, extractObjects = false) => {
      expectString(x);
      expectString(path);
      expectBoolean(extractObjects);
      try {
        let obj = JSON.parse(x);
        for (const field of path.split(".")) {
          obj = obj[field];
        }
        if (typeof obj === "string") {
          return obj;
        }
        if (typeof obj === "number" || typeof obj === "boolean") {
          return obj.toString();
        }
        if (extractObjects && obj) {
          return JSON.stringify(obj);
        }
        // prevent uncontrolled text extraction
        return "";
      } catch (e) {
        return "";
      }
    },
  }),
);

export function lookupBuiltinTransform(name) {
  const transform = TRANSFORMS.get(name);
  if (transform) {
    return transform;
  }
  throw new Error(`Unknown transformation: "${name}"`);
}

/**
 * Represents the currently active rules.
 *
 * It is updated by the PatternsUpdater, which polls
 * the server for updates.
 */
export default class Patterns {
  constructor() {
    this._rules = {};
  }

  update(rules) {
    logger.debug("Loaded patterns:", rules);
    this._rules = rules;
  }

  /**
   * Grants access to the active patterns. It is guaranteed that the
   * returned object will not be modified.
   *
   * If you plan to perform multiple operations, it is recommended
   * to call this function one and then operate on this snapshot.
   * Even though it is unlikely, patterns can change at any point
   * in time. As long as you operate on the snapshot, you do not have
   * to worry about it.
   */
  getRulesSnapshot() {
    return this._rules;
  }

  typeExists(type) {
    return type in this.getRulesSnapshot();
  }
}
