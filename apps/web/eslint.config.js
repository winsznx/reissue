import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

import rootConfig from "../../eslint.config.js";

export default tseslint.config(
  ...rootConfig,
  { ignores: ["next-env.d.ts", "playwright-report/**", "test-results/**"] },
  nextPlugin.configs["core-web-vitals"],
  reactHooks.configs.flat.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
    },
  },
);
