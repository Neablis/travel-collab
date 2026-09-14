import base from "./eslint.config.mjs";
export default [...base, { files: ["src/app/**"], rules: { "no-restricted-imports": ["error", { patterns: [{ group: ["@tc/predict"], message: "fixture" }] }] } }];
