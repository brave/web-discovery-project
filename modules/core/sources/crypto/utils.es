/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import crypto from "../../platform/crypto";
import {
  toBase64,
  fromBase64,
  toHex,
  fromHex,
  toUTF8,
} from "../encoding";

import { exportPublicKey } from "./pkcs-conversion";

function fromByteArray(data, format) {
  if (format === "hex") {
    return toHex(data);
  }
  if (format === "b64") {
    return toBase64(data);
  }
  return data;
}

function toByteArray(data, format) {
  if (format === "hex") {
    return fromHex(data);
  }
  if (format === "b64") {
    return fromBase64(data);
  }
  return data;
}

function fromArrayBuffer(data, format) {
  return fromByteArray(new Uint8Array(data), format);
}

function toArrayBuffer(data, format) {
  return toByteArray(data, format).buffer;
}

async function hash(algo, str, format = "hex") {
  return crypto.subtle
    .digest(algo, typeof str === "string" ? toUTF8(str) : str)
    .then((h) => fromArrayBuffer(h, format));
}

async function sha256(str, format = "hex") {
  return hash("SHA-256", str, format);
}

async function importAESKey(key) {
  return crypto.subtle.importKey(
    "raw",
    toArrayBuffer(key, "hex"),
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

async function encryptAES(data, key, iv) {
  return Promise.all([
    iv || crypto.getRandomValues(new Uint8Array(12)),
    typeof key === "string" ? importAESKey(key) : key,
  ]).then(([_iv, _key]) =>
    crypto.subtle
      .encrypt({ name: "AES-GCM", iv: _iv }, _key, data)
      .then((encrypted) => [
        fromArrayBuffer(_iv, "b64"),
        fromArrayBuffer(encrypted, "b64"),
      ])
  );
}

async function decryptAES(encrypted, key) {
  let iv = encrypted[0];
  let encryptedMsg = encrypted[1];
  iv = new Uint8Array(toArrayBuffer(iv, "b64"));
  encryptedMsg = toArrayBuffer(encryptedMsg, "b64");
  return Promise.resolve()
    .then(() => (typeof key === "string" ? importAESKey(key) : key))
    .then((importedKey) =>
      crypto.subtle.decrypt({ name: "AES-GCM", iv }, importedKey, encryptedMsg)
    );
}

async function importRSAKey(
  pk,
  pub = true,
  h = "SHA-256",
  algorithm = "RSA-OAEP"
) {
  let uses;
  if (pub) {
    if (algorithm === "RSA-OAEP") {
      uses = ["wrapKey", "encrypt"];
    } else {
      uses = ["verify"];
    }
  } else if (algorithm === "RSA-OAEP") {
    uses = ["unwrapKey", "decrypt"];
  } else {
    uses = ["sign"];
  }
  return crypto.subtle.importKey(
    pub ? "spki" : "pkcs8",
    fromBase64(pk),
    {
      name: algorithm,
      hash: { name: h },
    },
    true,
    uses
  );
}

async function sha1(s) {
  return hash("SHA-1", s);
}

async function generateRSAKeypair(bits = 2048, hashName = "SHA-256") {
  return crypto.subtle
    .generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: bits,
        publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
        hash: { name: hashName },
      },
      true,
      ["sign", "verify"]
    )
    .then((key) =>
      Promise.all([
        crypto.subtle.exportKey("spki", key.publicKey).then(toBase64),
        crypto.subtle.exportKey("pkcs8", key.privateKey).then(toBase64),
      ])
    );
}

async function signRSA(privateKey, data) {
  const _data = typeof data === "string" ? toUTF8(data) : data;
  return toHex(
    await crypto.subtle.sign(
      { name: "RSASSA-PKCS1-v1_5", hash: { name: "SHA-256" } },
      privateKey,
      _data
    )
  );
}

export {
  hash,
  sha256,
  toByteArray,
  encryptAES,
  decryptAES,
  importRSAKey,
  sha1,
  exportPublicKey,
  generateRSAKeypair,
  signRSA,
};
