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
  "https://foreignpolicy.com/2022/10/06/opec-oil-production-economy-us-russia-recession/",
  "https://www.newsweek.com/visiting-parents-needy-mother-laws-mumsnet-1749779",
  "https://www.bostonglobe.com/2022/10/07/metro/back-homeschool/?camp=bg:brief:rss:feedly&rss_id=feedly_rss_brief",
  "https://www.independent.co.uk/f1/japanese-grand-prix-practice-live-stream-updates-results-b2197145.html",
  "https://www.dailymail.co.uk/news/article-11290767/The-heroes-Bishopsgate-Incredible-footage-shows-fearless-passersby-confront-phone-muggers.html?ns_mchannel=rss&ns_campaign=1490&ito=1490",
  // "https://www.washingtonpost.com/world/2022/10/07/russia-ukraine-war-latest-updates/?utm_source=rss&utm_medium=referral&utm_campaign=wp_homepage",
  "https://www.cnn.com/2022/10/06/europe/wagner-ukraine-struggles-marat-gabidullin-cmd-intl/index.html",
  "https://www.bbc.com/news/world-africa-63155899?at_medium=RSS&at_campaign=KARANGA",
  "https://www.aljazeera.com/news/2022/10/7/grief-and-shock-in-thailand-over-attack-on-daycare-tiny-angels",
  "https://abcnews.go.com/GMA/Culture/video/kate-make-cocktails-visit-northern-ireland-91135829",
  "https://www.axios.com/2022/10/07/caribbean-coral-disease-new-plan",
  // "https://nypost.com/2022/10/07/1-dead-as-police-fans-clash-outside-argentine-soccer-match/",
  // "https://www.ft.com/content/e7faef6b-f2a3-4622-a51b-896b7d25e45d",
  "https://www.nytimes.com/2022/10/07/world/europe/ukraine-war-fighters.html",
  "https://www.smh.com.au/politics/federal/alan-moir-20150921-gjrcxr.html?ref=rss&utm_medium=rss&utm_source=rss_feed",
  "https://www.euronews.com/video/2022/10/07/latest-news-bulletin-october-7th-morning",
  "https://www.foxnews.com/us/kanye-west-tucker-carlson-white-lives-matter-shirt",
  "https://www.latimes.com/california/story/2022-10-06/two-inmates-killed-at-california-state-prisons-within-24-hours-officials-say",
  "https://www.propublica.org/article/new-mexico-foster-care-rtc-teens",
  "https://www.nbcnews.com/politics/congress/republican-sen-ben-sasse-will-resign-congress-rcna51109",
  // "https://www.wsj.com/articles/russian-missiles-hit-civilian-targets-in-southeastern-ukraine-11665046368",
  "https://www.thedailybeast.com/jaguar-queen-on-the-lam-after-cops-use-instagram-to-id-her?source=articles&via=rss",
  "https://www.telegraph.co.uk/news/2022/10/06/shakespeares-globe-rushes-delete-derogatory-poem-transphobic/",
  "https://www.motherjones.com/environment/2022/10/north-carolina-outer-banks-sea-level-rise-homes-consumed/",
  "https://newrepublic.com/article/167979/gretchen-whitmer-2022-reelection-presidential-nominee-2024",
  "https://news.sky.com/story/ukraine-war-first-time-since-the-cuban-missile-crisis-we-have-a-direct-threat-of-the-use-nuclear-weapons-says-president-biden-12714106",
  // "https://www.npr.org/2022/10/07/1125588656/comic-how-foraging-restored-my-relationship-with-food",
  // "https://www.huffpost.com/entry/european-union-agrees-on-price-cap-for-russian-oil-over-ukraine-war_n_633e2379e4b028164531059c",
  "https://www.politico.com/video/2022/09/28/newsom-says-dems-have-a-messaging-problem-716228",
  "https://www.theguardian.com/environment/2022/oct/05/drone-footage-orcas-killing-white-shark-south-africa",
  "https://www.washingtontimes.com/news/2022/oct/7/nobel-peace-prize-to-activists-from-belarus-russia/?utm_source=RSS_Feed&utm_medium=RSS",
  "https://www.breitbart.com/politics/2022/10/06/democrat-mike-franken-accuser-responds-to-backlash-multiple-women-allege-serial-misconduct/",
  "https://www.theblaze.com/news/alternatives-to-detention-program-gives-some-illegal-migrants-smartphone-monitoring-devices-and-lets-them-loose-in-the-us-costing-taxpayers-billions",
  "https://dailycaller.com/2022/10/06/washington-dc-crime-shootings-four-victims-north-capitol-street/",
  "https://www.csmonitor.com/World/Asia-South-Central/2022/1006/Meet-the-amateur-art-sleuths-helping-bring-back-Asia-s-stolen-heritage?icid=rss",
  // "https://www.spiegel.de/international/germany/inflation-bankruptcies-and-fears-of-decline-is-this-the-return-of-the-sick-man-of-europe-a-41d914b0-0322-46a8-9087-d118b3f0b399#ref=rss",
  "https://www.thenation.com/article/society/mahsa-amini-and-the-women-of-iran/",
  "https://www.democracynow.org/2022/10/5/haiti_demands_pm_resignation_lower_fuel",
]

export default () => {
    describe("UtilityRegression tests", () => {
        const getSuffix = (path = "base") => `/${path}`;
        const getUrl = (path = "base") => testServer.getBaseUrl(getSuffix(path));

        const WebDiscoveryProject = app.modules["web-discovery-project"].background.webDiscoveryProject;
        const pipeline = app.modules["webrequest-pipeline"].background;
        let addPipeline;

        const addCookiesToRequest = (request, response) => {
          response.modifyHeader("Cookie", "cookie-text")
        };

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

            addPipeline = (cb) =>
                pipeline.actions.addPipelineStep("onBeforeRequest", {
                name: "test",
                spec: "blocking",
                fn: cb,
            });
        });

        afterEach(() =>
            pipeline.actions.removePipelineStep("onBeforeRequest", "test")
        );

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
                addPipeline(addCookiesToRequest);
                await openTab(url);
                await waitFor(async () => {
                  // getURL needs to be called on the canonical url
                  let canonical_url = null;
                  console.log(WebDiscoveryProject.state.v)
                  Object.values(WebDiscoveryProject.state.v).every((entry) => {
                    if (entry.url == url || (entry.red && entry.red[0] == url)) {
                      canonical_url = entry.url
                      return false;
                    }

                    return true;
                  })
                  if (canonical_url != null) {
                    console.log(canonical_url)
                    return (await new Promise((resolve) => WebDiscoveryProject.db.getURL(canonical_url, resolve))).length == 1
                  }
                });
                console.log("about to force double fetch");
                await WebDiscoveryProject.forceDoubleFetch(url);
                await waitFor(async () => (await new Promise((resolve) => WebDiscoveryProject.db.getURL(url, resolve))).length == 0);
                WebDiscoveryProject.isAlreadyMarkedPrivate(url, (res) => {
                  expect(res.private, "url is marked as private!").equal(0);
                });
              }, 3);
            });
        });
    });
};
