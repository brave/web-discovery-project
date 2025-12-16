/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { parse } from "./utils/url.js";

const URL_PATTERNS = [
  {
    type: "search-goi",
    isSearchEngine: true,
    regexp:
      /^https:[/][/][^/]*[.]google[.].*?[#?&;]((q=[^&]+&([^&]+&)*tbm=isch)|(tbm=isch&([^&]+&)*q=[^&]+))/,
    prefix: "search?tbm=isch&gbv=1&q=",
  },
  {
    type: "search-gov",
    isSearchEngine: true,
    regexp:
      /^https:[/][/][^/]*[.]google[.].*?[#?&;]((q=[^&]+&([^&]+&)*tbm=vid)|(tbm=vid&([^&]+&)*q=[^&]+))/,
    prefix: "search?tbm=vid&gbv=1&q=",
  },
  {
    type: "search-go",
    isSearchEngine: true,
    regexp: /^https:[/][/][^/]*[.]google[.].*?[#?&;]/,
    prefix: "search?q=",
  },
  {
    type: "search-ya",
    isSearchEngine: true,
    regexp: /^https:[/][/][^/]*[.]search[.]yahoo[.].*?[#?&;][pq]=[^$&]+/,
    prefix: "search?q=",
    queryFinder(parsedUrl) {
      return parsedUrl.searchParams.get("q") || parsedUrl.searchParams.get("p");
    },
  },
  {
    type: "search-bii",
    isSearchEngine: true,
    regexp: /^https:[/][/][^/]*[.]bing[.][^/]+[/]images[/]search[?]q=[^$&]+/,
    prefix: "images/search?q=",
  },
  {
    type: "search-bi",
    isSearchEngine: true,
    regexp: /^https:[/][/][^/]*[.]bing[.].*?[#?&;]q=[^$&]+/,
    prefix: "search?q=",
  },
  {
    type: "search-am",
    isSearchEngine: false,
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
    type: "amp",
    isSearchEngine: false,
    regexp:
      /^https:[/][/][^/]*[.]amazon[.][^/]+[/]([/]dp[/]|[/]gp[/]product[/])/,
    queryFinder(parsedUrl) {
      return parsedUrl.searchParams.get("keywords");
    },
  },
  {
    type: "search-dd",
    isSearchEngine: true,
    regexp:
      /^https:[/][/]duckduckgo.com[/](?:html$|.*[?&]q=[^&]+.*&ia=web|[?]q=[^&]+$)/,
    prefix: "?q=",
  },
  {
    type: "li",
    isSearchEngine: false,
    regexp: /^https:[/][/][^/]*linkedin[.][^/]+[/]pub[/]dir+/,
  },
];

export default class UrlAnalyzer {
  constructor(patterns, debug) {
    this.patterns = patterns;
    this._urlPatterns = URL_PATTERNS;
    this.logger = { debug: debug ? console.debug.bind(console, "[url-analyzer]") : () => null };
  }

  parseLinks(url) {
    for (const urlPattern of this._urlPatterns) {
      const {
        type,
        regexp,
        queryFinder = (parsedUrl) => parsedUrl.searchParams.get("q"),
      } = urlPattern;
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
          this.logger.debug(
            "Matching rule for",
            url,
            "skipped (no matching server side rules exist)",
          );
          return { found: false };
        }
        return { found: true, urlPattern, query };
      }
    }

    return { found: false };
  }

  isSearchEngineUrl(url) {
    const { found, urlPattern } = this.parseLinks(url);
    if (!found) return false;
    return urlPattern.isSearchEngine || false;
  }

  tryExtractBraveSerpQuery(url) {
    const isBraveSearch =
      url.startsWith("https://search.brave.com/search?") ||
      url.startsWith("https://bravesearch.com/search?") ||
      url.startsWith("https://search.brave.software/search?");
    const parsedUrl = parse(url);
    return isBraveSearch && parsedUrl.searchParams.get("q");
  }

  checkAnonSearchURL(url, query) {
    const { found, urlPattern } = this.parseLinks(url);
    if (!found) return { isSearchEngineUrl: false, queryUrl: null };
    const queryPrefix = urlPattern.prefix;
    if (!queryPrefix) {
      this.logger.debug(
        `URL pattern with type '${urlPattern.type}' has no query prefix`,
      );
      return { isSearchEngineUrl: false, queryUrl: null };
    }
    const encodedQuery = encodeURIComponent(query).replace(/%20/g, "+");
    const parsedUrl = parse(url);
    const hostname = parsedUrl.hostname(url);
    const queryUrl = `https://${hostname}/${queryPrefix}${encodedQuery}`;
    return { isSearchEngineUrl: urlPattern.isSearchEngine || false, queryUrl };
  }
}
