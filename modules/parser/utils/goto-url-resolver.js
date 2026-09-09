/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Resolves Google "/goto?url=TOKEN" redirect links to their real URLs.
//
// Google hides result URLs behind goto redirects. An older layout leaks the
// destination in the JSON array element immediately following each goto link:
//
//   "/goto?url\u003dTOK"],["https://real-url.com","Title","Desc",...
//
// The current layout keeps it only inside the "about this result" request of
// the same result, a base64url protobuf that names the link it describes.
//
// The resolver scans real <script> nodes (not the raw HTML string) for both
// patterns, building a (token -> real URL) map, then rewrites matching <a>
// hrefs in place. Only Google result pages are processed; the host is checked
// against an allowlist to prevent spoofing via lookalike domains.

const GOOGLE_HOST = /^(www\.)?google\.(com|cat|[a-z]{2}|com?\.[a-z]{2})$/;

// Older layout: destination is the array element after the goto link.
const RENDER_DATA_REGEXP =
  /\/goto\?url\\u003d([\w-]{20,})"(?:,(?:null|-?\d+))*\],\["(https?:[^"]+)"/g;

// Current layout: destination is inside the "about this result" request.
const ABOUT_THIS_RESULT_REGEXP =
  /\/search\/about-this-result\?[^"]*?req(?:=|\\u003d)([\w-]+)/g;

// The request keeps the link at field 1 and the result it stands for under
// field 3, extension 1024 - where field 6 is the destination.
const ABOUT_THIS_RESULT_LINK = 1;
const ABOUT_THIS_RESULT_PATH = [3, 1024];
const ABOUT_THIS_RESULT_DESTINATION = 6;

// The same token turns up with different padding and parameters around it.
const TOKEN_REGEXP = /[?&]url=([\w-]{20,})/;

const UTF8 = new TextDecoder();

function unescapeJS(str) {
  return str.replace(/\\(?:u([\da-fA-F]{4})|x([\da-fA-F]{2})|(.))/g, (_, u, x, char) =>
    char !== undefined ? char : String.fromCharCode(parseInt(u || x, 16)),
  );
}

function httpUrl(value) {
  try {
    const { protocol, href } = new URL(value);
    return protocol === "https:" || protocol === "http:" ? href : null;
  } catch {
    return null;
  }
}

function addDestination(destinations, token, url) {
  // A result is described more than once per page, every copy the same way
  if (destinations.has(token)) return;

  const destination = httpUrl(url);
  if (destination) destinations.set(token, destination);
}

function fromBase64Url(encoded) {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));

  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

// Splits a protobuf message into its length-delimited fields, the only ones
// carrying anything here. A field set more than once keeps its last value.
function readFields(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("not a message");

  const fields = new Map();
  let i = 0;

  const readVarint = () => {
    let value = 0;
    let shift = 0;
    let byte;

    do {
      if (i >= bytes.length) throw new RangeError("truncated varint");
      byte = bytes[i++];
      value += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80);

    return value;
  };

  while (i < bytes.length) {
    const key = readVarint();
    const number = Math.floor(key / 8);

    switch (key & 7) {
      case 0:
        readVarint();
        break;
      case 1:
        i += 8;
        break;
      case 5:
        i += 4;
        break;
      case 2: {
        const length = readVarint();
        if (i + length > bytes.length) throw new RangeError("truncated field");

        fields.set(number, bytes.subarray(i, i + length));
        i += length;
        break;
      }
      default:
        throw new TypeError("not a message");
    }
  }

  return fields;
}

function decodeAboutThisResult(encoded) {
  try {
    const request = readFields(fromBase64Url(encoded));
    const result = ABOUT_THIS_RESULT_PATH.reduce(
      (fields, number) => readFields(fields.get(number)),
      request,
    );

    return {
      link: UTF8.decode(request.get(ABOUT_THIS_RESULT_LINK)),
      destination: UTF8.decode(result.get(ABOUT_THIS_RESULT_DESTINATION)),
    };
  } catch {
    return null;
  }
}

function indexRenderData(doc) {
  const destinations = new Map();

  for (const script of doc.querySelectorAll("script:not([src])")) {
    const text = script.textContent;
    if (!text || !text.includes("/goto?url")) continue;

    for (const [, token, url] of text.matchAll(RENDER_DATA_REGEXP)) {
      addDestination(destinations, token, unescapeJS(url));
    }

    for (const [, request] of text.matchAll(ABOUT_THIS_RESULT_REGEXP)) {
      const described = decodeAboutThisResult(request);
      const [, token] = described?.link.match(TOKEN_REGEXP) || [];

      if (token) addDestination(destinations, token, described.destination);
    }
  }

  return destinations;
}

export function resolveGotoUrls(doc, pageUrl) {
  const links = doc.querySelectorAll('a[href*="/goto?"]');
  if (links.length === 0) {
    return doc;
  }

  let pageHost;
  try {
    pageHost = new URL(pageUrl).hostname;
  } catch {
    return doc;
  }

  if (!GOOGLE_HOST.test(pageHost)) {
    return doc;
  }

  const destinations = indexRenderData(doc);

  if (destinations.size === 0) {
    return doc;
  }

  for (const link of links) {
    const raw = link.getAttribute("href");
    if (typeof raw !== "string") continue;

    let url;
    try {
      url = new URL(raw, pageUrl);
    } catch {
      continue;
    }

    if (url.hostname !== pageHost || url.pathname !== "/goto") continue;

    const [, token] = url.search.match(TOKEN_REGEXP) || [];
    const destination = token && destinations.get(token);
    if (destination) {
      link.setAttribute("href", destination);
    }
  }
  return doc;
}