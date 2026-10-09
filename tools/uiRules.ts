import ts from "typescript";

/**
 * The UI rules agents kept breaking, read from source so each problem names
 * the fix. A line that needs an exception says why on the line before it:
 *
 *   // ui-rules-allow: <rule> -- <reason>
 *
 * animation-clash: an element that is animated (a CSS animation class or
 * Framer props) must not also transition opacity or transform. The two fight
 * over the same property: Firefox then jumps back and forth as an animation
 * ends, and a Framer layout animation wobbles. Tailwind's bare `transition`
 * covers opacity and transform too, so only explicit property lists are safe
 * on animated elements. A `before:` or `after:` class styles another box.
 *
 * OpenScholar runs the same rules (scripts/check-ui-rules.mjs in
 * OpenDevEd/openalex-count); keep the two in step.
 */

type Rule = "animation-clash" | "uppercase" | "native-title" | "dot-separator" | "loading-text";

const FIX: Record<Rule, string> = {
	"animation-clash": "animates and transitions opacity or transform; put the animation on a wrapper, or transition only colours, borders and shadows.",
	uppercase: "no uppercase labels; build hierarchy with weight, size and colour.",
	"native-title": "native title tooltip; use Tooltip from src/components/nextui/Tooltip and keep the name in aria-label.",
	"dot-separator": "no dot separators; use spacing, a divider or an icon.",
	"loading-text": 'no "Loading" text; show a spinner, or hold the final size until the data is there.',
};

// The utilities that move opacity or transform. Bare `transition` and
// `transition-all` cover both; an arbitrary list counts when it names one.
const MOVING = new Set(["opacity", "transform", "translate", "scale", "rotate", "all"]);
const PSEUDO_ELEMENTS = new Set(["before", "after", "placeholder", "file", "marker", "selection", "first-letter", "first-line", "backdrop"]);
const FRAMER_PROPS = new Set(["initial", "animate", "exit", "layout", "layoutId", "variants", "whileHover", "whileTap", "whileInView", "whileFocus", "whileDrag"]);
// The `uppercase` utility with variants or the important mark (`sm:uppercase`,
// `uppercase!`), looked for only where classes are written so prose that says
// "uppercase" passes; and the CSS declaration anywhere.
const UPPERCASE_CLASS = /(?:^|[\s:!])!?uppercase!?(?=$|[\s"'`])/;
const UPPERCASE_CSS = /text-transform\s*:\s*uppercase/i;
const CLASS_HELPERS = new Set(["cn", "cva", "clsx", "cx", "twMerge", "tv", "classNames"]);
const CLASS_NAMES = /(class(name)?(es|s)?|styles?|variants?|texttransform)$/i;
// The characters, and the entities JSX text keeps undecoded.
const DOT = /[·•]|&(?:middot|bull|#183|#x0*b7|#8226|#x2022);/i;
// A short status label ("Loading", "Loading author profile..."), not a sentence that mentions loading.
const LOADING = /^loading\b[^.!?]{0,40}(…|\.\.\.)?$/i;

const allowed = (line: string | undefined, rule: Rule) => new RegExp(`ui-rules-allow:\\s*${rule}\\s+--\\s*\\S`).test(line ?? "");

/** A class without its variants and important mark: `hover:transition-opacity!` is `transition-opacity`. */
const utility = (token: string) => (token.split(":").at(-1) ?? "").replace(/^!|!$/g, "");
/** The box a class styles: the element, or a pseudo-element its variants name (`before:`). */
const box = (token: string) => token.split(":").slice(0, -1).find((variant) => PSEUDO_ELEMENTS.has(variant)) ?? "";

function transitionsMovement(token: string): boolean {
	const name = utility(token);
	const list = name.match(/^transition-\[(.+)\]$/)?.[1];
	if (list) return list.split(",").some((property) => MOVING.has(property.trim()));
	return /^transition(-all|-opacity|-transform)?$/.test(name);
}

const animates = (token: string) => /^(fade-enter|animate-[\w[\]-]+)$/.test(utility(token)) && utility(token) !== "animate-none";

/** The classes of a class list, grouped by the box they style. */
function boxes(classes: string): Map<string, string[]> {
	const groups = new Map<string, string[]>();
	for (const token of classes.split(/[\s"'`{}()]+/).filter(Boolean)) groups.set(box(token), [...(groups.get(box(token)) ?? []), token]);
	return groups;
}

/** Whether one box both animates and transitions opacity or transform; Framer props animate the element itself. */
function clashes(classes: string, framer: boolean): boolean {
	return [...boxes(classes)].some(([target, tokens]) => tokens.some(transitionsMovement) && ((framer && target === "") || tokens.some(animates)));
}

type Scan = { file: string; source: ts.SourceFile; lines: string[]; found: string[] };

function report(scan: Scan, node: ts.Node, rule: Rule) {
	const line = scan.source.getLineAndCharacterOfPosition(node.getStart(scan.source)).line;
	if (!allowed(scan.lines[line - 1], rule)) scan.found.push(`${scan.file}:${line + 1} ${rule}: ${FIX[rule]}`);
}

/** Whether a node names classes: a className, a class helper's arguments, or a variable or property named for classes or styles. */
function namesClasses(node: ts.Node, source: ts.SourceFile): boolean {
	if (ts.isJsxAttribute(node)) return node.name.getText(source) === "className";
	if (ts.isCallExpression(node)) return ts.isIdentifier(node.expression) && CLASS_HELPERS.has(node.expression.text);
	if (ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node)) return CLASS_NAMES.test(node.name.getText(source));
	return false;
}

function classContext(node: ts.Node, source: ts.SourceFile): boolean {
	for (let parent = node.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
		if (namesClasses(parent, source)) return true;
	}
	return false;
}

const RENDERING_OPERATORS = [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken];

/** Whether a value passes through this parent unchanged on its way to being rendered. */
function passesThrough(parent: ts.Node, child: ts.Node): boolean {
	if (ts.isParenthesizedExpression(parent)) return true;
	if (ts.isConditionalExpression(parent)) return parent.condition !== child;
	return ts.isBinaryExpression(parent) && RENDERING_OPERATORS.includes(parent.operatorToken.kind);
}

/** Whether a string is rendered as a JSX child, directly or through a condition. */
function renderedInJsx(node: ts.Node): boolean {
	let child = node;
	for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
		if (ts.isJsxExpression(parent)) return !ts.isJsxAttribute(parent.parent);
		if (!passesThrough(parent, child)) return false;
	}
	return false;
}

const isStringLike = (node: ts.Node): node is ts.StringLiteralLike | ts.TemplateLiteralLikeNode =>
	ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);

function checkString(scan: Scan, node: ts.StringLiteralLike | ts.TemplateLiteralLikeNode) {
	const uppercaseClass = UPPERCASE_CLASS.test(node.text) && classContext(node, scan.source);
	if (UPPERCASE_CSS.test(node.text) || uppercaseClass) report(scan, node, "uppercase");
	if (DOT.test(node.text)) report(scan, node, "dot-separator");
	const whole = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
	if (whole && LOADING.test(node.text.trim()) && renderedInJsx(node)) report(scan, node, "loading-text");
}

function checkText(scan: Scan, node: ts.JsxText) {
	if (DOT.test(node.text)) report(scan, node, "dot-separator");
	if (LOADING.test(node.text.trim())) report(scan, node, "loading-text");
}

type Attributes = { className: string; style: string; framer: boolean; title: ts.JsxAttribute | null };

function readAttributes(node: ts.JsxOpeningLikeElement, source: ts.SourceFile): Attributes {
	const tag = node.tagName.getText(source);
	const read: Attributes = { className: "", style: "", framer: false, title: null };
	for (const attribute of node.attributes.properties.filter(ts.isJsxAttribute)) {
		const name = attribute.name.getText(source);
		const value = attribute.initializer?.getText(source) ?? "";
		if (name === "className") read.className = value;
		if (name === "style") read.style = value;
		if (name === "title") read.title = attribute;
		read.framer ||= FRAMER_PROPS.has(name) && tag.startsWith("motion.");
	}
	return read;
}

// Built-in elements only. An iframe's title is its accessible name, a link's
// names the resource it points to, and the empty unAPI abbr carries a record
// key for Zotero; none of them is a tooltip.
const TITLED_ELEMENTS = new Set(["iframe", "link"]);
/** Whether an element shows nothing a pointer could rest on: self-closing, or only whitespace inside. */
const empty = (node: ts.JsxOpeningLikeElement) =>
	ts.isJsxSelfClosingElement(node) || (ts.isJsxElement(node.parent) && node.parent.children.every((child) => ts.isJsxText(child) && child.text.trim() === ""));
const unApi = (node: ts.JsxOpeningLikeElement, tag: string, className: string) => tag === "abbr" && /(?:^|[\s"'`])unapi-id(?=$|[\s"'`])/.test(className) && empty(node);
const nativeTooltip = (node: ts.JsxOpeningLikeElement, tag: string, read: Attributes) => !!read.title && /^[a-z]/.test(tag) && !TITLED_ELEMENTS.has(tag) && !unApi(node, tag, read.className);

function checkElement(scan: Scan, node: ts.JsxOpeningLikeElement) {
	const tag = node.tagName.getText(scan.source);
	const read = readAttributes(node, scan.source);
	if (clashes(read.className, read.framer)) report(scan, node, "animation-clash");
	if (nativeTooltip(node, tag, read)) report(scan, read.title!, "native-title");
}

function visit(scan: Scan, node: ts.Node) {
	if (isStringLike(node)) checkString(scan, node);
	if (ts.isJsxText(node)) checkText(scan, node);
	if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) checkElement(scan, node);
	ts.forEachChild(node, (child) => visit(scan, child));
}

/** The problems in one .ts or .tsx file. */
export function sourceProblems(file: string, text: string): string[] {
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
	const scan: Scan = { file, source, lines: text.split("\n"), found: [] };
	visit(scan, source);
	return scan.found;
}

/** Uppercase declarations in one stylesheet. */
export function stylesheetProblems(file: string, text: string): string[] {
	const lines = text.split("\n");
	return lines.flatMap((line, index) => (UPPERCASE_CSS.test(line) && !allowed(lines[index - 1], "uppercase") ? [`${file}:${index + 1} uppercase: ${FIX.uppercase}`] : []));
}

/** Every string in a messages file, with the key that holds it. */
function strings(value: unknown, key: string): [string, string][] {
	if (typeof value === "string") return [[key, value]];
	if (!value || typeof value !== "object") return [];
	return Object.entries(value).flatMap(([inner, child]) => strings(child, inner));
}

/**
 * Dot separators in one messages file. Values are read decoded, so an escaped
 * · counts too; the line is the one that holds the key.
 */
export function messageProblems(file: string, text: string): string[] {
	const lines = text.split("\n");
	return strings(JSON.parse(text), "")
		.filter(([, value]) => DOT.test(value))
		.map(([key]) => `${file}:${lines.findIndex((line) => line.includes(`"${key}"`)) + 1} dot-separator: ${FIX["dot-separator"]}`);
}
