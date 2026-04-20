import * as mdxPlugin from "eslint-plugin-mdx";
import reactPlugin from "eslint-plugin-react";

import defaultConfig from "./eslint.config.js";

const config = [
  ...defaultConfig,
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    ...reactPlugin.configs.flat.recommended,
    rules: {
      ...reactPlugin.configs.flat.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/no-unescaped-entities": "off",
      "react/self-closing-comp": "error",
      "react/jsx-curly-brace-presence": "error",
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  mdxPlugin.flat,
];

export default config;
