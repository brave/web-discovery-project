import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import babelParser from "@babel/eslint-parser";
import tsEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jsEslint from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: jsEslint.configs.recommended,
    allConfig: jsEslint.configs.all,
});

export default defineConfig([
    globalIgnores([
        "modules/web-discovery-project/sources/web-discovery-project.es",
        "modules/core/dist/EventUtils.js",
        "specific/node/index.js",
        "**/build/",
    ]),
    {
        files: ["./{modules,tests}/**/*.{js,es}"],

        extends: [
            jsEslint.configs.recommended,
        ],

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
            ecmaVersion: 6,
            sourceType: "module",

            parserOptions: {
                requireConfigFile: false,
            },
        },

        linterOptions: {
            reportUnusedDisableDirectives: false,
        },
        rules: {
            "import/extensions": "off",
            "import/no-unresolved": "off",
            "no-restricted-globals": ["error", "Worker"],
            "no-underscore-dangle": "off",
            "no-unused-vars": "off",
        },
    },
    {
        files: ["./{modules,tests}/**/*.ts"],

        plugins: {
            "@typescript-eslint": tsEslint,
        },

        languageOptions: {
            parser: tsParser,
            ecmaVersion: 6,
            sourceType: "module",

            parserOptions: {
                project: path.resolve(__dirname, "tsconfig.json"),
                tsconfigRootDir: __dirname,
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
]);
