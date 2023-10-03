#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const ramda = require("ramda");
const { expect } = require("chai");
const sinon = require("sinon");
const FileHound = require("filehound");
const { gunzipSync, gzipSync } = require("zlib");
const { JSDOM } = require("jsdom");
const stripJsonComments = require("strip-json-comments");
const { ContentExtractor } = require("../../../../build/web-discovery-project/content-extractor.js");

function jsonParse(text) {
  return JSON.parse(stripJsonComments(text));
}

const FIXTURES_BASE_PATH = path.join(__dirname, "fixtures/content-extractor");
const DEFAULT_PATTERNS = {
  normal: jsonParse(
    fs.readFileSync(`${FIXTURES_BASE_PATH}/patterns.json`, "utf8")
  ),
  strict: jsonParse(
    fs.readFileSync(`${FIXTURES_BASE_PATH}/patterns-anon.json`, "utf8")
  ),
};
const ALLOWED_SOURCES = new Set(["go", "bing"]);

function findAllFixtures() {
  function isFixtureDir(file) {
    if (!file.isDirectorySync()) {
      return false;
    }
    const pathname = file._pathname;
    const dirname = path.basename(path.dirname(pathname));
    if (!ALLOWED_SOURCES.has(dirname)) {
      return false;
    }
    const filename = path.basename(pathname);
    if (filename.split("-").length < 4) {
      return false;
    }
    return true;
  }

  return FileHound.create()
    .path(FIXTURES_BASE_PATH)
    .directory()
    .addFilter(isFixtureDir)
    .findSync()
    .map((file) => path.relative(FIXTURES_BASE_PATH, file));
}

const fixtureDirToQuery = (dir) => {
  let words = dir.split("-");
  // Remove last two words of a dir name which contain a date
  words.splice(words.length - 3, 3)
  return words.join(" ");
}

const fetchPageHTML = async (url) => {
  const response = await fetch(url, {
    method: "GET",
    headers: new Headers({
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36",
    }),
  });
  return await response.text();
};

const groupTelemetryCallsByAction = (sinonSpy) => {
  return ramda.pipe(
    ramda.map((args) => {
      expect(args.length).to.equal(1);
      return args[0];
    }),
    ramda.groupBy((msg) => msg.action)
  )(sinonSpy.args);
};

const setupDocument = function (html) {
  const mockWindow = new JSDOM(`<!DOCTYPE html><p>Test DOM</p>`).window;

  const document = mockWindow.document;
  document.open();
  document.write(html);
  document.close();
  return document;
};

const generateScenario = (url, html) => {
  const WebDiscoveryProject = {
    debug: false,
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
  };
  const contentExtractor = new ContentExtractor(WebDiscoveryProject);
  contentExtractor.updatePatterns(DEFAULT_PATTERNS.normal, "normal");
  contentExtractor.updatePatterns(DEFAULT_PATTERNS.strict, "strict");
  const document = setupDocument(html);
  contentExtractor.checkURL(document, url, "strict");
  const messages = groupTelemetryCallsByAction(WebDiscoveryProject.telemetry);
  const mustContain = Object.values(messages).reduce((acc, v) => acc.concat(v), []);
  return {url, mustContain};
};

const generateFixture = async (dir) => {
  let page = null;
  let scenario = null;
  const pageFilePath = path.join(dir, "page.html.gz");
  const scenarioFilePath = path.join(dir, "scenario.json");
  const query = fixtureDirToQuery(path.basename(dir));
  let url = null;
  const source = path.basename(path.dirname(dir));
  switch (source) {
    case "go":
      url = `https://www.google.com/search?q=${encodeURIComponent(query)}&gl=us&hl=en`;
      break;
    case "bing":
      url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
      break;
    default:
      return;
  }
  if (fs.existsSync(pageFilePath)) {
    page = gunzipSync(fs.readFileSync(pageFilePath)).toString();
  } else {
    console.log("Missing page html. Attempting to fetch");
    page = await fetchPageHTML(url);
    fs.writeFileSync(pageFilePath, gzipSync(page));
  }
  if (fs.existsSync(scenarioFilePath)) {
    scenario = fs.readFileSync(scenarioFilePath).toString();
  } else {
    console.log("Missing scenario. Attempting to generate");
    scenario = generateScenario(url, page);
    fs.writeFileSync(
      path.join(dir, "scenario.json"),
      JSON.stringify(scenario, null, 2)
    );
  }
};

const main = async () => {
  console.log("Generating fixtures...");
  findAllFixtures().forEach((fixtureDir) => {
    generateFixture(path.join(FIXTURES_BASE_PATH, fixtureDir));
  });
};

main();
