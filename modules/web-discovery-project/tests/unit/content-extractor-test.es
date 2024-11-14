/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* global chai */
/* global describeModule */
/* global sinon */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const jsdom = require("jsdom");
const { JSDOM } = jsdom;

const expect = chai.expect;
const R = require("ramda");
const FileHound = require("filehound");

const stripJsonComments = require("strip-json-comments");

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
  fs.readFileSync(`${FIXTURES_BASE_PATH}/rules.json`, "utf8")
);

const enableLogging = true;

export default describeModule(
  "web-discovery-project/content-extractor",
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

      let ContentExtractor;
      let WDP;
      let mockWindow;
      let document;
      let fixture;

      const setupDocument = function (html) {
        mockWindow = new JSDOM(`<!DOCTYPE html><p>Test DOM</p>`).window;

        document = mockWindow.document;
        document.open();
        document.write(html);
        document.close();
      };

      const initFixture = function (_path) {
        try {
          fixture = readFixtureFromDisk(_path);
          setupDocument(fixture.html);
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

        const Patterns = (await this.system.import("web-discovery-project/patterns")).default;

        ContentExtractor = this.module().ContentExtractor;
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
            const { messages } = WDP.contentExtractor.run(doc, url);
            for (const message of messages)
              WDP.telemetry({
                type: WDP.msgType,
                action: message.action,
                payload: message.payload,
              });
          },
        };
        WDP.contentExtractor = new ContentExtractor(WDP.patterns, WDP);
      });

      afterEach(function () {
        document = null;
        fixture = null;
        global.URL = oldURL;

        if (mockWindow) {
          mockWindow = null;
        }
      });

      describe("with an empty ruleset", function () {
        describe("#isSearchEngineUrl", function () {
          it("should not match any URL", function () {
            expect(
              WDP.contentExtractor.urlAnalyzer.isSearchEngineUrl("about:blank")
            ).to.be.false;
            expect(
              WDP.contentExtractor.urlAnalyzer.isSearchEngineUrl(
                "http://www.example.com/"
              )
            ).to.be.false;
            expect(
              WDP.contentExtractor.urlAnalyzer.isSearchEngineUrl(
                "https://www.google.de/search?q=test"
              )
            ).to.be.false;
          });
        });

        describe('when searching in Google for "Angela Merkel"', function () {
          beforeEach(function () {
            initFixture("go/angela-merkel-2023-10-10");
          });

          it('should not find any data', function () {
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
              WDP.contentExtractor.urlAnalyzer.isSearchEngineUrl("about:blank")
            ).to.be.false;
            expect(
              WDP.contentExtractor.urlAnalyzer.isSearchEngineUrl(
                "http://www.example.com/"
              )
            ).to.be.false;

            // should match:
            expect(
              WDP.contentExtractor.urlAnalyzer.isSearchEngineUrl(
                "https://www.google.de/search?q=test"
              )
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

          it('should find search results', function () {
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
              "https://search.brave.software/search?lang=en&country=us&safe_search=on&q=harzer%20k%C3%A4se"
            )
          ).to.equal("harzer käse");

          expect(
            WDP.contentExtractor.urlAnalyzer.tryExtractBraveSerpQuery(
              "https://search.brave.software/search?q=m%C3%BCnchen&lang=en&country=de"
            )
          ).to.equal("münchen");
        });

        it("should find search terms on search.brave.com", function () {
          expect(
            WDP.contentExtractor.urlAnalyzer.tryExtractBraveSerpQuery(
              "https://search.brave.com/search?lang=en&country=us&safe_search=on&q=harzer%20k%C3%A4se"
            )
          ).to.equal("harzer käse");

          expect(
            WDP.contentExtractor.urlAnalyzer.tryExtractBraveSerpQuery(
              "https://search.brave.com/search?q=m%C3%BCnchen&lang=en&country=de"
            )
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

    describe("parseQueryString", function () {
      let parseQueryString;

      beforeEach(function () {
        parseQueryString = this.module().parseQueryString;
      });

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
  }
);
