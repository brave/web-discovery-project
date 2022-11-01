/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  app,
  expect,
  newTab,
  updateTab,
  getTab,
  testServer,
  waitFor,
  testPageSources
} from "../../../tests/core/integration/helpers";

const test_urls = [
  "https://www.bostonglobe.com/2022/11/01/science/is-climate-change-coming-new-englands-fall-foliage/?camp=bg:brief:rss:feedly&rss_id=feedly_rss_brief",
  "https://www.propublica.org/getinvolved/religious-organizations-elections-johnson-amendment",
  "https://www.smh.com.au/national/superquiz-and-target-time-wednesday-november-2-20221101-p5bulw.html?ref=rss&utm_medium=rss&utm_source=rss_feed",
  "https://www.independent.co.uk/news/money-ap-fsa-budget-new-york-city-b2215106.html",
  "https://www.dailymail.co.uk/news/article-11376743/Jeremy-Hunt-Rishi-Sunak-set-cap-public-sector-pay-rises-2-year.html?ns_mchannel=rss&ns_campaign=1490&ito=1490",
  "https://www.aljazeera.com/news/2022/11/1/un-nuclear-watchdog-starts-dirty-bomb-claims-probe-in-ukraine",
  "https://www.newsweek.com/american-army-halloween-trick-treat-candy-himars-viral-video-ukraine-fort-sill-1755955",
  "https://www.nytimes.com/2022/10/27/fashion/craftsmanship-eb-meyrowitz-eyeglasses-london.html",
  "https://www.cbc.ca/news/canada/edmonton/first-person-davin-tikkala-safety-public-transit-1.6620436?cmp=rss",
  // "https://www.washingtonpost.com/elections/2022/11/01/oz-senate-doctor-research/?utm_source=rss&utm_medium=referral&utm_campaign=wp_homepage",
  "https://abcnews.go.com/GMA/Wellness/pfizer-announces-promising-developments-1st-maternal-rsv-vaccine/story?id=92444805",
  "https://www.axios.com/2022/10/31/cease-and-desist-campaign-ads",
  "https://www.bbc.com/news/world-europe-63466138?at_medium=RSS&at_campaign=KARANGA",
  "https://www.washingtontimes.com/news/2022/oct/31/north-korea-warns-us-of-powerful-response-to-allie/?utm_source=RSS_Feed&utm_medium=RSS",
  "https://thehill.com/homenews/3713646-at-least-14-people-shot-halloween-night-in-chicago-drive-by-police-say/",
  "https://www.cnn.com/2022/10/31/us/powerball-jackpot-drawing-monday/index.html",
  "https://nypost.com/2022/11/01/maryland-family-buys-prop-casket-finds-edith-crews-ashes/",
  "https://www.theguardian.com/world/2022/oct/31/brazil-election-bolsonaro-concede-reaction",
  "https://www.nbcnews.com/news/latino/latinas-most-impacted-abortion-bans-study-rcna54793",
  "https://www.euronews.com/2022/10/31/lula-supporters-celebrate-election-victory-in-brazil-amid-bolsonaro-silence",
  "https://www.ft.com/content/eef1c538-c22e-4231-8ade-6c16eeb4b039",
  "https://www.telegraph.co.uk/news/2022/10/30/bbc-local-radio-stations-face-big-cuts-content-area/",
  "https://dailycaller.com/2022/10/31/kirsten-powers-cnn-crime-democrats/",
  "https://www.latimes.com/california/story/2022-10-31/santa-clara-county-sheriff-laurie-smith-steps-down-corruption-trial",
  "https://www.foxnews.com/us/midterms-elections-at-stake-final-countdown",
  "https://foreignpolicy.com/2022/10/28/foreign-policy-news-quiz-china-party-congress-ccp-britain-prime-minister-leadership/",
  "https://www.huffpost.com/entry/india-bridge-collapse_n_635ec48ae4b044fae3ea8d1d",
  "https://www.thedailybeast.com/fox-news-panel-erupts-after-greg-gutfeld-defends-elon-musks-misinformation?source=articles&via=rss",
  "https://www.motherjones.com/politics/2022/10/elon-musk-free-speech-absolutist-is-silent-about-his-saudi-partners/",
  "https://newrepublic.com/article/168354/new-york-hochul-maloney-2022",
  "https://news.sky.com/story/brazil-election-jair-bolsonaro-remains-silent-as-his-supporters-block-roads-after-his-defeat-to-lula-12735475",
  "https://www.npr.org/2022/11/01/1133041108/how-to-confront-rising-antisemitism-in-the-u-s",
  "https://www.thenation.com/article/world/russia-hating-ukraine-war-media/",
  "https://www.wsj.com/articles/ultra-orthodox-israeli-military-unit-faces-calls-to-disband-after-abuse-allegations-11667216660",
  "https://www.breitbart.com/clips/2022/10/31/swalwell-republican-leaders-political-rhetoric-is-inspiring-violent-political-acts/",
  "https://www.theblaze.com/news/woke-doctrine-virginia-mom-slams-anti-second-amendment-school-assignment-for-advancing-a-political-agenda",
  "https://www.csmonitor.com/Commentary/2022/1031/Inspiring-by-example?icid=rss",
  "https://www.democracynow.org/2022/10/26/pennsylvania_mehmet_oz_john_fetterman_debate",
  "https://www.spiegel.de/international/world/the-divided-village-mistrust-abounds-among-the-liberated-residents-of-ukrainian-village-a-a0c64575-da9d-46b6-ba07-26a72db4a316#ref=rss",
  "https://www.politico.com/news/2022/10/11/liv-golf-nra-mckenna-associates-00061215"
]

export default () => {
    describe("UtilityRegression tests", () => {
      const getSuffix = (path = "base") => `/${path}`;
      const getUrl = (path = "base") => testServer.getBaseUrl(getSuffix(path));

      const WebDiscoveryProject = app.modules["web-discovery-project"].background.webDiscoveryProject;
      const pipeline = app.modules["webrequest-pipeline"].background;

      const openTab = async (url) => {
        const tabId = await newTab("about:blank");
        await waitFor(
          () =>
            expect(
              pipeline.pageStore.tabs.has(tabId),
              `expect ${tabId} in ${JSON.stringify(
                [...pipeline.pageStore.tabs.entries()],
                null,
                2
              )}`
            ).to.eql(true),
          2000
        );
        await updateTab(tabId, { url });
        await waitFor(
          async () => expect((await getTab(tabId)).url).to.not.eql("about:blank"),
          2000
        );
        return tabId;
      };

      beforeEach(async () => {
            await app.modules["web-discovery-project"].isReady();
            WebDiscoveryProject.debug = true;
            WebDiscoveryProject.utility_regression_tests = true;

            // Reload pipeline
            pipeline.unload();
        await pipeline.init();
      });

      describe("utility-regression-test.base", () => {
            it("mock_url appears in wdp state", async () => {
                let page = testPageSources['pages'][0]
                let path = page['url']
                await testServer.registerPathHandler(getSuffix(path), {
                  result: page['content'],
                });

                await openTab(getUrl(path));
              await waitFor(() => expect(Object.keys(WebDiscoveryProject.state.v)).to.include(getUrl(path)), 5000);
              });
      });

      describe("utility-regression-test.utility-regression", () => {
        test_urls.forEach((url) => {
          it(`'${url}' is allowed`, async () => {
            // addPipeline(addCookiesToRequest);
            await openTab(url);
            await waitFor(async () => {
              // getURL needs to be called on the canonical url
              let canonical_url = null;
              Object.values(WebDiscoveryProject.state.v).every((entry) => {
                if (entry.url == url || (entry.red && entry.red[0] == url)) {
                  canonical_url = entry.url
                  return false;
                }
                return true;
              })
              if (canonical_url != null) {
                return (await new Promise((resolve) => WebDiscoveryProject.db.getURL(canonical_url, resolve))).length == 1
              }
            });
            await WebDiscoveryProject.forceDoubleFetch(url);
            await waitFor(async () => (await new Promise((resolve) => WebDiscoveryProject.db.getURL(url, resolve))).length == 0);
            WebDiscoveryProject.isAlreadyMarkedPrivate(url, (res) => {
              expect(res.private, "url is marked as private!").equal(0);
            });
          });
            });
        });
    });
};
