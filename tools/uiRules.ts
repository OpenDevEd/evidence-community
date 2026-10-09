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
 * on animated elements. A `before:` or `after:` class styles another box. A
 * class string or `cn(...)` call that clashes by itself is reported where it
 * is written; a constant from the same file is read where className uses it;
 * and each stylesheet rule is checked the same way.
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
// The translation functions: `t`, and `tc` or `tUI` for a second namespace.
const TRANSLATE = /^t([a-z]|[A-Z]\w*)?$/;

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

type Scan = {
	file: string;
	source: ts.SourceFile;
	lines: string[];
	constants: Map<string, ts.Expression>;
	loadingKeys: ReadonlySet<string>;
	found: string[];
};

// The helpers that join their arguments into one class list; cva and tv take alternatives instead.
const JOINERS = new Set(["cn", "clsx", "cx", "twMerge", "classNames"]);
const joins = (node: ts.Node) => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && JOINERS.has(node.expression.text);
/** A class list written as one value: a string, a template, or a call joining classes. */
const classValue = (node: ts.Node) => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node) || joins(node);

/** The value of a same-file variable an identifier reads, when it holds classes. */
function constantValue(scan: Scan, node: ts.Node): ts.Expression | undefined {
	if (!ts.isIdentifier(node) || (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) return undefined;
	const value = scan.constants.get(node.text);
	return value && (classValue(value) || ts.isConditionalExpression(value)) ? value : undefined;
}

/**
 * Every class list a className can produce: the two sides of `a ? b : c`
 * never apply together, and a same-file constant adds the classes it holds.
 */
function classLists(scan: Scan, node: ts.Node | undefined, seen: ReadonlySet<ts.Node> = new Set()): string[] {
	if (!node) return [""];
	if (ts.isConditionalExpression(node)) return [...classLists(scan, node.whenTrue, seen), ...classLists(scan, node.whenFalse, seen)];
	const value = constantValue(scan, node);
	// A constant that clashes by itself is reported where it is written.
	if (value) return seen.has(value) || clashesAlone(scan, value, seen) ? [""] : classLists(scan, value, new Set([...seen, value]));
	const children = node.getChildren(scan.source);
	if (children.length === 0) return [node.getText(scan.source)];
	return children.reduce<string[]>((lists, child) => {
		const texts = classLists(scan, child, seen);
		return lists.flatMap((list) => texts.map((text) => `${list} ${text}`));
	}, [""]);
}

/** Whether a class value clashes by itself, wherever it is used. */
function clashesAlone(scan: Scan, node: ts.Node, seen: ReadonlySet<ts.Node> = new Set()): boolean {
	return classValue(node) && classLists(scan, node, new Set([...seen, node])).some((list) => clashes(list, false));
}

/** Whether a node is part of a larger class list: an element's className, a joining call, or a template. */
function insideClassList(node: ts.Node, source: ts.SourceFile): boolean {
	for (let parent = node.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
		if (joins(parent) || ts.isTemplateExpression(parent) || (ts.isJsxAttribute(parent) && parent.name.getText(source) === "className")) return true;
	}
	return false;
}

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

/** The translation call a string is the key of, as in `t("loadingData")`. */
function translationCall(node: ts.Node): ts.CallExpression | undefined {
	const call = node.parent;
	if (!ts.isCallExpression(call) || call.arguments[0] !== node) return undefined;
	return ts.isIdentifier(call.expression) && TRANSLATE.test(call.expression.text) ? call : undefined;
}

/** Whether a string shows a Loading label as a JSX child: the label itself, or the key of a translated one. */
function showsLoading(scan: Scan, node: ts.StringLiteralLike | ts.TemplateLiteralLikeNode): boolean {
	const whole = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
	if (whole && LOADING.test(node.text.trim())) return renderedInJsx(node);
	const call = translationCall(node);
	return !!call && scan.loadingKeys.has(node.text.split(".").at(-1) ?? "") && renderedInJsx(call);
}

function checkString(scan: Scan, node: ts.StringLiteralLike | ts.TemplateLiteralLikeNode) {
	const uppercaseClass = UPPERCASE_CLASS.test(node.text) && classContext(node, scan.source);
	if (UPPERCASE_CSS.test(node.text) || uppercaseClass) report(scan, node, "uppercase");
	if (DOT.test(node.text)) report(scan, node, "dot-separator");
	if (showsLoading(scan, node)) report(scan, node, "loading-text");
}

function checkText(scan: Scan, node: ts.JsxText) {
	if (DOT.test(node.text)) report(scan, node, "dot-separator");
	if (LOADING.test(node.text.trim())) report(scan, node, "loading-text");
}

type Attributes = { classLists: string[]; framer: boolean; title: ts.JsxAttribute | null };

function readAttributes(node: ts.JsxOpeningLikeElement, scan: Scan): Attributes {
	const source = scan.source;
	const tag = node.tagName.getText(source);
	const read: Attributes = { classLists: [""], framer: false, title: null };
	for (const attribute of node.attributes.properties.filter(ts.isJsxAttribute)) {
		const name = attribute.name.getText(source);
		if (name === "className") read.classLists = classLists(scan, attribute.initializer);
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
const unApi = (node: ts.JsxOpeningLikeElement, tag: string, lists: string[]) => tag === "abbr" && lists.every((list) => /(?:^|[\s"'`])unapi-id(?=$|[\s"'`])/.test(list)) && empty(node);
const nativeTooltip = (node: ts.JsxOpeningLikeElement, tag: string, read: Attributes) => !!read.title && /^[a-z]/.test(tag) && !TITLED_ELEMENTS.has(tag) && !unApi(node, tag, read.classLists);

function checkElement(scan: Scan, node: ts.JsxOpeningLikeElement) {
	const tag = node.tagName.getText(scan.source);
	const read = readAttributes(node, scan);
	if (read.classLists.some((list) => clashes(list, read.framer))) report(scan, node, "animation-clash");
	if (nativeTooltip(node, tag, read)) report(scan, read.title!, "native-title");
}

function visit(scan: Scan, node: ts.Node) {
	if (classValue(node) && !insideClassList(node, scan.source) && clashesAlone(scan, node)) report(scan, node, "animation-clash");
	if (isStringLike(node)) checkString(scan, node);
	if (ts.isJsxText(node)) checkText(scan, node);
	if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) checkElement(scan, node);
	ts.forEachChild(node, (child) => visit(scan, child));
}

/** Every variable in a file with the value it starts with. */
function constants(source: ts.SourceFile): Map<string, ts.Expression> {
	const found = new Map<string, ts.Expression>();
	const collect = (node: ts.Node) => {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) found.set(node.name.text, node.initializer);
		ts.forEachChild(node, collect);
	};
	collect(source);
	return found;
}

/** The problems in one .ts or .tsx file; `loadingKeys` are the message keys whose text is a Loading label. */
export function sourceProblems(file: string, text: string, loadingKeys: ReadonlySet<string> = new Set()): string[] {
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
	const scan: Scan = { file, source, lines: text.split("\n"), constants: constants(source), loadingKeys, found: [] };
	visit(scan, source);
	return scan.found;
}

// The words of a CSS transition that name no property.
const TIMING = /^(ease(-in|-out|-in-out)?|linear|step-start|step-end|allow-discrete|normal|-?[\d.]+m?s)$/;

/** Whether one item of a CSS transition list moves opacity or transform; an item that names no property transitions all. */
function cssItemMoves(item: string): boolean {
	const words = item.split(/\s+/).filter((word) => word && !TIMING.test(word));
	return words.length === 0 || words.some((word) => MOVING.has(word));
}

/** Whether one CSS rule both animates and transitions opacity or transform. */
function cssClashes(declarations: string): boolean {
	const values = new Map(
		declarations
			.split(";")
			.map((declaration) => declaration.split(":"))
			.filter((parts) => parts.length > 1)
			.map(([name, ...value]) => [name.trim().toLowerCase(), value.join(":").trim()]),
	);
	const animation = values.get("animation") ?? values.get("animation-name") ?? "none";
	const transition = values.get("transition") ?? values.get("transition-property") ?? "none";
	// Functions go first: the commas inside cubic-bezier() don't separate transitions.
	return !/^none\b/i.test(animation) && transition.replace(/[\w-]+\([^)]*\)/g, " ").split(",").some(cssItemMoves);
}

/** Uppercase declarations, and rules that animate and transition opacity or transform, in one stylesheet. */
export function stylesheetProblems(file: string, text: string): string[] {
	const lines = text.split("\n");
	const uppercase = lines.flatMap((line, index) => (UPPERCASE_CSS.test(line) && !allowed(lines[index - 1], "uppercase") ? [`${file}:${index + 1} uppercase: ${FIX.uppercase}`] : []));
	// Comments blanked with their newlines kept, so a brace in one can't open a rule.
	const plain = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
	const clashing = [...plain.matchAll(/\{([^{}]*)\}/g)]
		.filter((rule) => cssClashes(rule[1]))
		.map((rule) => plain.slice(0, rule.index).split("\n").length)
		.filter((line) => !allowed(lines[line - 2], "animation-clash"))
		.map((line) => `${file}:${line} animation-clash: ${FIX["animation-clash"]}`);
	return [...uppercase, ...clashing];
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

/**
 * The message keys that are Loading labels, so a translated label is caught
 * where it is rendered. A key counts only when every message of that name is
 * one, since the namespace a call reads from isn't known here.
 */
export function loadingKeys(text: string): string[] {
	const messages = strings(JSON.parse(text), "");
	const loading = ([, value]: [string, string]) => LOADING.test(value.trim());
	const other = new Set(messages.filter((message) => !loading(message)).map(([key]) => key));
	return messages.filter((message) => loading(message) && !other.has(message[0])).map(([key]) => key);
}
