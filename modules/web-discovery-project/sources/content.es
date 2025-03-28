/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { registerContentScript } from "../core/content/register";
import { throttle } from "../core/decorators";
import { documentBodyReady } from "../core/content/helpers";

import { normalizeAclkUrl } from "./ad-detection";

function logException(e) {
  window.console.error("[web-discovery-project] Exception caught:", e);
}

export function parseDom(url, window, wdp) {
  const document = window.document;

  // Let's try and get META refresh to detect javascript redirects.
  try {
    let jsRef = null;
    jsRef = document.querySelector("script");
    if (jsRef && jsRef.innerHTML.indexOf("location.replace") > -1) {
      const location = document.querySelector("title").textContent;
      wdp.action("jsRedirect", {
        location,
        url: document.location.href,
      });
    }
  } catch (ee) {
    logException(ee);
  }

  try {
    let _ad = "";
    let _h = false;

    if (document.querySelector("#s0p1c0")) {
      _ad = document.querySelector("#s0p1c0").href;
    }

    if (document.querySelector("#tads .ads-ad")) {
      if (document.querySelector("#tads .ads-ad").offsetParent === null)
        _h = true;
    }

    const additionalInfo = {
      type: "dom",
      ad: _ad,
      hidden: _h,
    };

    wdp.action("contentScriptTopAds", {
      message: additionalInfo,
    });
  } catch (ee) {
    logException(ee);
  }

  // We need to get all the ADS from this page.
  try {
    const adDetails = {};
    const doc = window.document;
    let noAdsOnThisPage = 0;
    const detectAdRules = {
      query: {
        element: "#rso",
        attribute: "data-async-context",
      },
      adSections: [
        ".ads-ad",
        ".pla-unit-container",
        ".pla-hovercard-content-ellip",
        ".cu-container tr",
      ],
      0: {
        cu: ".ad_cclk a[id^='s0p'],.ad_cclk a[id^='n1s0p'],.ad_cclk a[id^='s3p']",
        fu: ".ad_cclk a[id^='vs0p'],.ad_cclk a[id^='vn1s0p'],.ad_cclk a[id^='vs3p']",
      },
      1: {
        cu: "a[id^='plaurlg']",
        fu: "a[id^='vplaurlg']",
      },
      2: {
        cu: "a[id^='plaurlh']",
        fu: "a[id^='vplaurlh']",
      },
      3: {
        cu: "a[id^='plaurlt']",
        fu: "a[id^='vplaurlt']",
      },
    };

    // We need to scrape the query too.
    const queryElement = doc.querySelector(detectAdRules.query.element);
    let query = "";

    if (queryElement) {
      query = queryElement
        .getAttribute(detectAdRules.query.attribute)
        .replace("query:", "");

      try {
        query = decodeURIComponent(query);
      } catch (ee) {
        // empty
      }
    }

    // Let's iterate over each possible section of the ads.
    detectAdRules.adSections.forEach((eachAdSection, idx) => {
      const adNodes = Array.prototype.slice.call(
        doc.querySelectorAll(eachAdSection),
      );

      adNodes.forEach((eachAd) => {
        const cuRule = detectAdRules[idx].cu;
        const fuRule = detectAdRules[idx].fu;

        const clink = eachAd.querySelector(cuRule);
        const flink = eachAd.querySelector(fuRule);

        if (clink && flink) {
          const clickPattern = normalizeAclkUrl(clink.href);

          adDetails[clickPattern] = {
            ts: Date.now(),
            query,
            furl: [flink.getAttribute("data-preconnect-urls"), flink.href], // At times there is a redirect chain, we only want the final domain.
          };

          noAdsOnThisPage += 1;
        }
      });
    });

    if (noAdsOnThisPage > 0) {
      wdp.action("adClick", {
        ads: adDetails,
      });
    }
  } catch (ee) {
    logException(ee);
  }
}

function contentScript(window, chrome, WDP) {
  const url = window.location.href;
  const wdp = WDP.app.modules["web-discovery-project"];

  // Only add for main pages.
  if (window.top === window) {
    documentBodyReady().then(() => {
      parseDom(url, window, wdp);
    });
  }

  function proxyWindowEvent(action) {
    return (ev) => {
      wdp.action(action, {
        target: {
          baseURI: ev.target.baseURI,
        },
      });
    };
  }

  const onKeyPress = throttle(window, proxyWindowEvent("wdp:keypress"), 250);
  const onMouseMove = throttle(window, proxyWindowEvent("wdp:mousemove"), 250);
  const onScroll = throttle(window, proxyWindowEvent("wdp:scroll"), 250);
  const onCopy = throttle(window, proxyWindowEvent("wdp:copy"), 250);

  window.addEventListener("keypress", onKeyPress);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("scroll", onScroll);
  window.addEventListener("copy", onCopy);

  function stop(ev) {
    if (ev && ev.target !== window.document) {
      return;
    }

    // detect dead windows
    // https://developer.mozilla.org/de/docs/Web/JavaScript/Reference/Errors/Dead_object
    try {
      String(window);
    } catch (e) {
      return;
    }

    window.removeEventListener("keypress", onKeyPress);
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("copy", onCopy);
  }

  window.addEventListener("pagehide", stop);
}

registerContentScript({
  module: "web-discovery-project",
  matches: ["http://*/*", "https://*/*"],
  js: [contentScript],
  allFrames: true,
});
