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
    'https://www.reddit.com/r/betterCallSaul/comments/urbkns/',
    'https://www.twitch.tv/maynarde',
    'https://www.youtube.com/watch?v=ooXvqQYEipY',
    'https://www.dailymail.co.uk/tvshowbiz/article-10828127/This-viewers-break-watching-heartbreakingly-beautiful-penultimate-episod.html'
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