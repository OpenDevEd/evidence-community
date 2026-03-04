import { defineConfig } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([{
    extends: [...nextCoreWebVitals, ...nextTypescript],

	rules: {
		"@typescript-eslint/no-unused-vars": "off",
		"@typescript-eslint/no-explicit-any": "off",
		"@typescript-eslint/no-require-imports": "off",
		"react-hooks/exhaustive-deps": "off",
		"react-hooks/immutability": "off",
		"react-hooks/preserve-manual-memoization": "off",
		"react-hooks/purity": "off",
		"react-hooks/refs": "off",
		"react-hooks/set-state-in-effect": "off",
		"react-hooks/static-components": "off",
		"no-var": "off",
	},
}]);
