import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const config = {
  endOfLine: "lf",
  tabWidth: 2,
  printWidth: 100,
  plugins: [
    require.resolve("prettier-plugin-packagejson"),
    require.resolve("prettier-plugin-tailwindcss"),
  ],

  // tailwindcss plugin
  tailwindFunctions: ["cva", "clsx", "cn"],
};

export default config;
