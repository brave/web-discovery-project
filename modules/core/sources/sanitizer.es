/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { isHash } from "./helpers/hash-detector";
import logger from "./logger";

function isCharNumber(char) {
  const code = char.charCodeAt(0);
  return code >= 48 && code <= 57; // ASCII range for 0-9
}

// precondition: isCharNumber(char) === true
function uncheckedCharToNumber(char) {
  return char.charCodeAt(0) - 48; // 48 == ASCII '0'
}

// https://en.wikipedia.org/wiki/International_Article_Number
// In the US, also known as GTIN or UPTC.
export function isValidEAN13(ean) {
  if (ean.length !== 13 || ![...ean].every(isCharNumber)) {
    return false;
  }
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    const factor = i % 2 === 0 ? 1 : 3;
    sum += factor * uncheckedCharToNumber(ean[i]);
  }
  const checksum = (10 - (sum % 10)) % 10;
  return checksum === uncheckedCharToNumber(ean[12]);
}

// https://en.wikipedia.org/wiki/International_Standard_Serial_Number
export function isValidISSN(issn) {
  if (!/^[0-9]{4}-?[0-9]{3}[0-9xX]$/.test(issn)) {
    return false;
  }
  issn = issn.replace("-", "");

  let checksum = 0;
  for (let i = 0; i < 7; i++) {
    checksum += uncheckedCharToNumber(issn[i]) * (8 - i);
  }
  const endsWithX = issn[7] === "x" || issn[7] === "X";
  checksum += endsWithX ? 10 : uncheckedCharToNumber(issn[7]);

  return checksum % 11 === 0;
}

/**
 * Returns true if the given string contains any text that looks
 * like an email address. The check is conservative, that means
 * false positives are expected, but false negatives are not.
 */
function checkForEmail(str) {
  return /[a-z0-9\-_@]+(@|%40|%(25)+40)[a-z0-9\-_]+\.[a-z0-9\-_]/i.test(str);
}

/**
 * Intended to filter out potentially problematic numbers.
 * Tries to reduce the number of false-positives by detecting certain common
 * product IDs (EAN, ISSN), which are common in search, but don't have personal
 * information.
 *
 * Otherwise, it discard query that contain numbers longer than 7 digits.
 * So, 123456 is still allowed, but phone numbers like (090)90-2 or 5555 3235
 * will be dropped.
 *
 * Note:
 * - the current implementation discard anything that contains full dates
 *   (e.g. "2023/05/17", "17.05.2023").
 *  (TODO: perhaps this restriction should be reconsidered to allow a search
 *   like "What happened on 24.12.1914?")
 */
function hasLongNumber(str) {
  // allow one ISSN number
  const issn = str.split(" ").find(isValidISSN);
  if (issn) {
    str = str.replace(issn, " ");
  }

  const numbers = str
    .replace(/[^A-Za-z0-9]/g, "")
    .replace(/[^0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((num) => num.length > 2);
  if (numbers.length === 1) {
    const num = numbers[0];
    if (num.length === 13 && str.includes(num)) {
      const isEAN = isValidEAN13(num);
      return !isEAN;
    }
  }

  return numbers.some((num) => num.length > 7);
}

function isLogogramChar(char) {
  const codePoint = char.codePointAt(0);

  // Chinese: Range of Unicode code points for common Chinese characters
  if (codePoint >= 0x4e00 && codePoint <= 0x9fff) {
    return true;
  }

  // Japanese: Range of Unicode code points for Hiragana and Katakana characters
  if (codePoint >= 0x3040 && codePoint <= 0x30ff) {
    return true;
  }

  // Korean: Range of Unicode code points for Hangul syllables
  if (codePoint >= 0xac00 && codePoint <= 0xd7af) {
    return true;
  }

  // Thai: Range of Unicode code points for Thai characters
  if (codePoint >= 0x0e00 && codePoint <= 0x0e7f) {
    return true;
  }

  return false;
}

/**
 * Most languages have an alphabet where a word consist of multiple characters.
 * But other languages (e.g. Chinese) use logograms, where a single character
 * is equivalent to a word. Thus, heuristics need to adjusted if they count the
 * number of characters or words ("words" being defined as characters not
 * separated by whitespace).
 *
 * Note: texts in Arabic or European languages should not trigger this check.
 */
function hasLogograms(str) {
  return [...str].some(isLogogramChar);
}

export function checkSuspiciousQuery(query) {
  function accept() {
    return {
      accept: true,
    };
  }

  function discard(reason) {
    return {
      accept: false,
      reason,
    };
  }

  // First, normalize white spaces
  //
  // Note: this code doesn't trim but preserves a leading or trailing
  // whitespace. We could trim  (and the expected differences would be minimal).
  // Yet there is little benefit in trimming and it would lose information.
  query = query.replace(/\s+/g, " ");

  // Remove the msg if the query is too long
  if (query.length > 120) {
    return discard("too long (120 character limit)");
  }
  if (query.length > 50 && hasLogograms(query)) {
    return discard("too long (50 characters and logograms are present)");
  }

  const words = query.split(" ");
  if (words.length > 9) {
    if (words.filter((x) => x.length >= 4).length > 16) {
      return discard("too many words");
    }
    if (hasLogograms(query)) {
      return discard("too many words (smaller limit but logograms are present");
    }
  }

  if (hasLongNumber(query)) {
    return discard("long number detected");
  }

  // Remove if it contains text that could be an email,
  // even if the email is not well formed
  if (checkForEmail(query)) {
    return discard("looks like an email");
  }

  if (/[^:]+:[^@]+@/.test(query)) {
    return discard("looks like an http password");
  }

  for (let i = 0; i < words.length; i += 1) {
    if (words[i].length > 45) {
      return discard("found long word");
    }

    // Long words are common in some languages (e.g. German)
    if (
      words[i].length > 20 &&
      !/^[a-zA-ZäöüéÄÖÜ][a-zäöüéß]+$/.test(words[i])
    ) {
      return discard("found long word (smaller limit but uncommon shape)");
    }
  }

  return accept();
}

function tryParseUrl(url) {
  try {
    return new URL(url);
  } catch (e) {
    return null;
  }
}

function isPrivateHostname(hostname) {
  // TODO: this could be extended to detect more cases
  return hostname === "localhost" || hostname === "127.0.0.1";
}

// Note: This is a conservative implementation that detects all valid IPv4 addresses.
// It may produce false-positives, so consider this if using for other purposes.
function looksLikeIPv4Address(hostname) {
  return /^[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}$/.test(hostname);
}

function looksLikeSafeUrlParameter(key, value) {
  return value.length < 18 || /^[a-z-_]+$/.test(value);
}

/**
 * There should be no reason for these URLs to show up, but if they do
 * we should never send them to the backend. Especially, "moz-extension"
 * is problematic, as it includes an id that is unique per user and
 * can be used to link messages.
 */
function urlLeaksExtensionId(url) {
  return (
    url.startsWith("moz-extension://") || url.startsWith("chrome-extension://")
  );
}

function normalizeUrlPart(urlPart) {
  return urlPart.toLowerCase().replace(/_/g, '-');
}

// Note: matches URL parts (https://example.test/foo/bar/baz -> ['foo', 'bar', 'baz]).
// Before matching, URL match will be normalized (see "normalizeUrlPart").
const RISKY_URL_PATH_PARTS = new Set([
  // login related:
  'login',
  'login.php',
  'login-actions',
  'logout',
  'signin',
  'recover',
  'forgot',
  'forgot-password',
  'reset-credentials',
  'authenticate',
  'not-confirmed',
  'reset',
  'oauth',
  'password',

  // potential tokens
  'token',

  // could leak account:
  'edit',
  'checkout',
  'account',
  'share',
  'sharing',

  // Admin accounts
  'admin',
  'console',

  // Wordpress
  'wp-admin',
  'wp-admin.php',

  // Oracle WebLogic
  'weblogic',
]);

export function sanitizeUrl(url, options = {}) {
  const { strict = false, tryPreservePath = false } = options;
  let accept = () => ({ result: 'safe', safeUrl: url });
  const drop = (reason) => ({ result: 'dropped', safeUrl: null, reason });

  // first run some sanity check on the structure of the URL
  const parsedUrl = tryParseUrl(url);
  if (!parsedUrl) {
    return drop('invalid URL');
  }
  if (parsedUrl.username) {
    return drop('URL sets username');
  }
  if (parsedUrl.password) {
    return drop('URL sets password');
  }
  if (parsedUrl.port && parsedUrl.port !== '80' && parsedUrl.port !== '443') {
    return drop('URL has uncommon port');
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return drop('URL has uncommon protocol');
  }
  if (isPrivateHostname(parsedUrl.hostname)) {
    return drop('URL is not public');
  }
  if (looksLikeIPv4Address(parsedUrl.hostname)) {
    return drop('hostname is an ipv4 address');
  }
  if (urlLeaksExtensionId(url)) {
    return drop('URL leaks extension ID');
  }

  try {
    // At this point, the most problematic URLs should be gone;
    // now we can also decide to truncated by limiting it to the hostname.
    //
    // Often, that is a good compromise, as it still provides value
    // but the risk that it contains sensitive information is limited.
    // Note that even on https, the hostname will be shared in plaintext,
    // so it is less likely that sites include secrets or personal
    // identifiers in the hostname.
    const truncate = (reason) => {
      if (tryPreservePath && (parsedUrl.search || parsedUrl.hash)) {
        // if the URL with only the URL path left is safe, than we can mask the
        // URL less aggressively. Instead of leaving only the domain, we can
        // keep also the URL path.
        parsedUrl.search = '';
        parsedUrl.hash = '';
        const urlWithoutPath = parsedUrl.toString();
        const { result, safeUrl } = sanitizeUrl(urlWithoutPath, {
          ...options,
          tryPreservePath: false,
        });
        if (result === 'safe') {
          return {
            result: 'truncated',
            safeUrl: `${safeUrl} (PROTECTED)`,
            reason,
          };
        }
      }

      const safeUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}/ (PROTECTED)`;
      logger.debug('sanitizeUrl truncated URL:', url, '->', safeUrl);
      return {
        result: 'truncated',
        safeUrl,
        reason,
      };
    };

    // 50 is somewhat arbitrary, but appears to be an acceptable compromise.
    // There are valid websites with domains longer than 50 characters
    // (up to over 130 chars), but it is rare. Looking at relevant examples,
    // 99 percent fell in to 50 character range. If you need to tweaking
    // this value, it might be possible to increase it at bit.
    if (parsedUrl.hostname.length > 50) {
      return drop('hostname too long');
    }

    if (url.length > 800) {
      return truncate('url too long');
    }
    if (parsedUrl.search.length > 150) {
      return truncate('url search part too long');
    }
    if (parsedUrl.searchParams.size > 8) {
      return truncate('too many url search parameters');
    }

    const decodedUrl = decodeURIComponent(url);
    if (checkForEmail(url) || checkForEmail(decodedUrl)) {
      return truncate('potential email found');
    }

    const pathParts = parsedUrl.pathname.split('/');
    if (pathParts.length > 8) {
      return truncate('too many parts in the url path');
    }
    for (const part of pathParts) {
      const normalizedPart = normalizeUrlPart(part);
      if (RISKY_URL_PATH_PARTS.has(normalizedPart)) {
        return truncate(`Found a problematic part in the URL path: ${part}`);
      }

      if (strict && isHash(part, { threshold: 0.015 })) {
        return truncate(
          `Found URL path that could be an identifier: <<${part}>>`,
        );
      }
    }

    const regexps = [
      /[&?]redirect(?:-?url)?=/i,
      /[&?#/=;](?:http|https)(?::[/]|%3A%2F)/,
      /[/]order[/]./i,
      /[/]auth[/]realms[/]/i,
      /[/]protocol[/]openid-connect[/]/i,
      /((maps|route[^r-]).*|@)\d{1,2}[^\d]-?\d{6}.+\d{1,2}[^\d]-?\d{6}/i,
    ];
    for (const regexp of regexps) {
      if (regexp.test(url)) {
        return truncate(`matches ${regexp}`);
      }
    }

    for (const [key, value] of parsedUrl.searchParams) {
      if (value.length > 18 && !looksLikeSafeUrlParameter(key, value)) {
        const { accept: ok, reason } = checkSuspiciousQuery(value);
        if (!ok) {
          return truncate(
            `Found problematic URL parameter ${key}=${value}: ${reason}`,
          );
        }
      }
      if (strict && isHash(value, { threshold: 0.015 })) {
        return truncate(
          `Found URL parameter that could be an identifier ${key}=${value}`,
        );
      }
    }

    if (parsedUrl.hash) {
      parsedUrl.hash = '';
      const safeUrl = `${parsedUrl} (PROTECTED)`;
      logger.debug('sanitizeUrl truncated URL:', url, '->', safeUrl);
      return {
        result: 'truncated',
        safeUrl,
        reason: 'URL fragment found',
      };
    }

    return accept();
  } catch (e) {
    logger.warn(`Unexpected error in sanitizeUrl. Skipping url=${url}`, e);
    return drop('Unexpected error');
  }
}
