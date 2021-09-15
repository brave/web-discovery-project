/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* globals describeModule, chai */

const expect = chai.expect;

export default describeModule(
  "core/helpers/strip-api-headers",
  () => ({}),
  function () {
    describe("#isSafeToRemoveHeaders", function () {
      let isSafeToRemoveHeaders;

      beforeEach(function () {
        isSafeToRemoveHeaders = this.module().isSafeToRemoveHeaders;
      });

      const safeToRemoveHosts = [
        "wdp.brave.com",
        "star.wdp.brave.com",
        "star.wdp.brave.software",
      ];
      for (const hostname of safeToRemoveHosts) {
        it(`should modify requests to whitelisted hosts: ${hostname}`, () => {
          expect(isSafeToRemoveHeaders(hostname)).to.be.true;
        });
      }

      const protectedHosts = [
        "www.google.com",
        "www.amazon.com",
        "localhost",
        "127.0.0.1",
        "search.brave.com",
        "search.brave.software",
        "anotherdomain.brave.com",
        "any-domain-ending-with.brave.software",
      ];
      for (const hostname of protectedHosts) {
        it(`should not modify requests non-whitelisted hosts: ${hostname}`, () => {
          expect(isSafeToRemoveHeaders(hostname)).to.be.false;
        });
      }
    });
  }
);
