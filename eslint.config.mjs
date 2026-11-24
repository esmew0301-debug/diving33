import next from "eslint-config-next";

const config = [
  ...next,
  { ignores: [".next/**", ".next-e2e/**", ".next-qa/**", "node_modules/**", ".data/**", "playwright-report/**", "test-results/**"] },
];

export default config;
