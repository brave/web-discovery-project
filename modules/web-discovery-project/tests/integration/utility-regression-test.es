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

export default () => {
    describe("UtilityRegression tests", () => {
        const getSuffix = (path = "base") => `/${path}`;
        const getUrl = (path = "base") => testServer.getBaseUrl(getSuffix(path));

        const WebDiscoveryProject = app.modules["web-discovery-project"].background.webDiscoveryProject;
        const pipeline = app.modules["webrequest-pipeline"].background;
        let addPipeline;

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
                let mock_path = 'helloworld.com/hello'
                await testServer.registerPathHandler(getSuffix(mock_path), {
                  result: testPageSources['pages'][0][mock_path],
                });

                await openTab(getUrl(mock_path));
                await waitFor(() => expect(Object.keys(WebDiscoveryProject.state.v)).to.include(getUrl(mock_path)), 2000);
              });
        });
    });
};