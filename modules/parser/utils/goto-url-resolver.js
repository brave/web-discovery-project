/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Resolves Google "/goto?url=TOKEN" redirect links to their real URLs.
//
// Google hides result URLs behind goto redirects, but <script> blocks leak the
// real URL in the JSON array element immediately following each goto link:
//
//   "/goto?url\u003dTOK"],["https://real-url.com","Title","Desc",...
//
// The resolver scans real <script> nodes for this pattern, building a
// (token -> real URL) map, then rewrites matching <a> hrefs in place. Working
// on the parsed DOM (rather than the raw HTML string) avoids rewriting goto
// text that appears in <textarea>, comments, or script bodies, and avoids
// altering the document structure that downstream code inspects.

const GOTO_PATH_PREFIX = "/goto?url";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,}$/;

// Bounds the forward scan in extractQuotedString. Load-bearing for DoS
// resistance: without it, a run of escaped quotes makes every candidate scan
// to end of input. Ample headroom over real goto strings and leaked URLs;
// a longer value is skipped, not truncated.
const MAX_RAW = 1024;

// Extracts a JS-quoted string starting at content[pos] (must be a double
// quote). Skips \\-escaped characters. Returns the inner string (without
// quotes) or null if the string is not closed within MAX_RAW characters.
function extractQuotedString(content, pos) {
  if (content[pos] !== '"') {
    return null;
  }
  let end = pos + 1;
  let scanned = 0;
  while (end < content.length && scanned < MAX_RAW) {
    if (content[end] === "\\") {
      end += 2;
      scanned += 2;
      continue;
    }
    if (content[end] === '"') {
      return content.slice(pos + 1, end);
    }
    end += 1;
    scanned += 1;
  }
  return null;
}

// Unescapes JS string escapes used in Google's script data (\u003d → "=", etc.).
function unescapeStr(s) {
  return s
    .replace(/\\u003[dD]/g, "=")
    .replace(/\\u0026/g, "&")
    .replace(/\\x3[dD]/g, "=");
}

function extractToken(url) {
  if (!url) {
    return null;
  }

  // Strip origin if absolute (https://host/goto?...) so the path check works.
  let path = url;
  const schemeEnd = url.indexOf("://");
  if (schemeEnd !== -1) {
    const pathStart = url.indexOf("/", schemeEnd + 3);
    if (pathStart === -1) {
      return null;
    }
    path = url.slice(pathStart);
  }

  // Fast path: /goto?url(=|%3D)TOKEN — handles both separator encodings,
  // trailing &params, and %3D/= padding without URL decoding, which would
  // mangle the token.
  if (path.startsWith(GOTO_PATH_PREFIX)) {
    let rest = path.slice(GOTO_PATH_PREFIX.length);

    // Accept "=", "%3D", or "%3d" as the separator.
    if (rest.startsWith("=")) {
      rest = rest.slice(1);
    } else if (rest.startsWith("%3D") || rest.startsWith("%3d")) {
      rest = rest.slice(3);
    } else {
      return null;
    }

    const ampPos = rest.indexOf("&");
    if (ampPos !== -1) {
      rest = rest.slice(0, ampPos);
    }

    for (;;) {
      if (rest.endsWith("%3D") || rest.endsWith("%3d")) {
        rest = rest.slice(0, -3);
      } else if (rest.endsWith("=")) {
        rest = rest.slice(0, -1);
      } else {
        break;
      }
    }

    return TOKEN_PATTERN.test(rest) ? rest : null;
  }

  // Fallback: /goto with url not as the first param (e.g. /goto?a=1&url=TOKEN).
  // Google's /goto endpoint currently puts url first, but its /url endpoint
  // doesn't, so this guards against a future format change.
  try {
    const parsed = new URL(url, "https://www.google.com");
    if (parsed.pathname !== "/goto") {
      return null;
    }
    const token = parsed.searchParams.get("url");
    return token && TOKEN_PATTERN.test(token) ? token : null;
  } catch {
    return null;
  }
}

function resolveUrl(url, mapping) {
  const token = extractToken(url);
  return token ? (mapping.get(token) ?? null) : null;
}

// After a goto string's closing quote, checks if the next characters are
// ],[" followed by a quoted http(s) URL. If so, returns it.
function extractAdjacentUrl(content, strEnd) {
  let pos = strEnd;
  while (pos < content.length) {
    const ch = content[pos];
    if (ch === " " || ch === "\n" || ch === "\t" || ch === "\r") {
      pos++;
      continue;
    }
    break;
  }

  if (content.slice(pos, pos + 3) !== "],[") {
    return null;
  }
  pos += 3;

  if (content[pos] !== '"') {
    return null;
  }

  const raw = extractQuotedString(content, pos);
  if (!raw) {
    return null;
  }

  const unescaped = unescapeStr(raw);
  if (/^https?:\/\/./.test(unescaped)) {
    return unescaped;
  }
  return null;
}

// Collects goto tokens from one script block and resolves them via adjacent
// URL pairs. First match wins.
function scanScript(content, mapping) {
  let pos = content.indexOf('"/goto?');
  while (pos !== -1) {
    const raw = extractQuotedString(content, pos);
    if (raw) {
      const strEnd = pos + 1 + raw.length + 1;
      const unescaped = unescapeStr(raw);
      const token = extractToken(unescaped);
      if (token && !mapping.has(token)) {
        const adjUrl = extractAdjacentUrl(content, strEnd);
        if (adjUrl) {
          mapping.set(token, adjUrl);
        }
      }
    }
    pos = content.indexOf('"/goto?', pos + 1);
  }
}

export function resolveGotoUrls(doc) {
  const links = doc.querySelectorAll('a[href*="/goto?"]');
  if (links.length === 0) {
    return doc;
  }

  const mapping = new Map();
  for (const { textContent } of doc.querySelectorAll("script")) {
    if (textContent) {
      scanScript(textContent, mapping);
    }
  }

  if (mapping.size === 0) {
    return doc;
  }

  for (const link of links) {
    const url = resolveUrl(link.getAttribute("href"), mapping);
    if (url) {
      link.setAttribute("href", url);
    }
  }
  return doc;
}
