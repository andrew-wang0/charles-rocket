import { globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

import reactConfig from "./eslint.config.react.js";

const config = [
  ...nextVitals,
  ...nextTs,
  ...reactConfig,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
];

export default config;
