import base from "@cyberash-dev/dev-tooling/eslint.base.mjs";

/* Underscore-prefixed identifiers are the repo's "intentionally unused" marker
   (interface-conformance params like `_input`, throwaway `_`); honour it for
   no-unused-vars everywhere rather than deleting conformance params. */
const ALLOW_UNDERSCORE_UNUSED = {
	rules: {
		"@typescript-eslint/no-unused-vars": [
			"error",
			{
				argsIgnorePattern: "^_",
				varsIgnorePattern: "^_",
				caughtErrorsIgnorePattern: "^_",
				destructuredArrayIgnorePattern: "^_",
			},
		],
	},
};

/* Test files relax rules whose value targets shipped code, not the hand-rolled
   test harness: JSON/HTTP boundaries need narrowing assertions, stub adapters
   expose async signatures with no await, suites emit result JSON to stdout, and
   suite bodies run long. comment-policy stays on for tests. */
const TEST_FILES = ["**/tests/**/*.ts", "**/*.test.ts"];

export default [
	...base,
	ALLOW_UNDERSCORE_UNUSED,
	{
		files: TEST_FILES,
		rules: {
			"@typescript-eslint/no-unsafe-type-assertion": "off",
			"@typescript-eslint/no-non-null-assertion": "off",
			"@typescript-eslint/require-await": "off",
			"@typescript-eslint/naming-convention": "off",
			"@typescript-eslint/no-require-imports": "off",
			"max-lines-per-function": "off",
			"id-denylist": "off",
			"no-console": "off",
		},
	},
];
