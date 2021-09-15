/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* please keep keys in this object sorted */
module.exports = (env = "sandbox") => {
  if (env === "sandbox") {
    return {
      ENDPOINT_HPNV2_ANONYMOUS: "https://collector.wdp.brave.software", // hpnv2/sources/endpoints.es
      ENDPOINT_HPNV2_DIRECT: "https://collector.wdp.brave.software", // hpnv2/sources/endpoints.es
      ENDPOINT_PATTERNS: "https://patterns.hpn.brave.software/patterns.gz",
      ENDPOINT_SAFE_QUORUM_PROVIDER: "https://safe-browsing-quorum.hpn.brave.software/config",
      ENDPOINT_STAR: "https://star.wdp.brave.software/",
      FETCHER_GATEWAY: "https://fg.search.brave.com",
    };
  }

  if (env === "production") {
    return {
      ENDPOINT_HPNV2_ANONYMOUS: "https://collector.wdp.brave.com", // hpnv2/sources/endpoints.es
      ENDPOINT_HPNV2_DIRECT: "https://collector.wdp.brave.com", // hpnv2/sources/endpoints.es
      ENDPOINT_PATTERNS: "https://patterns.wdp.brave.com/patterns.gz",
      ENDPOINT_SAFE_QUORUM_PROVIDER: "https://quorum.wdp.brave.com/config",
      ENDPOINT_STAR: "https://star.wdp.brave.com/",
      FETCHER_GATEWAY: "https://fg.search.brave.com",
    };
  }

  if (env === "local") {
    return {
      ENDPOINT_HPNV2_ANONYMOUS: "http://127.0.0.1:3001", // hpnv2/sources/endpoints.es
      ENDPOINT_HPNV2_DIRECT: "http://127.0.0.1:3001", // hpnv2/sources/endpoints.es
      ENDPOINT_PATTERNS: "http://127.0.0.1:8000/hw-patterns.gz",
      ENDPOINT_SAFE_QUORUM_PROVIDER: "http://127.0.0.1:7100/config",
      FETCHER_GATEWAY: "http://localhost:8083",
    };
  }
};
