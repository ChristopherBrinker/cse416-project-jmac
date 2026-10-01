import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import next from "ultracite/oxlint/next";
import react from "ultracite/oxlint/react";

export default defineConfig({
  extends: [core, react, next],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    "**/convex/_generated/**",
    "**/src/env.ts",
    "**/.next/**",
  ],
  overrides: [
    {
      files: [
        "packages/backend/convex/privateData.ts",
        "packages/backend/convex/healthCheck.ts",
      ],
      rules: { "unicorn/filename-case": "off" },
    },
    {
      files: ["packages/ui/src/components/**"],
      rules: {
        "jsx-a11y/prefer-tag-over-role": "off",
        "jsx-a11y/label-has-associated-control": "off",
        "unicorn/prefer-export-from": "off",
      },
    },
  ],
  rules: {
    "func-style": "off",
    "react/function-component-definition": "off",
    "sort-keys": "off",
  },
});
