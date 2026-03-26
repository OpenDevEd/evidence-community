#!/usr/bin/env node
/**
 * buildGapMap.js
 *
 * Takes a stock EPPI Mapper HTML export and produces a customized version
 * using the FCDO gap map as the design template.
 *
 * Usage:
 *   node tools/buildGapMap.js <stock-eppi-file.html> [output-name]
 *
 * Examples:
 *   node tools/buildGapMap.js ~/Downloads/my-new-gapmap.html
 *   node tools/buildGapMap.js ~/Downloads/my-new-gapmap.html custom-slug
 *
 * What it does:
 *   1. Reads the FCDO template (the customized gap map with all CSS/JS enhancements)
 *   2. Reads the stock EPPI Mapper export
 *   3. Extracts data variables, logos, title, and colors from the stock file
 *   4. Injects them into the FCDO template
 *   5. Writes the result to public/gapmaps/{index}/
 *   6. Updates the LABEL_MAP in src/lib/gapmaps.ts
 *
 * The FCDO template provides: Montserrat font, warm color palette, search strip,
 * animated drawers, pre-computed cell indexes, event delegation, and all other
 * CSS/JS customizations over the stock EPPI Mapper.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const GAPMAPS_DIR = path.join(ROOT, "public", "gapmaps");
const TEMPLATE_NAME = "fcdo-evaluation-evidence.html";
const GAPMAPS_TS = path.join(ROOT, "src", "lib", "gapmaps.ts");

// --- Data variable prefixes ---
// Each entry: [prefix to match, distinguisher character]
// The distinguisher prevents matching function-local declarations like
// `const csvData = convertReferencesToCSV(...)` instead of the data blob.
const DATA_VARIABLES = [
	{ prefix: "const csvData = ", startsWith: "{" },
	{ prefix: "const filters = ", startsWith: "[" },
	{ prefix: "const externalURLedAttributes = ", startsWith: "[" },
	{ prefix: "const segmentAttributes = ", startsWith: "[" },
	{ prefix: "const referenceData = ", startsWith: "[" },
	{ prefix: "const aboutContent = ", startsWith: '"' },
	{ prefix: "const title = ", startsWith: '"' },
];

// Config variables to carry over from the stock file (extracted and injected by exact prefix)
const CONFIG_VARIABLES = [
	"const topHeaderColors = ",
	"const sideHeaderColors = ",
];

// ---- Helpers ----

function findLine(lines, prefix, startsWith) {
	for (const line of lines) {
		const stripped = line.trimStart();
		if (stripped.startsWith(prefix)) {
			const valueStart = stripped.slice(prefix.length).trimStart();
			if (!startsWith || valueStart.startsWith(startsWith)) {
				return line;
			}
		}
	}
	return null;
}

function findLineValue(lines, prefix) {
	for (const line of lines) {
		const stripped = line.trimStart();
		if (stripped.startsWith(prefix)) {
			return stripped;
		}
	}
	return null;
}

function extractLogos(lines) {
	// Stock EPPI Mapper uses a table-based header. Find the line with `<table` inside `.header`
	// and extract all <img src="data:image/..."> values.
	const imgPattern = /<img\s+src="(data:image\/[^"]+)"/g;
	for (const line of lines) {
		if (line.includes("<table") && line.includes("base64")) {
			const matches = [...line.matchAll(imgPattern)].map((m) => m[1]);
			if (matches.length >= 2) return matches.slice(0, 2);
		}
	}
	// Fallback: scan all lines for base64 images in the header region (first 200 lines)
	const allMatches = [];
	for (let i = 0; i < Math.min(lines.length, 200); i++) {
		for (const m of lines[i].matchAll(imgPattern)) {
			if (m[1].startsWith("data:image")) allMatches.push(m[1]);
		}
	}
	return allMatches.slice(0, 2);
}

function extractTitle(lines) {
	// Stock EPPI Mapper title is in <strong><span style="font-size: ...">TITLE</span></strong>
	// or in `const title = "..."` variable.
	const titleLine = findLine(lines, 'const title = ', '"');
	if (titleLine) {
		const match = titleLine.match(/const title = "(.+?)";?\s*$/);
		if (match) return match[1];
	}
	// Fallback: extract from header HTML
	for (const line of lines) {
		if (line.includes("<strong>") && line.includes("<span")) {
			const match = line.match(
				/<strong><span[^>]*>(.+?)<\/span><\/strong>/,
			);
			if (match) return match[1].replace(/<[^>]+>/g, "").trim();
		}
	}
	return null;
}

function slugify(name) {
	return name
		.replace(/\.html$/i, "")
		.replace(/[^a-zA-Z0-9+]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.toLowerCase()
		.replace(/\+/g, "-plus-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function titleCase(slug) {
	return slug
		.split("-")
		.map((w) => {
			if (w.toLowerCase() === "redd-plus") return "REDD+";
			if (w.toLowerCase() === "egm") return "EGM";
			if (w.toLowerCase() === "rq") return "RQ";
			if (w.toLowerCase() === "op") return "OP";
			if (w.toLowerCase() === "ca") return "CA";
			if (w.toLowerCase() === "fcdo") return "FCDO";
			return w.charAt(0).toUpperCase() + w.slice(1);
		})
		.join(" ");
}

// ---- Main ----

function main() {
	const args = process.argv.slice(2);

	if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
		console.log(`
Usage: node tools/buildGapMap.js <stock-eppi-file.html> [output-slug]

Arguments:
  stock-eppi-file.html   Path to a stock EPPI Mapper HTML export
  output-slug            Optional output filename slug (auto-derived from input filename if omitted)

Examples:
  node tools/buildGapMap.js ~/Downloads/my-gap-map.html
  node tools/buildGapMap.js ~/Downloads/my-gap-map.html custom-name
`);
		process.exit(0);
	}

	const stockPath = path.resolve(args[0]);
	if (!fs.existsSync(stockPath)) {
		console.error(`Error: File not found: ${stockPath}`);
		process.exit(1);
	}

	// Determine output slug
	const inputBasename = path.basename(stockPath, ".html");
	const slug = args[1] || slugify(inputBasename);

	// Find the template
	const indexDirs = fs
		.readdirSync(GAPMAPS_DIR)
		.filter((d) =>
			fs.statSync(path.join(GAPMAPS_DIR, d)).isDirectory(),
		);

	if (indexDirs.length === 0) {
		console.error("Error: No index directories found in public/gapmaps/");
		process.exit(1);
	}

	// Use the first directory that contains the template
	let templateDir = null;
	for (const dir of indexDirs) {
		if (fs.existsSync(path.join(GAPMAPS_DIR, dir, TEMPLATE_NAME))) {
			templateDir = dir;
			break;
		}
	}

	if (!templateDir) {
		console.error(
			`Error: Template '${TEMPLATE_NAME}' not found in any gapmaps subdirectory`,
		);
		process.exit(1);
	}

	const templatePath = path.join(GAPMAPS_DIR, templateDir, TEMPLATE_NAME);
	const outputPath = path.join(GAPMAPS_DIR, templateDir, `${slug}.html`);

	console.log(`Template:  ${templatePath}`);
	console.log(`Stock:     ${stockPath}`);
	console.log(`Output:    ${outputPath}`);
	console.log(`Slug:      ${slug}`);
	console.log();

	// Read files
	const templateLines = fs.readFileSync(templatePath, "utf-8").split("\n");
	const stockLines = fs.readFileSync(stockPath, "utf-8").split("\n");

	// Extract data from stock file
	const stockData = {};
	for (const { prefix, startsWith } of DATA_VARIABLES) {
		const line = findLine(stockLines, prefix, startsWith);
		if (line) {
			stockData[prefix] = line;
			console.log(
				`  Extracted: ${prefix}(${line.trim().slice(prefix.length, prefix.length + 30)}...)`,
			);
		} else {
			console.warn(`  WARNING: Could not find '${prefix}' in stock file`);
		}
	}

	// Extract config (colors) from stock file
	const stockConfig = {};
	for (const prefix of CONFIG_VARIABLES) {
		const line = findLineValue(stockLines, prefix);
		if (line) {
			stockConfig[prefix] = line;
			console.log(`  Extracted: ${line.trim()}`);
		}
	}

	// Extract logos
	const logos = extractLogos(stockLines);
	console.log(`  Extracted: ${logos.length} logo(s)`);

	// Extract title
	const stockTitle = extractTitle(stockLines);
	console.log(`  Extracted title: "${stockTitle}"`);

	if (!stockTitle) {
		console.error("Error: Could not extract title from stock file");
		process.exit(1);
	}

	console.log();

	// Build output
	const outputLines = [];
	const fcodoTitlePattern = /FCDO-COMMISSIONED EVALUATIONS: AN EVIDENCE AND GAP MAP/;
	// Also match any previously injected title in the header-title span
	let currentTemplateTitle = null;
	for (const line of templateLines) {
		if (line.includes('class="header-title"')) {
			const m = line.match(/<span>(.+?)<\/span>/);
			if (m) currentTemplateTitle = m[1];
		}
	}

	for (const line of templateLines) {
		const stripped = line.trimStart();
		let replaced = false;

		// Replace data variables
		for (const { prefix, startsWith } of DATA_VARIABLES) {
			if (stripped.startsWith(prefix) && stockData[prefix]) {
				const valueStart = stripped.slice(prefix.length).trimStart();
				if (!startsWith || valueStart.startsWith(startsWith)) {
					// Preserve the template's indentation
					const indent = line.match(/^(\s*)/)[1];
					let newLine = stockData[prefix];
					newLine = indent + newLine.trimStart();
					if (!newLine.endsWith("\n")) newLine += "\n";
					outputLines.push(newLine);
					replaced = true;
					break;
				}
			}
		}
		if (replaced) continue;

		let currentLine = line;

		// Replace config variables (colors)
		for (const prefix of CONFIG_VARIABLES) {
			if (stripped.startsWith(prefix) && stockConfig[prefix]) {
				const indent = currentLine.match(/^(\s*)/)[1];
				currentLine = indent + stockConfig[prefix];
				if (!currentLine.endsWith("\n")) currentLine += "\n";
				break;
			}
		}

		// Replace logos
		if (currentLine.includes('class="logoOne"') && logos.length >= 1) {
			currentLine = currentLine.replace(
				/(<div class="logoOne"><img src=")([^"]+)(")/,
				`$1${logos[0]}$3`,
			);
		}
		if (currentLine.includes('class="logoTwo"') && logos.length >= 2) {
			currentLine = currentLine.replace(
				/(<div class="logoTwo"><img src=")([^"]+)(")/,
				`$1${logos[1]}$3`,
			);
		}

		// Replace title in header HTML
		if (
			currentLine.includes('class="header-title"') &&
			currentTemplateTitle
		) {
			currentLine = currentLine.replace(
				`<span>${currentTemplateTitle}</span>`,
				`<span>${stockTitle}</span>`,
			);
		}

		outputLines.push(currentLine);
	}

	// Write output
	fs.writeFileSync(outputPath, outputLines.join("\n"), "utf-8");
	const outputSize = fs.statSync(outputPath).size;
	console.log(
		`Written: ${outputPath} (${(outputSize / 1024 / 1024).toFixed(2)} MB, ${outputLines.length} lines)`,
	);

	// Update LABEL_MAP in gapmaps.ts
	const label = titleCase(slug);
	const gapmapsTsContent = fs.readFileSync(GAPMAPS_TS, "utf-8");

	if (gapmapsTsContent.includes(`"${slug}"`)) {
		console.log(`\nLABEL_MAP already contains "${slug}", skipping update.`);
	} else {
		const updated = gapmapsTsContent.replace(
			/^(const LABEL_MAP: Record<string, string> = \{)\n/m,
			`$1\n\t"${slug}": "${label}",\n`,
		);
		if (updated !== gapmapsTsContent) {
			fs.writeFileSync(GAPMAPS_TS, updated, "utf-8");
			console.log(
				`\nUpdated LABEL_MAP in gapmaps.ts: "${slug}" => "${label}"`,
			);
			console.log(
				"  Review the label and adjust if the auto-generated one isn't right.",
			);
		} else {
			console.warn(
				"\nWARNING: Could not auto-update LABEL_MAP. Add manually:",
			);
			console.warn(`  "${slug}": "${label}",`);
		}
	}

	console.log("\nDone!");
}

main();
