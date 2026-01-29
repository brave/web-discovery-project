import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import babelParser from "@babel/eslint-parser";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all,
});

export default defineConfig([
    globalIgnores([
        "modules/web-discovery-project/sources/web-discovery-project.es",
        "modules/core/dist/EventUtils.js",
        "specific/node/index.js",
        "**/build/",
    ]),
    {
        extends: compat.extends(
            "eslint:recommended",
            "plugin:compat/recommended",
            "prettier"
        ),

        languageOptions: {
            globals: {
                ...globals.browser,
                ...Object.fromEntries(
                    Object.entries(globals.commonjs).map(([key]) => [
                        key,
                        "off",
                    ])
                ),
                ...globals.mocha,
                ...globals.node,
                ...globals["shared-node-browser"],
                ...globals.webextensions,
                ...globals.worker,
            },

            parser: babelParser,
            ecmaVersion: 5,
            sourceType: "commonjs",

            parserOptions: {
                requireConfigFile: false,
            },
        },

        rules: {
            "compat/compat": "error",
            "import/extensions": "off",
            "no-underscore-dangle": "off",
            "import/no-unresolved": "off",
            "no-restricted-globals": ["error", "Worker"],
        },
    },
    {
        files: ["**/*.ts"],

        extends: compat.extends(
            "eslint:recommended",
            "plugin:compat/recommended",
            "plugin:@typescript-eslint/recommended",
            "plugin:@typescript-eslint/recommended-requiring-type-checking"
        ),

        plugins: {
            "@typescript-eslint": typescriptEslint,
        },

        languageOptions: {
            parser: tsParser,
            ecmaVersion: 5,
            sourceType: "script",

            parserOptions: {
                project: "./tsconfig.json",
            },
        },

        rules: {
            "lines-between-class-members": "off",
            "@typescript-eslint/no-unsafe-call": "off",
            "@typescript-eslint/no-unsafe-member-access": "off",
            "@typescript-eslint/no-unsafe-assignment": "off",
            "@typescript-eslint/no-unsafe-return": "off",
            "@typescript-eslint/restrict-template-expressions": "off",
            "@typescript-eslint/no-unsafe-argument": "off",
            "@typescript-eslint/no-explicit-any": "off",
        },
    },
    {
        ignores: [
            "modules/web-discovery-project/sources/web-discovery-project.es",
            "modules/core/dist/EventUtils.js",
            "specific/node/index.js",
            "build/",
        ],
    },
]);
