/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* global chai */
/* global describeModule */
/* global sinon */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const expect = chai.expect;
const R = require("ramda");
const FileHound = require("filehound");

const stripJsonComments = require("strip-json-comments");
const {
  parseQueryString,
  resolveGotoUrls,
  ContentExtractor,
  Patterns,
} = require("@web-discovery-project/parser");

function jsonParse(text) {
  return JSON.parse(stripJsonComments(text));
}

const FIXTURES_BASE_PATH =
  "modules/web-discovery-project/tests/unit/fixtures/content-extractor";

function readFixtureFromDisk(_path) {
  const fixture = jsonParse(
    fs.readFileSync(`${FIXTURES_BASE_PATH}/${_path}/scenario.json`, "utf8"),
  );
  fixture.html = zlib
    .gunzipSync(fs.readFileSync(`${FIXTURES_BASE_PATH}/${_path}/page.html.gz`))
    .toString();
  return fixture;
}

function findAllFixtures() {
  function isFixtureDir(file) {
    if (!file.isDirectorySync()) {
      return false;
    }
    const base = file.getAbsolutePath();
    return (
      fs.existsSync(path.join(base, "scenario.json")) &&
      fs.existsSync(path.join(base, "page.html.gz"))
    );
  }

  return FileHound.create()
    .path(FIXTURES_BASE_PATH)
    .directory()
    .addFilter(isFixtureDir)
    .findSync()
    .map((file) => path.relative(FIXTURES_BASE_PATH, file));
}

/**
 * Although not required for the tests, these patterns should ideally
 * be close to the ones that we used in production.
 * If they deviate too much from production, the tests will have less
 * value in catching bugs.
 */
const DEFAULT_PATTERNS = jsonParse(
  fs.readFileSync(`${FIXTURES_BASE_PATH}/rules.json`, "utf8"),
);

const enableLogging = true;

export default describeModule(
  // TODO Specifyping an arbitrary simple module here for compatibility reasons. We
  // should move away from the `describeModule` approach
  "web-discovery-project/html-helpers",
  () => ({
    "core/logger": {
      default: {
        get() {
          return {
            debug() {},
            log() {},
            warn(...args) {
              if (enableLogging) {
                console.warn(...args);
              }
            },
            error(...args) {
              if (enableLogging) {
                console.error(...args);
              }
            },
          };
        },
      },
    },
  }),
  () => {
    describe("ContentExtractor", function () {
      this.timeout(20000);

      let WDP;
      let document;
      let fixture;

      const initFixture = function (_path) {
        try {
          fixture = readFixtureFromDisk(_path);
          // Same order as production: the resolver takes a document, not HTML.
          document = resolveGotoUrls(WDP.parseHtml(fixture.html));
        } catch (e) {
          throw new Error(`Failed to load test fixture "${_path}": ${e}`, e);
        }
      };

      const verifyFixtureExpectations = function () {
        function groupTelemetryCallsByAction(sinonSpy) {
          return R.pipe(
            R.map((args) => {
              expect(args.length).to.equal(1);
              return args[0];
            }),
            R.groupBy((msg) => msg.action),
          )(sinonSpy.args);
        }

        const messages = groupTelemetryCallsByAction(WDP.telemetry);
        // uncomment to export expectations:
        // fs.writeFileSync('/tmp/failing-test-expected-messages.json', JSON.stringify(messages));
        if (fixture.mustContain) {
          for (const check of fixture.mustContain) {
            if (!messages[check.action]) {
              throw new Error(`Missing message with action=${check.action}`);
            }

            // simplification for now: assume we will not send more than
            // one message of the same type. (If this assumption does not
            // hold, this test code needs to be extended.)
            expect(messages[check.action].length === 1);

            const realPayload = messages[check.action][0].payload;
            expect(realPayload).to.deep.equal(check.payload);
          }
        }

        if (fixture.mustNotContain) {
          for (const check of fixture.mustNotContain) {
            const blacklist = new RegExp(
              `^${check.action.replace("*", ".*")}$`,
            );
            const matches = Object.keys(messages).filter((x) =>
              blacklist.test(x),
            );
            if (matches.length > 0) {
              throw new Error(
                `Expected no messages with action '${check.action}' ` +
                  `but got messages for the following actions: [${matches}]`,
              );
            }
          }
        }
      };

      const oldURL = global.URL;
      beforeEach(async function () {
        /* eslint-disable-next-line global-require */
        global.URL = global.URL || require("url").URL;

        const parseHtml = (
          await this.system.import("web-discovery-project/html-helpers")
        ).parseHtml;

        WDP = {
          debug: enableLogging,
          msgType: "wdp",
          getCountryCode() {
            return "de";
          },
          maskURL(url) {
            return url;
          },
          // args: msg, instantPush
          telemetry: sinon.fake(),
          // args: url, query
          addStrictQueries: sinon.fake(),
          queryCache: {},
          patterns: new Patterns(),
          checkURL: (doc, url) => {
            const { messages } = WDP.contentExtractor.run(doc, url, WDP.getCountryCode());
            for (const message of messages)
              WDP.telemetry({
                type: WDP.msgType,
                action: message.action,
                payload: message.payload,
              });
          },
        };
        WDP.contentExtractor = new ContentExtractor(WDP.patterns);
        WDP.parseHtml = parseHtml;
      });

      afterEach(function () {
        document = null;
        fixture = null;
        global.URL = oldURL;
      });

      describe("with an empty ruleset", function () {
        describe("#isSearchEngineUrl", function () {
          it("should not match any URL", function () {
            expect(
              WDP.contentExtractor.urlAnalyzer.isSearchEngineUrl("about:blank"),
            ).to.be.false;
            expect(
              WDP.contentExtractor.urlAnalyzer.isSearchEngineUrl(
                "http://www.example.com/",
              ),
            ).to.be.false;
            expect(
              WDP.contentExtractor.urlAnalyzer.isSearchEngineUrl(
                "https://www.google.de/search?q=test",
              ),
            ).to.be.false;
          });
        });

        describe('when searching in Google for "Angela Merkel"', function () {
          beforeEach(function () {
            initFixture("go/angela-merkel-2023-10-10");
          });

          it("should not find any data", function () {
            WDP.checkURL(document, fixture.url);
            expect(WDP.addStrictQueries.notCalled);
            expect(WDP.telemetry.notCalled);
          });
        });
      });

      describe("with a realistic ruleset", function () {
        beforeEach(function () {
          WDP.patterns.update(DEFAULT_PATTERNS);
        });

        describe("#isSearchEngineUrl", function () {
          it("matches the configured search engines", function () {
            // no match:
            expect(
              WDP.contentExtractor.urlAnalyzer.isSearchEngineUrl("about:blank"),
            ).to.be.false;
            expect(
              WDP.contentExtractor.urlAnalyzer.isSearchEngineUrl(
                "http://www.example.com/",
              ),
            ).to.be.false;

            // should match:
            expect(
              WDP.contentExtractor.urlAnalyzer.isSearchEngineUrl(
                "https://www.google.de/search?q=test",
              ),
            ).to.be.true;
          });
        });

        describe("in an empty HTML page", function () {
          beforeEach(function () {
            initFixture("empty-page");
          });

          it("should not find any data", function () {
            WDP.checkURL(document, fixture.url);
            expect(WDP.addStrictQueries.notCalled);
            expect(WDP.telemetry.notCalled);
          });
        });

        describe('when searching in Google for "Angela Merkel"', function () {
          beforeEach(function () {
            initFixture("go/angela-merkel-2023-10-10");
          });

          it("should find search results", function () {
            WDP.checkURL(document, fixture.url);
            expect(WDP.addStrictQueries.called);
            expect(WDP.telemetry.called);
          });
        });
      });

      findAllFixtures().forEach((fixtureDir) => {
        describe(`in scenario: ${fixtureDir}`, function () {
          beforeEach(function () {
            WDP.patterns.update(DEFAULT_PATTERNS);
          });

          it("should pass the fixture's expections", function () {
            // Given
            initFixture(fixtureDir);
            WDP.telemetry = sinon.spy();

            // When
            WDP.checkURL(document, fixture.url);

            // Then
            verifyFixtureExpectations();
          });
        });
      });

      describe("#tryExtractBraveSerpQuery", function () {
        const expectNotFound = (url) => {
          if (WDP.contentExtractor.urlAnalyzer.tryExtractBraveSerpQuery(url)) {
            chai.assert.fail(`Expected not to find a query on url=${url}`);
          }
        };

        it("should find search terms on search.brave.software", function () {
          expect(
            WDP.contentExtractor.urlAnalyzer.tryExtractBraveSerpQuery(
              "https://search.brave.software/search?lang=en&country=us&safe_search=on&q=harzer%20k%C3%A4se",
            ),
          ).to.equal("harzer käse");

          expect(
            WDP.contentExtractor.urlAnalyzer.tryExtractBraveSerpQuery(
              "https://search.brave.software/search?q=m%C3%BCnchen&lang=en&country=de",
            ),
          ).to.equal("münchen");
        });

        it("should find search terms on search.brave.com", function () {
          expect(
            WDP.contentExtractor.urlAnalyzer.tryExtractBraveSerpQuery(
              "https://search.brave.com/search?lang=en&country=us&safe_search=on&q=harzer%20k%C3%A4se",
            ),
          ).to.equal("harzer käse");

          expect(
            WDP.contentExtractor.urlAnalyzer.tryExtractBraveSerpQuery(
              "https://search.brave.com/search?q=m%C3%BCnchen&lang=en&country=de",
            ),
          ).to.equal("münchen");
        });

        it("should not find false positives", function () {
          [
            "https://search.brave.software/",
            "https://example.test/?q=test",
          ].forEach(expectNotFound);
        });

        it("should ignore broken URLs", function () {
          expectNotFound("");
          expectNotFound("no valid URL");
        });
      });
    });

    describe("resolveGotoUrls", function () {
      // Real token shapes; the resolver requires 20+ chars of [A-Za-z0-9_-].
      const TOKEN = "CAESZAHrOzAVb1atHhwqC5PmCod7HpfgxcRW";
      const TOKEN_B = "CAESbgHrOzAV08MgZdu9wX5RPs97TgG6RHOBEk";
      const URL_A = "https://example.com/page-a";
      const URL_B = "https://example.com/page-b";

      // What Google emits: the destination is the array element after the link.
      const leak = (token, url) =>
        `<script>var d = [["/goto?url\\u003d${token}"],["${url}","T"]];</script>`;
      const anchor = (href) => `<a href="${href}">result</a>`;
      const goto = (token = TOKEN) => `/goto?url=${token}`;

      let parseHtml;
      let resolve;

      beforeEach(async function () {
        parseHtml = (
          await this.system.import("web-discovery-project/html-helpers")
        ).parseHtml;
        // The resolver mutates and returns the document it is given.
        resolve = (html) => resolveGotoUrls(parseHtml(html));
      });

      const hrefs = (doc) =>
        [...doc.querySelectorAll("a")].map((a) => a.getAttribute("href"));

      it("resolves a goto link to its real URL", function () {
        const doc = resolve(leak(TOKEN, URL_A) + anchor(goto()));
        expect(hrefs(doc)).to.deep.equal([URL_A]);
      });

      it("resolves several links with different tokens", function () {
        const scripts = leak(TOKEN, URL_A) + leak(TOKEN_B, URL_B);
        const doc = resolve(scripts + anchor(goto()) + anchor(goto(TOKEN_B)));
        expect(hrefs(doc)).to.deep.equal([URL_A, URL_B]);
      });

      it("leaves unmatched goto links unchanged", function () {
        const unmapped = goto("UNMAPPED_TOKEN_zzzzzzzzzzz");
        const html = leak(TOKEN, URL_A) + anchor(unmapped) + anchor(goto());
        expect(hrefs(resolve(html))).to.deep.equal([unmapped, URL_A]);
      });

      it("returns the same document when there are no goto links", function () {
        const doc = parseHtml('<a href="https://example.com">link</a>');
        const before = doc.documentElement.innerHTML;
        expect(resolveGotoUrls(doc)).to.equal(doc);
        expect(doc.documentElement.innerHTML).to.equal(before);
      });

      it("preserves ampersands in the resolved URL", function () {
        const url = "https://example.com/path?a=1&b=2";
        const doc = resolve(leak(TOKEN, url) + anchor(goto()));
        expect(hrefs(doc)).to.deep.equal([url]);
      });

      it("accepts every separator and escape form Google emits", function () {
        const cases = {
          "literal =": [
            `<script>x=[["/goto?url=${TOKEN}"],["${URL_A}"]];</script>`,
            goto(),
          ],
          "\\u003d in script": [leak(TOKEN, URL_A), goto()],
          "\\x3d in script, %3D in href": [
            `<script>x=[["/goto?url\\x3d${TOKEN}"],["${URL_A}"]];</script>`,
            `/goto?url%3D${TOKEN}`,
          ],
          "base64 padding": [
            `<script>x=[["/goto?url\\u003d${TOKEN}%3D"],["${URL_A}"]];</script>`,
            `${goto()}%3D`,
          ],
          "trailing tracking param": [
            `<script>x=[["/goto?url=${TOKEN}\\u0026ved=x"],["${URL_A}"]];</script>`,
            `${goto()}&ved=x`,
          ],
          "escaped slashes": [
            `<script>x=[["/goto?url=${TOKEN}"],["https:\\/\\/example.com\\/page-a"]];</script>`,
            goto(),
          ],
          "absolute href": [
            leak(TOKEN, URL_A),
            `https://www.google.com${goto()}`,
          ],
        };
        for (const [name, [script, href]] of Object.entries(cases)) {
          expect(hrefs(resolve(script + anchor(href))), name).to.deep.equal([
            URL_A,
          ]);
        }
      });

      it("reads scripts the way the HTML parser does", function () {
        const upper = leak(TOKEN, URL_A).replace(/script/g, "SCRIPT");
        expect(hrefs(resolve(upper + anchor(goto())))).to.deep.equal([URL_A]);

        // A commented-out script is not in the DOM, so it must not map anything.
        const hidden = `<!--${leak(TOKEN, "https://evil.example/")}-->`;
        expect(hrefs(resolve(hidden + anchor(goto())))).to.deep.equal([goto()]);
      });

      it("only rewrites hrefs that really are goto redirects", function () {
        const untouched = [
          `javascript:go('${goto()}')`,
          `.${goto()}`,
          `/search${goto()}`,
          `/goto?a=1&url=${TOKEN}`,
          goto("TOO_SHORT_zzzzzzzzz"),
        ];
        const html = leak(TOKEN, URL_A) + untouched.map(anchor).join("");
        expect(hrefs(resolve(html))).to.deep.equal(untouched);
      });

      it("rejects leaked values that are not http(s) URLs", function () {
        const bad = [
          "javascript:alert(1)",
          "data:text/html,x",
          "//evil.example/p",
          "https:",
          "https://",
          `https://example.com/${"p".repeat(4000)}`,
        ];
        for (const value of bad) {
          const doc = resolve(leak(TOKEN, value) + anchor(goto()));
          expect(hrefs(doc), value).to.deep.equal([goto()]);
        }
      });

      it("does not alter the document outside goto hrefs", function () {
        // A raw-string replace spliced the leaked value into text, <style> and
        // attributes too, skewing both the telemetry and the double-fetch check.
        const evil =
          "https://evil.example/x</style><title>forged</title>" +
          "<link rel=canonical href=https://forged.example/>" +
          "<form><input type=password></form>";
        const html =
          `<html><head><title>Innocent</title>${leak(TOKEN, evil)}` +
          `<style>${goto()}</style></head>` +
          `<body><p>see ${goto()}</p></body></html>`;
        const shape = (doc) => ({
          title: doc.querySelectorAll("title")[0].textContent,
          anchors: doc.querySelectorAll("a").length,
          passwords: doc.querySelectorAll("input[type=password]").length,
          forms: doc.querySelectorAll("form").length,
          canonical: doc.querySelectorAll("link[rel=canonical]").length,
          text: doc.querySelectorAll("p")[0].textContent,
        });
        expect(shape(resolve(html))).to.deep.equal(shape(parseHtml(html)));
      });

      it("stays fast on adversarial script content", function () {
        // Each payload needs a closed <script> and a goto anchor, or the
        // early-out skips the scan and the test proves nothing. ~10ms as
        // written; 18s without both LEAK_RE guards, 10s without the tail
        // bound, 15s for the string-scanning predecessor.
        const link = anchor(goto());
        const payloads = [
          `<script>"/goto?url=${"A".repeat(128000)}</script>${link}`,
          `<script>${'\\"/goto?url=AAAAAAAAAAAAAAAAAAAA'.repeat(16000)}</script>${link}`,
          `<script>${'\\"/goto?urlAAAAAAAAAAAAAAAAAAAA'.repeat(20000)}</script>${link}`,
        ];
        for (const html of payloads) {
          const started = Date.now();
          resolve(html);
          expect(Date.now() - started, html.slice(0, 32)).to.be.below(1000);
        }
      });

      it("is idempotent", function () {
        const doc = resolve(leak(TOKEN, URL_A) + anchor(goto()));
        expect(hrefs(resolveGotoUrls(doc))).to.deep.equal([URL_A]);
      });
    });

    describe("parseQueryString", function () {
      it("should pass regression tests", function () {
        expect(parseQueryString("")).to.deep.equal({});
        expect(parseQueryString("foo")).to.deep.equal({ foo: [true] });
        expect(parseQueryString("foo=bar")).to.deep.equal({ foo: ["bar"] });

        // unquoting:
        expect(parseQueryString("a%26b=a%26b")).to.deep.equal({
          "a&b": ["a&b"],
        });

        // grouping:
        expect(parseQueryString("a=b&c=d")).to.deep.equal({
          a: ["b"],
          c: ["d"],
        });
        expect(parseQueryString("a=b&a=c")).to.deep.equal({ a: ["b", "c"] });

        // '&' and ';' both split:
        expect(parseQueryString("a=b;c=d")).to.deep.equal({
          a: ["b"],
          c: ["d"],
        });
        expect(parseQueryString("a;b&c")).to.deep.equal({
          a: [true],
          b: [true],
          c: [true],
        });
        expect(parseQueryString("a;a&a")).to.deep.equal({
          a: [true, true, true],
        });
      });
    });
  },
);
