#!/usr/bin/env sh

yarn build-module
# Remove "webextension-polyfill" references which require an app to be run as a web-extension
find ../../../../build/platform -name "*.js" -type f \
    | xargs -I {} sed -i "" "s/require(\"webextension-polyfill\")/null/g" {}
./generate-fixtures.js
