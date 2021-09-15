/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* global chai */
/* global describeModule */

const expect = chai.expect;

export default describeModule(
  "core/crypto/pkcs-conversion",
  () => ({
    "../../platform/text-encoder": {
      default: function () {
        return {
          encode: function (s) {
            const buf = Buffer.from(s, "utf8");
            return buf;
          },
        };
      },
    },
    "../../platform/text-decoder": {
      default: function () {
        return {
          decode: function (s) {
            return Buffer.from(s).toString();
          },
        };
      },
    },
  }),
  () => {
    describe("PKCS Conversion", function () {
      this.timeout(5000);
      const privateKeyJWK = {
        kty: "RSA",
        key_ops: ["sign"],
        e: "AQAB",
        n: "0nKhlw2zQSvi5Lo8JSYzMAXtAeew1ztSOoISJhDbFEvsR7a3_c7CcHSp1YvTgOZnheASgeVrzIxJIxUcvLDKRRg09Sh7dUtclm7pnieVCN5zoQ74aO30L7l0LZRX_Gfz9eO6h3jrGmRcQ_X1SfqN_gemQanokQOFh4xO3YVeU3lUnCglg3ALgysVYRTQm3AKgp5e4yhLm249Q0-vgkjDcJnzbLwGq9-gCvjLHineIhlpRmVb5lSV9wzLyCtdG8p1HkWWJMHtICK-JlUtEGNi0Ec7m96nnq_ceRFfzQJyQVKNrLHJOpvHPEHy9Nd7ErsaEysFFicIYiXNCBSG-hnhzw",
        d: "kcGhV6y-faH2yTKP268EfvtrtwkQu1Gz1yAlj8XW5sza_qR39MtScm7q_iOVPs7V3qxeRSdwLUDwmuLRf4L25Top267JK2kh3HM_TTHfEEB6V4-1z38XxEIvTC5VblVVa_XpSFEgjKv8F3nwBOgLlmkX5pzWnjGRN1ufd-Aaf7bkfO8L3QdPqswyET3LqFuq1dekY7-6ZUz6wdnuwsc3_dMJfItUrlnaVzWnPeeRVYh3MXVtHQQ1Oc_wVbPdWJ-MFrFrfeqhVGyZd1_ZPTEI6LIlsbjHc9zVQRUqwfoz1r0M366UKqt4xxZHq4R4qFVUcY5uPNbZL32FS2HNx9-LwQ",
        p: "8Mfuk_GnIji599qwjDdZktXKJN441RsVphC5X4cJfFaDkq1HjVa70X4N3JTIg-FkVhbtjRxHhZIJfvVCp_h7IaGr6vZ1jvIta-5u1Wf_DWvtPJxKMgsz_krkxfVWR8ylXEZI6rPOCPO128Wr0-zn_MDj1NhnnHrKINT6jpFP6OE",
        q: "37_g-QtEVhPxxex_NZ6GwxsOz_y7_hQQVQO3QGT4-lZSO3WVtWHZYnkWgMOxLwuHrOgTKSp5bWsxeogRDhZiRDfbxdDt6OL0MCunYBJ_ybdUsrJ1HKA5Bfhg7b8INybHcXQmyCyfvHm4lzMSkNOBRoKXDOT_fv-ce1YRdAU_sK8",
        dp: "P6t-yRxTp9b8RjBMEyfnxc5Gv-0Ldj7NQLaXbk1VEs4FyNmNXDCdRc5hd_zX8Re-4oz5kCD0QLvXSv0r_SLV3JTV0zIM8BnWLP5FzKTNaw0pFKf3brhLrWi8iiRQBnh1Gat0SKv3RaK8ajshLs8soUeYd4YqD9TgckIfZ2fBi8E",
        dq: "amrWU1y6eb4upZYfwp7NNYpu9xkbSHK-edC0nZnomRfpMIJyW7xYKe-xdjic0uVG-EPAqTmcWyA6fi6s_ehDgHKYwnLmVHds8GQyzQy_Xm8lh4A9FwpVVLOXVjwfaiu1fA5kS5x9tKSn2LHfyKXvvFtsACQCKKLmB_sdffLpId0",
        qi: "wjBj_ZzBcRR5ImZxTuoltlhbFrpx5FfxDVuqEm0vGZPDrkoJuA8H4VHqZpHaC-cM5eeKlS5e32pe13QJHuXD88OgKXqg1GXPnGCXPu2uk3bfbbCdJI_euqdLM3vtU25DseIBEj2tjbXH78x4vAgCo65qZV0gwFaxMovV0AnShOI",
        alg: "RS256",
        ext: true,
      };

      const publicKey =
        "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0nKhlw2zQSvi5Lo8JSYzMAXtAeew1ztSOoISJhDbFEvsR7a3/c7CcHSp1YvTgOZnheASgeVrzIxJIxUcvLDKRRg09Sh7dUtclm7pnieVCN5zoQ74aO30L7l0LZRX/Gfz9eO6h3jrGmRcQ/X1SfqN/gemQanokQOFh4xO3YVeU3lUnCglg3ALgysVYRTQm3AKgp5e4yhLm249Q0+vgkjDcJnzbLwGq9+gCvjLHineIhlpRmVb5lSV9wzLyCtdG8p1HkWWJMHtICK+JlUtEGNi0Ec7m96nnq/ceRFfzQJyQVKNrLHJOpvHPEHy9Nd7ErsaEysFFicIYiXNCBSG+hnhzwIDAQAB";

      let PKCS;
      beforeEach(function () {
        PKCS = this.module();
      });

      it("exportPublicKey", function () {
        expect(PKCS.exportPublicKey(privateKeyJWK)).to.equal(publicKey);
      });
    });
  }
);
