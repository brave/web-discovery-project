/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { toASCII } from "punycode";
import { ImmutableURL, URL, getPunycodeEncoded } from "@cliqz/url-parser";
import { parse as parseHostname } from "tldts-experimental";

import Cache from "./helpers/string-cache";

function tryDecode(fn: (url: string) => string): (url: string) => string {
  return (url) => {
    // Any decoding function should always be given a 'string' argument but
    // since the name of the function `try` implies that it should *never* throw
    // it is safer to add an explicit check for this.
    if (typeof url !== "string") {
      return url;
    }

    // We observe that in practice, most URLs do not need any decoding; to make
    // sure the cost is as low as possible, we first check if there is a chance
    // that decoding will be needed (will be false 99% of the time).
    if (!url.includes("%")) {
      return url;
    }

    try {
      return fn(url);
    } catch (e) {
      return url;
    }
  };
}

export function isIpAddress(host: string): boolean {
  const parsed = parseHostname(host);
  if (parsed === null) {
    return false;
  }
  return parsed.isIp === true;
}

const urlCache: Cache<ImmutableURL> = new Cache(128);

/**
 * This is an abstraction over URL with caching and basic error handling built in. The main
 * difference is that this catches exceptions from the URL constructor (when the url is invalid)
 * and returns null instead in these cases.
 * @param String url
 * @returns {URL} parsed URL if valid is parseable, otherwise null;
 */
export function parse(url: string): URL | null {
  // We can only try to parse url of type `string`.
  if (typeof url !== "string") {
    return null;
  }

  // Check if we already parsed this particular `url`.
  const res = urlCache.get(url);
  if (res !== undefined) {
    return res;
  }

  // If it's the first time we see `url`, try to parse it.
  try {
    const parsed = new ImmutableURL(url);
    return urlCache.set(url, parsed);
  } catch (e) {
    return null;
  }
}

export const tryDecodeURI = tryDecode(decodeURI);

export function isPrivateIP(ip: string): boolean {
  // Need to check for ipv6.
  if (ip.includes(":")) {
    // ipv6
    if (ip === "::1") {
      return true;
    }
    if (
      ip.toLowerCase().startsWith("fc00:") ||
      ip.toLowerCase().startsWith("fe80:")
    ) {
      return true;
    }
    const ipParts = ip.split(":");
    return (
      ipParts[0].toLowerCase().startsWith("fd") ||
      ipParts.every((d, i) => {
        if (i === ipParts.length - 1) {
          // last group of address
          return d === "1";
        }
        return d === "0" || !d;
      })
    );
  }
  const ipParts = ip.split(".").map((d) => parseInt(d, 10));
  return (
    ipParts[0] === 10 ||
    (ipParts[0] === 100 && ipParts[1] >= 64 && ipParts[1] < 128) ||
    (ipParts[0] === 192 && ipParts[1] === 168) ||
    (ipParts[0] === 172 && ipParts[1] >= 16 && ipParts[1] < 32) ||
    ipParts[0] === 127 ||
    ipParts[0] === 0
  );
}

function protocolDefaultPort(protocol: string): string {
  if (protocol === "https:") {
    return "443";
  }

  if (protocol === "http:") {
    return "80";
  }

  return "";
}

/**
 * Equivalence check for two URL strings.
 */
export function equals(url1: string, url2: string): boolean {
  if (!url1 || !url2) {
    return false;
  }
  const pUrl1 = parse(tryDecodeURI(url1));
  const pUrl2 = parse(tryDecodeURI(url2));

  if (!pUrl1 || !pUrl2) {
    // one is not a url
    return false;
  }
  if (pUrl1.href === pUrl2.href) {
    return true;
  }
  const port1 = pUrl1.port || protocolDefaultPort(pUrl1.protocol);
  const port2 = pUrl2.port || protocolDefaultPort(pUrl2.protocol);
  return (
    pUrl1.protocol === pUrl2.protocol &&
    pUrl1.username === pUrl2.username &&
    pUrl1.password === pUrl2.password &&
    port1 === port2 &&
    pUrl1.pathname === pUrl2.pathname &&
    pUrl1.search === pUrl2.search &&
    pUrl1.hash === pUrl2.hash &&
    (pUrl1.hostname === pUrl2.hostname ||
      getPunycodeEncoded(toASCII, pUrl1).hostname ===
        getPunycodeEncoded(toASCII, pUrl2).hostname)
  );
}

// List of url shorteners hostnames.
const SHORTENERS = new Set([
  "adf.ly",
  "amp.gs",
  "bc.vc",
  "bit.do",
  "bit.ly",
  "bitly.com",
  "cutt.us",
  "db.tt",
  "filoops.info",
  "goo.gl",
  "hive.am",
  "is.gd",
  "ity.im",
  "j.mp",
  "joturl.com",
  "link.zip.net",
  "lnkd.in",
  "lnnk.in",
  "ow.ly",
  "po.st",
  "q.gs",
  "qr.ae",
  "qr.net",
  "rover.ebay.com",
  "shorter.is",
  "shorturl.is",
  "shrt.li",
  "shtn.me",
  "t.co",
  "t2mio.com",
  "tinyurl.com",
  "tr.im",
  "u.to",
  "urlways.com",
  "ux9.de",
  "v.gd",
  "vzturl.com",
  "x.co",
  "yourls.org",
  "youtu.be",
  "zii.bz",
]);

/**
 * Check if `url` is a shortener, using our list of shortener hostnames.
 */
export function isUrlShortener(url: URL | null): boolean {
  if (url === null) {
    return false;
  }

  return SHORTENERS.has(url.hostname);
}

/**
 * split0(str, on) === str.split(on)[0]
 */
function split0(str: string, on: string) {
  const pos = str.indexOf(on);
  return pos < 0 ? str : str.slice(0, pos);
}

/**
 * Given a URL and a list of query parameters, it returns an
 * equivalent URL, but with those query parameters removed.
 *
 * Note: this function will not do any decoding. Instead, it will try
 * to preserve the original URL as best as it can (e.g. the invalid URL
 * "https://example.test?q=x y" will not be normalized to the valid URL
 * "https://example.test/?q=x%20y").
 */
export function removeQueryParams(url: string, queryParams: string[]) {
  const searchStart = url.indexOf("?");
  if (searchStart === -1) {
    return url;
  }
  const searchEnd = url.indexOf("#", searchStart + 1);
  const search =
    searchEnd === -1
      ? url.slice(searchStart + 1)
      : url.slice(searchStart + 1, searchEnd);
  if (!search) {
    return url;
  }
  const parts = search
    .split("&")
    .filter((x) => !queryParams.includes(split0(x, "=")));
  const beforeSearch = url.slice(0, searchStart);

  const hash = searchEnd === -1 ? "" : url.slice(searchEnd);
  if (parts.length === 0) {
    return beforeSearch + hash;
  } else {
    return `${beforeSearch}?${parts.join("&")}${hash}`;
  }
}
