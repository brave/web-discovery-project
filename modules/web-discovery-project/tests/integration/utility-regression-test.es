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
    "https://www.theblaze.com/news/john-kennedy-call-a-crackhead",
    "https://abcnews.go.com/Sports/wireStory/indonesia-police-stadium-exit-gates-small-escape-90965283",
    "https://www.bostonglobe.com/2022/10/03/business/imagining-new-role-kennedy-compound/?camp=bg:brief:rss:feedly&rss_id=feedly_rss_brief",
    "https://www.foxnews.com/world/russia-mobilization-over-200000-citizens-drafted-military-since-putin-order",
    "https://www.dailymail.co.uk/news/article-11279085/Oxford-University-student-union-trigger-warnings-Freshers-Fair-stalls.html?ns_mchannel=rss&ns_campaign=1490&ito=1490",
    "https://nypost.com/2022/10/04/ecuador-prison-clash-leaves-at-least-15-dead-20-injured/",
    "https://www.democracynow.org/2022/9/29/florida_prisons_hurricane_ian_evacuated_evacuation",
    "https://nypost.com/2022/10/04/russia-planning-nuke-test-near-ukraine-border-report/",
    "https://www.motherjones.com/politics/2022/10/oath-keepers-trial-day-1-january-6-rifles/",
    "https://abcnews.go.com/International/wireStory/iran-launched-test-tug-suborbital-space-90961665",
    "https://www.thedailybeast.com/nasas-james-webb-space-telescope-could-lead-us-to-treasure-trove-of-rogue-alien-planets?source=articles&via=rss",
    "https://www.spiegel.de/international/germany/inflation-bankruptcies-and-fears-of-decline-is-this-the-return-of-the-sick-man-of-europe-a-41d914b0-0322-46a8-9087-d118b3f0b399#ref=rss",
    "https://www.bostonglobe.com/2022/10/03/metro/details-emerge-about-mystery-woman-who-led-migrants-marthas-vineyard/?camp=bg:brief:rss:feedly&rss_id=feedly_rss_brief",
    "https://www.dailymail.co.uk/sciencetech/article-11278563/Nobel-Prize-physics-awarded-three-quantum-mechanics-scientists.html?ns_mchannel=rss&ns_campaign=1490&ito=1490",
    "https://www.ft.com/content/4351d5b0-0888-4b47-9368-6bc4dfbccbf5",
    "https://www.thenation.com/article/politics/frank-watkins-obituary/",
    "https://www.propublica.org/article/us-ban-mexicans-sell-blood-plasma#1440010",
    "https://www.ft.com/content/41cdc7e9-e0eb-4aa7-8e18-4681f4fa2a23",
    "https://abcnews.go.com/US/wireStory/us-require-rest-shifts-flight-attendants-90974287",
    "https://www.washingtontimes.com/news/2022/oct/4/live-updates-russia-ukraine-war/?utm_source=RSS_Feed&utm_medium=RSS",
    "https://www.thenation.com/article/society/lady-justice/",
    "https://nypost.com/2022/10/04/biden-told-al-sharpton-he-will-seek-2024-reelection-report/",
    "https://www.nbcnews.com/politics/supreme-court/not-parody-onion-files-brief-supreme-court-rcna50615",
    "https://www.spiegel.de/international/world/the-great-bluff-how-the-ukrainians-outwitted-putin-s-army-a-05d74f95-a5c5-482e-bb6a-837de8700fc9#ref=rss",
    "https://www.breitbart.com/clips/2022/10/03/herschel-walker-on-abortion-report-a-flat-out-lie/",
    "https://www.npr.org/2022/10/04/1126240060/meet-the-california-farmers-awash-in-colorado-river-water-even-in-a-drought",
    "https://www.thedailybeast.com/hasan-minhaj-on-the-kings-jester-netflix-special-and-doing-the-right-thing-for-the-wrong-reasons?source=articles&via=rss",
    "https://www.smh.com.au/national/superquiz-and-target-time-wednesday-october-5-20221004-p5bn2p.html?ref=rss&utm_medium=rss&utm_source=rss_feed",
    "https://www.euronews.com/2022/10/03/denmarks-queen-margrethe-sorry-for-stripping-royal-titles-from-grandchildren",
    "https://www.thedailybeast.com/herschel-walkers-son-lashes-out-at-him-after-abortion-revelation?source=articles&via=rss",
    "https://www.thenation.com/article/society/nixon-watergate-jan-6/",
    "https://news.sky.com/story/nuclear-strike-could-become-more-appealing-for-putin-as-options-shrink-12711789",
    "https://www.csmonitor.com/Commentary/the-monitors-view/2022/1003/Russia-s-war-of-the-pews-in-Ukraine?icid=rss",
    "https://www.bostonglobe.com/2022/10/03/metro/brother-patient-who-died-new-hampshire-hospital-slams-state-regulators/?camp=bg:brief:rss:feedly&rss_id=feedly_rss_brief",
    "https://www.latimes.com/california/story/2022-10-03/slave-auction-high-school-football-team-forfeits-season-yuba-city-river-valley",
    "https://www.breitbart.com/europe/2022/10/04/blackout-britain-significant-risk-of-gas-shortages-this-winter/",
    "https://www.aljazeera.com/news/2022/10/4/haitian-police-use-tear-gas-as-thousands-march-port-au-prince",
    "https://www.dailymail.co.uk/news/article-11278923/If-voted-Tory-dont-deserve-resuscitated-NHS-Outrage-nurses-outburst.html?ns_mchannel=rss&ns_campaign=1490&ito=1490",
    "https://www.newsweek.com/newsweek-com-worm-spit-digests-most-common-plastic-1748767",
    "https://dailycaller.com/2022/10/03/planned-parenthood-abortions-rv-mobile/",
    "https://newrepublic.com/article/167904/hurricane-ian-exposes-ron-desantiss-faux-environmentalism",
    "https://foreignpolicy.com/2022/10/01/moskva-south-china-sea-russia/",
    "https://www.thedailybeast.com/tv-garden-experts-rod-and-rachel-saunders-killed-and-fed-to-hungry-crocodiles-over-rare-seeds-court-hears?source=articles&via=rss",
    "https://www.axios.com/2022/10/03/iran-protests-spread-university-mahsa-amini",
    "https://www.cnn.com/2022/10/04/us/hurricane-ian-florida-recovery-tuesday/index.html",
    "https://www.cnn.com/2022/10/04/opinions/inflation-high-prices-pandemic-stewart/index.html",
    "https://www.washingtontimes.com/news/2022/oct/4/new-york-moves-to-ban-gas-powered-cars-by-2035-cal/?utm_source=RSS_Feed&utm_medium=RSS",
    "https://foreignpolicy.com/2022/10/02/ngos-nongovernmental-organizations-problems-crackdown-democracy/",
    "https://www.huffpost.com/entry/denmark-queen-strips-titles-grandchildren_n_633c227ae4b02816452dc04f",
    "https://www.spiegel.de/international/europe/open-arms-the-exploitation-of-ukrainians-in-the-european-union-a-83327326-3692-4663-92f3-85a26731c0c2#ref=rss",
]

export default () => {
    describe("UtilityRegression tests", () => {
        const getSuffix = (path = "base") => `/${path}`;
        const getUrl = (path = "base") => testServer.getBaseUrl(getSuffix(path));

        const WebDiscoveryProject = app.modules["web-discovery-project"].background.webDiscoveryProject;
        const pipeline = app.modules["webrequest-pipeline"].background;
        let addPipeline;

        const addCookiesToRequest = (request, response) => {
            request.requestHeaders.push("Cookie", "Secret");
            // request.requestHeaders['cookie'].push({'OptanonAlertBoxClosed', '2022-10-05T10:34:28.502Z'})
            // request.requestHeaders['cookie2'].push({'OptanonAlertBoxClosed': '2022-10-05T10:34:28.502Z'})
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
                await waitFor(() => expect(Object.keys(WebDiscoveryProject.state.v)).to.include(getUrl(path)), 2000);
              });
        });

        describe("utility-regression-test.utility-regression", () => {
            // const safe_pages = testPageSources['pages'];
            test_urls.forEach((url) => {
                it(`'${url}' is allowed`, async () => {
                    addPipeline(addCookiesToRequest);
                    await openTab(url);
                    await waitFor(async () => (await new Promise((resolve) => WebDiscoveryProject.db.getURL(url, resolve))).length == 1);
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