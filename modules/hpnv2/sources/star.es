import { fromBase64, toBase64 } from "../core/encoding";
import { sha256 } from "../core/crypto/utils";
import logger from "./logger";

const THRESHOLD = 20; // current threshold
const EPOCH = "1"; // versioning

export default class Star {
  constructor() {
    this.create_share = null;
  }

  async init() {
    const { create_share } = await import("star-wasm");
    this.create_share = create_share;
  }

  /**
   * Given a `url` and `page` message to send to the backend, create a random
   * STAR share and wrap it into a JSON message which can be sent to the backend.
   * The backend then collects all shares and decrypts the ones which have reached
   * the threshold.
   */
  async prepareMessage(url, hpnMsg, oc, fetchOptions) {
    // `tag`, `key` and `share` are base64-encoded strings.
    logger.debug("prepareMessage", { url, THRESHOLD, EPOCH });

    // NOTE: sta-rs currently limits the length of the "measurement" (i.e.
    // `url`) to 32 characters. To make sure we can give URLs of arbitrary
    // length, we instead send a SHA256 hash of the URL as a measurement.
    const measurement = await sha256(url, "raw");

    // NOTE: Wrapper is expecting `measurement` to be `&[u8]`, which means we
    // need to pass Uint8Array (the type resulting from `sha256`). Second
    // argument should be u32 and last one `&str`.
    //
    // It is important to make sure the right types are used, otherwise the
    // wrapper might not complain but the results could be surprising (if you
    // pass a string instead of Uint8Array as first argument you might get the
    // same `tag` all the time).
    const t0 = Date.now();
    const { tag, key, share } = JSON.parse(
      this.create_share(measurement, THRESHOLD, EPOCH)
    );
    const t1 = Date.now();
    logger.debug("create_share:", t1 - t0);

    // importKey: get actual encryption key from `key`
    const aesKey = await window.crypto.subtle.importKey(
      "raw",
      fromBase64(key),
      {
        name: "AES-GCM",
      },
      false,
      ["encrypt"]
    );

    // Generate random `iv`
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    // Encrypt `hpnMsg` with `aesKey`
    const encrypted = await window.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
      },
      aesKey,
      hpnMsg
    );

    return {
      // Constants: backend will need them to stay in sync with clients.
      // NOTE: the value of `tag` should be sensitive to both of these values,
      // which means that changing `EPOCH` or `THRESHOLD` will result in a
      // different tag. It should thus be safe for the backend to group by `tag`
      // and expect that values of all constants will match.
      threshold: THRESHOLD,
      epoch: EPOCH,

      // Information about the STAR share
      tag,
      share,
      oc, // Last octet of IP to drop from same subnet

      // Information needed for STAR aggregator to POST the decrypted hpn
      // payload to the collector. These headers only contain data which is
      // generated for this specific fetch call and cannot be used to link
      // records.
      //
      // For example:
      // {
      //   "content-type": "application/octet-stream",
      //   "encryption": "6gTNdtyv5/ruuz9o4MMu71A9Xo/hEbobM98RZc3WFbcaBDv/RpLw6dANwWzLiW/oNVfXEK2eZVmUCVeKB3AGPDPQqXLfXYPJzSCpGLHI",
      //   "key-date": "20210914",
      //   "version": "1",
      // }
      fetchOptions,

      // Information about encrypted accompanying data (i.e. page message)
      encrypted: toBase64(encrypted),
      iv: toBase64(iv),
    };
  }

  unload() {
    this.create_share = null;
  }
}
