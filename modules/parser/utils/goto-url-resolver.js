// Resolves Google "/goto?url=TOKEN" redirect links to their real URLs.
//
// Google protects most result URLs behind redirect links like
//
//   /goto?url=CAESZAHrOzAVb1atHhwqC5PmCod7HpfgxcRW[..]
//
// <script> blocks leak the real URLs in the JSON array element immediately
// following each goto link:
//
//   "/goto?url\u003dTOK"],["https://real-url.com","Title","Desc",...
//
// The resolver scans <script> tags for this pattern, building a
// (goto token -> real URL) map that resolveGotoUrlsInHtml uses to rewrite
// the rendered DOM hrefs before the page is parsed.

const GOTO_HREF_PREFIX = "/goto?url=";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,}$/;

// Matches goto hrefs as they appear in the rendered DOM (only literal "="
// and "%3D"; script-tag escapes are intentionally not matched here to avoid
// rewriting data inside JSON structures).
const GOTO_HREF_RE = /\/goto\?url(?:=|%3[dD])([A-Za-z0-9_-]{20,})/g;

const SCRIPT_RE = /<script[^>]*>([\s\S]*?)<\/script>/g;

// --- String extraction helpers ---

// Extracts a JS-quoted string starting at content[pos] (must be a double
// quote). Skips \\-escaped characters. Returns the inner string (without
// quotes) or null if the string is not properly closed.
function extractQuotedString(content, pos) {
    if (content[pos] !== '"') {
        return null;
    }
    let end = pos + 1;
    while (end < content.length) {
        if (content[end] === "\\") {
            end += 2;
            continue;
        }
        if (content[end] === '"') {
            return content.slice(pos + 1, end);
        }
        end += 1;
    }
    return null;
}

// Returns the position just past the closing quote of the string at pos,
// or -1 if the string is not properly closed.
function skipQuotedString(content, pos) {
    if (content[pos] !== '"') {
        return -1;
    }
    let end = pos + 1;
    while (end < content.length) {
        if (content[end] === "\\") {
            end += 2;
            continue;
        }
        if (content[end] === '"') {
            return end + 1;
        }
        end += 1;
    }
    return -1;
}

// Unescapes the JS string escapes that appear in Google's script data:
// \u003d / \u003D → "=", \u0026 → "&", \x3d / \x3D → "=".
function unescapeStr(s) {
    return s
        .replace(/\\u003[dD]/g, "=")
        .replace(/\\u0026/g, "&")
        .replace(/\\x3[dD]/g, "=");
}

// --- Token / URL helpers ---

export function extractToken(url) {
    if (!url || !url.startsWith(GOTO_HREF_PREFIX)) {
        return null;
    }
    let token = url.slice(GOTO_HREF_PREFIX.length);

    const ampPos = token.indexOf("&");
    if (ampPos !== -1) {
        token = token.slice(0, ampPos);
    }

    for (;;) {
        if (token.endsWith("%3D") || token.endsWith("%3d")) {
            token = token.slice(0, -3);
        } else if (token.endsWith("=")) {
            token = token.slice(0, -1);
        } else {
            break;
        }
    }

    return TOKEN_PATTERN.test(token) ? token : null;
}

export function resolveUrl(url, mapping) {
    const token = extractToken(url);
    return token ? mapping.get(token) ?? null : null;
}

// --- Script scanning (positional, not regex-based) ---

// After a goto string's closing quote, checks if the next characters are
// ],[" followed by a quoted string starting with http(s)://. If so, returns
// the real URL. Handles the common JSON array layout:
//   "...goto..."],["https://real.com","Title",...
function extractAdjacentUrl(content, strEnd) {
    let pos = strEnd;
    while (pos < content.length) {
        const ch = content[pos];
        if (ch === " " || ch === "\n" || ch === "\t" || ch === "\r") {
            pos++;
            continue;
        }
        break;
    }

    if (content.slice(pos, pos + 3) !== "],[") {
        return null;
    }
    pos += 3;

    if (content[pos] !== '"') {
        return null;
    }

    const raw = extractQuotedString(content, pos);
    if (!raw) {
        return null;
    }

    const unescaped = unescapeStr(raw);
    if (unescaped.startsWith("https://") || unescaped.startsWith("http://")) {
        return unescaped;
    }
    return null;
}

// Collects goto tokens from one script block and resolves them via adjacent
// URL pairs. First mapping wins (existing entries are not overwritten).
function scanScript(content, mapping) {
    let pos = content.indexOf('"/goto?url');
    while (pos !== -1) {
        const raw = extractQuotedString(content, pos);
        if (raw) {
            const strEnd = pos + 1 + raw.length + 1;
            const unescaped = unescapeStr(raw);

            // Extract the token from the goto URL
            try {
                const url = new URL(unescaped, "https://www.google.com");
                const token = url.searchParams.get("url");
                if (token && TOKEN_PATTERN.test(token) && !mapping.has(token)) {
                    const adjUrl = extractAdjacentUrl(content, strEnd);
                    if (adjUrl) {
                        mapping.set(token, adjUrl);
                    }
                }
            } catch {
                const token = extractToken(unescaped);
                if (token && !mapping.has(token)) {
                    const adjUrl = extractAdjacentUrl(content, strEnd);
                    if (adjUrl) {
                        mapping.set(token, adjUrl);
                    }
                }
            }
        }
        pos = content.indexOf('"/goto?url', pos + 1);
    }
}

// --- Public API ---

export function buildGotoUrlMap(html) {
    const mapping = new Map();
    let match;
    SCRIPT_RE.lastIndex = 0;
    while ((match = SCRIPT_RE.exec(html)) !== null) {
        scanScript(match[1], mapping);
    }
    return mapping;
}

function escapeHtmlAttr(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;");
}

export function resolveGotoUrlsInHtml(html, mapping) {
    if (mapping.size === 0) {
        return html;
    }
    return html.replace(GOTO_HREF_RE, (full, token) => {
        const real = mapping.get(token);
        return real ? escapeHtmlAttr(real) : full;
    });
}

export function resolveGotoUrls(html) {
    const mapping = buildGotoUrlMap(html);
    return resolveGotoUrlsInHtml(html, mapping);
}
