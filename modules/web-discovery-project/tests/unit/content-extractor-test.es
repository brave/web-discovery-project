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
          document = resolveGotoUrls(WDP.parseHtml(fixture.html), fixture.url);
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
      // Tokens must be 20+ chars of [\w-]
      const TOKEN = "CAESZAHrOzAVb1atHhwqC5PmCod7HpfgxcRW";
      const TOKEN_B = "CAESbgHrOzAV08MgZdu9wX5RPs97TgG6RHOBEk";
      const URL_A = "https://example.com/page-a";
      const URL_B = "https://example.com/page-b";
      const PAGE = "https://www.google.com/search?q=test";

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
        resolve = (html, pageUrl = PAGE) =>
          resolveGotoUrls(parseHtml(html), pageUrl);
      });

      const hrefs = (doc) =>
        [...doc.querySelectorAll("a")].map((a) => a.getAttribute("href"));

      it("resolves a goto link through render data", function () {
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
        expect(resolveGotoUrls(doc, PAGE)).to.equal(doc);
        expect(doc.documentElement.innerHTML).to.equal(before);
      });

      it("ignores a destination that is not an http(s) URL", function () {
        for (const value of ["javascript:alert(1)", "ftp://example.com/x", "https://not a url"]) {
          const doc = resolve(leak(TOKEN, value) + anchor(goto()));
          expect(hrefs(doc), value).to.deep.equal([goto()]);
        }
      });

      it("unescapes a destination out of the render data", function () {
        const escaped = "https://example.com/a\\u003db\\u0026c\\u003dd";
        const doc = resolve(leak(TOKEN, escaped) + anchor(goto()));
        expect(hrefs(doc)).to.deep.equal(["https://example.com/a=b&c=d"]);
      });

      it("tolerates extra fields trailing the token in render data", function () {
        const html =
          `<script>x = "/goto?url\\u003d${TOKEN}",null,3],["${URL_A}","T"];</script>` +
          anchor(goto());
        expect(hrefs(resolve(html))).to.deep.equal([URL_A]);
      });

      it("matches a token carrying padding or extra parameters", function () {
        for (const suffix of ["", "=", "%3D", "&ved=abc", "%3D%3D&ved=abc"]) {
          const doc = resolve(leak(TOKEN, URL_A) + anchor(`${goto()}${suffix}`));
          expect(hrefs(doc), `suffix: ${JSON.stringify(suffix)}`).to.deep.equal([URL_A]);
        }
      });

      it("ignores tokens too short to be real", function () {
        const short = "tooShort";
        const doc = resolve(leak(short, URL_A) + anchor(goto(short)));
        expect(hrefs(doc)).to.deep.equal([goto(short)]);
      });

      describe("through the about-this-result request", function () {
        const varint = (value) => {
          const bytes = [];
          do {
            const byte = value % 128;
            value = Math.floor(value / 128);
            bytes.push(value ? byte | 0x80 : byte);
          } while (value);
          return bytes;
        };

        const bytesField = (number, payload) => [
          ...varint(number * 8 + 2),
          ...varint(payload.length),
          ...payload,
        ];
        const text = (value) => [...Buffer.from(value)];

        const aboutThisResultRequest = (link, destination, otherFields = []) =>
          Buffer.from([
            ...bytesField(1, text(link)),
            ...otherFields,
            ...bytesField(
              3,
              bytesField(1024, [...otherFields, ...bytesField(6, text(destination))]),
            ),
          ]).toString("base64url");

        const aboutThisResultScript = (
          token = TOKEN,
          destination = URL_A,
          request = aboutThisResultRequest(`/goto?url=${token}`, destination),
        ) =>
          `<script>x,"/goto?url\\u003d${token}",[null,"/search/about-this-result?origin\\u003dwww.google.com\\u0026req\\u003d${request}\\u0026hl\\u003den"],y</script>`;

        it("resolves a wrapped link", function () {
          expect(hrefs(resolve(aboutThisResultScript() + anchor(goto())))).to.deep.equal([URL_A]);
        });

        it("resolves a result the older layout no longer describes", function () {
          const script = `${aboutThisResultScript()},["/goto?url\\u003d${TOKEN}","a title"]`;
          expect(hrefs(resolve(script + anchor(goto())))).to.deep.equal([URL_A]);
        });

        it("skips the fields of the request it has no use for", function () {
          const otherFields = [0x10, 0x05, 0x21, ...Array(8).fill(0), 0x2d, ...Array(4).fill(0)].concat(
            bytesField(7, text("<b>a</b> title")),
          );
          const request = aboutThisResultRequest(`/goto?url=${TOKEN}`, URL_A, otherFields);
          expect(hrefs(resolve(aboutThisResultScript(TOKEN, URL_A, request) + anchor(goto())))).to.deep.equal([URL_A]);
        });

        it("reads the request however its parameter is escaped", function () {
          expect(hrefs(resolve(aboutThisResultScript().replace("req\\u003d", "req=") + anchor(goto())))).to.deep.equal([URL_A]);
        });

        it("leaves a link alone when its request cannot be read", function () {
          const request = aboutThisResultRequest(`/goto?url=${TOKEN}`, URL_A);
          const truncated = request.slice(0, -12);
          for (const badRequest of ["A", "AAAA", Buffer.from([0x0a, 0xff]).toString("base64url"), truncated]) {
            const doc = resolve(aboutThisResultScript(TOKEN, URL_A, badRequest) + anchor(goto()));
            expect(hrefs(doc), badRequest).to.deep.equal([goto()]);
          }
        });

        it("ignores a request that does not describe a wrapped link", function () {
          const request = aboutThisResultRequest("https://example.com/", URL_A);
          const doc = resolve(aboutThisResultScript(TOKEN, URL_A, request) + anchor(goto()));
          expect(hrefs(doc)).to.deep.equal([goto()]);
        });

        it("ignores a destination that is not an http(s) URL", function () {
          const doc = resolve(aboutThisResultScript(TOKEN, "javascript:alert(1)") + anchor(goto()));
          expect(hrefs(doc)).to.deep.equal([goto()]);
        });
      });

      it("only rewrites same-origin /goto hrefs", function () {
        const untouched = [
          `javascript:go('${goto()}')`,
          `/search${goto()}`,
          goto("TOO_SHORT_zzzzzzzzz"),
        ];
        const html = leak(TOKEN, URL_A) + untouched.map(anchor).join("");
        expect(hrefs(resolve(html))).to.deep.equal(untouched);
      });

      it("resolves absolute google.com goto hrefs", function () {
        const doc = resolve(leak(TOKEN, URL_A) + anchor(`https://www.google.com${goto()}`));
        expect(hrefs(doc)).to.deep.equal([URL_A]);
      });

      it("does not resolve on a non-Google host", function () {
        const doc = resolve(
          leak(TOKEN, URL_A) + anchor(goto()),
          "https://a.google.evil.test/?q=x",
        );
        expect(hrefs(doc)).to.deep.equal([goto()]);
      });

      it("resolves on google.co.uk", function () {
        const doc = resolve(
          leak(TOKEN, URL_A) + anchor(goto()),
          "https://www.google.co.uk/search?q=test",
        );
        expect(hrefs(doc)).to.deep.equal([URL_A]);
      });

      it("is idempotent", function () {
        const doc = resolve(leak(TOKEN, URL_A) + anchor(goto()));
        expect(hrefs(resolveGotoUrls(doc, PAGE))).to.deep.equal([URL_A]);
      });

      it("does not map goto-shaped text reflected into a <textarea>", function () {
        const forged = `"/goto?url=${TOKEN}"],["https://evil.example/harvest"`;
        const html =
          `<textarea name="q">${forged}</textarea>` +
          leak(TOKEN, URL_A) +
          anchor(goto());
        expect(hrefs(resolve(html))).to.deep.equal([URL_A]);
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
