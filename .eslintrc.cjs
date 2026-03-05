module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module"
  },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "fs",
            importNames: ["readFileSync", "writeFileSync", "appendFileSync", "readdirSync"],
            message: "Phase 1 contract forbids blocking I/O. Use fs/promises with async/await."
          },
          {
            name: "node:fs",
            importNames: ["readFileSync", "writeFileSync", "appendFileSync", "readdirSync"],
            message: "Phase 1 contract forbids blocking I/O. Use node:fs/promises with async/await."
          }
        ]
      }
    ],
    "@typescript-eslint/no-explicit-any": "error"
  },
  ignorePatterns: ["dist", "node_modules"]
};
