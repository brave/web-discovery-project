/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* eslint-disable no-bitwise */
/* eslint-disable no-param-reassign */
/* eslint-disable no-plusplus */

import { toBase64, fromBase64 } from "../encoding";
import DynamicDataView from "../helpers/dynamic-data-view";

function bytesToEncode(len) {
  let sum = len + 1;
  if (len < 1 << 7) {
    sum += 1;
  } else if (len < 1 << 8) {
    sum += 2;
  } else if (len < 1 << 16) {
    sum += 3;
  } else if (len < 1 << 24) {
    sum += 4;
  } else if (len <= 2147483647) {
    // < 2**31
    sum += 5;
  } else {
    throw new Error(`value too big ${len}`);
  }
  return sum;
}

function pushLength(buffer, len) {
  if (len < 1 << 7) {
    buffer.pushByte(len);
  } else if (len < 1 << 8) {
    buffer.pushByte(0x81);
    buffer.pushByte(len);
  } else if (len < 1 << 16) {
    buffer.pushByte(0x82);
    buffer.pushByte(len >> 8);
    buffer.pushByte(len & 0xff);
  } else if (len < 1 << 24) {
    buffer.pushByte(0x83);
    buffer.pushByte(len >> 16);
    buffer.pushByte((len >> 8) & 0xff);
    buffer.pushByte(len & 0xff);
  } else if (len <= 2147483647) {
    // < 2**31
    buffer.pushByte(0x84);
    buffer.pushByte(len >> 24);
    buffer.pushByte((len >> 16) & 0xff);
    buffer.pushByte((len >> 8) & 0xff);
    buffer.pushByte(len & 0xff);
  } else {
    throw new Error(`value too big ${len}`);
  }
}

function fromBase64url(data) {
  data = data.replace(/-/g, "+").replace(/_/g, "/");
  const pads = (4 - (data.length % 4)) % 4;
  if (pads === 3) {
    throw new Error(`illegal base64 string: ${data}`);
  }
  for (let i = 0; i < pads; i++) {
    data += "=";
  }
  return data;
}

function padIfSigned(array) {
  if (array[0] & 0x80) {
    const newArray = new Uint8Array(array.length + 1);
    newArray[0] = 0;
    newArray.set(array, 1);
    return newArray;
  }
  return array;
}

/* RSAPublicKey ::= SEQUENCE {
    modulus           INTEGER,  -- n
    publicExponent    INTEGER   -- e
} */

/* SEQUENCE(2 elem)
    SEQUENCE(2 elem)
        OBJECT IDENTIFIER 1.2.840.113549.1.1.1
        NULL
    BIT STRING(1 elem)
        SEQUENCE(2 elem)
            INTEGER(2048 bit) n
            INTEGER e
*/
export function exportPublicKey(key) {
  const origValues = [key.n, key.e];
  const values = origValues.map((x) =>
    padIfSigned(fromBase64(fromBase64url(x)))
  );
  const numBytes = values.reduce((a, x) => a + bytesToEncode(x.length), 0);

  const buffer = new DynamicDataView(2000);

  buffer.pushByte(0x30); // SEQUENCE
  pushLength(buffer, bytesToEncode(bytesToEncode(numBytes) + 1) + 15);

  buffer.pushBytes(
    new Uint8Array([
      0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01,
      0x01, 0x05, 0x00,
    ])
  );
  buffer.pushByte(0x03); // BIT STRING
  pushLength(buffer, bytesToEncode(numBytes) + 1);
  buffer.pushByte(0x00);

  buffer.pushByte(0x30); // SEQUENCE
  pushLength(buffer, numBytes);

  values.forEach((x) => {
    buffer.pushByte(0x02); // INTEGER
    pushLength(buffer, x.length);
    buffer.pushBytes(x);
  });
  return toBase64(buffer.crop());
}
