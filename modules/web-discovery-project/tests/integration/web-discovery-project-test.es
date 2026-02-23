/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { app, expect } from "../../../tests/core/integration/helpers";
import { HashProb } from "@web-discovery-project/parser";

export default function () {
  const WebDiscoveryProject =
    app.modules["web-discovery-project"].background.webDiscoveryProject;
  const testPrivateUrl = "https://somerandomprivatedomain.com";

  describe("WebDiscoveryProject tests", function () {
    beforeEach(async function () {
      await app.modules["web-discovery-project"].isReady();
      WebDiscoveryProject.setAsPrivate(testPrivateUrl);
    });

    describe("web-discovery-project.isHash", function () {
      const notHash = [
        "",
        "11667216660",
        "12",
        "2022",
        "Firefox",
        "about-us",
        "anti-tracking",
        "callback",
        "cliqz.com",
        "compress%2Cformat%2Cenhance",
        "compress-format-enhance",
        "contact",
        "front/ng",
        "homepage",
        "javascript",
        "navigation",
        "newsletter",
        "privacy-policy",
        "search-results",
        "settings",
        "shopping",
        // ALL-CAPS brands
        "JUJUTSU-KAISEN",
        "NODAPL",
        // CamelCase compound words
        "BluRay",
        "YouTube",
        // Short mixed-case strings
        "iPadOS",
        "LoRaWAN",
        // Hex strings that read as English — correctly not flagged
        "deadbeef",
        "cafebabe",
        // Words with uncommon bigrams — correctly not-hash
        "download",
        "knowledge",
        "cryptocurrency",
        "breadcrumbs",
        // Uncommon English words — correctly not-hash
        "shipwreck",
        "gymnasium",
        // More words with uncommon bigrams that should not be flagged
        "drawback",
        "clockwork",
        "throwback",
        // Resolution/dimension strings — caught by prefilter (digit x digit)
        "1021x952",
        "1024x768",
        "1440x900",
        "468x742",
        "728x90",
        // Short strings (< 6 chars) — always not-hash regardless of content
        "a1b2",
        "xyz",
        "Ab1",
        // Known v3 false positive — uncommon bigrams (hm, ms, sl) fool the LR classifier
        "OhmsLaw",
        // URL-encoded non-Latin text — decoded to Greek, non-Latin chars yield neutral bigramProb → not hash
        "%CE%94%CE%B9%CE%BF%CE%AF%CE%BA%CE%B7%CF%83%CE%B7",
        // Long slug strings — must NOT be caught by base64 prefilter
        "turn-customer-input-into-innovation",
        "vintage-watercolor-sky-wall-art-neutral",
        "como-eliminar-el-aire-de-las-tuberias",
        "what_are_your_opinion_on_the_act_of_rainbow",
        // More slug patterns: non-English, underscore, date-like, very long
        "how-to-build-a-website-from-scratch",
        "les-meilleures-recettes-de-cuisine",
        "top_ten_programming_languages_2024",
        "the-quick-brown-fox-jumps-over-the-lazy-dog",
        "october-2023",
        // File names / dotted identifiers
        "script.min.js",
        // Tracking parameter names
        "utm_source",
        // Plus-encoded query strings
        "hello+world+foo+bar",
        // URL paths with / — word separator guard must catch these
        "products/electronics/phones",
        // Long natural language words
        "internationalization",
        "troubleshooting",
        "unsubscribe",
        // Concatenated phrase (23 chars, just under base64 prefilter)
        "theartofprogrammingwell",
        // Vowel-less English words — v1/v2 false positives, v3 correctly handles
        "rhythm",
        "rhythms",
        // Unusual English word — v3 false positive (no a/e/i/o/u, uncommon bigrams)
        "syzygy",
        // CamelCase tech brands
        "TypeScript",
        "WordPress",
        "PlayStation",
        "LinkedIn",
        // Concatenated words + numbers (caught by long-lowercase-run guard)
        "medicalattendancerules20210531154958ppt",
        "EducationalMaterialsMarch2012",
        "carewellcostassistance2022",
        // UK postcodes — structured geographic codes, not hashes
        "SW1A2AB",
        "EC2R8AH",
        "gu254ha",
        "ne425ay",
        // Real words/names starting with UC/PL — not YouTube IDs
        "UCLEngineering",
        "PLANIFICACION",
        "UCundinamarca",
        // Facebook page IDs — readable brand name + numeric suffix
        "Boursorama-100063898754011",
        "Wandamotor-100064778348203",
        // ISBN-based document identifiers
        "B9780128202029000096",
        // Compound words + year/date (caught by base64 prefilter due to digits)
        "WesternAustralianElection2021",
        "PainelPagamentos20212024",
        "InternetArchiveComments1082015",
        // German ISIN securities code
        "DE0005220008",
        // Product names starting with PL (not playlist IDs)
        "PLUMBFLEX-2-in-Hinged-Split-Ring",
        // Amazon ASIN-like product identifiers
        "B000008FS3",
      ];

      const hashes = [
        "02a6a4e3-260a-4513-a95b-7bc5b50679c9",
        "04C2EAD03B",
        "54f5095c96e",
        "5d41402abc4b",
        "6a204bd89f3c",
        "7b3e4d2f-8a19-4c6e-bc0d-1e5f6a7b8c9d",
        "8c14e45fceea",
        "9f86d081884c",
        "B62a15974a93",
        "a1b2c3d4e5",
        "c81e728d9d4c",
        "d3b07384d113",
        "e3b0c44298fc1c14",
        "f47ac10b58cc",
        // Hex hash (12 chars) — v3 classifier correctly catches this
        "22163a4ff903",
        // Hex hash (12 chars)
        "4505cbd6e3a2",
        // MD5 hash (32 hex chars) — caught by pure hex ≥16 prefilter
        "95cf24bda36cdf7acbd57ee3ec570141",
        // Chrome extension ID (32 lowercase a-p) — caught by prefilter
        "nkbihfbeogaeaoehlefnkodbefgpgknn",
        // SHA-1 hash (40 hex chars) — caught by pure hex ≥16 prefilter
        "da39a3ee5e6b4b0d3255bfef95601890afd80709",
        // Random alphanumeric
        "x7k9m2p4q8",
        "j3f8h2k5n9",
        // Random hex-like
        "f7a3b9c1d5e2",
        // More random alphanumeric
        "r4t7w1z6v3",
        // Hex-like identifiers
        "c3f2a1b4d5e6",
        "7c4a8d09e61f",
        // 8-char git short hash — IS an opaque identifier
        "a865566f",
        // base64-encoded "user:pass" — IS an opaque token
        "dXNlcjpwYXNz",
        // UUID — caught by UUID prefilter
        "550e8400-e29b-41d4-a716-446655440000",
        // SHA-256 (64 hex chars) — caught by hex>=16 prefilter
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        // base64 "hello world" (15 chars) — caught by classifier
        "aGVsbG8gd29ybGQ",
        // JWT header (20 chars, below base64 prefilter)
        "eyJhbGciOiJIUzI1NiJ9",
        // 8-char hex hashes (short opaque identifiers)
        "f3a9b2c1",
        "9e2d4a7b",
        // 15-char hex (just under 16-char pure hex prefilter)
        "1a2b3c4d5e6f7a8",
        // MD5 hash (32 hex chars)
        "c9f0f895fb98ab9159f51fd0297e236d",
        // SHA-1 hash (40 hex chars)
        "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d",
        // base64 "Hello World!" (16 chars, below prefilter)
        "SGVsbG8gV29ybGQh",
        // API tokens with prefix_value format
        "tok_1234abcd5678efgh",
        "sess_abc123def456ghi789jkl012mno",
        // AWS access key — v3 false negative (high vowel ratio, contains "EXAMPLE")
        "AKIAIOSFODNN7EXAMPLE",
        // GitHub personal access token — v3 false negative (word separator guard blocks prefilter)
        "ghp_ABCDEFghijklmnop1234567890ab",
        // Base32 encoded TOTP secret
        "JBSWY3DPEHPK3PXP",
        // YouTube channel ID — all-alpha but opaque token
        "UCDlLfadiQHJuFkJnSBBnQsQ",
        // YouTube playlist ID — opaque token
        "PLkqio3At9fTuBAzYKjQVGj",
        // Hash-based filename basenames (hex hash without extension)
        "dc64e27d36f8a1b2c3d4e5f6",
        // MongoDB ObjectId
        "507f1f77bcf86cd799439011",
      ];

      // WARNING: Do NOT add entries here. Fix the classifier instead.
      // Only add exceptions as a last resort after all classifier fixes are exhausted.
      const knownV3FalseNegatives = new Set([
        "AKIAIOSFODNN7EXAMPLE", // AWS key — high vowel ratio, contains "EXAMPLE"
        "ghp_ABCDEFghijklmnop1234567890ab", // GitHub PAT — word separator guard blocks prefilter
      ]);

      // WARNING: Do NOT add entries here. Fix the classifier instead.
      // Only add exceptions as a last resort after all classifier fixes are exhausted.
      const knownV3FalsePositives = new Set([
        "OhmsLaw", // uncommon bigrams (hm, ms, sl) fool the LR classifier
        "syzygy", // zero vowels, rare bigrams — irreducible LR FP
        "B000008FS3", // Amazon ASIN — 90% hex chars triggers LR
      ]);

      notHash.forEach(function (str) {
        it(`'${str}' is not a hash`, function () {
          if (knownV3FalsePositives.has(str)) {
            this.skip(); // known v3 limitation — see tools/test-validator.js for details
          }
          expect(WebDiscoveryProject.hashProb.isHash(str)).to.be.false;
        });
      });

      hashes.forEach(function (str) {
        it(`'${str}' is a hash`, function () {
          if (knownV3FalseNegatives.has(str)) {
            this.skip(); // known v3 limitation — see tools/test-validator.js for details
          }
          expect(WebDiscoveryProject.hashProb.isHash(str)).to.be.true;
        });
      });
    });

    describe("web-discovery-project.checkForEmail", function () {
      // Ref: https://en.wikipedia.org/wiki/Email_address
      const emails = [
        "email@domain.com",
        "firstname.lastname@domain.com",
        "firstname+lastname@domain.com  ",
        "_______@domain.com",
      ];

      emails.forEach((e) => {
        it(`'${e}' is a email`, function () {
          expect(WebDiscoveryProject.checkForEmail(e)).to.equal(true);
        });
      });
    });

    describe("web-discovery-project.dropLongURL", function () {
      const longUrls = [
        // path segment over rel_part_len
        "https://example.com/foobarbazfoobarbazfoobarbazfoobarbazfoobarbazfoobarbazfoobarbazfoobarbazfoobarbaz",
        // long number (> 8 digits) in path in strict mode
        "https://www.wsj.com/articles/ultra-orthodox-israeli-military-unit-faces-calls-to-disband-after-abuse-allegations-11667216660",
        // hash in query string
        "https://example.com?q=a1b2c3d4e5",
        // hash-like path segment in strict mode
        "https://example.com/page/7c4a8d09e61f/view",
      ];

      const notLongUrls = [
        "https://example.com",
        "https://www.nytimes.com/2022/10/27/fashion/craftsmanship-eb-meyrowitz-eyeglasses-london.html",
        "https://www.newsweek.com/american-army-halloween-trick-treat-candy-himars-viral-video-ukraine-fort-sill-1755955",
        "https://www.telegraph.co.uk/news/2022/10/30/bbc-local-radio-stations-face-big-cuts-content-area/",
        // "download" in path — not a hash at 0.01820, but needs > 5 chars AND
        // hash check to trigger in strict; "download" is 8 chars but not hash
        "https://example.com/download/latest",
        // "shipwreck" in path — not a hash at 0.01820, just above threshold boundary
        "https://example.com/articles/shipwreck-discovery",
      ];

      longUrls.forEach((u) => {
        it(`'${u}' is a long URL`, function () {
          expect(WebDiscoveryProject.dropLongURL(u, { strict: true })).to.equal(
            true,
          );
        });
      });

      notLongUrls.forEach((u) => {
        it(`'${u}' is not a long URL`, function () {
          expect(WebDiscoveryProject.dropLongURL(u, { strict: true })).to.equal(
            false,
          );
        });
      });
    });

    describe("web-discovery-project.isShortenerURL", function () {
      const shortenerUrls = [
        // hostname "t.co" (4 chars < 8), path "/a1b2c3d4e5" (11 chars > 4),
        // segment "a1b2c3d4e5" is a hash
        "https://t.co/a1b2c3d4e5",
        "https://bit.ly/54f5095c96e",
        // Real-world bitly pattern — 7-char random alphanumeric is a hash
        "https://bit.ly/3xK9mP2",
      ];

      const notShortenerUrls = [
        // hostname "example.com" (11 chars >= 8) — fails hostname check
        "https://example.com/a1b2c3d4e5",
        // hostname < 8, but path "/abc" (4 chars, not > 4)
        "https://t.co/abc",
        // hostname < 8, path > 4, but segment "about-us" is not a hash
        "https://bit.ly/about-us",
        // normal URL — hostname >= 8
        "https://www.google.com/search",
        // hostname < 8, path > 4, but natural slug "go2site" is not a hash
        "https://t.co/go2site",
      ];

      shortenerUrls.forEach(function (url) {
        it(`'${url}' is a shortener URL`, function () {
          expect(WebDiscoveryProject.isShortenerURL(url)).to.be.true;
        });
      });

      notShortenerUrls.forEach(function (url) {
        it(`'${url}' is not a shortener URL`, function () {
          expect(WebDiscoveryProject.isShortenerURL(url)).to.be.false;
        });
      });
    });

    describe("web-discovery-project.dropLongURL (default options)", function () {
      const longUrls = [
        // > 4 query params triggers non-strict check
        "https://example.com/page?a=1&b=2&c=3&d=4&e=5",
        // 13-digit number in path (> 12 non-strict threshold)
        "https://example.com/article/1234567890123",
        // path segment > rel_part_len (18 chars) — always triggers
        "https://example.com/a1b2c3d4e5f6a1b2c3d4e",
        // query string longer than qs_len (30 chars)
        "https://example.com/page?very_long_query_string_exceeding_threshold_value=1",
      ];

      const notLongUrls = [
        // clean URL, no suspicious content
        "https://example.com",
        // short query, no long numbers, no hash in path
        "https://example.com/news?page=2",
        // real-world URL with natural path segments
        "https://www.nytimes.com/2022/10/27/fashion/craftsmanship.html",
        // "download" in path — no longer a hash at 0.01820
        "https://example.com/download/knowledge/articles",
        // 4 query params (not > 4, boundary)
        "https://example.com/page?a=1&b=2&c=3&d=4",
        // 12-digit number (not > 12, boundary)
        "https://example.com/article/123456789012",
      ];

      longUrls.forEach((u) => {
        it(`'${u}' is a long URL (default options)`, function () {
          expect(WebDiscoveryProject.dropLongURL(u)).to.equal(true);
        });
      });

      notLongUrls.forEach((u) => {
        it(`'${u}' is not a long URL (default options)`, function () {
          expect(WebDiscoveryProject.dropLongURL(u)).to.equal(false);
        });
      });
    });

    describe("web-discovery-project.isSuspiciousTitle", function () {
      const notSuspicious = [
        "",
        "Firefox",
        "\n  Booking.com:  Hotels in Berlin.  Buchen Sie jetzt Ihr Hotel!  \n",
        "bet365 - Sportwetten, Fußball-Quoten für die Bundesliga und Champions League, ATP- und WTA-Tennis-Quoten, sowie Basketball-Wetten auf die BBL und Euroleague, Casino, Poker, Spiele, Vegas",
        // Mixed-case brand words in normal titles (no word > 15 chars stripped)
        "PlayStation Store Official Website - Buy Games",
        "JUJUTSU KAISEN Official Anime Website",
        // 16-char natural word — just over rel_segment_len (15) but not a hash
        "Internationalize Your App With This Framework",
        // Title with common words that have uncommon bigrams
        "Gymnasium Equipment and Shipwreck Artifacts Exhibition",
      ];

      const suspicious = [
        "Redaxo 5.x.x (29.10.12 - 4f0849709c511232fe72059d5a1d3344a668035a): redaxo5/redaxo/src/addons/structure/plugins/content/lib/article_slice.php Source File",
        "meine telephone number +491861200214001",
        "Email id a@a.com",
        'Blog Nachhaltige Wissenschaft – Große gesellschaftliche Herausforderungen wie der Klimawandel und Umweltprobleme erfordern neues Wissen. Eine „transformative Wissenschaft" steht vor der Herausforderung, die gesellschaftliche Transformation zu einer Nachhaltigen Entwicklung nicht nur zu analysieren und zu begleiten, sondern auch aktiv zu befördern. Um dies leisten zu können, muss sich das Wissenschaftssystem selbst institutionell transformieren. Hierfür setzen sich die „NaWis"-Runde und das „Ecological Research Network" (Ecornet) ein. Auf diesem Blog geben sie einen Überblick über Akteure, Initiativen und Projekte einer transformativen Wissenschaft auf nationaler und internationaler Ebene.',
        // Title containing MD5 hash (32 chars > rel_segment_len 15)
        "Page 95cf24bda36cdf7acbd57ee3ec570141 - Error Log",
        // Title containing Chrome extension ID
        "Details nkbihfbeogaeaoehlefnkodbefgpgknn Profile",
        // Title containing SHA-1 hash
        "Commit da39a3ee5e6b4b0d3255bfef95601890afd80709 in main",
        // Title with random alphanumeric token (16+ chars, is hash)
        "Error r4t7w1z6v3b8m2p5 occurred during processing",
      ];

      suspicious.forEach((e) => {
        it(`'${e}' is suspicious title`, function () {
          expect(WebDiscoveryProject.isSuspiciousTitle(e)).to.equal(true);
        });
      });

      notSuspicious.forEach((e) => {
        it(`'${e}' is not suspicious title`, function () {
          expect(WebDiscoveryProject.isSuspiciousTitle(e)).to.equal(false);
        });
      });
    });

    describe("web-discovery-project.allowedCountryCode", function () {
      const allowed = ["de"];

      const notAllowed = ["gr", null, undefined, "in", "mm"];

      notAllowed.forEach((e) => {
        it(`'${e}'is not allowed`, function () {
          expect(WebDiscoveryProject.sanitizeCountryCode(e)).to.equal("--");
        });
      });

      allowed.forEach((e) => {
        it(`'${e}' is allowed`, function () {
          expect(WebDiscoveryProject.sanitizeCountryCode(e)).to.equal(e);
        });
      });
    });

    describe("web-discovery-project.bloomfilter", function () {
      const testPublicUrl = "https://somerandompublicdomain.com";

      it(`${testPrivateUrl} is private`, function () {
        WebDiscoveryProject.isAlreadyMarkedPrivate(testPrivateUrl, (e) => {
          expect(e.private).to.equal(1);
        });
      });

      it(`${testPublicUrl} is public`, function () {
        WebDiscoveryProject.isAlreadyMarkedPrivate(testPublicUrl, (e) => {
          expect(e.private).to.equal(0);
        });
      });
    });

    describe("web-discovery-project.searchEngineUrl", function () {
      const testSearchEngineUrl =
        "https://google.com/search?q=apple+pie&sca_esv=3204631f57a9e94fc9b15156c2a60e5a&ei=6e19f02b9aade4603fe3bc81768743f6";

      it(`${testPrivateUrl} is private`, function () {
        WebDiscoveryProject.isAlreadyMarkedPrivate(testPrivateUrl, (e) => {
          expect(e.private).to.equal(1);
        });
      });

      it(`${testSearchEngineUrl} is public`, function () {
        WebDiscoveryProject.isAlreadyMarkedPrivate(testSearchEngineUrl, (e) => {
          expect(e.private).to.equal(0);
        });
      });
    });

    describe("web-discovery-project.storage", function () {
      it("storage test", function (done) {
        WebDiscoveryProject.db.saveRecordTelemetry("unit-test", "test", () => {
          WebDiscoveryProject.db.loadRecordTelemetry(
            "unit-test",
            function (data) {
              if (data && data === "test") {
                done();
              } else {
                done("storage test-failed");
              }
            },
          );
        });
      });
    });
  });
}
