/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  RemoteResourceWatcher,
  ResourceUpdatedCallback,
} from "./remote-resource-watcher";
import SignatureVerifier from "./signature-verifier";
import config from "../core/config";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/**
 * List of keys that the clients will trust. Normally, there is no
 * reason to have multiples keys except to improve compatibility
 * with platforms that do not support the prefered signing algorithm.
 */
const trustedSigningKeys = {
  "2021-09-10-wdp-sandbox.pub": {
    algorithm: "RSA-PSS",
    pem: `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArbQNCIZZ0bEr8JTHcRh1
c80H4cP0++y6hSSexRCGiNG8ONhLCHtOaJZQaZweiYJrk7tWrAKEpjpA0YUQb38Y
lgSgDTKfF2Ce3EF0ScxJlJcZZPDIIT/Jk2lkHMpxEvmKvoAJJX16UpDbQNCpw8PX
4lcC7WxEURmRdpCNDAAu4BeGf9hV5ZViNXKMiPHyGCCIZ0y0neDuYOsjwCQBKwQX
SUNE2SymoSc3gNniMqEOHYiSt4eyR1WrWUc+wft7vIOCQhLcTwwdd3kSUcI9Iyyq
nuCY6jG0gbBbeEkRjJeG0de415tgDL1DzUCuTJILbomQT+8AA8kV+ZtL01BHz9fJ
lQIDAQAB
-----END PUBLIC KEY-----`,
  },
  "2021-09-10-wdp-prod.pub": {
    algorithm: "RSA-PSS",
    pem: `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0maJo7JBWm6pPXJLXeDo
DNC5+sPh489MeuZHuMjPGV1okSH4ZMoEBi9Gmc6isD35FJkb2yEM6zgdU3jPxFM9
ym7RgjChuymlW4FTOrMkOwylp+17deZlARu7TcvX55SQEET/R1YtZSbTgRSHSbdk
5C9ORpcl2BWjVLMN0dqGFZFKnVPqHsJcYMBN48X26ezbe6NWoehdIyG4JXAT1ckP
bTLY65+GXCqEhxU2MIaLYGDX1mMButdIhderJiSmwopbAH87NvjlFv9gwtGlehFX
6ENTRhs4MUCrRxGW8KGAXPgxN/hvkU2GOuGMXRmOouSAocMGBAGZihcjD5/0eD5/
QwIDAQAB
-----END PUBLIC KEY-----`
  },
};

/**
 * Loads content extraction patterns from the CDN.
 * For instance, these pattern define rules to recognize
 * queries from search engine result pages.
 * To keep in sync with the backend, the client will regularly
 * poll for changes.
 *
 * If the initial loading of the pattern fails because the network
 * is not available, wdp will start in a well-defined state
 * but some functionality will be disabled until the patterns could
 * be successfully fetched from the server.
 *
 * Well-defined state means that no patterns will be active.
 * In other words, there should be no errors, but at the same
 * time no content will be collected. Once the patterns are
 * loaded, full functionality of wdp will be restored.
 */
export default class SignedPatternsLoader {
  verifier: SignatureVerifier;
  resourceWatcher: RemoteResourceWatcher;

  constructor(url: string, onUpdate: ResourceUpdatedCallback) {
    const publicKeyName =
      config.settings.WDP_ENV === "sandbox"
        ? "2021-09-10-wdp-sandbox.pub"
        : "2021-09-10-wdp-prod.pub";

    const { algorithm, pem } = trustedSigningKeys[publicKeyName];
    this.verifier = new SignatureVerifier({
      resourceUrl: url,
      publicKeyName,
      algorithm,
      publicKeyPem: pem,
      insecure: !config.settings.WDP_PATTERNS_SIGNING,
    });

    this.resourceWatcher = new RemoteResourceWatcher({
      moduleName: "web-discovery-project",
      resource: {
        id: "web-discovery-project-patterns",
        url,
      },
      signature: {
        url: this.verifier.signatureUrl,
        verifier: this.verifier,
      },
      caching: {
        maxAge: 1 * HOUR,
      },
      onUpdate,
      uncompressWith: "gzip",
    });
  }

  async init() {
    // Fail fast if there is a problem with loading the public key.
    // There is no way to recover except by disabling signature
    // checking (by setting the 'insecure' flag), or switching to
    // alternative crypto algorithms.
    await this.verifier.ensureKeysAreLoaded();

    await this.resourceWatcher.init();
  }

  async unload() {
    this.resourceWatcher.unload();
  }
}
