/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { parse } from "../core/url";
import logger from "./logger";

const URL_PATTERNS = [
  {
    type: "search-google-images",
    regexp:
      /^https:[/][/][^/]*[.]google[.].*?[#?&;]((q=[^&]+&([^&]+&)*tbm=isch)|(tbm=isch&([^&]+&)*q=[^&]+))/,
    prefix: "search?tbm=isch&gbv=1&q=",
  },
  {
    type: "search-gooogle-videos",
    regexp:
      /^https:[/][/][^/]*[.]google[.].*?[#?&;]((q=[^&]+&([^&]+&)*tbm=vid)|(tbm=vid&([^&]+&)*q=[^&]+))/,
    prefix: "search?tbm=vid&gbv=1&q=",
  },
  {
    type: "search-google",
    regexp: /^https:[/][/][^/]*[.]google[.].*?[#?&;]/,
    prefix: "search?q=",
  },
  {
    type: "search-yahoo",
    regexp: /^https:[/][/][^/]*[.]search[.]yahoo[.].*?[#?&;][pq]=[^$&]+/,
    prefix: "search?q=",
    queryFinder(parsedUrl) {
      return parsedUrl.searchParams.get("q") || parsedUrl.searchParams.get("p");
    },
  },
  {
    type: "search-bing-images",
    regexp: /^https:[/][/][^/]*[.]bing[.][^/]+[/]images[/]search[?]q=[^$&]+/,
    prefix: "images/search?q=",
  },
  {
    type: "search-bing",
    regexp: /^https:[/][/][^/]*[.]bing[.].*?[#?&;]q=[^$&]+/,
    prefix: "search?q=",
  },
  {
    type: "search-amazon",
    regexp:
      /^https:[/][/][^/]*[.]amazon[.][^/]+[/](s[?]k=[^$&]+|.*[?&]field-keywords=[^$&]+)/,
    prefix: "s/?field-keywords=",
    queryFinder(parsedUrl) {
      return (
        parsedUrl.searchParams.get("field-keywords") ||
        parsedUrl.searchParams.get("k")
      );
    },
  },
  {
    type: "amazon-product",
    regexp:
      /^https:[/][/][^/]*[.]amazon[.][^/]+[/]([/]dp[/]|[/]gp[/]product[/])/,
    queryFinder(parsedUrl) {
      return parsedUrl.searchParams.get("keywords");
    },
  },
  {
    type: "search-duckduckgo",
    regexp:
      /^https:[/][/]duckduckgo.com[/](?:html$|.*[?&]q=[^&]+.*&ia=web|[?]q=[^&]+$)/,
    prefix: "?q=",
  },
  {
    type: "linkedin",
    regexp: /^https:[/][/][^/]*linkedin[.][^/]+[/]pub[/]dir+/,
  },
];
const SEARCH_ENGINE_TYPES = new Set([
  "search-google-images",
  "search-google-videos",
  "search-google",
  "search-yahoo",
  "search-bing-images",
  "search-bing",
  "search-duckduckgo",
]);

export default class UrlAnalyzer {
  constructor(patterns) {
    this.patterns = patterns;
    this._urlPatterns = URL_PATTERNS;
  }

  parseLinks(url) {
    for (const {
      type,
      regexp,
      queryFinder = (parsedUrl) => parsedUrl.searchParams.get("q"),
    } of this._urlPatterns) {
      if (regexp.test(url)) {
        // Workaround for an encoding issue (source: https://stackoverflow.com/a/24417399/783510).
        // Reason: we want to preserve the original search term. In other words, searches
        // for "abc def" and "abc+def" should be distinguishable. That is why we need to
        // avoid the ambigious '+' character and use explicit white space encoding.
        const url_ = url.replaceAll("+", "%20");
        const parsedUrl = parse(url_);

        const query = queryFinder(parsedUrl);
        if (!query) {
          return { found: false };
        }
        if (!this.patterns.typeExists(type)) {
          logger.debug(
            "Matching rule for",
            url,
            "skipped (no matching server side rules exist)"
          );
          return { found: false };
        }
        return { found: true, type, query };
      }
    }

    return { found: false };
  }

  isSearchEngineUrl(url) {
    const { found, type } = this.parseLinks(url);
    if (!found) return false;
    return SEARCH_ENGINE_TYPES.has(type);
  }

  tryExtractBraveSerpQuery(url) {
    const isBraveSearch =
      url.startsWith("https://search.brave.com/search?") ||
      url.startsWith("https://bravesearch.com/search?") ||
      url.startsWith("https://search.brave.software/search?");
    const parsedUrl = parse(url);
    return isBraveSearch && parsedUrl.searchParams.get("q");
  }
}
