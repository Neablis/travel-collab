import base from "./eslint.config.mjs";
export default [...base, { files: ["e2e/**/*.ts"], rules: { "playwright/expect-expect": "off" } }, { files: ["src/**/*.test.{ts,tsx}"], rules: { "testing-library/no-container": "off" } }];
