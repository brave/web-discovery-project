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
        "Firefox",
        "cliqz.com", // a url
        "anti-tracking",
        "front/ng",
        "javascript",
        "callback",
        "compress-format-enhance",
        "compress%2Cformat%2Cenhance",
        "2022",
        "12",
        "11667216660",
      ];

      const hashes = [
        "04C2EAD03B",
        "54f5095c96e",
        "B62a15974a93",
        "22163a4ff903",
        "468x742",
        "1021x952",
        "1024x768",
        "1440x900",
      ];

      notHash.forEach(function (str) {
        it(`'${str}' is not a hash`, function () {
          expect(WebDiscoveryProject.hashProb.isHash(str)).to.be.false;
        });
      });

      hashes.forEach(function (str) {
        it(`'${str}' is a hash`, function () {
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
        "https://example.com/22163a4ff903",
        "https://example.com?q=22163a4ff903",
        "https://example.com/foobarbazfoobarbazfoobarbazfoobarbazfoobarbazfoobarbazfoobarbazfoobarbazfoobarbaz",
        "https://www.wsj.com/articles/ultra-orthodox-israeli-military-unit-faces-calls-to-disband-after-abuse-allegations-11667216660",
      ];

      const notLongUrls = [
        "https://example.com",
        "https://www.nytimes.com/2022/10/27/fashion/craftsmanship-eb-meyrowitz-eyeglasses-london.html",
      ];

      longUrls.forEach((u) => {
        it(`'${u}' is a long URL`, function () {
          expect(WebDiscoveryProject.dropLongURL(u, { strict: true })).to.equal(true);
        });
      });

      notLongUrls.forEach((u) => {
        it(`'${u}' is not a long URL`, function () {
          expect(WebDiscoveryProject.dropLongURL(u, { strict: true })).to.equal(false);
        });
      });
    });

    describe("web-discovery-project.isSuspiciousTitle", function () {
      const notSuspicious = [
        "",
        "Firefox",
        "\n  Booking.com:  Hotels in Berlin.  Buchen Sie jetzt Ihr Hotel!  \n",
        "bet365 - Sportwetten, Fußball-Quoten für die Bundesliga und Champions League, ATP- und WTA-Tennis-Quoten, sowie Basketball-Wetten auf die BBL und Euroleague, Casino, Poker, Spiele, Vegas",
      ];

      const suspicious = [
        "Redaxo 5.x.x (29.10.12 - 4f0849709c511232fe72059d5a1d3344a668035a): redaxo5/redaxo/src/addons/structure/plugins/content/lib/article_slice.php Source File",
        "meine telephone number +491861200214001",
        "Email id a@a.com",
        'Blog Nachhaltige Wissenschaft – Große gesellschaftliche Herausforderungen wie der Klimawandel und Umweltprobleme erfordern neues Wissen. Eine „transformative Wissenschaft" steht vor der Herausforderung, die gesellschaftliche Transformation zu einer Nachhaltigen Entwicklung nicht nur zu analysieren und zu begleiten, sondern auch aktiv zu befördern. Um dies leisten zu können, muss sich das Wissenschaftssystem selbst institutionell transformieren. Hierfür setzen sich die „NaWis“-Runde und das „Ecological Research Network“ (Ecornet) ein. Auf diesem Blog geben sie einen Überblick über Akteure, Initiativen und Projekte einer transformativen Wissenschaft auf nationaler und internationaler Ebene.',
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
      const testSearchEngineUrl = "https://google.com/search?q=apple+pie&sca_esv=3204631f57a9e94fc9b15156c2a60e5a&ei=6e19f02b9aade4603fe3bc81768743f6";

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
