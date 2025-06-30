/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import BloomFilter from "../core/bloom-filter";
import md5 from "../core/helpers/md5";
import { isHash } from "../core/helpers/hash-detector";
import { sha1 } from "../core/crypto/utils";
import random from "../core/crypto/random";
import { fetch, httpGet } from "../core/http";
import { parse, isIpAddress } from "../core/url";
import { extractHostname } from "../core/tlds";
import { checkSuspiciousQuery, sanitizeUrl } from "../core/sanitizer";
import Storage from "../platform/web-discovery-project/storage";
import config from "../core/config";
import { getAllOpenPages } from "../platform/web-discovery-project/opentabs";
import { normalizeAclkUrl } from "./ad-detection";
import { getActiveTab, isPrivateMode, getWindow } from "../core/browser";
import DoublefetchHandler from "./doublefetch-handler";
import WebDiscoveryProjectPatternsLoader from "./web-discovery-project-patterns-loader";
import { ContentExtractor, parseQueryString } from "./content-extractor";
import logger from "./logger";
import { parseHtml, getContentDocument } from "./html-helpers";
import { parseURL, Network } from "./network";
import prefs from "../core/prefs";
import pacemaker from "../core/services/pacemaker";
import SafebrowsingEndpoint from "./safebrowsing-endpoint";
import Patterns from "./patterns";

/*
Configuration for Bloomfilter
*/

const bloomFilterSize = 500001; // false-positive 0.01, hashes 7
const bloomFilterNHashes = 7;
const allowedCountryCodes = config.settings.ALLOWED_COUNTRY_CODES;

function getRandomIntInclusive(min, max) {
  const _min = Math.ceil(min);
  const _max = Math.floor(max);
  return Math.floor(random() * (_max - _min + 1)) + min;
}

function cleanFinalUrl(domain, href) {
  /*
    We need to get the final domain, there are 2 elements that we try to capture.
    1. Which is mentioned in the key 'fu' in the scraping rules. It is not clean in all the cases.
    For eg: That URL at times comes as aclk?. In this case we will try and fall back on data-preconnect-urls.
    2. data-preconnect-urls: We are not using it as primary source, because at times, this contains the ad-server domain.
    When we use this attribute, we need to ensure we do not send back the complete chain.
    */

  let cleanDomain = href;

  // Parse domain from href.
  let parsedLink = parseURL(href);
  if (
    parsedLink &&
    parsedLink.hostname &&
    parsedLink.hostname.indexOf("google") === -1 &&
    parsedLink.path.indexOf("aclk?") === -1
  ) {
    cleanDomain = parsedLink.hostname;
  } else if (domain) {
    if (domain.indexOf(",") > -1) {
      cleanDomain = domain.split(",")[0];
    } else {
      cleanDomain = domain;
    }
  }
  return cleanDomain;
}

const WebDiscoveryProject = {
  adDetails: {},
  CHANNEL: config.settings.WDP_CHANNEL,
  VERSION: "1.0",
  WAIT_TIME: 2000,
  PAGE_WAIT_TIME: 5000,
  LOG_KEY: "wdp",
  testMode: false,
  httpCache: {},
  httpCache401: {},
  queryCache: {},
  docCache: {},
  qs_len: 30,
  rel_part_len: 18,
  rel_segment_len: 15,
  doubleFetchTimeInSec: 3600,
  MAX_NUMBER_DOUBLEFETCH_ATTEMPS: 3,
  can_urls: {},
  deadFiveMts: 5,
  deadTwentyMts: 20,
  msgType: "wdp",
  patterns: new Patterns(),
  _patternsLastUpdated: null,
  patternsLoader: (() => {
    return new WebDiscoveryProjectPatternsLoader(
      config.settings.ENDPOINT_PATTERNS,
      (content) => {
        try {
          const rules = JSON.parse(content);
          logger.debug("Got new patterns", rules);
          WebDiscoveryProject.patterns.update(rules);
          WebDiscoveryProject._patternsLastUpdated = new Date();
          logger.info(
            `WebDiscoveryProject patterns successfully updated at ${WebDiscoveryProject._patternsLastUpdated}`,
          );
        } catch (e) {
          logger.warn("Failed to apply new WebDiscoveryProject patterns", e);
        }
      },
      !config.settings.WDP_PATTERNS_SIGNING,
    );
  })(),
  ts: "",
  can_url_match: {},
  key: [
    "source",
    "protocol",
    "authority",
    "userInfo",
    "user",
    "password",
    "host",
    "port",
    "relative",
    "path",
    "directory",
    "file",
    "query",
    "anchor",
  ],
  q: {
    name: "queryKey",
    parser: /(?:^|&)([^&=]*)=?([^&]*)/g,
  },
  activeUsage: null,
  activeUsageThreshold: 2,
  bloomFilter: null,
  bf: null,
  strictQueries: [],
  oc: null,
  location: null,
  SAFE_QUORUM_PROVIDER: config.settings.ENDPOINT_SAFE_QUORUM_PROVIDER,
  safebrowsingEndpoint: new SafebrowsingEndpoint(),
  getAllOpenPages: getAllOpenPages,
  prefs: {
    config_ts: null,
    config_location: null,
  },
  allowlist: [
    /^https:\/\/www\.ft\.com\/content\//,
    /^https:\/\/www\.huffpost\.com\/entry\//,
    /^https:\/\/www\.npr\.org\/[0-9]{4}\/[0-9]{2}\/[0-9]{2}\//,
    /^https:\/\/www\.propublica\.org\/article\//,
    /^https:\/\/www\.spiegel\.de\/international\//,
    /^https:\/\/www\.washingtonpost\.com\/[a-z]+\/[0-9]{4}\/[0-9]{2}\/[0-9]{2}\//,
    /^https:\/\/www\.wsj\.com\/articles\//,
  ],

  _md5: function (str) {
    return md5(str);
  },
  isShortenerURL: function (url) {
    try {
      var url_parts = parseURL(url);
      if (!url_parts) return true;

      if (url_parts.hostname.length < 8 && url_parts.path.length > 4) {
        var v = url_parts.path.split("/");
        for (var i = 0; i < v.length; i++) if (isHash(v[i])) return true;
      }
      return false;
    } catch (ee) {
      return true;
    }
  },
  getTime() {
    const now = new Date();
    const utcHours = now.getUTCHours();
    const ts = prefs.get("config_ts", null);
    if (!ts) {
      const date = now.getDate();
      const month = now.getMonth();
      const d = (date < 10 ? "0" : "") + date;
      const m = (month < 9 ? "0" : "") + (month + 1);
      const h = (utcHours < 10 ? "0" : "") + utcHours;
      const y = now.getFullYear();
      return y + "" + m + "" + d + "" + h;
    } else {
      const h = (utcHours < 10 ? "0" : "") + utcHours;
      return ts + "" + h;
    }
  },
  isSuspiciousDomainName: function (hostname) {
    /*
         We need to identify is a hostname looks suspicious.
        */

    let splitDomain = hostname.split(".");

    if (splitDomain.length > 6) {
      return true;
    }

    if (WebDiscoveryProject.checkForLongNumber(hostname, 5)) {
      return true;
    }

    let splitHyphen = hostname.split("-");

    if (splitHyphen.length > 4) {
      return true;
    }

    return false;
  },
  calculateStrictness: function (url, page_doc, structure = false) {
    var strict_value = true;
    if (page_doc && page_doc["x"] && page_doc["x"]["canonical_url"]) {
      // there is canonical,
      var can_url_parts = parseURL(page_doc["x"]["canonical_url"]);
      var url_parts = parseURL(url);

      if (!url_parts || !can_url_parts) return true;

      if (
        url_parts.hostname != null &&
        url_parts.hostname != "" &&
        url_parts.hostname == can_url_parts.hostname
      ) {
        // both canonical and url have a hostname and is the same,
        if (
          page_doc["x"]["canonical_url"] != url &&
          page_doc["x"]["canonical_url"].length < url.length
        ) {
          // the page has a canonical of same domain, which usually is a sign that is public,
          // and the canonical is not the same url, which comes out of automatic generation
          // of canonicals
          strict_value = false;
        } else if (!structure && page_doc["alw"]) {
          // if page url is among allowlisted (alw) patterns
          strict_value = false;
        }
      }
    }
    return strict_value;
  },
  dropLongURL: function (url, options) {
    logger.debug("DLU called with arguments:", url, options);
    try {
      if (options == null)
        options = {
          strict: false,
          allowlisted: false,
        };

      if (WebDiscoveryProject.checkForEmail(url)) return true;

      var url_parts = parseURL(url);
      if (!url_parts) return true;

      if (options.strict == true) {
        if (
          url_parts.query_string &&
          url_parts.query_string.length > WebDiscoveryProject.qs_len * 0.75
        )
          return true;
        // check the number of parameters too,

        if (url_parts.query_string) {
          var v = url_parts.query_string.split(/[&;]/);
          if (v.length > 1) {
            // that means that there is a least one &; hence 2 params
            return true;
          }

          for (var i = 0; i < v.length; i++) {
            if (v[i].length > 3 && isHash(v[i])) return true;
          }

          if (
            WebDiscoveryProject.checkForLongNumber(url_parts.query_string, 8) !=
            null
          )
            return true;
        }

        if (WebDiscoveryProject.checkForLongNumber(url_parts.path, 8) != null)
          return true;
      } else {
        if (
          !options.allowlisted &&
          url_parts.query_string &&
          url_parts.query_string.length > WebDiscoveryProject.qs_len
        ) {
          logger.debug(
            "DLU failed: length of query string is longer than qs_len",
          );
          return true;
        }

        if (url_parts.query_string) {
          var v = url_parts.query_string.split(/[&;]/);
          if (v.length > 4) {
            // that means that there is a least one &; hence 5 params
            logger.debug("DLU failed: there are more than 4 parameters");
            return true;
          }
          if (
            !options.allowlisted &&
            WebDiscoveryProject.checkForLongNumber(
              url_parts.query_string,
              12,
            ) != null
          ) {
            logger.debug(
              "DLU failed: long number in the query string: ",
              url_parts.query_string,
            );
            return true;
          }
        }

        if (
          !options.allowlisted &&
          WebDiscoveryProject.checkForLongNumber(url_parts.path, 12) != null
        ) {
          logger.debug("DLU failed: long number in path: ", url_parts.path);
          return true;
        }
      }

      var vpath = url_parts.path.split(/[\/\._ \-:\+;]/);
      for (var i = 0; i < vpath.length; i++) {
        if (vpath[i].length > WebDiscoveryProject.rel_part_len) {
          return true;
        }

        if (options.strict == true) {
          // if strict, check the no token in path looks like a hash
          if (vpath[i].length > 5 && isHash(vpath[i])) return true;
        } else {
          if (vpath[i].length > 12 && isHash(vpath[i])) {
            logger.debug("DLU failed: hash in the URL ", vpath[i]);
            return true;
          }
        }
      }

      var vpath = url_parts.path.split("/");
      for (var i = 0; i < vpath.length; i++) {
        var cstr = vpath[i].replace(/[^A-Za-z0-9]/g, "");
        var mult = 1.0;
        if (options.strict == true) mult = 0.5;
        if (cstr.length > WebDiscoveryProject.rel_segment_len * mult) {
          if (isHash(cstr)) {
            logger.debug("DLU failed: hash in the path ", cstr);
            return true;
          }
        }
      }

      var v = [
        /\/admin([\/\?#=]|$)/i,
        /\/wp-admin([\/\?#=]|$)/i,
        /\/edit([\/\?#=]|$)/i,
        /[&\?#\/]share([\/\?#=]|$)/i,
        /[&\?#\/;]sharing([\/\?#=]|$)/i,
        /[&\?#\/;]logout([\/\?#=]|$)/i,
        /WebLogic/i,
        /[&\?#\/;]token([\/\?#=_;]|$)/i,
        /[&\?#\/;]trk([\/\?#=_]|$)/i,
        /[&\?#\/=;](http|https)(:\/|\%3A\%2F)/,
      ];

      // url_rel contains path and query_string
      //
      var url_rel =
        (url_parts.path || "/") + "?" + (url_parts.query_string || "");
      for (var i = 0; i < v.length; i++) if (v[i].test(url_rel)) return true;

      // checks specific to the query string
      //
      // real query string (?) or a 'fake' one with a sharp on the path, they should be treated the same way
      //
      var path_query_string = null;
      var ind_pos = url_parts.path.indexOf("#");
      if (ind_pos != -1)
        path_query_string = url_parts.path.slice(
          ind_pos,
          url_parts.path.length,
        );

      if (
        (url_parts.query_string && url_parts.query_string.length > 0) ||
        (path_query_string && path_query_string.length > 0)
      ) {
        var v = [
          /[&\?#_\-;]user/i,
          /[&\?#_\-;]token/i,
          /[&\?#_\-;]auth/i,
          /[&\?#_\-;]uid/i,
          /[&\?#_\-;]email/i,
          /[&\?#_\-;]usr/i,
          /[&\?#_\-;]pin/i,
          /[&\?#_\-;]pwd/i,
          /[&\?#_\-;]password/i,
          /[&\?#;]u[=#]/i,
          /[&\?#;]url[=#]/i,
          /[&\?#_\-;]http/i,
          /[&\?#_\-;]ref[=#]/i,
          /[&\?#_\-;]red[=#]/i,
          /[&\?#_\-;]trk/i,
          /[&\?#_\-;]track/i,
          /[&\?#_\-;]shar/i,
          /[&\?#_\-;]login/i,
          /[&\?#_\-;]logout/i,
          /[&\?#_\-;]session/i,
        ];

        if (url_parts.query_string && url_parts.query_string.length > 0) {
          for (var i = 0; i < v.length; i++)
            if (v[i].test("?" + url_parts.query_string)) {
              logger.debug(
                "Prohibited keyword found: ",
                url_parts.query_string,
              );
              return true;
            }
        }

        if (path_query_string && path_query_string.length > 0) {
          for (var i = 0; i < v.length; i++)
            if (v[i].test(path_query_string)) {
              logger.debug("Prohibited keyword found: ", path_query_string);
              return true;
            }
        }
      }

      return false;
    } catch (ee) {
      // if there were any exception, we return true for safety
      logger.debug("Exception in dropLongURL: " + ee);
      return true;
    }
  },
  cleanDocCache: function () {
    for (var key in WebDiscoveryProject.docCache) {
      if (
        WebDiscoveryProject.counter -
          WebDiscoveryProject.docCache[key]["time"] >
        3600 * WebDiscoveryProject.tmult
      ) {
        delete WebDiscoveryProject.docCache[key];
      }
    }
  },
  cleanHttpCache: function () {
    for (var key in WebDiscoveryProject.httpCache) {
      if (
        WebDiscoveryProject.counter -
          WebDiscoveryProject.httpCache[key]["time"] >
        60 * WebDiscoveryProject.tmult
      ) {
        delete WebDiscoveryProject.httpCache[key];
      }
    }
    for (var key in WebDiscoveryProject.httpCache401) {
      if (
        WebDiscoveryProject.counter -
          WebDiscoveryProject.httpCache401[key]["time"] >
        60 * WebDiscoveryProject.tmult
      ) {
        delete WebDiscoveryProject.httpCache401[key];
      }
    }
  },
  getHeaders: function (strData) {
    var o = {};
    let _status = strData.split(" ")[1];

    if (parseInt(_status)) {
      _status = parseInt(_status);
    } else {
      _status = null;
    }

    o["status"] = _status;

    var l = strData.split("\n");
    for (var i = 0; i < l.length; i++) {
      if (l[i].indexOf("Location: ") == 0) {
        o["loc"] = decodeURIComponent(l[i].split(" ")[1].trim());
      }
      if (l[i].indexOf("WWW-Authenticate: ") == 0) {
        var tmp = l[i].split(" ");
        var tmp = tmp.slice(1, tmp.length).join(" ");
        o["auth"] = tmp;
      }
    }

    return o;
  },
  httpObserver: {
    // check the non 2xx page and report if this is one of the brave result
    observeActivity: function ({
      url: aUrl,
      type,
      responseStatus,
      statusCode,
      responseHeaders,
      isPrivate,
      tabId,
    }) {
      // If isPrivate true, then drop it.
      if (isPrivate) {
        return;
      }

      // But we are only concerned, with main_frame tabs,
      // hence we can return all the others, from this point.

      if (type !== 6 && type !== "main_frame") {
        return;
      }

      // Detect ad click
      try {
        WebDiscoveryProject.detectAdClick(aUrl);

        const url = decodeURIComponent(aUrl);
        const status = responseStatus || statusCode;
        const headers = responseHeaders;

        if (status === 301 || status === 302) {
          let location;
          headers.forEach((eachHeader) => {
            if (
              eachHeader.name &&
              eachHeader.name.toLowerCase() === "location"
            ) {
              location = eachHeader.value;
            }
          });
          WebDiscoveryProject.httpCache[url] = {
            status: status,
            time: WebDiscoveryProject.counter,
            location,
          };
        } else if (status === 401) {
          WebDiscoveryProject.httpCache401[url] = {
            time: WebDiscoveryProject.counter,
          };
        } else if (status) {
          WebDiscoveryProject.httpCache[url] = {
            status: status,
            time: WebDiscoveryProject.counter,
          };
        }
      } catch (e) {
        logger.debug(e);
      }
    },
  },
  onVisitRemoved({ urls, allHistory }) {
    if (allHistory) {
      WebDiscoveryProject.db.clearHistory();
    } else {
      for (const url of urls) {
        WebDiscoveryProject.db.deleteVisit(url);
      }
    }
  },
  linkCache: {},
  cleanLinkCache: function () {
    for (var key in WebDiscoveryProject.linkCache) {
      if (
        WebDiscoveryProject.counter -
          WebDiscoveryProject.linkCache[key]["time"] >
        60 * WebDiscoveryProject.tmult
      ) {
        delete WebDiscoveryProject.linkCache[key];
      }
    }
  },
  // maxLength is the maximum length of the redirect chain
  // (once a cycle is found, it will always stop, independent of maxLength)
  getRedirects(url, _res, maxLength = 6) {
    const res = _res || [];
    if (maxLength <= 0) {
      return res;
    }

    const isRedirectToUrl = (status, location) => {
      if (status !== 301 && status !== 302) {
        return false;
      }

      return (
        location === url ||
        decodeURIComponent(location) === url ||
        location + "/" === url
      );
    };

    // Note: O(n*c) complexity, where n is the size of WebDiscoveryProject.httpCache
    // and c is the redirect chain length. In practice, it should not be an
    // issue for two reasons:
    // 1) "c" is limited by maxLength, which typically is a small constant
    // 2) WebDiscoveryProject.httpCache is reguarly cleaned up, thus it should stay quite small
    //
    // (TODO: verify that the cleanup of WebDiscoveryProject.httpCache works)
    //
    try {
      for (const [key, { status, location }] of Object.entries(
        WebDiscoveryProject.httpCache,
      )) {
        if (
          key !== url &&
          isRedirectToUrl(status, location) &&
          res.indexOf(key) < 0
        ) {
          res.unshift(key);
          return WebDiscoveryProject.getRedirects(key, res, maxLength - 1);
        }
      }
    } catch (ee) {
      logger.debug(">>>> REDIRECT ERROR >>> " + ee);
    }
    return res;
  },
  getParametersQS: function (url) {
    var res = {};
    var KeysValues = url.split(/[\?&]+/);
    for (var i = 0; i < KeysValues.length; i++) {
      var kv = KeysValues[i].split("=");
      if (kv.length == 2) res[kv[0]] = kv[1];
    }
    return res;
  },
  getEmbeddedURL: function (targetURL) {
    var ihttps = targetURL.toLowerCase().lastIndexOf("https://");
    var ihttp = targetURL.toLowerCase().lastIndexOf("http://");
    if (ihttps > 0 || ihttp > 0) {
      // contains either http or https not on the query string, very suspicious
      const parqs = parse(targetURL);
      if (parqs === null) {
        return null;
      }
      const urlParam = parqs.searchParams.params.find((kv) => kv[0] === "url");
      if (urlParam) {
        return decodeURIComponent(urlParam[1]);
      }
    } else return null;
  },
  auxIsAlive: function () {
    return true;
  },

  auxGetPageData: function (url, page_data, original_url, onsuccess, onerror) {
    WebDiscoveryProject.doublefetchHandler
      .anonymousHttpGet(url)
      .then(({ body }) => {
        return parseHtml(body);
      })
      .then((doc) => {
        const x = WebDiscoveryProject.getPageData(url, doc);

        WebDiscoveryProject.docCache[url] = {
          time: WebDiscoveryProject.counter,
          doc,
        };

        onsuccess(url, page_data, original_url, x);
      })
      .catch((error_message) => {
        logger.debug(`Error on doublefetch: ${error_message}`);
        onerror(url, page_data, original_url, error_message);
      });
  },
  auxIntersection: function (a, b) {
    var ai = 0,
      bi = 0;
    var result = new Array();
    while (ai < a.length && bi < b.length) {
      if (a[ai] < b[bi]) {
        ai++;
      } else if (a[ai] > b[bi]) {
        bi++;
      } else {
        result.push(a[ai]);
        ai++;
        bi++;
      }
    }
    return result;
  },
  auxUnion: function (a, b) {
    var h = {};
    for (var i = a.length - 1; i >= 0; --i) h[a[i]] = a[i];
    for (var i = b.length - 1; i >= 0; --i) h[b[i]] = b[i];
    var res = [];
    for (var k in h) {
      if (h.hasOwnProperty(k)) res.push(h[k]);
    }
    return res;
  },
  validDoubleFetch: function (struct_bef, struct_aft, options) {
    // compares the structure of the page when rendered in the browser with the structure of
    // the page after.

    logger.debug("xbef: " + JSON.stringify(struct_bef));
    logger.debug("xaft: " + JSON.stringify(struct_aft));

    // Check if struct_bef or struct_aft is not null, in case anyone is then we mark it as private.

    // if any of the titles is null (false), then decline (discard)
    if (!(struct_bef && struct_aft)) {
      logger.debug("fovalidDoubleFetch: found an empty structure");
      return false;
    }

    if (!(struct_bef["t"] && struct_aft["t"])) {
      logger.debug("fovalidDoubleFetch: found an empty title");
      return false;
    }

    // if any of the two struct has a iall to false decline
    if (!(struct_bef["iall"] && struct_aft["iall"])) {
      logger.debug("fovalidDoubleFetch: found a noindex");
      return false;
    }

    // check that there are not different number of frames (or iframes) with an internal
    // link on the two different loads (with and with session), if so, the frame (iframe)
    // might contain a password field. Cannot afford to fetch all iframes on page. Only
    // internal are considered, externals are likely to vary a lot due to advertisement.
    //

    /*
        Adding key to check how many pages will we loose if frame check is turned on
        if (struct_bef['nfsh']==null || struct_aft['nfsh']==null || struct_bef['nfsh']!=struct_aft['nfsh']) {
            logger.debug("fovalidDoubleFetch: number of internal frames does not match");
            return false;
        }

        if (struct_bef['nifsh']==null || struct_aft['nifsh']==null || struct_bef['nifsh']!=struct_aft['nifsh']) {
            logger.debug("fovalidDoubleFetch: number of internal iframes does not match");
            return false;
        }
        */
    if (struct_bef["canonical_url"] != struct_aft["canonical_url"]) {
      // if canonicals are different, in principle are different pages,

      if (
        struct_aft["canonical_url"] != null &&
        struct_aft["canonical_url"].length > 0 &&
        struct_bef["canonical_url"] == null
      ) {
        // unless in the case that struct_aft (after) has a canonical different than null
        // and struct_bef has no canonical,
      } else {
        return false;
      }
    }

    if (options.structure_strict == true) {
      // if there is enough html length, do the ratio, if below or above 10% then very imbalance, discard

      var length_html_ok = true;
      var length_text_ok = true;

      var ratio_lh =
        (struct_bef["lh"] || 0) /
        ((struct_bef["lh"] || 0) + (struct_aft["lh"] || 0));
      if ((struct_bef["lh"] || 0) > 10 * 1024) {
        var ratio_lh =
          (struct_bef["lh"] || 0) /
          ((struct_bef["lh"] || 0) + (struct_aft["lh"] || 0));
        if (ratio_lh < 0.1 || ratio_lh > 0.9) {
          logger.debug("fovalidDoubleFetch: lh is not balanced");
          length_html_ok = false;
        }
      }

      // if there is enough html length, do the ratio, if below or above 10% then very imbalance, discard
      var ratio_nl =
        (struct_bef["nl"] || 0) /
        ((struct_bef["nl"] || 0) + (struct_aft["nl"] || 0));
      if ((struct_bef["lh"] || 0) > 30) {
        var ratio_nl =
          (struct_bef["nl"] || 0) /
          ((struct_bef["nl"] || 0) + (struct_aft["nl"] || 0));
        if (ratio_nl < 0.1 || ratio_nl > 0.9) {
          logger.debug("fovalidDoubleFetch: nl is not balanced");
          length_text_ok = false;
        }
      }

      if (!length_text_ok && !length_html_ok) return false;
    }

    // check for passwords and forms if there is no canonical on the after (double fetched with no session)
    if (
      struct_aft["canonical_url"] == null ||
      struct_aft["canonical_url"] == ""
    ) {
      // if had no password inputs before and it has after, decline
      if (
        struct_bef["nip"] == null ||
        struct_aft["nip"] == null ||
        (struct_bef["nip"] == 0 && struct_aft["nip"] > 0)
      ) {
        logger.debug("validDoubleFetch: fail nip");
        return false;
      }

      // if had no forms before and it has after, decline
      if (
        struct_bef["nf"] == null ||
        struct_aft["nf"] == null ||
        (struct_bef["nf"] == 0 && struct_aft["nf"] > 0)
      ) {
        logger.debug("validDoubleFetch: fail text nf");
        return false;
      }
    }

    // compare that titles are equal, if not equal, use the jaccard coefficient, decline if <=0.5
    var t1 = struct_bef["t"] || "";
    var t2 = struct_aft["t"] || "";
    var jc = 1.0;

    if (t1 != t2) {
      var vt1 = t1.split(" ").filter(function (el) {
        return el.length > 1;
      });
      var vt2 = t2.split(" ").filter(function (el) {
        return el.length > 1;
      });

      jc =
        WebDiscoveryProject.auxIntersection(vt1, vt2).length /
        WebDiscoveryProject.auxUnion(vt1, vt2).length;

      if (Math.max(vt1.length, vt2.length) <= 4) {
        // the longest titles is 4 tokens long, the, we are a bit flexible on title differences
        if (jc >= 0.5) return true;
        else {
          logger.debug("short title fail title overlap");
          return false;
        }
      } else {
        // the longest titles has 4 or more tokens, be more restrictive
        if (jc <= 0.5) {
          // one last check, perhaps it's an encoding issue

          var tt1 = t1.replace(
            /[^A-Za-z 0-9 \.,\?""!@#\$%\^&\*\(\)-_=\+;:<>\/\\\|\}\{\[\]`~]*/g,
            "",
          );
          var tt2 = t2.replace(
            /[^A-Za-z 0-9 \.,\?""!@#\$%\^&\*\(\)-_=\+;:<>\/\\\|\}\{\[\]`~]*/g,
            "",
          );

          if (tt1.length > t1.length * 0.5 && tt2.length > t2.length * 0.5) {
            // if we have not decreased the titles by more than 50%
            var vtt1 = tt1.split(" ").filter(function (el) {
              return el.length > 1;
            });
            var vtt2 = tt2.split(" ").filter(function (el) {
              return el.length > 1;
            });
            jc =
              WebDiscoveryProject.auxIntersection(vtt1, vtt2).length /
              WebDiscoveryProject.auxUnion(vtt1, vtt2).length;
            // we are more demanding on the title overlap now
            if (jc <= 0.8) {
              logger.debug("validDoubleFetch: fail title overlap after ascii");
              return false;
            }
          } else {
            logger.debug("validDoubleFetch: fail title overlap");
            return false;
          }
        }

        // if the titles are not a perfect match then check for more structural things like number of inputs
        // that are type password and number of forms. This is prone to false positives because when not logged in
        // legitimate sites something prompt you to register

        // if had no password inputs before and it has after, decline
        if (
          struct_bef["nip"] == null ||
          struct_aft["nip"] == null ||
          (struct_bef["nip"] == 0 && struct_aft["nip"] > 0)
        ) {
          logger.debug("validDoubleFetch: fail nip");
          return false;
        }

        // if had no forms before and it has after, decline
        if (
          struct_bef["nf"] == null ||
          struct_aft["nf"] == null ||
          (struct_bef["nf"] == 0 && struct_aft["nf"] > 0)
        ) {
          logger.debug("validDoubleFetch: fail text nf");
          return false;
        }

        return true;
      }
    } else {
      // exactly same title
      return true;
    }

    logger.debug("validDoubleFetch: default option");

    return false;
  },
  getCleanerURL: function (url) {
    var clean_url = url;
    // check first if there is a query string,

    var url_parts = parseURL(url);
    if (!url_parts) return null;

    if (url_parts && url_parts.query_string && url_parts.query_string != "") {
      // it has a query string, either by ? # or ;
      clean_url =
        url_parts.protocol + "://" + url_parts.hostname + url_parts.path;
    } else {
      // it has neither query_string or hash or semicolon, so let's try to remove the last segment

      if (url_parts && url_parts.path && url_parts.path != "") {
        var qs = url_parts.path.split("/");
        var cqs = [];
        for (let i = 0; i < qs.length; i++) if (qs[i] != "") cqs.push(qs[i]);

        if (cqs.length >= 3) {
          // more than 3, /a/b/c, let's remove the last one

          var new_path = cqs.slice(0, cqs.length - 1).join("/");
          clean_url =
            url_parts.protocol +
            "://" +
            url_parts.hostname +
            "/" +
            new_path +
            "/";
        }
      }
    }

    if (clean_url != url) {
      // they are different, sanity checks
      if (
        !sanitizeUrl(clean_url, { testMode: WebDiscoveryProject.testMode })
          .safeUrl ||
        WebDiscoveryProject.dropLongURL(clean_url)
      )
        return url;
      else return clean_url;
    } else return url;
  },
  fetchReferral: function (referral_url, callback) {
    logger.debug("PPP in fetchReferral: " + referral_url);

    if (referral_url && referral_url != "") {
      if (WebDiscoveryProject.docCache[referral_url] == null) {
        WebDiscoveryProject.auxGetPageData(
          referral_url,
          null,
          null,
          function (referral_url) {
            logger.debug(
              "PPP in fetchReferral success auxGetPageData: " + referral_url,
            );
            callback();
          },
          function (referral_url) {
            logger.debug(
              "PPP in fetchReferral failure auxGetPageData: " + referral_url,
            );
            callback();
          },
        );
      } else {
        logger.debug(
          "PPP in fetchReferral already in docCache: " + referral_url,
        );
        callback();
      }
    } else callback();
  },

  // Runs some heuristics based on the URL and the page structure to determine
  // whether the given page is safe enough to proceed with doublefetch.
  allowDoublefetch(url, page_doc) {
    function discard(reason) {
      return { accepted: false, rejectDetails: reason };
    }
    function accept() {
      return { accepted: true };
    }

    // Need to add check for page MU.
    // one last validation whether should be fetchable or not. If we cannot send that URL because it's
    // private/suspicious/search_result page/etc. we can mark it as private directly

    if (page_doc == null || page_doc["x"] == null) {
      // this should not happen, but it does. Need to debug why the 'x' field gets lost
      // right now, let's set is a private to avoid any risk
      logger.debug("page_doc.x missing for url:", url);
      return discard("page_doc.x missing");
    }

    if (page_doc && page_doc["x"] && page_doc["x"]["iall"] == false) {
      return discard("the page is marked as noindex");
    }

    // the url is suspicious, this should never be the case here but better safe
    if (!sanitizeUrl(url, { testMode: WebDiscoveryProject.testMode }).safeUrl) {
      return discard("URL failed the isSuspiciousURL check");
    }

    let allowlisted = page_doc["alw"];

    if (WebDiscoveryProject.dropLongURL(url)) {
      // The URL itself is considered unsafe, but it has a canonical URL, so it should be public
      const cUrl = page_doc["x"]["canonical_url"];
      if (cUrl) {
        if (!allowlisted && WebDiscoveryProject.dropLongURL(cUrl)) {
          // oops, the canonical is also bad, therefore mark as private
          logger.debug(
            `both URL=${url} and canonical_url=${cUrl} are too long`,
          );
          return discard(`both URL and canonical_url are too long`);
        }
        // proceed, as we are in the good scenario in which the canonical
        // looks safe, although the url did not
      } else if (page_doc["isMU"]) {
        return accept();
      } else {
        return discard(`URL is too long (and there is no canonical URL)`);
      }
    }

    return accept();
  },

  async doubleFetch(url, page_doc) {
    try {
      const result = await WebDiscoveryProject._doubleFetch(url, page_doc);
      if (result.isPrivate) {
        WebDiscoveryProject.setAsPrivate(result.url);
      } else {
        WebDiscoveryProject.setAsPublic(result.url);

        // At this point, we have the "page" message ready but there
        // are still checks left in telemetry, so it is still possible
        // that the message will be dropped.
        await WebDiscoveryProject.telemetry(result.msgCandidate);
      }
    } catch (e) {
      logger.debug("Unexpected error during doublefetch", e);
    }
  },

  _doubleFetch(url, page_doc) {
    return new Promise((resolve, _) => {
      function privateUrlFound(url, explanation) {
        logger.debug(
          "The URL",
          url,
          "failed one of the doublefetch heuristics. Details:",
          explanation,
        );
        resolve({
          url,
          isPrivate: true,
          explanation,
        });
      }
      function publicUrlFound(url, page_doc) {
        logger.debug("The URL", url, "passed all doublefetch heuristics");
        resolve({
          url,
          isPrivate: false,
          page_doc,

          // Note that the sanitizer still needs to run over it. Depending on that
          // output, it is still possible that the message will be modified or even dropped.
          msgCandidate: {
            type: WebDiscoveryProject.msgType,
            action: "page",
            payload: page_doc,
          },
        });
      }

      const { accepted: allowDoublefetch, rejectDetails } =
        WebDiscoveryProject.allowDoublefetch(url, page_doc);
      if (!allowDoublefetch) {
        privateUrlFound(
          url,
          `URL rejected by heuristics before doublefetch: ${rejectDetails}`,
        );
        return;
      }

      logger.debug("going to double-fetch:", url);
      WebDiscoveryProject.auxGetPageData(
        url,
        page_doc,
        url,
        function (url, page_doc, original_url, data) {
          // data contains the public data of the url double-fetch,

          logger.debug("success on doubleFetch, need further validation", url);

          if (
            WebDiscoveryProject.validDoubleFetch(page_doc["x"], data, {
              structure_strict: false,
            })
          ) {
            //
            // If the double fetch is validated, we will now check for the iFrame and frameSets
            // Since we only need the telemetry for now, this seems to be the right place
            // we need to inject the page structure. The final event will have an extra key
            // nifshmatch : true / false , nfshmatch: true / false.,
            // nifshbf : Iframe count in struct_bef, nifshbf : framsetcount in before.
            // This key is added to both page_doc and data.
            //

            let nifshmatch = WebDiscoveryProject.validFrameCount(
              page_doc["x"],
              data,
            );
            let nfshmatch = WebDiscoveryProject.validFrameSetCount(
              page_doc["x"],
              data,
            );

            data.nifshmatch = nifshmatch;
            data.nfshmatch = nfshmatch;
            data.nifshbf = page_doc.x.nifsh;
            data.nfshbf = page_doc.x.nifsh;

            //
            // url, we should have the data of the double for the referral in WebDiscoveryProject.docCache
            //
            WebDiscoveryProject.fetchReferral(page_doc["ref"], function () {
              var url_strict_value = WebDiscoveryProject.calculateStrictness(
                url,
                page_doc,
              );

              var structure_strict_value =
                WebDiscoveryProject.calculateStrictness(url, page_doc, true);

              var allowlisted = page_doc["alw"];
              url_strict_value = url_strict_value && !allowlisted;

              if (page_doc["ref"] && page_doc["ref"] != "") {
                // the page has a referral
                logger.debug(
                  "PPP: page has a referral, " + url + " < " + page_doc["ref"],
                );
                var hasurl = WebDiscoveryProject.hasURL(page_doc["ref"], url);
                logger.debug(
                  "PPP: page has a referral, " +
                    url +
                    " < " +
                    page_doc["ref"] +
                    ">>>> " +
                    hasurl,
                );

                // overwrite strict value because the link exists on a public fetchable page
                logger.debug(
                  "Strictness values:",
                  url_strict_value,
                  structure_strict_value,
                );
                if (hasurl) {
                  url_strict_value = false;
                  structure_strict_value = false;
                }
              } else {
                // page has no referral
                logger.debug("PPP: page has NO referral,", url);

                // we do not know the origin of the page, run the dropLongURL strict version, if
                // there is no canonical or if there is canonical and is the same as the url,
              }

              logger.debug(
                "strict URL:",
                url,
                "> struct:",
                structure_strict_value,
                " url:",
                url_strict_value,
              );

              if (
                WebDiscoveryProject.validDoubleFetch(page_doc["x"], data, {
                  structure_strict: structure_strict_value,
                })
              ) {
                // we do not know the origin of the page, run the dropLongURL strict version

                if (
                  WebDiscoveryProject.dropLongURL(url, {
                    strict: url_strict_value,
                  })
                ) {
                  if (
                    page_doc &&
                    page_doc["x"] &&
                    page_doc["x"]["canonical_url"]
                  ) {
                    if (
                      !allowlisted &&
                      WebDiscoveryProject.dropLongURL(
                        page_doc["x"]["canonical_url"],
                        {
                          strict: url_strict_value,
                        },
                      )
                    ) {
                      privateUrlFound(
                        url,
                        "rejected by dropLongURL (strict=true) heuristic",
                      );
                      return;
                    }
                  } else {
                    privateUrlFound(
                      url,
                      "rejected by dropLongURL (strict=true) heuristic",
                    );
                    return;
                  }
                }
              } else {
                // the strict version of validDoubleFetch fails for a page with no referral,
                // since we do not know the origin mark as private
                privateUrlFound(
                  url,
                  `rejected by validDoubleFetch(structure_strict=${structure_strict_value})`,
                );
                return;
              }
              logger.debug("success on doubleFetch, need further validation");

              //
              // we need to modify the 'x' field of page_doc to substitute any structural information about
              // the page content by the data coming from the doubleFetch (no session)
              //

              var first_url_double_fetched = url;

              //
              // we need to modify the 'x' field of page_doc to substitute any structural information about
              // the page content by the data coming from the doubleFetch (no session)
              //

              // at this point we might have 3 different urls: url, page_doc['x']['canonical_url'] (either
              // one of them has to have passed the dropLongURL test), and finally we also have data['canonical_url']
              // (which has not passed the dropLongURL test). In principle, data['canonical_url']==page_doc['x']['canonical_url']
              // but is not always the case, different calls can give different urls

              if (
                data["canonical_url"] != null &&
                data["canonical_url"] != "" &&
                WebDiscoveryProject.dropLongURL(data["canonical_url"]) == false
              ) {
                page_doc["url"] = data["canonical_url"];
                page_doc["x"] = data;
              } else {
                if (
                  page_doc["x"]["canonical_url"] != null &&
                  page_doc["x"]["canonical_url"] != "" &&
                  (allowlisted ||
                    WebDiscoveryProject.dropLongURL(
                      page_doc["x"]["canonical_url"],
                    ) == false)
                ) {
                  page_doc["url"] = page_doc["x"]["canonical_url"];
                  page_doc["x"] = data;
                  page_doc["x"]["canonical_url"] = page_doc["url"];
                } else {
                  // there was no canonical either on page_doc['x'] or in data or it was droppable

                  if (
                    allowlisted ||
                    WebDiscoveryProject.dropLongURL(url) == false
                  ) {
                    page_doc["url"] = url;
                    page_doc["x"] = data;

                    if (
                      page_doc["x"]["canonical_url"] != null &&
                      page_doc["x"]["canonical_url"] != ""
                    ) {
                      page_doc["x"]["canonical_url"] = url;
                    }
                  } else {
                    // this should not happen since it would be covered by the isok checks, but better safe,
                    privateUrlFound(
                      url,
                      `rejected by fail-safe branch (dropLongURL(${url} should have been passed)`,
                    );
                    return;
                  }
                }
              }

              var clean_url = WebDiscoveryProject.getCleanerURL(
                page_doc["url"],
              );

              if (clean_url != page_doc["url"]) {
                // we have a candidate for a cleaner url (without query_string) or without the last segment
                // of the path, we want to double fetch it and if successful, then, we could replace the url
                // because it would be cleaner hence safer
                //

                logger.debug("going to clean_url double-fetch:", clean_url);

                WebDiscoveryProject.auxGetPageData(
                  clean_url,
                  page_doc,
                  first_url_double_fetched,
                  function (url, page_doc, original_url, data) {
                    logger.debug(
                      "success on clean_url doubleFetch, need further validation",
                    );

                    if (
                      WebDiscoveryProject.validDoubleFetch(
                        page_doc["x"],
                        data,
                        {
                          structure_strict: false,
                        },
                      )
                    ) {
                      // if it the second double fetch is valid, that means that the clean_url is (url parameter) is
                      // equivalent, so we can replace
                      page_doc["url"] = url;
                      page_doc["x"] = data;
                      publicUrlFound(original_url, page_doc);
                    } else {
                      // the page with the clean_urls does not return the same, it can be two cases here, one is that
                      // the content is just totally different, in this case, we should send the page with the unclean_url,
                      // the other case is that the content is different but now we have passwords where we did not have before,
                      // in such a case, it's safer to assume that the fragments cleaned were identifiying a user, and the
                      // website is redirecting to the login page, in such a case, we should not send the page at all, in fact, we
                      // should mark it as private just to be sure,
                      logger.debug("checking clean_url, page_doc:", page_doc);
                      logger.debug("checking clean_url, data: ", data);

                      if (page_doc["x"]["nip"] < data["nip"]) {
                        // the page with url_clean have more input password fields or more forms, this is dangerous,
                        privateUrlFound(
                          original_url,
                          "rejected by extra password / form fields (after doublefetch)",
                        );
                      } else {
                        // safe, here we will send the url before clean_url
                        publicUrlFound(original_url, page_doc);
                      }
                    }
                  },
                  function (url, page_doc, original_url, error_message) {
                    // there was a failure, the clean_url does not go to the same place, therefore it's better
                    // not to replace
                    logger.debug(
                      "failure on clean_url doubleFetch! structure did not match",
                    );
                    publicUrlFound(original_url, page_doc);
                  },
                );
              } else {
                publicUrlFound(original_url, page_doc);
              }
            });
          } else {
            privateUrlFound(
              url,
              "rejected as the structure of the document changed significantly (after doublefetch)",
            );
          }
        },
        function (url, page_doc, original_url, error_message) {
          logger.debug("failure on doubleFetch!", error_message);
          privateUrlFound(
            url,
            `rejected as doublefetch failed with an error ${error_message}`,
          );
        },
      );
    });
  },
  hasURL: function (source_url, target_url) {
    // the target_url is in the source_url
    try {
      var tt = WebDiscoveryProject.docCache[source_url];
      if (tt) {
        var cd = tt["doc"];
        if (!cd) {
          // fetch the content of the source_url,
          //
          logger.debug("hasURL no CD!!! ");
          return false;
        }
      } else return false;

      var target_url_no_protocol = target_url.replace(/^http(s?)\:\/\//i, "");
      var target_url_relative = null;
      try {
        var source_hostname = parseURL(source_url).hostname;
        var target_hostname = parseURL(target_url).hostname;
      } catch (ee) {
        return false;
      }

      if (source_hostname == target_hostname) {
        // same domain, path could be relative
        target_url_relative = "/";
        var v = target_url_no_protocol.split("/");
        if (v.length > 1)
          target_url_relative = "/" + v.slice(1, v.length).join("/");
      }

      //var html = cd.documentElement.innerHTML;
      //var ind1 = html.indexOf(target_url_no_protocol);
      var found = false;

      var links = cd.documentElement.getElementsByTagName("a");

      for (var i = 0; i < links.length; i++) {
        try {
          var link = links[i].href;
          link = link.replace(/^http(s?)\:\/\//i, "");

          if (link == target_url_no_protocol) {
            found = true;
            break;
          } else {
            if (target_url_relative && link == target_url_relative) {
              found = true;
              break;
            }
          }
        } catch (ee) {}
      }

      return found;
    } catch (ee) {
      logger.debug("Error on hasURL: " + ee);
      return false;
    }
  },
  getPageData: function (url, cd) {
    var len_html = null;
    var len_text = null;
    var title = null;
    var numlinks = null;
    var inputs = null;
    var inputs_nh = null;
    var inputs_pwd = null;
    var frames_same_host = null;
    var iframes_same_host = null;
    var frames = null;
    var forms = null;
    var pg_l = null;
    var metas = null;
    var tag_html = null;
    var iall = true;
    var all = null;
    var canonical_url = null;

    var url_host = null;
    var frame_host = null;

    let ourl = parseURL(url);

    try {
      url_host = parseURL(url).hostname;
    } catch (ee) {
      url_host = null;
    }

    try {
      len_html = cd.documentElement.innerHTML.length;
    } catch (ee) {}
    try {
      len_text = cd.documentElement.textContent.length;
    } catch (ee) {}
    try {
      title = cd.getElementsByTagName("title")[0].textContent;
    } catch (ee) {}
    //title = unescape(encodeURIComponent(title));

    try {
      numlinks = cd.getElementsByTagName("a").length;
    } catch (ee) {}
    try {
      inputs = cd.getElementsByTagName("input") || [];
      inputs_nh = 0;
      inputs_pwd = 0;
      for (var i = 0; i < inputs.length; i++) {
        if (inputs[i]["type"] && inputs[i]["type"] != "hidden") inputs_nh += 1;
        if (inputs[i]["type"] && inputs[i]["type"] == "password")
          inputs_pwd += 1;
      }
    } catch (ee) {}

    try {
      frames = cd.getElementsByTagName("frame") || [];
      frames_same_host = 0;
      for (var i = 0; i < frames.length; i++) {
        if (frames[i]["src"]) {
          var tsrc = frames[i]["src"];
          if (frames[i]["src"].startsWith("//"))
            tsrc = "http:" + frames[i]["src"];
          try {
            frame_host = parseURL(tsrc).hostname;
            if (frame_host === url_host || frame_host == "browser")
              frames_same_host++;
          } catch (ee) {
            frames_same_host++;
          }
        }
      }
    } catch (ee) {}

    try {
      frames = cd.getElementsByTagName("iframe") || [];
      iframes_same_host = 0;
      for (var i = 0; i < frames.length; i++) {
        if (frames[i]["src"]) {
          var tsrc = frames[i]["src"];
          if (frames[i]["src"].startsWith("//"))
            tsrc = "http:" + frames[i]["src"];
          try {
            frame_host = parseURL(tsrc).hostname;
            if (frame_host === url_host || frame_host == "browser")
              iframes_same_host++;
          } catch (ee) {
            iframes_same_host++;
          }
        }
      }
    } catch (ee) {}

    try {
      forms = cd.getElementsByTagName("form");
    } catch (ee) {}

    var metas = cd.getElementsByTagName("meta");

    // extract the language of th
    try {
      for (let i = 0; i < metas.length; i++) {
        if (
          metas[i].getAttribute("http-equiv") == "content-language" ||
          metas[i].getAttribute("name") == "language"
        ) {
          pg_l = metas[i].getAttribute("content");
        }
      }

      if (pg_l == null) {
        tag_html = cd.getElementsByTagName("html");
        pg_l = tag_html[0].getAttribute("lang");
      }

      // Keep a tab on the length of pagel.
      if (pg_l) {
        if (pg_l.length > 10) {
          pg_l = null;
        }
      }
    } catch (ee) {}

    // Check if page is not allowed for indexing, by checking the no-index tag.
    let headTag = "";
    try {
      headTag = cd.querySelector("head");
      if (headTag) {
        let headContent = headTag.innerHTML.toLowerCase();
        if (headContent && headContent.indexOf("noindex") > -1) {
          iall = false;
        }
      }
    } catch (ee) {
      logger.debug("no-index check failed " + ee);
    }

    // extract the canonical url if available
    var link_tag = cd.getElementsByTagName("link");
    for (var j = 0; j < link_tag.length; j++) {
      if (link_tag[j].getAttribute("rel") == "canonical") {
        canonical_url = link_tag[j].href;

        // This check is done because of misplaced titles on sites like 500px, youtube etc.
        // Since could not find a proper fix, hence dropping canonical URL looks like a safe idea.

        if (
          WebDiscoveryProject.can_url_match[canonical_url] &&
          WebDiscoveryProject.can_url_match[canonical_url] != url
        )
          canonical_url = null;
      }
    }

    if (canonical_url != null && canonical_url.length > 0) {
      // check that canonical url is not relative.
      // Possible variations
      // ourl:
      // http://www.liceubarcelona.cat/ca/properament_2017/opera
      // curl:
      // ca/properament_2017/opera,
      // /liceubarcelona.cat/ca/properament_2017/opera
      // chrome://www.liceubarcelona.cat/ca/properament_2017/opera
      // //www.ghacks.net/

      if (canonical_url.startsWith("//")) {
        canonical_url = canonical_url.replace("//", "");
      }

      let _urlDetails = parse(canonical_url);
      if (
        (_urlDetails !== null && _urlDetails.scheme.startsWith("chrome")) ||
        _urlDetails.scheme === ""
      ) {
        canonical_url = `${ourl.protocol}:\/\/${ourl.hostname}${_urlDetails.path}`;
      }
    }

    // extract the location of the user (country level)
    try {
      var location = WebDiscoveryProject.getCountryCode();
    } catch (ee) {}

    var x = {
      lh: len_html,
      lt: len_text,
      t: title,
      nl: numlinks,
      ni: (inputs || []).length,
      ninh: inputs_nh,
      nip: inputs_pwd,
      nf: (forms || []).length,
      pagel: pg_l,
      ctry: location,
      iall: iall,
      canonical_url: canonical_url,
      nfsh: frames_same_host,
      nifsh: iframes_same_host,
    };

    return x;
  },
  listener: {
    tmpURL: undefined,

    onLocationChange: function ({
      isPrivate,
      isLoadingDocument,
      url,
      referrer,
      frameId,
    }) {
      logger.debug("onLocationChange", {
        isPrivate,
        isLoadingDocument,
        url,
        referrer,
        frameId,
      });

      // New location, means a page loaded on the top window, visible tab
      // Return if it's a private tab.
      if (isPrivate) {
        return;
      }

      if (url === this.tmpURL) {
        logger.debug("[onLocationChange] Same as tmpURL", this.tmpURL);
        return;
      }
      this.tmpURL = url;

      WebDiscoveryProject.lastActive = WebDiscoveryProject.counter;
      WebDiscoveryProject.lastActiveAll = WebDiscoveryProject.counter;

      // The "originalURL" is the URL as shown in the address bar of the browser.
      // Internally, WebDiscoveryProject uses a decoded version. In general, if something is
      // referred to as "url" in web-discovery-project, you should assume it is a decoded URL.
      //
      // The difference is important when accessing the browser API, where
      // you should prefer the "originalURL". But within web-discovery-project itself, you
      // should consistently use the internal representation. Otherwise,
      // you risk that it will fail to match identical URLs when they contain
      // special characters.
      //
      // (Note: Why not use the "originalURL" also for the internal representation?
      //  In principle, it should work and could potentially simplify the code a bit,
      //  as you do not have to worry less about the encoding, especially when
      //  communicating with other modules or with the browser API.)
      const originalURL = url;
      const activeURL = WebDiscoveryProject.cleanCurrentUrl(url);

      //Check if the URL is know to be bad: private, about:, odd ports, etc.
      if (
        !sanitizeUrl(activeURL, { testMode: WebDiscoveryProject.testMode })
          .safeUrl
      ) {
        logger.debug("[onLocationChange] isSuspiciousURL", activeURL);
        return;
      }

      if (activeURL.indexOf("about:") != 0) {
        if (WebDiscoveryProject.state["v"][activeURL] == null) {
          const braveQuery =
            WebDiscoveryProject.contentExtractor.urlAnalyzer.tryExtractBraveSerpQuery(
              activeURL,
            );
          logger.debug("[onLocationChange] isBraveQuery", braveQuery);
          if (braveQuery) {
            WebDiscoveryProject.queryCache[activeURL] = {
              d: 0,
              q: braveQuery,
              t: "br",
            };
          } else if (
            WebDiscoveryProject.contentExtractor.urlAnalyzer.isSearchEngineUrl(
              activeURL,
            )
          ) {
            logger.debug("[onLocationChange] isSearchEngineUrl", activeURL);
            pacemaker.setTimeout(
              function (url) {
                if (!WebDiscoveryProject) {
                  return;
                }
                const query =
                  WebDiscoveryProject.contentExtractor.extractQuery(url);
                if (!query) return;
                const queryCheck = checkSuspiciousQuery(query);
                if (!queryCheck.accept) {
                  logger.debug(
                    `[onLocationChange] Dropping suspicious query before double-fetch (${queryCheck.reason})`,
                  );
                  return;
                }
                WebDiscoveryProject.addStrictQueries(url, query);
              },
              WebDiscoveryProject.WAIT_TIME,
              activeURL,
            );
          }

          var status = null;

          if (WebDiscoveryProject.httpCache[activeURL] != null) {
            status = WebDiscoveryProject.httpCache[activeURL]["status"];
          }

          var referral = null;
          var qreferral = null;

          if (WebDiscoveryProject.linkCache[activeURL] != null) {
            referral = WebDiscoveryProject.linkCache[activeURL]["s"];
          }

          //Get redirect chain
          var red = [];
          red = WebDiscoveryProject.getRedirects(activeURL, red);
          if (red.length == 0) {
            red = null;
          }

          //Set referral for the first redirect in the chain.
          if (red && referral == null) {
            var redURL = red[0];
            var refURL = WebDiscoveryProject.linkCache[redURL];
            if (refURL) {
              referral = refURL["s"];
            }

            //Update query cache with the redirected URL

            if (WebDiscoveryProject.queryCache[redURL]) {
              WebDiscoveryProject.queryCache[activeURL] =
                WebDiscoveryProject.queryCache[redURL];
            }
          }

          const allowlisted = WebDiscoveryProject.allowlist.some(
            (allowlist_regex) => allowlist_regex.test(activeURL),
          );

          // Page details to be saved.
          WebDiscoveryProject.state["v"][activeURL] = {
            url: activeURL,
            a: 0,
            x: null,
            tin: new Date().getTime(),
            e: {
              cp: 0,
              mm: 0,
              kp: 0,
              sc: 0,
              md: 0,
            },
            st: status,
            c: [],
            ref: referral,
            red: red,
            alw: allowlisted,
          };

          if (referral) {
            // when the user clicks fast enough, the query can be in the queryCache,
            // but did not get attached to the page yet
            if (
              WebDiscoveryProject.queryCache[referral] &&
              !WebDiscoveryProject.state["v"][referral]["qr"]
            ) {
              WebDiscoveryProject.state["v"][referral]["qr"] =
                WebDiscoveryProject.queryCache[referral];
            }

            // if there is a good referral, we must inherit the query if there is one
            if (
              WebDiscoveryProject.state["v"][referral] &&
              WebDiscoveryProject.state["v"][referral]["qr"]
            ) {
              WebDiscoveryProject.state["v"][activeURL]["qr"] = {
                q: WebDiscoveryProject.state["v"][referral]["qr"].q,
                t: WebDiscoveryProject.state["v"][referral]["qr"].t,
                d: WebDiscoveryProject.state["v"][referral]["qr"].d + 1,
              };
              //If the depth is greater then two, we need to check if the ref. is of same domain.
              //If not then drop the QR object, else keep it.
              if (WebDiscoveryProject.state["v"][activeURL]["qr"]["d"] > 2) {
                delete WebDiscoveryProject.state["v"][activeURL]["qr"];
              } else if (
                WebDiscoveryProject.state["v"][activeURL]["qr"]["d"] == 2
              ) {
                try {
                  if (
                    parseURL(activeURL).hostname !== parseURL(referral).hostname
                  ) {
                    delete WebDiscoveryProject.state["v"][activeURL]["qr"];
                  }
                } catch (ee) {
                  delete WebDiscoveryProject.state["v"][activeURL]["qr"];
                }
              }
            }
          }

          pacemaker.setTimeout(
            function (currURL) {
              // Extract info about the page, title, length of the page, number of links, hash signature,
              // 404, soft-404, you name it
              //

              // we cannot get it directly via
              // var cd = currWin.gBrowser.selectedBrowser.contentDocument;
              // because during the time of the timeout there can be win or tab switching
              //
              //var activeURL = WebDiscoveryProject.currentURL();
              //if (activeURL != currURL) {}
              getContentDocument(originalURL)
                .then(
                  function (cd) {
                    if (
                      !WebDiscoveryProject.contentExtractor.urlAnalyzer.isSearchEngineUrl(
                        currURL,
                      )
                    ) {
                      // Check active usage...
                      // WebDiscoveryProject.activeUsage += 1;
                      WebDiscoveryProject.incrActiveUsage();
                    }

                    var x = WebDiscoveryProject.getPageData(currURL, cd);

                    if (x["canonical_url"]) {
                      WebDiscoveryProject.can_urls[currURL] =
                        x["canonical_url"];
                      WebDiscoveryProject.can_url_match[x["canonical_url"]] =
                        currURL;
                    }

                    if (WebDiscoveryProject.state["v"][currURL] != null) {
                      WebDiscoveryProject.state["v"][currURL]["x"] = x;
                    }

                    if (WebDiscoveryProject.queryCache[currURL]) {
                      WebDiscoveryProject.state["v"][currURL]["qr"] =
                        WebDiscoveryProject.queryCache[currURL];
                      delete WebDiscoveryProject.queryCache[currURL];
                    }

                    if (WebDiscoveryProject.state["v"][currURL] != null) {
                      WebDiscoveryProject.addURLtoDB(
                        currURL,
                        WebDiscoveryProject.state["v"][currURL]["ref"],
                        WebDiscoveryProject.state["v"][currURL],
                      );
                    }
                  },
                  function () {
                    logger.debug("CANNOT GET THE CONTENT OF : " + currURL);
                  },
                )
                .catch((ee) => {
                  logger.debug(
                    "Error fetching title and length of page: " +
                      ee +
                      " : " +
                      currURL,
                  );
                });
            },
            WebDiscoveryProject.PAGE_WAIT_TIME,
            activeURL,
            originalURL,
          );
        } else {
          // oops, it exists on the active page, probably it comes from a back button or back
          // from tab navigation
          WebDiscoveryProject.state["v"][activeURL]["tend"] = null;
        }
      }
    },
  },
  _debugRemoveFromActivePages: function (url) {
    var tt = new Date().getTime();
    if (WebDiscoveryProject.state["v"][url]["tend"] == null) {
      WebDiscoveryProject.state["v"][url]["tend"] = tt;

      WebDiscoveryProject.state["m"].push(WebDiscoveryProject.state["v"][url]);
      WebDiscoveryProject.addURLtoDB(
        url,
        WebDiscoveryProject.state["v"][url]["ref"],
        WebDiscoveryProject.state["v"][url],
      );
      delete WebDiscoveryProject.state["v"][url];
      delete WebDiscoveryProject.queryCache[url];
    }
  },
  startPacemaker: function () {
    const tasks = [];

    // TODO - replace with some event to detect when currentURL changes
    // Every second (used to be 250 ms)
    tasks.push(
      pacemaker.register(
        function checkCurrentURL() {
          WebDiscoveryProject.currentURL()
            .then((activeURL) => {
              if (activeURL && activeURL.indexOf("about:") !== 0) {
                if (
                  WebDiscoveryProject.counter - WebDiscoveryProject.lastActive <
                  5 * WebDiscoveryProject.tmult
                ) {
                  // if there has been an event on the last 5 seconds, if not do no count, the user must
                  // be doing something else,
                  //
                  try {
                    WebDiscoveryProject.state["v"][activeURL]["a"] += 1;
                  } catch (ee) {}
                }
              }
            })
            .catch((e) => {
              logger.debug("Error fetching the currentURL: " + e);
            });

          WebDiscoveryProject.counter += 4;
        },
        { timeout: 1000 },
      ),
    ); // 1 second

    // TODO - could be replaced by tab events (closed, updated, new)
    // Every 5 seconds
    tasks.push(
      pacemaker.register(
        function checkAllOpenPages() {
          WebDiscoveryProject.getAllOpenPages()
            .then((openPages) => {
              var tt = new Date().getTime();

              for (var url in WebDiscoveryProject.state["v"]) {
                if (WebDiscoveryProject.state["v"].hasOwnProperty(url)) {
                  if (openPages.indexOf(url) == -1) {
                    // not opened

                    if (WebDiscoveryProject.state["v"][url]["tend"] == null) {
                      WebDiscoveryProject.state["v"][url]["tend"] = tt;
                    }

                    if (
                      tt - WebDiscoveryProject.state["v"][url]["tend"] >
                      WebDiscoveryProject.deadFiveMts * 60 * 1000
                    ) {
                      // move to "dead pages" after 5 minutes
                      WebDiscoveryProject.state["m"].push(
                        WebDiscoveryProject.state["v"][url],
                      );
                      WebDiscoveryProject.addURLtoDB(
                        url,
                        WebDiscoveryProject.state["v"][url]["ref"],
                        WebDiscoveryProject.state["v"][url],
                      );
                      delete WebDiscoveryProject.state["v"][url];
                      delete WebDiscoveryProject.queryCache[url];
                    }
                  } else {
                    // stil opened, do nothing.
                    if (
                      tt - WebDiscoveryProject.state["v"][url]["tin"] >
                      WebDiscoveryProject.deadTwentyMts * 60 * 1000
                    ) {
                      // unless it was opened more than 20 minutes ago, if so, let's move it to dead pages

                      WebDiscoveryProject.state["v"][url]["tend"] = null;
                      WebDiscoveryProject.state["v"][url]["too_long"] = true;
                      WebDiscoveryProject.state["m"].push(
                        WebDiscoveryProject.state["v"][url],
                      );
                      WebDiscoveryProject.addURLtoDB(
                        url,
                        WebDiscoveryProject.state["v"][url]["ref"],
                        WebDiscoveryProject.state["v"][url],
                      );
                      delete WebDiscoveryProject.state["v"][url];
                      delete WebDiscoveryProject.queryCache[url];
                      //logger.debug("Deleted: moved to dead pages after 20 mts.");
                      //logger.debug("Deleted: moved to dead pages after 20 mts: " + WebDiscoveryProject.state['m'].length);
                    }
                  }
                }
              }
            })
            .catch((ee) => {
              logger.debug(ee);
            });
        },
        { timeout: 5000 },
      ),
    );

    // Every 10 seconds
    tasks.push(
      pacemaker.register(
        function loadBloomFilterCheck() {
          var ll = WebDiscoveryProject.state["m"].length;
          if (ll > 0) {
            var v = WebDiscoveryProject.state["m"].slice(0, ll);
            WebDiscoveryProject.state["m"] = WebDiscoveryProject.state[
              "m"
            ].slice(ll, WebDiscoveryProject.state["m"].length);
          }
          if (!WebDiscoveryProject.bloomFilter) {
            WebDiscoveryProject.loadBloomFilter();
          }
        },
        { timeout: 10 * 1000 },
      ),
    ); // 10 seconds

    // Clean http cache (when >1 hour)
    tasks.push(
      pacemaker.register(
        function cleanHttpCache() {
          WebDiscoveryProject.cleanHttpCache();
        },
        { timeout: 15 * 1000 },
      ),
    ); // 15 seconds

    // Purge clean link cache (when >1 minute)
    tasks.push(
      pacemaker.register(
        function cleanLinkCache() {
          WebDiscoveryProject.cleanLinkCache();
        },
        { timeout: 15 * 1000 },
      ),
    ); // 15 seconds

    // Purge ad lookup (when >15 minutes)
    tasks.push(
      pacemaker.register(
        function purgeAdLookUp() {
          WebDiscoveryProject.purgeAdLookUp();
        },
        { timeout: 15 * 1000 },
      ),
    ); // 15 seconds

    // Clean doc cache (>1 hour)
    tasks.push(
      pacemaker.register(
        function cleanDocCache() {
          WebDiscoveryProject.cleanDocCache();
        },
        { timeout: 60 * 1000 },
      ),
    ); // 1 minute

    // Every minute
    tasks.push(
      pacemaker.register(
        function processUnchecked() {
          WebDiscoveryProject.listOfUnchecked(
            1,
            WebDiscoveryProject.doubleFetchTimeInSec,
            null,
            WebDiscoveryProject.processUnchecks,
          );
          WebDiscoveryProject.auxGetQuery();
        },
        { timeout: 60 * 1000 },
      ),
    ); // 1 minute

    // Every 5 minutes
    tasks.push(
      pacemaker.register(
        function flushExpiredCacheEntries() {
          logger.debug("web-discovery-project: flush network cache");
          WebDiscoveryProject.network.flushExpiredCacheEntries();
        },
        { timeout: 5 * 60 * 1000 },
      ),
    ); // 5 minutes

    // Every 20 minutes
    tasks.push(
      pacemaker.register(
        function checkActiveUsage() {
          logger.debug("Check if alive");
          WebDiscoveryProject.checkActiveUsage();
        },
        { timeout: 20 * 60 * 1000 },
      ),
    ); // 20 minutes

    // Every 4 hours
    tasks.push(
      pacemaker.register(
        function checkAllOpenPages() {
          WebDiscoveryProject.fetchSafeQuorumConfig();
        },
        { timeout: 4 * 60 * 60 * 1000 },
      ),
    ); // 4 hours

    return tasks;
  },
  unload: function () {
    //Check is active usage, was sent
    WebDiscoveryProject.checkActiveUsage();
    // send all the data
    WebDiscoveryProject.safebrowsingEndpoint.flushSendQueue();

    if (WebDiscoveryProject.pacemakerTasks) {
      WebDiscoveryProject.pacemakerTasks.forEach((task) => {
        task.stop();
      });
      WebDiscoveryProject.pacemakerTasks = null;
    }
    WebDiscoveryProject.safebrowsingEndpoint.unload();

    WebDiscoveryProject.patternsLoader.unload();

    // NOTE - this should be called already after each double-fetch call, but
    // we keep one last check here in case the extension is unloaded while
    // double-fetch is happening.
    WebDiscoveryProject.doublefetchHandler.unload();
  },
  currentURL: function () {
    return getActiveTab().then(({ url }) =>
      WebDiscoveryProject.cleanCurrentUrl(url),
    );
  },
  cleanCurrentUrl: function (url) {
    try {
      url = decodeURIComponent(url.trim());
    } catch (ee) {}

    if (url != null || url != undefined) return url;
    else return null;
  },
  pacemakerTasks: null,
  // load from the about:config settings
  captureKeyPressPage: function (ev) {
    if (
      WebDiscoveryProject.counter -
        (WebDiscoveryProject.lastEv["keypresspage"] | 0) >
      1 * WebDiscoveryProject.tmult
    ) {
      //logger.debug('captureKeyPressPage');
      WebDiscoveryProject.lastEv["keypresspage"] = WebDiscoveryProject.counter;
      WebDiscoveryProject.lastActive = WebDiscoveryProject.counter;
      var activeURL = WebDiscoveryProject.cleanCurrentUrl(ev.target.baseURI);
      if (
        WebDiscoveryProject.state["v"][activeURL] != null &&
        WebDiscoveryProject.state["v"][activeURL]["a"] >
          1 * WebDiscoveryProject.tmult
      ) {
        WebDiscoveryProject.state["v"][activeURL]["e"]["kp"] += 1;
      }
    }
  },
  captureMouseMovePage: function (ev) {
    if (
      WebDiscoveryProject.counter -
        (WebDiscoveryProject.lastEv["mousemovepage"] | 0) >
      1 * WebDiscoveryProject.tmult
    ) {
      logger.debug("captureMouseMovePage");
      WebDiscoveryProject.lastEv["mousemovepage"] = WebDiscoveryProject.counter;
      WebDiscoveryProject.lastActive = WebDiscoveryProject.counter;
      var activeURL = WebDiscoveryProject.cleanCurrentUrl(ev.target.baseURI);
      if (
        WebDiscoveryProject.state["v"][activeURL] != null &&
        WebDiscoveryProject.state["v"][activeURL]["a"] >
          1 * WebDiscoveryProject.tmult
      ) {
        WebDiscoveryProject.state["v"][activeURL]["e"]["mm"] += 1;
      }
    }
  },
  getURLFromEvent: function (ev) {
    logger.debug(">>>> Get url from event >>> " + ev.target.href);
    try {
      if (ev.target.href != null || ev.target.href != undefined) {
        return decodeURIComponent("" + ev.target.href);
      } else {
        if (
          ev.target.parentNode.href != null ||
          ev.target.parentNode.href != undefined
        ) {
          return decodeURIComponent("" + ev.target.parentNode.href);
        }
      }
    } catch (ee) {
      logger.debug("Error in getURLFromEvent: " + ee);
    }
    return null;
  },
  contextFromEvent: null,

  captureMouseClickPage(ev, contextHTML, href) {
    // if the target is a link of type hash it does not work, it will create a new page without referral
    //

    var targetURL = WebDiscoveryProject.getURLFromEvent(ev) || href;

    logger.debug("captureMouseClickPage>> " + targetURL);
    if (contextHTML) {
      WebDiscoveryProject.contextFromEvent = {
        html: contextHTML,
        ts: Date.now(),
      };
    } else {
      WebDiscoveryProject.contextFromEvent = null;
    }

    if (targetURL != null) {
      var embURL = WebDiscoveryProject.getEmbeddedURL(targetURL);
      if (embURL != null) targetURL = embURL;

      // Need to improve.
      var activeURL = WebDiscoveryProject.cleanCurrentUrl(ev.target.baseURI);
      logger.debug(
        "captureMouseClickPage>> " +
          WebDiscoveryProject.counter +
          " " +
          targetURL +
          " : " +
          " active: " +
          activeURL +
          " " +
          (WebDiscoveryProject.state["v"][activeURL] != null) +
          " " +
          ev.target +
          " :: " +
          ev.target.value +
          " >>" +
          JSON.stringify(WebDiscoveryProject.lastEv),
      );

      if (WebDiscoveryProject.state["v"][activeURL] != null) {
        WebDiscoveryProject.linkCache[targetURL] = {
          s: "" + activeURL,
          time: WebDiscoveryProject.counter,
        };
        //Fix same link in 'l'
        //Only add if gur. that they are public and the link exists in the double fetch page(Public).it's available on the public page.Such
        //check is not done, therefore we do not push the links clicked on that page. - potential record linkage.
        //We need to check for redirections and use the final link for 'l' this is why the logic is here. This will
        //for sure miss the first time it's see, cause we don't know on mouse click where it redirects.

        var linkURL = targetURL;
        if (WebDiscoveryProject.httpCache[targetURL]) {
          if (WebDiscoveryProject.httpCache[targetURL]["status"] === 301) {
            linkURL = WebDiscoveryProject.httpCache[targetURL]["location"];
          }
        }

        if (
          sanitizeUrl(linkURL, { testMode: WebDiscoveryProject.testMode })
            .safeUrl &&
          !WebDiscoveryProject.dropLongURL(linkURL)
        ) {
          WebDiscoveryProject.isAlreadyMarkedPrivate(linkURL, function (_res) {
            if (_res && _res["private"] == 0) {
              WebDiscoveryProject.state["v"][activeURL]["c"].push({
                l:
                  "" +
                  sanitizeUrl(linkURL, {
                    testMode: WebDiscoveryProject.testMode,
                  }).safeUrl,
                t: WebDiscoveryProject.counter,
              });
            } else if (!_res) {
              WebDiscoveryProject.state["v"][activeURL]["c"].push({
                l:
                  "" +
                  sanitizeUrl(linkURL, {
                    testMode: WebDiscoveryProject.testMode,
                  }).safeUrl,
                t: WebDiscoveryProject.counter,
              });
            }
          });
        }
      }
    }

    if (
      WebDiscoveryProject.counter -
        (WebDiscoveryProject.lastEv["mouseclickpage"] | 0) >
      1 * WebDiscoveryProject.tmult
    ) {
      logger.debug("captureMouseClickPage");
      WebDiscoveryProject.lastEv["mouseclickpage"] =
        WebDiscoveryProject.counter;
      WebDiscoveryProject.lastActive = WebDiscoveryProject.counter;
      var activeURL = WebDiscoveryProject.cleanCurrentUrl(ev.target.baseURI);
      if (
        WebDiscoveryProject.state["v"][activeURL] != null &&
        WebDiscoveryProject.state["v"][activeURL]["a"] >
          1 * WebDiscoveryProject.tmult
      ) {
        WebDiscoveryProject.state["v"][activeURL]["e"]["md"] += 1;
      }
    }
  },
  captureScrollPage: function (ev) {
    if (
      WebDiscoveryProject.counter -
        (WebDiscoveryProject.lastEv["scrollpage"] | 0) >
      1 * WebDiscoveryProject.tmult
    ) {
      logger.debug("captureScrollPage ");

      WebDiscoveryProject.lastEv["scrollpage"] = WebDiscoveryProject.counter;
      WebDiscoveryProject.lastActive = WebDiscoveryProject.counter;
      var activeURL = WebDiscoveryProject.cleanCurrentUrl(ev.target.baseURI);
      if (
        WebDiscoveryProject.state["v"][activeURL] != null &&
        WebDiscoveryProject.state["v"][activeURL]["a"] >
          1 * WebDiscoveryProject.tmult
      ) {
        WebDiscoveryProject.state["v"][activeURL]["e"]["sc"] += 1;
      }
    }
  },
  captureCopyPage: function (ev) {
    if (
      WebDiscoveryProject.counter -
        (WebDiscoveryProject.lastEv["copypage"] | 0) >
      1 * WebDiscoveryProject.tmult
    ) {
      logger.debug("captureCopyPage");
      WebDiscoveryProject.lastEv["copypage"] = WebDiscoveryProject.counter;
      WebDiscoveryProject.lastActive = WebDiscoveryProject.counter;
      var activeURL = WebDiscoveryProject.cleanCurrentUrl(ev.target.baseURI);
      if (
        WebDiscoveryProject.state["v"][activeURL] != null &&
        WebDiscoveryProject.state["v"][activeURL]["a"] >
          1 * WebDiscoveryProject.tmult
      ) {
        WebDiscoveryProject.state["v"][activeURL]["e"]["cp"] += 1;
      }
    }
  },
  counter: 0,
  tmult: 4,
  tpace: 250,
  lastEv: {},
  lastActive: null,
  lastActiveAll: null,

  network: new Network(),
  doublefetchHandler: new DoublefetchHandler({
    onHostnameResolved: (domain, ip) => {
      // Remember the DNS mapping because not all platforms
      // provide an API for DNS resolution.
      WebDiscoveryProject.network.cacheDnsResolution(domain, ip);
    },
  }),

  init: function () {
    return Promise.resolve().then(() => {
      logger.debug("Init function called:");
      WebDiscoveryProject.log = logger.debug;
      return Promise.resolve()
        .then(() => {
          if (WebDiscoveryProject.db) {
            logger.debug("Closing database connections...");
            return WebDiscoveryProject.db
              .asyncClose()
              .then(() => {
                WebDiscoveryProject.db = undefined;
                logger.debug("Closing database connections...done");
              })
              .catch((e) => logger.debug(e));
          } else {
            return Promise.resolve();
          }
        })
        .then(() => {
          const db = new Storage(WebDiscoveryProject);
          return db.init().then(() => {
            WebDiscoveryProject.db = db;
            logger.debug("Successfully connected to database");
          });
        })
        .then(() => {
          if (WebDiscoveryProject.state == null) {
            WebDiscoveryProject.state = {};
          }

          // Load bloom filter
          if (!WebDiscoveryProject.bloomFilter) {
            WebDiscoveryProject.loadBloomFilter();
          }

          // Load strict queries
          WebDiscoveryProject.loadStrictQueries();

          const promises = [];

          promises.push(WebDiscoveryProject.patternsLoader.init());

          // Load config from the backend
          promises.push(WebDiscoveryProject.fetchSafeQuorumConfig());

          // Load active usage stats.
          if (WebDiscoveryProject.activeUsage === null) {
            WebDiscoveryProject.db.loadRecordTelemetry(
              "activeUsage",
              (data) => {
                if (data === null) {
                  WebDiscoveryProject.activeUsage = {};
                } else {
                  WebDiscoveryProject.activeUsage = JSON.parse(data);
                }
              },
            );
          }

          // Check last alive signal sent.
          WebDiscoveryProject.db.loadRecordTelemetry(
            "activeUsageLastSent",
            (data) => {
              if (data === null) {
                // Means we have never sent the signal.
                WebDiscoveryProject.saveActiveUsageTime();
              } else {
                logger.debug(`Active usage last sent  from db as ${data}`);
                WebDiscoveryProject.activeUsageLastSent = parseInt(data);
              }
            },
          );

          return Promise.all(promises).then(() => {
            WebDiscoveryProject.safebrowsingEndpoint.init();
            if (WebDiscoveryProject.pacemakerTasks === null) {
              WebDiscoveryProject.pacemakerTasks =
                WebDiscoveryProject.startPacemaker();
            }
          });
        });
    });
  },
  state: { v: {}, m: [] },
  hashCode: function (s) {
    return s.split("").reduce(function (a, b) {
      a = (a << 5) - a + b.charCodeAt(0);
      return a & a;
    }, 0);
  },
  msgSanitize: function (msg) {
    //Check and add time , else do not send the message
    msg.channel = WebDiscoveryProject.CHANNEL;

    // Applying '--' , instead of null;
    msg.ts = WebDiscoveryProject.getTS();

    if (!msg.ts || msg.ts == "") {
      return null;
    }

    // Adding anti-duplicate key, so to detect duplicate messages on the backend.
    msg["anti-duplicates"] = Math.floor(random() * 10000000);

    if (msg.action == "page") {
      if (msg.payload.tend && msg.payload.tin) {
        var duration = msg.payload.tend - msg.payload.tin;
        logger.debug(
          "Duration spent: " +
            msg.payload.tend +
            " : " +
            msg.payload.tin +
            " : " +
            duration,
        );
      } else {
        var duration = null;
        logger.debug(
          "Duration spent: " +
            msg.payload.tend +
            " : " +
            msg.payload.tin +
            " : " +
            duration,
        );
      }

      msg.payload["dur"] = duration;

      delete msg.payload.tend;
      delete msg.payload.tin;

      // Check for fields which have urls like ref.
      // Check if they are suspicious.
      // Check if they are marked private.
      if (msg.payload.ref) {
        if (
          !sanitizeUrl(msg.payload["ref"], {
            testMode: WebDiscoveryProject.testMode,
          }).safeUrl
        ) {
          msg.payload["ref"] = null;
        } else {
          msg.payload["ref"] = WebDiscoveryProject.sanitizeUrl(
            msg.payload["ref"],
            { testMode: WebDiscoveryProject.testMode },
          );
        }

        // Check if ref. exists in bloom filter, then turn ref to null.
        WebDiscoveryProject.isAlreadyMarkedPrivate(
          msg.payload.ref,
          function (_res) {
            if (_res) {
              if (_res["private"] == 1) {
                msg.payload["ref"] = null;
              }
            }
          },
        );
      }

      // Check for title.
      if (msg.payload.x.t) {
        if (WebDiscoveryProject.isSuspiciousTitle(msg.payload.x.t)) {
          logger.debug("Suspicious Title: " + msg.payload.x.t);
          return null;
        }
      } else {
        logger.debug("Missing Title: " + msg.payload.x.t);
        return null;
      }

      // Remove C
      if (msg.payload.c) {
        msg.payload.c = null;
      }

      if (WebDiscoveryProject.dropLongURL(msg.payload.url) == true) {
        // the url is not safe, replace by the canonical if exists and is safe
        var canonical_url = msg.payload.x.canonical_url;

        if (
          canonical_url != null &&
          canonical_url != "" &&
          WebDiscoveryProject.dropLongURL(canonical_url) == false
        ) {
          // the canonical exists and is ok
          msg.payload.url = canonical_url;
        } else {
          logger.debug(
            "Suspicious url with no/bad canonical: " + msg.payload.url,
          );
          return null;
        }
      } else {
        var canonical_url = msg.payload.x.canonical_url;
        if (
          canonical_url != null &&
          canonical_url != "" &&
          WebDiscoveryProject.dropLongURL(canonical_url) == true
        ) {
          // the canonical is not safe, but the url is, remove only the canonical
          msg.payload.x.canonical_url = null;
        }
      }

      // validate that is not a shortener url, they are not useful anyway

      var short_url = WebDiscoveryProject.isShortenerURL(msg.payload.url);
      var short_canonical_url = false;
      if (
        msg.payload.x.canonical_url != null &&
        msg.payload.x.canonical_url != ""
      ) {
        short_canonical_url = WebDiscoveryProject.isShortenerURL(
          msg.payload.x.canonical_url,
        );
      }

      if (short_url || short_canonical_url) return null;

      // check if suspiciousURL
      if (
        !sanitizeUrl(msg.payload.url, {
          testMode: WebDiscoveryProject.testMode,
        }).safeUrl
      )
        return null;

      if (
        msg.payload.x.canonical_url != null &&
        msg.payload.x.canonical_url != ""
      ) {
        if (
          !sanitizeUrl(msg.payload.x.canonical_url, {
            testMode: WebDiscoveryProject.testMode,
          }).safeUrl
        )
          return null;
      }

      //Mask the long ugly redirect URLs
      if (msg.payload.red) {
        var cleanRed = [];
        msg.payload.red.forEach(function (e) {
          if (
            (sanitizeUrl(e).safeUrl, { testMode: WebDiscoveryProject.testMode })
          ) {
            cleanRed.push(
              sanitizeUrl(e, { testMode: WebDiscoveryProject.testMode })
                .safeUrl,
            );
          }
        });
        msg.payload.red = cleanRed;
      }

      // Check for canonical seen or not.
      if (msg.payload["x"]["canonical_url"]) {
        if (msg.payload["url"] == msg.payload["x"]["canonical_url"]) {
          logger.debug("Canoncial is same: ");
          // canonicalSeen = WebDiscoveryProject.canoincalUrlSeen(msg.payload['x']['canonical_url']);
          if (msg.payload["csb"] && msg.payload["ft"]) {
            logger.debug("Canoncial seen before: ");
            delete msg.payload.csb;
            delete msg.payload.ft;
          }
        }

        // if the url is not replaces by canonical then also clear the csb key.
        if (msg.payload["csb"]) delete msg.payload.csb;
      }

      // Cap values of some numerical fields like 'mm' (number of mouse mouvements)
      if (msg.payload.a) {
        // unit of times that the user was engaged in the page
        msg.payload.a = Math.min(100, msg.payload.a);
      }

      for (const [attr, max] of [
        ["mm", 100], // mouse movements
        ["sc", 100], // scroll downs or ups
        ["cp", 10], // copy (as copy+paste) event
        ["md", 50], // mouse down
        ["kp", 100], // key pressed
      ]) {
        if (msg.payload.e[attr]) {
          msg.payload.e[attr] = Math.min(max, msg.payload.e[attr]);
        }
      }

      // STAR-specific: here we attach `oc` to the page message (last octet of
      // IPv4), it will be used (and dropped) from
      // `hpnv2/sources/endpoints.es`.
      msg.oc = WebDiscoveryProject.oc;
    }

    //Check the depth. Just to be extra sure.

    if (msg.payload.qr) {
      if (msg.payload.qr.d > 2) {
        delete msg.payload.qr;
      }
    }

    // Check if qr.q is suspicious.
    if (msg.payload.qr) {
      if (!checkSuspiciousQuery(msg.payload.qr.q).accept) {
        delete msg.payload.qr;
      }
    }

    //Remove the msg if the query is too long,

    if (
      msg.action == "query" ||
      msg.action == "anon-query" ||
      msg.action == "widgetTitle"
    ) {
      //Remove the msg if the query is too long,
      if (msg.payload.q == null || msg.payload.q == "") {
        return null;
      } else {
        if (!checkSuspiciousQuery(msg.payload.q).accept) {
          return null;
        }
      }

      // We need to check the URLs for suspicious patterns,
      // Remove the suspicious URLs and limit them to 8 results.
      // Ensure reordering is done.
      if (msg.payload.r) {
        let cleanR = [];
        let newR = {};

        Object.keys(msg.payload.r).forEach((eachResult) => {
          if (
            sanitizeUrl(msg.payload.r[eachResult].u, {
              testMode: WebDiscoveryProject.testMode,
            }).safeUrl
          ) {
            cleanR.push(msg.payload.r[eachResult]);
          }
        });
        // If there are too few results, the search query tends to be very specific.
        // To avoid leaking personal information, drop them.
        //
        // Note: This limit only takes into account the results on the first page.
        // For navigational queries, like 'facebook', 'web', 'sueddeutsche', although
        // there are billions of results, only few of them are on the first page.
        // That it where we currently set the threshold.
        if (cleanR.length < 4) {
          logger.debug(
            `Dropping message for query ${msg.payload.q}, as there are too few search results.`,
          );
          return null;
        }
        cleanR.forEach((each, idx) => {
          newR[idx] = each;
        });

        logger.debug("Original: " + JSON.stringify(msg.payload.r));
        logger.debug("New: " + JSON.stringify(newR));
        msg.payload.r = newR;
      }
    }

    return msg;
  },
  // ****************************
  // telemetry, PREFER NOT TO SHARE WITH utils for safety, blatant rip-off though
  // ****************************
  notification: function (payload) {
    try {
      var location = WebDiscoveryProject.getCountryCode();
    } catch (ee) {}

    if (payload && typeof payload === "object") {
      payload["ctry"] = location;
      WebDiscoveryProject.telemetry({
        type: WebDiscoveryProject.msgType,
        action: "telemetry",
        payload: payload,
      });
    } else {
      logger.debug("Not a valid object, not sent to notification");
    }
  },

  // DEBUG FOR BRAVE, sending the message
  async telemetry(msg, instantPush) {
    const { accepted, rejectDetails } =
      await WebDiscoveryProject.runAllMessageSanitizers(msg);

    if (accepted) {
      logger.debug(
        "all checks passed: telemetry message added to the send queue:",
        msg,
      );

      // do not wait for the promise to complete (keeping the old fire-and-forget API)
      const start = Date.now();
      WebDiscoveryProject.safebrowsingEndpoint
        .send(msg, { instantPush })
        .then(() => {
          logger.debug(
            "Successfully sent message after",
            (Date.now() - start) / 1000.0,
            "sec",
            msg,
          );
        })
        .catch((e) => {
          logger.info(
            `Finally giving up on sending message (reason: ${e}, elapsed: ${
              (Date.now() - start) / 1000.0
            } sec)`,
            msg,
          );
        });
    } else {
      logger.debug("telemetry message has been discarded:", rejectDetails, msg);
    }
  },

  // Runs final heuristics to decide whether the given WebDiscoveryProject
  // message is safe to be sent. Note that the sanitizer might modify the
  // given message as a side-effect (i.e., it might zero out sensitive fields).
  async runAllMessageSanitizers(msg) {
    function discard(reason) {
      return { accepted: false, rejectDetails: reason };
    }
    function accept() {
      return { accepted: true, rejectDetails: null };
    }

    if (
      !WebDiscoveryProject //might be called after the module gets unloaded
    ) {
      return discard("web discovery project disabled");
    }
    if (isPrivateMode(getWindow())) {
      return discard("private mode");
    }

    // Sanitize message before doing the quorum check.
    msg.ver = WebDiscoveryProject.VERSION;
    msg = WebDiscoveryProject.msgSanitize(msg);
    if (!msg) {
      return discard("rejected by sanitize checks");
    }

    // Check if host is private or not.
    msg = await WebDiscoveryProject.network.sanitizeUrlsWithPrivateDomains(msg);
    if (!msg) {
      return discard("failed local domain check");
    }

    // Sanitize all urls of 'page' messages.
    try {
      msg = WebDiscoveryProject.sanitizePageMessageUrls(msg);
    } catch (e) {
      logger.debug("Error while sanitizing urls of page message", e, msg);
      return discard("failed safe quorum check for other urls");
    }

    return accept();
  },

  pushTelemetry() {
    WebDiscoveryProject.safebrowsingEndpoint.flushSendQueue();
  },

  isAlreadyMarkedPrivate: function (url, callback) {
    var hash = md5(url).substring(0, 16);
    var r = null;
    if (WebDiscoveryProject.bloomFilter) {
      var sta = WebDiscoveryProject.bloomFilter.testSingle(hash);
      if (sta) {
        r = { hash: hash, private: 1 };
      } else {
        r = { hash: hash, private: 0 };
      }
    }
    callback(r);
    return r;
  },

  // to invoke in console: WebDiscoveryProject.listOfUnchecked(1000000000000, 0, null, function(x) {console.log(x)})
  forceDoubleFetch: function (url) {
    WebDiscoveryProject.listOfUnchecked(
      1000000000000,
      0,
      url,
      WebDiscoveryProject.processUnchecks,
    );
  },

  // Intended only for debugging doublefetch heuristics.
  //
  // To use it, follow these steps:
  // 1) open all URLs that you want to check in new tabs
  // 2) run this function (in the extension devtools):
  //    WDP.app.modules['web-discovery-project'].background.webDiscoveryProject._simulateDoublefetch().then(console.table).catch(console.error);
  //
  // By default all open URLs are considered, but you can pass filter conditions:
  //  * domainFilter (type: string): only consider URLs that match the given domain
  //  * urlFilter (type: string): only consider URLs that match the given domain
  //
  // If you want only complete matches, use the "exact" version of the filter.
  // Otherwise, there is some tolerance. For example, "https://www.example.com" will
  // match both filterByDomain = "example.com" and filterByDomain = "www.example.com",
  // but not "exactFilterByDomain = "example.com".
  //
  // Examples:
  // 1) Check all open tabs:
  //   _simulateDoublefetch()
  //
  // 2) Check all open tabs, but filter only for the Spiegel news site:
  //   _simulateDoublefetch({ filterByDomain: 'spiegel' })
  //
  // 3) Check all pending, but unprocessed pages for the FAZ news site ("unprocessed"
  //    means these URLs will eventually be tested and if they meet all conditions
  //    result in actual "page" messages being sent):
  //
  //   _simulateDoublefetch({ filterByDomain: 'faz', source: 'unprocessed' })
  async _simulateDoublefetch({
    filterByDomain = null,
    filterByUrl = null,
    filterByExactDomain = null,
    filterByExactUrl = null,
    source = null, // 'openTabs' (default), 'unprocessed'
  } = {}) {
    function isRelevantUrl(url) {
      if (filterByUrl && !url.includes(filterByUrl)) {
        return false;
      }
      if (filterByExactUrl && url !== filterByExactUrl) {
        return false;
      }
      if (filterByDomain && !extractHostname(url).includes(filterByDomain)) {
        return false;
      }
      if (filterByExactDomain && extractHostname(url) !== filterByExactDomain) {
        return false;
      }
      return true;
    }

    let pages;
    if (!source || source === "openTabs") {
      const allOpenPages = await WebDiscoveryProject.getAllOpenPages();
      pages = allOpenPages
        .map((url) => ({ url, page_doc: WebDiscoveryProject.state.v[url] }))
        .filter(({ url, page_doc }) => page_doc && isRelevantUrl(url));
    } else if (source === "unprocessed") {
      pages = await new Promise((resolve, reject) => {
        WebDiscoveryProject.listOfUnchecked(
          1000000000000,
          0,
          null,
          (res, _) => {
            try {
              resolve(
                res
                  .map((x) => ({ url: x[0], page_doc: x[1] }))
                  .filter((x) => isRelevantUrl(x.url)),
              );
            } catch (e) {
              reject(e);
            }
          },
        );
      });
    } else {
      throw new Error(`unexpected source: ${source}`);
    }

    const results = await Promise.all(
      pages.map(async ({ url, page_doc }) => {
        try {
          const { isPrivate, explanation, msgCandidate } =
            await WebDiscoveryProject._doubleFetch(url, page_doc);
          let state;
          let comment;
          if (isPrivate) {
            if (
              WebDiscoveryProject.contentExtractor.urlAnalyzer.isSearchEngineUrl(
                url,
              )
            ) {
              state = "search";
              comment = 'search pages never generate "page" messages';
            } else {
              state = "private";
              comment = explanation;
            }
          } else {
            const { accepted, rejectDetails } =
              await WebDiscoveryProject.runAllMessageSanitizers(msgCandidate);
            if (accepted) {
              state = "public";
            } else {
              state = "private";
              comment = rejectDetails;
            }
          }
          return { url, state, comment: comment || "" };
        } catch (e) {
          logger.error(e);
          return { url, state: "error", explanation: `error: ${e}` };
        }
      }),
    );
    return results.sort((x, y) => x.url < y.url);
  },

  /**
   * Returns true if the given string contains any text that looks
   * like an email address. The check is conservative, that means
   * false positives are expected, but false negatives are not.
   */
  checkForEmail(str) {
    return /[a-z0-9\-_@]+(@|%40|%(25)+40)[a-z0-9\-_]+\.[a-z0-9\-_]/i.test(str);
  },

  checkForLongNumber: function (str, max_number_length) {
    var cstr = str.replace(/[^A-Za-z0-9]/g, "");

    var lcn = 0;
    var maxlcn = 0;
    var maxlcnpos = null;

    for (let i = 0; i < cstr.length; i++) {
      if (cstr[i] >= "0" && cstr[i] <= "9") lcn += 1;
      else {
        if (lcn > maxlcn) {
          maxlcn = lcn;
          maxlcnpos = i;
          lcn = 0;
        } else lcn = 0;
      }
    }

    if (lcn > maxlcn) {
      maxlcn = lcn;
      maxlcnpos = cstr.length;
      lcn = 0;
    } else lcn = 0;

    if (maxlcnpos != null && maxlcn > max_number_length)
      return cstr.slice(maxlcnpos - maxlcn, maxlcnpos);
    else return null;
  },

  checkURL(pageContent, url) {
    const { messages } = WebDiscoveryProject.contentExtractor.run(
      pageContent,
      url,
    );
    for (const message of messages)
      WebDiscoveryProject.telemetry({
        type: WebDiscoveryProject.msgType,
        action: message.action,
        payload: message.payload,
      });
  },

  /**
   * Used in context-search module
   */
  isSearchEngineUrl(url) {
    return WebDiscoveryProject.contentExtractor.urlAnalyzer.isSearchEngineUrl(
      url,
    );
  },

  aggregateMetrics: function (metricsBefore, metricsAfter) {
    var aggregates = { cp: 0, mm: 0, kp: 0, sc: 0, md: 0 };
    logger.debug(
      "aggregates: " +
        JSON.stringify(metricsBefore) +
        JSON.stringify(metricsAfter),
    );

    var _keys = Object.keys(aggregates);
    for (var i = 0; i < _keys.length; i++) {
      aggregates[_keys[i]] = metricsBefore[_keys[i]] + metricsAfter[_keys[i]];
    }
    logger.debug("aggregates: " + JSON.stringify(aggregates));

    return aggregates;
  },
  isSuspiciousTitle: function (title) {
    // 1. Need to check if the title is suspicious or not.
    // 2. Title should should not contain number greater than 8.
    // 3. Title should not contain html.

    if (title.length > 500) return true;
    var vt = title.split(" ");
    for (var i = 0; i < vt.length; i++) {
      if (vt[i].length > WebDiscoveryProject.rel_segment_len) {
        var cstr = vt[i].replace(/[^A-Za-z0-9]/g, "");
        if (cstr.length > WebDiscoveryProject.rel_segment_len) {
          if (isHash(cstr)) return true;

          if (isHash(cstr.toLowerCase(), { threshold: 0.0225 })) {
            return true;
          }
        }
      }
      var cstr = vt[i].replace(/[^A-Za-z0-9]/g, "");
      if (WebDiscoveryProject.checkForLongNumber(cstr, 8) != null) {
        return true;
      }

      if (WebDiscoveryProject.checkForEmail(cstr)) {
        return true;
      }

      if (/<[^<]+>/.test(cstr)) {
        return true;
      }
    }

    if (WebDiscoveryProject.checkForLongNumber(title, 8) != null) {
      return true;
    }

    if (WebDiscoveryProject.checkForEmail(title)) {
      return true;
    }

    if (/<[^<]+>/.test(title)) {
      return true;
    }

    return false;
  },
  auxProbString: function (h, p, s, c) {
    // h[i] = k : there are k bins (letter) with i balls (repetitions) on it,
    // h[2] = 1 : there is one letter that is repeated twice

    if (h[1] == s) {
      // recursion stop condition
      return 1.0;
    } else {
      var tot_p = 0.0;
      var kkp = 1.0;

      for (let i = h.length - 1; i > 1; i--) {
        if (h[i] != 0) {
          // it has repetitions,
          var pi = (h[i - 1] + 1) * p;
          var h2 = h.slice();

          h2[i] -= 1;

          if (false && h2[i] == 0 && h2[i - 1] == 0 && i > 1) {
            // minimize number of recursions
            h2[i - 1] += 1;

            kkp = kkp * p;
          } else {
            h2[i - 1] += 1;

            var lab = h2.join("-");
            if (!c[lab])
              c[lab] = WebDiscoveryProject.auxProbString(h2, p, s, c);
            tot_p += kkp * pi * c[lab];
          }
        }
      }

      return tot_p;
    }
  },
  probString: function (str) {
    var bins = {};

    for (let i = 0; i < str.length; i++) bins[str[i]] = (bins[str[i]] || 0) + 1;

    var keys = Object.keys(bins);

    var p = 1.0 / keys.length;
    var k = str.length - keys.length;

    var h = [];
    for (let i = 0; i < str.length + 1; i++) h[i] = 0;
    var s = 0;

    var max_freq = 0;
    for (let i = 0; i < keys.length + 1; i++) {
      var freq = bins[keys[i]];

      if (freq > 0) {
        h[bins[keys[i]]] += 1;
        s += 1;

        if (freq > max_freq) {
          max_freq = freq;
        }
      }
    }

    h = h.slice(0, max_freq + 1);

    var cache = {};
    var prob_conf = WebDiscoveryProject.auxProbString(h, p, s, cache);

    // probability of the string to be random, e.g. hash. Better to keep it for
    // strings > 15, lower probability means not random, > 0.25, random.

    return prob_conf;
  },
  incrActiveUsage: function () {
    let t = WebDiscoveryProject.getTime();

    if (!WebDiscoveryProject.activeUsage.hasOwnProperty(t)) {
      WebDiscoveryProject.activeUsage[t] = 0;
    }
    WebDiscoveryProject.activeUsage[t] += 1;

    // Persist active usage count.
    WebDiscoveryProject.db.saveRecordTelemetry(
      "activeUsage",
      JSON.stringify(WebDiscoveryProject.activeUsage),
      (result) => {
        logger.debug("Active usage stats saved:", result);
      },
    );
  },
  checkActiveUsage: function () {
    /*
          This event is generated every 60 minutes to check a user
          was active or not. We treat the user to be active if in the
          last hour, the user visited two non search pages.
          Get the active usage from DB.
          hen generate & send payload.
          Update the time last sent, and reset the value to 0.

          Sample payload:
            {
              "action": "alive",
              "ver": "1.0",
              "type": "wdp",
              "payload": {
                "status": true,
                "ctry": "de",
                "t": "2016110909"
              },
              "ts": "2016110909"
            }
        */

    const tDiff = parseInt(
      (new Date().getTime() - WebDiscoveryProject.activeUsageLastSent) / 1000,
    );
    if (tDiff > 3600) {
      const activeHours = Object.keys(WebDiscoveryProject.activeUsage);
      activeHours.forEach((h) => {
        if (
          WebDiscoveryProject.activeUsage[h] >
            WebDiscoveryProject.activeUsageThreshold &&
          h != WebDiscoveryProject.getTime()
        ) {
          WebDiscoveryProject.sendAliveMessage(h);
          delete WebDiscoveryProject.activeUsage[h];
          WebDiscoveryProject.db.saveRecordTelemetry(
            "activeUsage",
            JSON.stringify(WebDiscoveryProject.activeUsage),
            (result) => {
              logger.debug("Active usage stats saved:", result);
            },
          );
          WebDiscoveryProject.saveActiveUsageTime();
        }
      });
    }
  },
  sendAliveMessage: function (h) {
    const payload = {
      status: true,
      t: h,
      ctry: WebDiscoveryProject.getCountryCode(), // Need to fix this.
    };

    logger.debug(
      `Sending alive message for the hour: ${h} , ${JSON.stringify(payload)}`,
    );

    WebDiscoveryProject.telemetry({
      type: WebDiscoveryProject.msgType,
      action: "alive",
      payload: payload,
    });
  },
  saveActiveUsageTime: function () {
    let t = new Date().getTime();
    WebDiscoveryProject.db.saveRecordTelemetry(
      "activeUsageLastSent",
      t,
      (result) => {
        WebDiscoveryProject.activeUsageLastSent = t;
        logger.debug(`Active usage last sent as ${t}`);
      },
    );
  },
  saveStrictQueries: function () {
    logger.debug("Saving local table");
    WebDiscoveryProject.db.saveRecordTelemetry(
      "localStrictQueries",
      JSON.stringify(WebDiscoveryProject.strictQueries),
      (result) => {
        logger.debug("localStrictQueries saved:", result);
      },
    );
  },
  dumpBloomFilter: function () {
    var bf = [].slice.call(WebDiscoveryProject.bloomFilter.buckets);
    if (bf) {
      WebDiscoveryProject.db.saveRecordTelemetry(
        "bf",
        bf.join("|"),
        (result) => {
          logger.debug("bloom filter saved:", result);
        },
      );
    }
  },
  loadBloomFilter: function () {
    WebDiscoveryProject.db.loadRecordTelemetry("bf", function (data) {
      if (data == null) {
        logger.debug("There was no data on WebDiscoveryProject.bf");
        WebDiscoveryProject.bloomFilter = new BloomFilter(
          Array(bloomFilterSize).join("0"),
          bloomFilterNHashes,
        );
      } else {
        var _data = data.split("|").map(Number);
        WebDiscoveryProject.bloomFilter = new BloomFilter(
          _data,
          bloomFilterNHashes,
        );
      }
    });
  },
  loadStrictQueries: function () {
    WebDiscoveryProject.db.loadRecordTelemetry(
      "localStrictQueries",
      function (data) {
        if (data == null || data.length == 0) {
          logger.debug("There was no data on WebDiscoveryProject.bf");
          WebDiscoveryProject.strictQueries = [];
        } else {
          WebDiscoveryProject.strictQueries = JSON.parse(data);
        }
      },
    );
  },
  auxGetQuery: function () {
    WebDiscoveryProject.strictQueries.forEach(function (e, idx) {
      var t = Date.now();
      if (t - e.ts > e.tDiff * 60 * 1000) {
        WebDiscoveryProject.auxGetPageData(
          e.qurl,
          null,
          e.qurl,
          function (url, page_data, ourl, x) {
            let cd = WebDiscoveryProject.docCache[url]["doc"];
            WebDiscoveryProject.checkURL(cd, url);
          },
          function (a, b, c, d) {
            logger.debug("Error aux>>>> " + d);
          },
        );
        WebDiscoveryProject.strictQueries.splice(idx, 1);
        WebDiscoveryProject.saveStrictQueries();
      }
    });
  },
  sanitizeResultTelemetry: function (data) {
    /*
        Sanitize result telemetry. Does NOT send it, but returns sanitized telemetry.
        */
    // If there is a problem in initializing web-discovery-project, we should return.
    if (WebDiscoveryProject && WebDiscoveryProject.counter === 0) {
      return Promise.reject("WebDiscoveryProject not initialized");
    }

    const msg = data.msg;
    const msgType = data.type;

    let query = data.q;
    let sanitisedQuery = null;
    let url = msg.u;

    const hostName = extractHostname(url) || "";

    // Check if there is a query.
    if (!query || query.length == 0) {
      logger.debug("No Query");
      return Promise.reject("No Query");
    }

    // If suspicious query.
    if (!checkSuspiciousQuery(query).accept) {
      logger.debug("Query is suspicious");
      sanitisedQuery = "(PROTECTED)";
    }

    // Check if query is like a URL.
    let query_parts = parseURL(query);
    let queryLikeURL = false;
    if (
      query_parts &&
      (query_parts.protocol === "http" ||
        query_parts.protocol === "https" ||
        query_parts.protocol === "www")
    ) {
      queryLikeURL = true;
    }

    if (
      queryLikeURL &&
      (!sanitizeUrl(query, { testMode: WebDiscoveryProject.testMode })
        .safeUrl ||
        WebDiscoveryProject.dropLongURL(query))
    ) {
      logger.debug("Query is dangerous");
      sanitisedQuery = "(PROTECTED)";
    }

    // Queries also appear on the URL, in which
    // case we need to check whether it's a URL or not.
    if (hostName.length > 0 && url && url.length > 0) {
      // Check if the URL is marked as already private.

      // If there is a problem in initializing web-discovery-project bloom-filter, we should return.
      if (!WebDiscoveryProject.bloomFilter) {
        return Promise.reject("Bloom filter not initialized");
      }
      const urlPrivate = WebDiscoveryProject.bloomFilter.testSingle(md5(url));
      if (urlPrivate) {
        logger.debug("Url is already marked private");
        return Promise.reject("Url is already marked private");
      }

      // Check URL is suspicious
      if (
        !sanitizeUrl(url, { testMode: WebDiscoveryProject.testMode }).safeUrl
      ) {
        logger.debug("Url is suspicious");
        url = "(PROTECTED)";
      }

      // Check URL is dangerous, with strict DROPLONGURL.
      if (WebDiscoveryProject.dropLongURL(url, { strict: true })) {
        // If it's Google / Yahoo / Bing. Then mask and send them.
        if (
          WebDiscoveryProject.contentExtractor.urlAnalyzer.isSearchEngineUrl(
            url,
          )
        ) {
          url = sanitizeUrl(url, {
            testMode: WebDiscoveryProject.testMode,
          }).safeUrl;
        } else {
          url = "(PROTECTED)";
        }
      }

      // Check for DNS.
      // isHostNamePrivate can leak sensitive information while doing the DNS lookup
      // https://bugzilla.mozilla.org/show_bug.cgi?id=1469709
      // return WebDiscoveryProject.network.isHostNamePrivate(url).then((res) => {
      return Promise.resolve().then(() => {
        let maskedURL;
        let parsedUrl = parseURL(url);
        if (parsedUrl && parsedUrl.hostname) {
          maskedURL = sanitizeUrl(url, {
            testMode: WebDiscoveryProject.testMode,
          }).safeUrl;
        } else {
          maskedURL = "(PROTECTED)";
        }

        // Cases when query and URL are same.
        if (url === query) {
          sanitisedQuery = "(PROTECTED)";
          maskedURL = sanitisedQuery;
        }
        // Check if query failed any checks, then replace it with
        // a placeholder.
        if (sanitisedQuery) {
          query = sanitisedQuery;
          maskedURL = sanitisedQuery;
        }
        return {
          query,
          url: maskedURL,
          data,
        };
      });
    } else {
      // The URL was not a URL hence drop it.
      // Check if query failed any checks, then replace it with
      // a placeholder.

      // As a final check, if query is a single token, and can be a private domain.
      // Like my.adminportal.com
      if (query.indexOf(" ") === -1 && query.indexOf(".") > -1) {
        return WebDiscoveryProject.network
          .isHostNamePrivate(query)
          .then((res) => {
            if (res) {
              logger.debug("Private Domain");
              sanitisedQuery = "(PROTECTED)";
            }
            if (sanitisedQuery) {
              query = sanitisedQuery;
            }
            return {
              query,
              url: null,
              data,
            };
          });
      } else {
        if (sanitisedQuery) {
          query = sanitisedQuery;
        }
        return Promise.resolve({
          query,
          url: null,
          data,
        });
      }
    }
  },
  sendResultTelemetry: function (query, url, data) {
    const params =
      encodeURIComponent(query) +
      (data.msg.a ? "&a=" + encodeURIComponent(data.msg.a) : "") +
      "&i=" +
      data.msg.i +
      (url ? "&u=" + encodeURIComponent(url) : "") +
      data.s +
      data.msg.o +
      (data.msg.e ? "&e=" + data.msg.e : "");
    const payLoadURL = data.endpoint + params;
    httpGet(payLoadURL);
  },
  validFrameCount: function (struct_bef, struct_aft) {
    //
    // To take into account, the transition state, when the extension is updated
    // Data saved in the DB will not have the key nifsh, hence we should return true
    // for those cases.
    //

    if (
      struct_bef.nifsh == null ||
      struct_aft.nifsh == null ||
      struct_bef.nifsh != struct_aft.nifsh
    ) {
      logger.debug(
        "fovalidDoubleFetch: number of internal iframes does not match",
      );
      return false;
    }

    return true;
  },
  validFrameSetCount: function (struct_bef, struct_aft) {
    //
    // To take into account, the transition state, when the extension is updated
    // Data saved in the DB will not have the key nfsh, hence we should return true
    // for those cases.
    //

    if (
      struct_bef.nfsh == null ||
      struct_aft.nfsh == null ||
      struct_bef.nfsh != struct_aft.nfsh
    ) {
      logger.debug(
        "fovalidDoubleFetch: number of internal frameset does not match",
      );
      return false;
    }

    return true;
  },
  sha1: function (s) {
    return sha1(s);
  },
  async fetchSafeQuorumConfig() {
    try {
      const req = await fetch(WebDiscoveryProject.SAFE_QUORUM_PROVIDER);
      if (!req.ok) {
        throw new Error(req.statusText);
      }
      const json = await req.json();

      if (WebDiscoveryProject) {
        // TODO - remove and also delete `keyExpire` from backend response
        // WebDiscoveryProject.keyExpire = json.expiry * (24 * 60 * 60 * 1000); // Backend sends it in days;
        WebDiscoveryProject.oc = json.oc;

        // TODO - maybe reuse this or hard-code
        // WebDiscoveryProject.quorumThreshold = json.threshold;
        WebDiscoveryProject.location = json.location;
      }
    } catch (e) {
      logger.debug("Error loading config.", e);
    }
  },
  getCountryCode: function () {
    let ctryCode = WebDiscoveryProject.location;
    return WebDiscoveryProject.sanitizeCountryCode(ctryCode);
  },
  getTS: function () {
    try {
      let ts = prefs.get("config_ts", "--");
      return ts;
    } catch (ee) {
      return null;
    }
  },
  sanitizeCountryCode: function (ctryCode) {
    let _countryCode = ctryCode;
    if (allowedCountryCodes.indexOf(_countryCode) === -1) {
      _countryCode = "--";
    }
    return _countryCode;
  },
  getUrlsToSanitizeFromPageMessage: function (msg) {
    const urls = [];

    // Only sanitize canonical, when:
    // - It is not from qr.
    // - If it is from qr then only type cl or othr.
    if (
      (msg.payload.x.canonical_url && !msg.payload.qr) ||
      (msg.payload.x.canonical_url &&
        msg.payload.qr &&
        (msg.payload.qr.t === "cl" || msg.payload.qr.t === "othr"))
    ) {
      let canURL = msg.payload.x.canonical_url;
      let parse_url = parseURL(canURL);

      if (
        (parse_url && parse_url.path.length > 1) ||
        (parse_url.query_string &&
          parse_url.path.length == 1 &&
          parse_url.query_string.length > 1)
      ) {
        urls.push({ t: "canonical", url: canURL });
      }
    }
    if (msg.payload.ref) {
      let refURL = msg.payload.ref;
      let parse_url = parseURL(refURL);

      if (
        (parse_url && parse_url.path.length > 1) ||
        (parse_url.query_string &&
          parse_url.path.length == 1 &&
          parse_url.query_string.length > 1)
      ) {
        urls.push({ t: "ref", url: refURL });
      }
    }

    if (msg.payload.red) {
      msg.payload.red.forEach((_redURL, idx) => {
        if (_redURL) {
          let redURL = _redURL;
          let parse_url = parseURL(redURL);

          if (
            (parse_url && parse_url.path.length > 1) ||
            (parse_url.query_string &&
              parse_url.path.length == 1 &&
              parse_url.query_string.length > 1)
          ) {
            urls.push({ t: "red:" + idx, url: redURL });
          }
        }
      });
    }

    return urls;
  },
  sanitizePageMessageUrls: function (msg) {
    // Before sending the action page, we need to sanitize the URLs carried in
    // canonical_url field, referrer and redirect chain.
    //
    // Not all URLs require sanitizing, we only sanitize the URLs which either
    // have a path/ or query string.
    //
    // Example:
    // https://example.com/ will not be sanitized.
    // https://example.com/?q=something will be sanitized.
    //
    // We do not need to sanitize canonical url if it comes out of a search
    // engine.
    if (msg.action === "page") {
      const urls = WebDiscoveryProject.getUrlsToSanitizeFromPageMessage(msg);
      logger.debug("All urls in the message:" + JSON.stringify(urls));

      for (const original of urls) {
        if (original.t === "canonical") {
          msg.payload.x.canonical_url = sanitizeUrl(original.url, {
            strict: true,
            testMode: WebDiscoveryProject.testMode,
          }).safeUrl;
          logger.debug(
            `Sanitized 'canonical': ${original.url} -> ${msg.payload.x.canonical_url}`,
          );
        }

        if (original.t === "ref") {
          msg.payload.ref = sanitizeUrl(original.url, {
            strict: true,
            testMode: WebDiscoveryProject.testMode,
          }).safeUrl;
          logger.debug(
            `Sanitized 'ref': ${original.url} -> ${msg.payload.ref}`,
          );
        }

        if (original.t.startsWith("red")) {
          let redPos = original.t.split(":")[1];
          msg.payload.red[redPos] = sanitizeUrl(original.url, {
            strict: true,
            testMode: WebDiscoveryProject.testMode,
          }).safeUrl;
          logger.debug(
            `Sanitized 'ref++${redPos}': ${original.url} -> ${msg.payload.red[redPos]}`,
          );
        }
      }
      logger.debug("All urls in the message:" + JSON.stringify(msg));
    }
  },
  addURLtoDB(url, ref, paylobj) {
    /*
      1. Check if the given URL is a search URL,
      We do not want to save search URLs in the DB,
      for double-fetch.

      2. Then we want to check whether we have already marked the UpRL as private.
      If yes then we should return.

      3. Check if URL
        a. Not in the DB.
          i. Check if URL is fit to save
            x. paylobj['x'] == null
            y. WebDiscoveryProject.isSuspiciousURL(url)
            z. WebDiscoveryProject.httpCache401[url]

            if any of the above condition is met, it is set as private.
            else it is inserted in the DB

        b. Already in the DB.
          i. Update the stats, like engagement metrics.
      */

    var tt = new Date().getTime();
    if (
      WebDiscoveryProject.contentExtractor.urlAnalyzer.isSearchEngineUrl(url)
    ) {
      return;
    }

    //Check if url is in hashtable

    /*
      The key ft is obsolete, should remove.
      */

    var ft = 1;
    var privateHash = false;

    WebDiscoveryProject.isAlreadyMarkedPrivate(url, function (_res) {
      if (_res) {
        if (_res["private"] == 1) {
          privateHash = true;
        } else {
          ft = 0;
        }
      } else {
        // we never seen it, let's add it
        paylobj["ft"] = true;
      }
    });

    // Need to add if canonical is seen before or not.
    // This is helpful, becuase now we replace the url with canonical incase of dropLongUrl(url) => true.
    // Hence, in the event log, lot of URL's look ft => true.

    WebDiscoveryProject.db.getURL(url, function (obj) {
      // If the url is already not in the DB or marked private, then we need save it.
      logger.debug(">>>>> Add url to dbobj" + obj.length + privateHash);
      if (!privateHash && obj.length === 0) {
        // does not exist
        var setPrivate = false;

        var newObj = {};
        newObj.url = url;
        newObj.ref = ref;
        newObj.last_visit = tt;
        newObj.first_visit = tt;
        newObj.ft = ft;
        newObj.payload = paylobj || {}; // This needs to stringified before pushing to chrome storage.

        if (paylobj["x"] == null) {
          // page data structure is empty, so no need to double fetch, is private
          let reason = "empty page data";
          setPrivate = true;
          logger.debug("Setting private because empty page data");
        } else if (
          !sanitizeUrl(url, { testMode: WebDiscoveryProject.testMode }).safeUrl
        ) {
          // if the url looks private already add it already as checked and private
          let reason = "susp. url";
          setPrivate = true;
          logger.debug("Setting private because suspiciousURL");
        } else {
          if (WebDiscoveryProject.httpCache401[url]) {
            let reason = "401";
            setPrivate = true;
            logger.debug("Setting private because of 401");
          } else {
            let reason = "";
            setPrivate = false;
          }
        }
        logger.debug(">>>>> lets save >>> " + JSON.stringify(newObj));

        // This needs to simplified, if it needs to set Private, why insert it in the first place.
        // Possibly because else the remove url would break in setAsPrivate.
        WebDiscoveryProject.db.saveURL(url, newObj, function () {
          logger.debug("Insertion success add urltoDB");

          if (setPrivate) WebDiscoveryProject.setAsPrivate(url);
        });
      } else if (obj.length === 1) {
        logger.debug(
          ">>>>> Add url to dbobj found record" + JSON.stringify(obj),
        );
        let record = obj[0];
        // Looks like the URL is already there, we just need to update the stats.

        //Need to aggregate the engagement metrics.
        logger.debug(record);
        let metricsBefore;
        if (typeof record.payload === "string") {
          // (possibly only reachable on Bootstrapped extensions)
          metricsBefore = JSON.parse(record.payload).e;
        } else {
          metricsBefore = record.payload.e;
        }

        var metricsAfter = paylobj["e"];
        paylobj["e"] = WebDiscoveryProject.aggregateMetrics(
          metricsBefore,
          metricsAfter,
        );

        var cloneObj = record;

        cloneObj.last_visit = tt;
        cloneObj.payload = paylobj || {};

        WebDiscoveryProject.db.updateURL(url, cloneObj, function () {
          logger.debug("Record updated");
        });

        paylobj["e"] = { cp: 0, mm: 0, kp: 0, sc: 0, md: 0 };
      }
    });
  },
  setAsPrivate: function (url) {
    if (WebDiscoveryProject.bloomFilter) {
      WebDiscoveryProject.bloomFilter.addSingle(md5(url).substring(0, 16));
    }

    WebDiscoveryProject.db.removeUnsafe(url, (result) => {
      logger.debug(`Deleting ${url} : ${result}`);
    });

    if (WebDiscoveryProject.state["v"][url]) {
      delete WebDiscoveryProject.state["v"][url];
    }
    WebDiscoveryProject.dumpBloomFilter();
  },
  setAsPublic: function (url) {
    WebDiscoveryProject.db.removeUnsafe(url, (result) => {
      logger.debug(`Deleting ${url} : ${result}`);
    });

    if (WebDiscoveryProject.state["v"][url]) {
      delete WebDiscoveryProject.state["v"][url];
    }
  },
  listOfUnchecked: function (cap, sec_old, fixed_url, callback) {
    WebDiscoveryProject.db.getListOfUnchecked(
      cap,
      sec_old,
      fixed_url,
      (res, res2) => {
        callback(res);
      },
    );
  },
  processUnchecks: function (listOfUncheckedUrls) {
    logger.debug(
      ">>> URLS UNPROCESSED >>> " + JSON.stringify(listOfUncheckedUrls),
    );
    var url_pagedocPair = {};

    for (var i = 0; i < listOfUncheckedUrls.length; i++) {
      var url = listOfUncheckedUrls[i][0];
      var page_doc = listOfUncheckedUrls[i][1];
      var page_struct_before = page_doc["x"];
      url_pagedocPair[url] = page_doc;

      WebDiscoveryProject.log(
        "Going for double fetch (url:",
        url,
        ", page_doc:",
        page_doc,
        ", page_struct_before:",
        page_struct_before,
        ")",
      );

      // only do doubleFetch for the same url 3 times in a row
      // (set up as this.webDiscoveryProject.MAX_NUMBER_DOUBLEFETCH_ATTEMPS).
      // If more attemps are tried then the url is marked as private.
      // Prevent infinite loop if the doubleFetch causes the browser
      // to crash (issue #2213)
      //
      WebDiscoveryProject.db.loadRecordTelemetry(
        "last-double-fetch",
        function (data) {
          var obj = null;
          if (data == null) obj = { url: url, count: 1 };
          else {
            obj = JSON.parse(data);
            if (obj.url != url) obj = { url: url, count: 1 };
            else {
              try {
                obj["count"] += 1;
              } catch (err) {
                obj["count"] = 1;
              }
            }
          }
          logger.debug(">>>>> DOUBLE FETCH COUNT >>> " + JSON.stringify(obj));
          WebDiscoveryProject.db.saveRecordTelemetry(
            "last-double-fetch",
            JSON.stringify(obj),
            (result) => {
              logger.debug("last-double-fetch saved:", result);
            },
          );

          if (obj.count > WebDiscoveryProject.MAX_NUMBER_DOUBLEFETCH_ATTEMPS) {
            WebDiscoveryProject.setAsPrivate(url);
          } else {
            WebDiscoveryProject.doubleFetch(url, url_pagedocPair[url]);
          }
        },
      );
    }
  },
  detectAdClick(targetURL) {
    // The first URL observed after clicking the ad has the pattern,
    // google and aclk? in it.
    if (targetURL.includes("google") && targetURL.includes("aclk?")) {
      const clickedU = normalizeAclkUrl(targetURL);
      logger.debug("ad-ctr: targetURL:", targetURL, "normalized to", clickedU);

      if (WebDiscoveryProject.adDetails[clickedU]) {
        let query = WebDiscoveryProject.adDetails[clickedU].query;
        if (!checkSuspiciousQuery(query).accept) {
          query = " (PROTECTED) ";
        }
        const domain = cleanFinalUrl(
          WebDiscoveryProject.adDetails[clickedU].furl[0],
          WebDiscoveryProject.adDetails[clickedU].furl[1],
        );

        const payload = {
          action: "ad-ctr",
          "anti-duplicates": Math.floor(random() * 10000000),
          type: "wdp",
          channel: WebDiscoveryProject.CHANNEL,
          payload: {
            query,
            domain,
            ctry: WebDiscoveryProject.getCountryCode(),
          },
        };

        logger.debug("ad-ctr payload:", payload);
        WebDiscoveryProject.telemetry(payload);
      }
    }
  },
  purgeAdLookUp: function () {
    // We should clean the ads in lookup table, keep it from growing too huge.
    // Cleaning ads which are older than 15 minutes seems reasonable right now.

    let ts = Date.now();
    Object.keys(WebDiscoveryProject.adDetails).forEach((item) => {
      let adTS = WebDiscoveryProject.adDetails[item]["ts"];
      let diff = (ts - adTS) / (1000 * 60);
      if (diff > 15) {
        delete WebDiscoveryProject.adDetails[item];
      }
    });
  },
  addStrictQueries(url, query) {
    // In some cases, we get query undefined.
    if (!query) {
      logger.debug(">> Got an undefined query >>> " + url);
      return;
    }

    if (!checkSuspiciousQuery(query).accept) {
      logger.debug("Dropping suspicious query before double-fetch:", query);
      return;
    }

    const { isSearchEngineUrl, queryUrl } =
      WebDiscoveryProject.contentExtractor.urlAnalyzer.checkAnonSearchURL(
        url,
        query,
      );
    if (isSearchEngineUrl) {
      try {
        const qObj = {
          qurl: queryUrl,
          ts: Date.now(),
          tDiff: getRandomIntInclusive(1, 20),
        };
        logger.debug("PCN: pushed to strictQueries:", queryUrl);
        WebDiscoveryProject.strictQueries.push(qObj);
        WebDiscoveryProject.saveStrictQueries();
      } catch (ee) {
        logger.error("Failed to add query:", ee);
      }
    }
  },
};
WebDiscoveryProject.contentExtractor = new ContentExtractor(
  WebDiscoveryProject.patterns,
  WebDiscoveryProject,
);

export default WebDiscoveryProject;
