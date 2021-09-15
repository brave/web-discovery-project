/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import config from "../core/config";
import { fetch, Headers, Response, AbortController } from "../core/http";
import random from "../core/crypto/random";
import logger from "./logger";
import {
  TransportError,
  ServerError,
  NotReadyError,
  MsgTimeoutError,
} from "./errors";
import { VERSION, ECDH_P256_AES_128_GCM } from "./constants";
import { inflate } from "../core/zlib";
import {
  fromUTF8,
  toUTF8,
  toByteArray,
  toBase64,
  fromBase64,
} from "../core/encoding";
import crypto from "../platform/crypto";
import pacemaker from "../core/services/pacemaker";

const SECOND = 1000;

const { subtle } = crypto;

async function generateECDH() {
  return subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveKey",
  ]);
}

async function deriveKey(serverEcdhPubKey, clientPrivateKey) {
  return subtle.deriveKey(
    { name: "ECDH", namedCurve: "P-256", public: serverEcdhPubKey },
    clientPrivateKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

async function exportKey(key) {
  return new Uint8Array(await subtle.exportKey("raw", key));
}

async function sha256(data) {
  return new Uint8Array(await subtle.digest({ name: "SHA-256" }, data));
}

async function importAesKey(data) {
  return subtle.importKey(
    "raw",
    data,
    { name: "AES-GCM", length: 128 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptAES(iv, key, data) {
  return new Uint8Array(
    await subtle.encrypt({ name: "AES-GCM", iv, tagLength: 128 }, key, data)
  );
}

async function decryptAES(iv, key, data) {
  return new Uint8Array(
    await subtle.decrypt({ name: "AES-GCM", iv, tagLength: 128 }, key, data)
  );
}

/**
 * To prevent proxies from reading or modifying the traffic, the
 * traffic is encrypted with GCM-AES. To negotiate the symmetric
 * key, a Diffie-Hellman key exchange is performed.
 *
 * For performance reasons, we do not want to pay for a separate request.
 * That is why the server publishes its part of the key exchange in advance
 * (though the /config endpoint). For forward secrecy, the server rotates this key daily.
 *
 * Warnings:
 *
 * 1) Make sure that the clients never fetch the /config endpoint
 * through the proxies. Otherwise, it would allow malicious proxies to act
 * as a man-in-the-middle and change the DH key. Clients should send messages
 * through the proxies but should not fetch the config from them!
 *
 * 2) Be aware that the server will be able to link message if you
 * use the same key to send multiple messages. If you are not sure, it is
 * safer to generate new keys for each message.
 */
async function negotiateAesKey(serverEcdhPubKey) {
  const { publicKey, privateKey } = await generateECDH();
  const clientPublicKey = await exportKey(publicKey);
  const derivedKey = await deriveKey(serverEcdhPubKey.key, privateKey);
  const rawDerived = await exportKey(derivedKey);
  const encryptionKey = (await sha256(rawDerived)).subarray(0, 16);
  const aesKey = await importAesKey(encryptionKey);
  return { aesKey, clientPublicKey, serverEcdhPubKey };
}

async function encrypt(data, aesKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await encryptAES(iv, aesKey, data);
  return { iv, encrypted };
}

function toRelativeTimeout(absoluteTimeout) {
  if (!absoluteTimeout) {
    return { timeoutInMs: undefined, isExpired: false };
  }

  const timeoutInMs = absoluteTimeout - Date.now();
  return { timeoutInMs, isExpired: timeoutInMs <= 0 };
}

async function myfetch(
  url,
  {
    method = "GET",
    body,
    payloadEncryption = null,
    timeoutInMs,
    cache = "no-store",
    star,
  } = {}
) {
  // eslint-disable-next-line no-param-reassign
  timeoutInMs = timeoutInMs || 60 * SECOND;

  const abortController = new AbortController();
  const headers = new Headers({ Version: VERSION.toString() });
  const options = {
    method,
    headers,
    credentials: "omit",
    cache,
    redirect: "manual",
    signal: abortController.signal,
  };

  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    options.headers.append("Content-Type", "application/octet-stream");
    options.body = toByteArray(body);
  } else if (body && typeof body === "object") {
    options.headers.append("Content-Type", "application/json");
    options.body = toUTF8(JSON.stringify(body));
  }

  logger.debug('myFetch', { url, method, star, options });

  // When messages are sent through proxies, we cannot rely on TLS alone.
  // Proxies terminate TLS connections, so we have to apply end-to-end encryption
  // on top. This step is not needed when we communicate directly with the server
  // (e.g. for the join operation).
  let aesKey;
  if (payloadEncryption && options.body) {
    aesKey = payloadEncryption.aesKey;
    const { iv, encrypted } = await encrypt(options.body, aesKey);
    options.body = encrypted;

    // Apart from the encrypted payload and the initialization vector, the
    // server needs to know more information to perform its part of the
    // key exchange:
    // 1) client: our Diffie-Hellman public key
    // 2) server: the date of the prepublished server key that was used
    // (otherwise, the server would need to try all active keys)
    options.headers.append("Key-Date", payloadEncryption.serverEcdhPubKey.date);
    const encryption = new Uint8Array(1 + 65 + 12);
    encryption.set(payloadEncryption.clientPublicKey, 1);
    encryption.set(iv, 1 + 65);
    encryption[0] = ECDH_P256_AES_128_GCM;
    options.headers.append("Encryption", toBase64(encryption));
  }

  // We inject STAR here (for 'page' messages only), just before sending to
  // backend. We need to do it as late as possible (just before calling fetch)
  // so that 1. we benefit from delayed sending, and other HPNv2 client-side
  // protections, and 2. the exact message can be forwarded from STAR
  // aggregator to HPN backend without any modification (including AES
  // encryption). This includes forwarding some requests headers like
  // 'Key-Date' and 'Encryption'.
  if (star && star.originalMsg && star.originalMsg.action === "page") {
    // Save 'oc' to be sent at the top level with STAR payload and remove from
    // message. This attribute is attached in `WebDiscoveryProject.msgSanitize`.
    const oc = star.originalMsg.oc;
    delete star.originalMsg.oc;
    const fetchOptions = {
      method: options.method,
      headers: [...options.headers.entries()],
      credentials: options.credentials,
      cache: options.cache,
      redirect: options.redirect,
    };
    const starMsg = await star.prepareStarMessage(
      star.originalMsg.payload.url,
      options.body,
      oc,
      fetchOptions
    );

    // Override headers and let STAR aggregator forward with original fetch
    // options (including headers).
    options.headers = new Headers();
    options.headers.append("Content-Type", "application/json");
    options.body = toUTF8(JSON.stringify(starMsg));
    url = star.url;
    logger.debug('Got STAR share', url, starMsg);
  }

  // eslint-disable-next-line no-async-promise-executor
  return new Promise(async (resolve, reject) => {
    const timer = pacemaker.setTimeout(() => {
      reject(
        new MsgTimeoutError(`Exceeded timeout of ${timeoutInMs / 1000} sec`)
      );
      abortController.abort();
    }, timeoutInMs);
    try {
      let response;
      try {
        response = await fetch(url, options);
      } catch (e) {
        throw new ServerError(e);
      }

      const { status, statusText, ok } = response;
      if (!ok) {
        throw new ServerError(statusText);
      }

      if (aesKey && response.headers.get("Encryption-IV")) {
        const encrypted = new Uint8Array(await response.arrayBuffer());
        const iv = fromBase64(response.headers.get("Encryption-IV"));
        const decrypted = await decryptAES(iv, aesKey, encrypted);
        response = new Response(decrypted, { status, statusText });
      }
      resolve(response);
    } catch (e) {
      reject(e);
    } finally {
      pacemaker.clearTimeout(timer);
    }
  });
}

// Just to have all the endpoints in the same place.
export default class Endpoints {
  constructor({ maxRetries = 3, urls = config.settings, star } = {}) {
    this._reset();
    this.maxRetries = maxRetries;
    this.urls = urls;
    this.star = star;
  }

  _reset() {
    const oldMessages = this.messages || [];
    this.messages = [];
    this.sendTimer = null;
    this.unloaded = false;

    oldMessages.forEach((x) =>
      x.reject(new NotReadyError("Request cancelled because of unload"))
    );
  }

  get ENDPOINT_HPNV2_ANONYMOUS() {
    return this.urls.ENDPOINT_HPNV2_ANONYMOUS;
  }

  get ENDPOINT_HPNV2_DIRECT() {
    return this.urls.ENDPOINT_HPNV2_DIRECT;
  }

  get ENDPOINT_HPNV2_JOIN() {
    return `${this.ENDPOINT_HPNV2_DIRECT}/join`;
  }

  get ENDPOINT_HPNV2_POST() {
    return this.ENDPOINT_HPNV2_ANONYMOUS;
  }

  get ENDPOINT_HPNV2_CONFIG() {
    // It is important that we never use the anonymous endpoint here!
    // If /config requests would go through a 3rd party proxy, we would
    // be open to man-in-the-middle attacks.
    //
    // The reason is that it breaks the Diffie-Hellman key exchange,
    // as a malicious proxy could modify the server's public key.
    // The consequence would be that a malicious proxy could trick
    // the client into encrypting with a secret known to the proxy.
    return `${this.ENDPOINT_HPNV2_DIRECT}/config`;
  }

  get ENDPOINT_STAR() {
    return this.urls.ENDPOINT_STAR;
  }

  _scheduleSend() {
    if (this.unloaded || this.sendTimer !== null) {
      return;
    }
    this.sendTimer = pacemaker.setTimeout(() => {
      const n = Math.floor(random() * this.messages.length);
      const {
        url,
        msg,
        originalMsg,
        cnt,
        payloadEncryption,
        resolve,
        reject,
        absoluteTimeout,
      } = this.messages.splice(n, 1)[0];

      myfetch(url, {
        method: "POST",
        body: msg,
        payloadEncryption,
        star: {
          url: this.ENDPOINT_STAR,
          originalMsg,
          prepareStarMessage: (url, page, oc, fetchOptions) =>
            this.star.prepareMessage(url, page, oc, fetchOptions),
        },
      })
        .then(resolve, (e) => {
          if (cnt < this.maxRetries) {
            logger.log("Will retry sending msg after error", e);
            this.messages.push({
              url,
              msg,
              cnt: cnt + 1,
              payloadEncryption,
              resolve,
              reject,
              absoluteTimeout,
            });
          } else {
            logger.warn(
              "_scheduleSend failed (gave up after",
              this.maxRetries,
              "retry attempts)",
              e
            );
            reject(e);
          }
        })
        .then(() => {
          this.sendTimer = null;
          if (this.messages.length > 0) {
            this._scheduleSend();
          }
        });
    }, 500 + Math.floor(random() * 1500)); // TODO: improve?
  }

  async send(
    msg,
    { instant, serverEcdhPubKey, absoluteTimeout, originalMsg } = {}
  ) {
    function prepareEndToEndEncryptionIfNeeded() {
      if (!serverEcdhPubKey || serverEcdhPubKey.unsupportedByBrowser) {
        return null;
      }
      return negotiateAesKey(serverEcdhPubKey);
    }

    let url;
    let payloadEncryption;
    url = this.ENDPOINT_HPNV2_POST;
    payloadEncryption = await prepareEndToEndEncryptionIfNeeded();

    if (instant) {
      try {
        const { timeoutInMs, isExpired } = toRelativeTimeout(absoluteTimeout);
        if (isExpired) {
          throw new MsgTimeoutError(
            "dropping request because the absolute timeout expired"
          );
        }

        const response = await myfetch(url, {
          method: "POST",
          body: msg,
          payloadEncryption,
          timeoutInMs,
        });
        let data = new Uint8Array(await response.arrayBuffer());
        if (data[0] !== 0x7b) {
          const size = new DataView(data.buffer).getUint32();
          data = inflate(data.subarray(4, 4 + size));
        }
        const { status, body } = JSON.parse(fromUTF8(data));
        return new Response(body, { status });
      } catch (e) {
        if (e instanceof ServerError) {
          throw e;
        }
        throw new TransportError(e.message);
      }
    }

    // non-instance message
    const pendingSend = new Promise((resolve, reject) => {
      this.messages.push({
        url,
        msg,
        originalMsg,
        cnt: 0,
        payloadEncryption,
        resolve,
        reject,
        absoluteTimeout,
      });
    });
    this._scheduleSend();

    // The server response is not too interesting, as it will always confirm
    // with an empty response. Still, waiting for the response is useful
    // to make sure that the server got the message, also we only will
    // know for sure that the network request was successful.
    await pendingSend;
    return new Response();
  }

  async join(body) {
    const response = await myfetch(this.ENDPOINT_HPNV2_JOIN, {
      method: "POST",
      body,
    });
    return response.json();
  }

  // By default all fields will be requested, but you can pass
  // a comma separated list of list of required fields.
  //
  // Advantages:
  // less traffic and better cache behavior (especially
  // dropping the timestamp fields is important).
  async getConfig(fields) {
    let url = this.ENDPOINT_HPNV2_CONFIG;
    if (fields) {
      url += `?fields=${fields}`;
    }
    return (await myfetch(url, { cache: "default" })).text();
  }

  async getServerTimestamp() {
    const response = await myfetch(`${this.ENDPOINT_HPNV2_CONFIG}?fields=ts`);
    const { ts } = await response.json();
    return ts;
  }

  unload() {
    pacemaker.clearTimeout(this.sendTimer);
    this._reset();
    this.unloaded = true;
  }
}
