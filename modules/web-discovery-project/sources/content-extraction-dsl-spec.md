# Web Discovery Project Content Extraction DSL Specification

## Overview

The Content Extraction DSL is a JSON-based domain-specific language designed to extract structured data from web pages, particularly search engine results pages. It provides a declarative way to define extraction rules without writing custom code for each target website.

## File Structure

The DSL is organized as a JSON object where each top-level key represents a rule set for a specific type of web page:

```json
{
  "search-go": { /* Rules for Google Search */ },
  "search-goi": { /* Rules for Google Image Search */ },
  "search-gov": { /* Rules for Google Video Search */ },
  "search-am": { /* Rules for Amazon Search */ },
  "search-bi": { /* Rules for Bing Search */ },
  "search-bii": { /* Rules for Bing Image Search */ }
}
```

Each rule set contains two main sections:
- `input`: Defines what content to extract from the page
- `output`: Defines how to structure the extracted data

## Input Rules

Input rules define selectors and transformations to extract data from web pages.

### Structure

```json
"input": {
  "<CSS selector>": {
    "<selection mode>": {
      "<field name>": {
        // Extraction rules
      }
    }
  }
}
```

### Selection Modes

- `first`: Extract only the first matching element
- `all`: Extract all matching elements

### Extraction Methods

- `select`: CSS selector to find elements within the matched element
- `attr`: HTML attribute to extract (e.g., "textContent", "href", "data-pcu")
- `firstMatch`: Try multiple extraction rules in order until one succeeds
- `transform`: Apply transformations to the extracted value

Example:
```json
"q": {
  "select": "#rso",
  "attr": "data-async-context",
  "transform": [
    ["trySplit", "query:", 1],
    ["decodeURIComponent"]
  ]
}
```

### Transformations

Transformations are arrays of operations to apply to extracted values:

| Transformation | Description | Example |
|----------------|-------------|---------|
| `trySplit` | Split string by delimiter and take a specific part | `["trySplit", "query:", 1]` |
| `decodeURIComponent` | URL-decode the string | `["decodeURIComponent"]` |
| `tryDecodeURIComponent` | Try to URL-decode, but don't fail if invalid | `["tryDecodeURIComponent"]` |
| `filterExact` | Match against an array of allowed values | `["filterExact", ["en", "fr", "de"]]` |
| `json` | Parse JSON and extract a specific field | `["json", "t"]` |
| `maskU` | Mask/sanitize URLs | `["maskU"]` |
| `relaxedMaskU` | Less strict URL masking | `["relaxedMaskU"]` |
| `queryParam` | Extract a query parameter from a URL | `["queryParam", "gl"]` |
| `removeParams` | Remove specific query parameters from a URL | `["removeParams", ["utm_source", "ref_"]]` |
| `requireURL` | Verify that a URL is well-formed | `["requireURL", "https://example.com"]` |
| `split` | Split string by delimiter | `["split", "•", 0]` |
| `trim` | Remove whitespace | `["trim"]` |

## Output Rules

Output rules define how to structure the extracted data into meaningful records.

### Structure

```json
"output": {
  "<record type>": {
    "fields": [
      {
        "key": "<field name>",
        "source": "<CSS selector>",
        "requiredKeys": ["<required subfields>"],
        "optional": true|false
      }
    ]
  }
}
```

### Field Properties

- `key`: Name of the field in the output
- `source`: CSS selector reference from the input section
- `requiredKeys`: Subfields that must be present for the record to be valid
- `optional`: Whether the field is optional (default: false)

Example:
```json
"query": {
  "fields": [
    {
      "key": "r",
      "source": "div#rso div.g:not(:has(div.g))",
      "requiredKeys": ["t", "u"]
    },
    {
      "key": "q",
      "source": "#search"
    },
    {
      "key": "qurl"
    },
    {
      "key": "ctry"
    },
    {
      "key": "lang",
      "source": "html[lang]",
      "optional": true
    }
  ]
}
```

## Common Extraction Patterns

### Search Results

Extracts organic search results with titles and URLs:
```json
"div#rso div.g:not(:has(div.g))": {
  "all": {
    "t": {
      "select": "a > br + h3, g-section-with-header g-link > a > h3",
      "attr": "textContent"
    },
    "u": {
      "select": "div.yuRUbf > div > span > a[jsname]",
      "attr": "href",
      "transform": [
        ["trySplit", "?ref_src=twsrc", 0],
        ["tryDecodeURIComponent"]
      ]
    }
  }
}
```

### Advertisements

Extracts sponsored results with different formats:
```json
"#tads div[data-text-ad]": {
  "all": {
    "u": {
      "firstMatch": [
        {
          "select": "a.sVXRqc[data-pcu][href^=\"https://www.googleadservices.com/\"]",
          "attr": "data-pcu",
          "transform": [
            ["trySplit", ",", 0],
            ["maskU"]
          ]
        },
        {
          "select": "a.sVXRqc",
          "attr": "href",
          "transform": [
            ["removeParams", ["utm_source", "utm_medium"]],
            ["trySplit", "#", 0],
            ["relaxedMaskU"]
          ]
        }
      ]
    },
    "t": {
      "select": "a.sVXRqc > div.CCgQ5[role='heading'] > span",
      "attr": "textContent"
    }
  }
}
```

### Knowledge Panels

Extracts structured information about entities:
```json
"#rhs[role=\"complementary\"] div.wDYxhc[data-attrid^=\"kc:/\"]": {
  "all": {
    "prop": {
      "select": "div.rVusze > span.w8qArf:nth-child(1)",
      "attr": "textContent",
      "transform": [
        ["split", ": ", 0]
      ]
    },
    "val": {
      "select": "div.rVusze > span:nth-child(2)",
      "attr": "textContent"
    }
  }
}
```

## Special Features

1. **Language Detection**: Extract and filter page language
2. **Query Extraction**: Extract the search query from various elements
3. **Snippet Extraction**: Extract featured snippets and answer boxes
4. **Table Extraction**: Extract tabular data with row/column structure
5. **Place Information**: Extract location data including addresses and coordinates

## Example Rule Sets

The DSL includes rule sets for various search engines:

1. **Google Search** (`search-go`): Extracts organic results, ads, knowledge panels, etc.
2. **Google Image Search** (`search-goi`): Extracts image results with thumbnails and source URLs
3. **Google Video Search** (`search-gov`): Extracts video results with metadata
4. **Amazon Search** (`search-am`): Extracts product listings
5. **Bing Search** (`search-bi`): Extracts organic results
6. **Bing Image Search** (`search-bii`): Extracts image results

## Usage

This DSL is used by the Web Discovery Project's content extractor to parse web pages and extract structured data. The rules can be updated independently of the extraction engine to adapt to changes in website structures.
