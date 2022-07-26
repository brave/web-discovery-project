/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// import { newTab } from "../core/browser";
// import sleep from "../core/helpers/sleep";
import App from "../core/app";

const WDP = { app: undefined };

WDP.app = new App({
  version: chrome.runtime.getManifest().version,
});
window.WDP = WDP;

// function testStar() {
//   console.error("Fake message sending");
//   WDP.app.modules[
//     "web-discovery-project"
//   ].background.webDiscoveryProject.network.dns.cacheDnsResolution(
//     `remusao.github.io`,
//     "172.31.23.1"
//   );
//
//   let oc = 14;
//   const n = Date.now();
//   setTimeout(() => {
//     for (let i = 0; i < 5; i += 1) {
//       // Fake 'page message'
//       const page = {
//         type: "wdp",
//         action: "page",
//         oc: `${oc + i}`,
//         payload: {
//           url: `https://remusao.github.io/posts/packaging-nodejs-apps.html2`,
//           a: 2,
//           x: {
//             lh: 20729,
//             lt: 15503,
//             t: "Packaging Node.js apps the easy way",
//             nl: 12,
//             ni: 0,
//             ninh: 0,
//             nip: 0,
//             nf: 0,
//             pagel: "en",
//             ctry: "fr",
//             iall: true,
//             canonical_url: "https://remusao.github.io/ (PROTECTED)",
//             nfsh: 0,
//             nifsh: 0,
//             nifshmatch: true,
//             nfshmatch: true,
//             nifshbf: 0,
//             nfshbf: 0,
//           },
//           e: {
//             cp: 0,
//             mm: 0,
//             kp: 0,
//             sc: 0,
//             md: 0,
//           },
//           st: 200,
//           c: null,
//           ref: null,
//           red: null,
//           dur: 7841,
//         },
//         ver: "1.0",
//         channel: "brave",
//         ts: "20210912",
//         "anti-duplicates": n,
//       };
//
//       WDP.app.modules[
//         "web-discovery-project"
//       ].background.webDiscoveryProject.telemetry(page, false);
//     }
//   }, 5000);
// }
//
// function testDoubleFetch() {
//   setTimeout(async () => {
//     await Promise.all([
//       newTab("https://economist.com"),
//       newTab(
//         "https://www.economist.com/europe/2021/09/18/the-warring-parties-plans-for-germanys-economy-are-full-of-holes"
//       ),
//       newTab("https://remusao.github.io"),
//     ]);
//     await sleep(10000);
//     const results = await WDP.app.modules[
//       "web-discovery-project"
//     ].background.webDiscoveryProject._simulateDoublefetch();
//     console.error("??? results", results);
//   }, 2000);
// }

WDP.app
  .start()
  .then(() => {
    console.log("App is running!");
    // NOTE: for debugging only, force fetching of patterns immediately
    return WDP.app.ready();
  })
  .then(() => {
    console.log("App is ready!");
    return WDP.app.modules[
      "web-discovery-project"
    ].background.webDiscoveryProject.patternsLoader.resourceWatcher.forceUpdate();
  })
  .then(() => {
    // NOTE: This can be un-commented for local testing
    // testStar();
    // testDoubleFetch();
  })
  .catch((ex) => {
    console.error("????", ex);
  })
  .then(() => {
    console.error("Done with custom stuff!");
  });

window.addEventListener("unload", () => {
  WDP.app.stop();
});

// To enable
// WDP.prefs.set("modules.web-discovery-project.enabled", true);
// WDP.prefs.set("modules.hpnv2.enabled", true);

// To disable again
// WDP.prefs.set("modules.web-discovery-project.enabled", false);
// WDP.prefs.set("modules.hpnv2.enabled", false);

// Content script can be bundled as well:
// import 'web-discovery-project/build/core/content-script';
