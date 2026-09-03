/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Google hides result URLs behind "/goto?url=<token>" links, but leaks the real
// URL in <script> data, as the first element of the array after the goto link:
//
//   "/goto?url=TOKEN"],["https://real-url.com","Title",...
//
// Rewrite the parsed DOM, not the HTML string: a string replace also hits text,
// <style>, comments and script bodies, altering the structure that getPageData
// reports and validDoubleFetch checks.
//
// Both LEAK_RE guards keep matching linear, and were found by measurement. The
// lookahead stops the token class (a subset of the one after it) from splitting
// ambiguously; the bounded tails stop a run of escaped quotes making every
// candidate scan to end of input. 256 fits padding plus tracking params, 2048
// a destination URL.

const LEAK_RE =
  /"\/goto\?url(?:=|%3[dD]|\\u003[dD]|\\x3[dD])([A-Za-z0-9_-]{20,})(?![A-Za-z0-9_-])(?:[^"\\]|\\.){0,256}"\s*\]\s*,\s*\[\s*"(https?:(?:[^"\\]|\\.){0,2048})"/g;

const HREF_TOKEN_RE =
  /^(?:https?:\/\/[^/]+)?\/goto\?url(?:=|%3[dD])([A-Za-z0-9_-]{20,})/;

// Decodes the escapes Google's script data uses (=, &, \x3d, \/).
// Any other escape keeps its payload character, which is harmless in a URL.
const decodeEscapes = (s) =>
  s.replace(/\\u([0-9a-f]{4})|\\x([0-9a-f]{2})|\\(.)/gi, (_, u, x, c) =>
    u || x ? String.fromCharCode(parseInt(u || x, 16)) : c,
  );

export function resolveGotoUrls(doc) {
  const links = doc.querySelectorAll('a[href*="/goto?url"]');
  if (links.length === 0) {
    return doc;
  }

  const mapping = new Map();
  for (const { textContent } of doc.querySelectorAll("script")) {
    for (const [, token, raw] of textContent.matchAll(LEAK_RE)) {
      const url = decodeEscapes(raw);
      if (!mapping.has(token) && /^https?:\/\/./.test(url)) {
        mapping.set(token, url);
      }
    }
  }
  for (const link of links) {
    const url = mapping.get(HREF_TOKEN_RE.exec(link.getAttribute("href"))?.[1]);
    if (url) {
      link.setAttribute("href", url);
    }
  }
  return doc;
}
