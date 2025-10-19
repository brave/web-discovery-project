export function parse(url) {
  try {
    return new URL(url);
  } catch (e) {
    return null;
  }
}

/**
 * split0(str, on) === str.split(on)[0]
 */
function split0(str, on) {
  const pos = str.indexOf(on);
  return pos < 0 ? str : str.slice(0, pos);
}

/**
 * Given a URL and a list of query parameters, it returns an
 * equivalent URL, but with those query parameters removed.
 *
 * Note: this function will not do any decoding. Instead, it will try
 * to preserve the original URL as best as it can (e.g. the invalid URL
 * "https://example.test?q=x y" will not be normalized to the valid URL
 * "https://example.test/?q=x%20y").
 */
export function removeQueryParams(url, queryParams) {
  const searchStart = url.indexOf("?");
  if (searchStart === -1) {
    return url;
  }
  const searchEnd = url.indexOf("#", searchStart + 1);
  const search =
    searchEnd === -1
      ? url.slice(searchStart + 1)
      : url.slice(searchStart + 1, searchEnd);
  if (!search) {
    return url;
  }
  const parts = search
    .split("&")
    .filter((x) => !queryParams.includes(split0(x, "=")));
  const beforeSearch = url.slice(0, searchStart);

  const hash = searchEnd === -1 ? "" : url.slice(searchEnd);
  if (parts.length === 0) {
    return beforeSearch + hash;
  } else {
    return `${beforeSearch}?${parts.join("&")}${hash}`;
  }
}
