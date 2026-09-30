// ESLint flat config for the whole monorepo: TypeScript everywhere, Next.js + React + accessibility (jsx-a11y)
// rules for apps/web. Run with `pnpm lint` (each package's lint script) or `pnpm exec eslint .` from the root.
import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/out/**", "**/*.tsbuildinfo", "**/next-env.d.ts", "e2e/demo-videos/out/**", "storage/**", "apps/web/public/scan-sw.js"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_", caughtErrors: "none" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  // Web app: Next.js core web vitals (includes React, hooks and jsx-a11y plugins) plus the full jsx-a11y
  // recommended set, as errors, for WCAG AA on public pages and the ticket view (SPEC §7).
  ...nextVitals.map((c) => ({ ...c, files: ["apps/web/**/*.{ts,tsx,js,jsx}"] })),
  {
    files: ["apps/web/**/*.{ts,tsx,js,jsx}"],
    languageOptions: { globals: { ...globals.browser } },
    settings: { next: { rootDir: "apps/web" } },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // Labels in this app wrap their inputs; the rule's default wants both nesting and htmlFor.
      // PasswordInput renders a real <input> (components/staff/password-input.tsx).
      "jsx-a11y/label-has-associated-control": ["error", { assert: "either", depth: 3, controlComponents: ["PasswordInput"] }],
      // React Compiler advice (new in eslint-plugin-react-hooks 6): useful, but not bugs. The scanner's effects
      // are deliberate (sync timers, online/offline); keep them visible as warnings rather than rewrite it now.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      // Plain <img> is intentional: media is served from our own /media route, not next/image.
      "@next/next/no-img-element": "off",
    },
  },
  {
    // CommonJS config files (PM2).
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: { ...globals.node } },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: ["**/*.test.ts", "**/test/**", "e2e/**", "**/scripts/**"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
);
