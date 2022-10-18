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
  "https://www.independent.co.uk/climate-change/news/stop-oil-protests-today-dartford-b2205018.html",
  "https://www.bostonglobe.com/2022/10/18/world/taliban-killed-captives-restive-afghan-province-report-says/?camp=bg:brief:rss:feedly&rss_id=feedly_rss_brief",
  "https://www.newsweek.com/parent-voters-more-likely-back-democrats-economy-poll-1752551",
  "https://www.smh.com.au/sport/racing/the-day-this-golden-eagle-favourite-beat-a-cox-plate-winner-20221018-p5bqoq.html?ref=rss&utm_medium=rss&utm_source=rss_feed",
  // "https://www.washingtonpost.com/history/2022/10/16/howard-baskerville-reza-aslan-iran/?utm_source=rss&utm_medium=referral&utm_campaign=wp_homepage",
  "https://abcnews.go.com/Business/wireStory/asian-shares-gain-rally-wall-street-91660244",
  "https://www.theguardian.com/world/2022/oct/18/chinas-plans-to-annex-taiwan-moving-much-faster-under-xi-says-blinken",
  "https://foreignpolicy.com/2022/10/17/national-security-strategy-biden-asia-china-geopolitics-democracy/",
  "https://www.bbc.com/news/world-asia-63282589?at_medium=RSS&at_campaign=KARANGA",
  // "https://www.npr.org/2022/10/18/1129521692/matthew-deperno-dana-nessel-michigan-attorney-general-voting-machines",
  "https://www.axios.com/2022/10/18/microsoft-layoffs-latest-tech-firm-cuts",
  "https://www.aljazeera.com/economy/2022/10/17/amazon-faces-off-with-union-in-fight-for-a-second-warehouse",
  "https://www.nbcnews.com/news/us-news/jackson-mississippi-water-crisis-congress-investigates-rcna52129",
  // "https://www.huffpost.com/entry/singer-mikaben-dies-after-paris-collapse_n_634d76a8e4b051268c4c5f84",
  "https://www.thenation.com/article/politics/letters-from-the-october-31-november-7-2022-issue/",
  "https://www.nytimes.com/2022/10/17/briefing/russia-drone-attacks-booker-prize.html",
  "https://www.foxnews.com/lifestyle/reddit-poster-heat-throwing-dry-wedding-tells-friend-alcohol-problem",
  // "https://www.propublica.org/article/wisconsin-election-midterms-voting-2022#1460399",
  "https://www.cbc.ca/news/politics/jim-watson-testify-emergencies-act-inquiry-1.6619609?cmp=rss",
  "https://nypost.com/2022/10/18/superfly-actor-kaalan-walker-sentenced-to-50-years-to-life-in-prison-for-rape-charges/",
  "https://www.cnn.com/2022/10/17/politics/joe-odea-donald-trump-colorado-senate/index.html",
  "https://www.thedailybeast.com/the-vow-part-iis-most-disturbing-nxivm-revelation-the-three-mexican-teens-abused-by-keith-raniere?source=articles&via=rss",
  "https://www.telegraph.co.uk/news/2022/10/18/huw-edwards-queen-elizabeth-death-announcement-flawless-hold/",
  "https://news.sky.com/story/more-than-100-ukrainian-women-released-in-one-of-the-wars-biggest-prisoner-swaps-12723412",
  "https://www.euronews.com/2022/10/18/liz-truss-admits-budget-mistakes-and-apologises-after-jeremy-hunt-announces-mini-budget-u-",
  "https://www.washingtontimes.com/news/2022/oct/17/uncharted-territory-high-stakes-questions-swirl-ar/?utm_source=RSS_Feed&utm_medium=RSS",
  // "https://www.ft.com/content/5c4827ab-9882-4cbb-a2ba-049dc5f363bb",
  "https://www.breitbart.com/politics/2022/10/17/republican-j-d-vance-slams-democrat-rep-tim-ryan-for-sucking-up-to-nancy-pelosi-national-democrats/",
  "https://www.latimes.com/california/story/2022-10-17/irvine-romance-scammer-who-claimed-to-be-navy-seal-took-up-to-1-5-million",
  "https://thehill.com/homenews/campaign/3693646-tulsi-gabbard-to-campaign-for-kari-lake-blake-masters-in-arizona/",
  "https://www.theblaze.com/news/illegal-teachers-strike-causes-school-closures-that-impact-over-13000-students",
  "https://dailycaller.com/2022/10/17/dasha-burns-fetterman-stroke-senate/",
  // "https://www.wsj.com/articles/china-economy-xi-jinping-ideology-11666016306",
  "https://www.csmonitor.com/World/Asia-Pacific/2022/1017/How-Xi-Jinping-is-reshaping-China-in-five-charts?icid=rss",
  "https://www.motherjones.com/politics/2022/10/donald-trump-would-like-jewish-people-to-be-more-appreciative-of-him-before-its-too-late/",
  // "https://www.spiegel.de/international/europe/serbia-s-president-targets-lgbtqi-community-as-a-distraction-a-3f02073c-5928-4c32-8010-c45dd9f0fabb#ref=rss",
  "https://www.democracynow.org/2022/10/17/the_rebellious_life_of_mrs_rosa",
  "https://newrepublic.com/article/168045/neoconservative-isolationism-republican-party",
  "https://www.politico.com/news/2022/09/28/states-dismissal-suit-era-ratification-00059332"
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
