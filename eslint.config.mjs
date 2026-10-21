/**
 * ESLint flat config.
 *
 * The project had no ESLint config at all and `npm run lint` ran `next lint`,
 * which Next.js 16 removed — so linting has never actually run here. ESLint 9
 * also defaults to flat config and ignores `.eslintrc.*`.
 *
 * `eslint-config-next@16` already exports flat-config ARRAYS from
 * ./core-web-vitals and ./typescript, so these spread in directly; the
 * `FlatCompat` shim that older guides use is not needed.
 *
 * Deliberately minimal: this adopts Next's own recommended rules and adds no
 * house style of its own. Turning a first-time lint run into a formatting
 * sweep would bury real findings in noise.
 */
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "next-env.d.ts",
      "tsconfig.tsbuildinfo",
      // Standalone Node assertion scripts, not part of the Next build. They
      // are plain ESM run directly by node and share none of the app's config.
      "scripts/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
];

export default config;
