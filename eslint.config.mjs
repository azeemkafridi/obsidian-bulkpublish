// eslint.config.mjs
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import { DEFAULT_BRANDS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js";

export default defineConfig([
	{
		ignores: ["main.js", "node_modules/**", "tests/**", "esbuild.config.mjs"],
	},
	...tseslint.configs.recommendedTypeChecked,
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.mjs"],
				},
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"obsidianmd/ui/sentence-case": [
				"warn",
				{
					// Our product name, and Obsidian's own "Settings" screen.
					brands: [...DEFAULT_BRANDS, "BulkPublish", "Settings"],
					// Example input values, a link that continues a sentence after
					// a dash ("Published — view post"), and text naming our web
					// address, which the brand rule would otherwise re-case.
					ignoreRegex: ["^bp_", "^x, linkedin$", "^view post$", "app\\.bulkpublish\\.com"],
				},
			],
		},
	},
]);
