import ts from "typescript";

import tailwindConfig from "../tailwind.config";

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
 * icon-top: an icon, avatar or cover beside a title with a line under it
 * starts at the title's top. A row that centres its items floats the picture
 * between the lines and moves it when the text wraps. `self-start` on the
 * picture keeps it on the title's line, and changes nothing while the picture
 * is the taller of the two. A picture after the text, such as a chevron, may
 * stay centred, and so may one in a row of a set height.
 *
 * OpenScholar runs the same rules (scripts/check-ui-rules.mjs in
 * OpenDevEd/openalex-count); keep the two in step.
 */

type Rule = "animation-clash" | "uppercase" | "native-title" | "dot-separator" | "loading-text" | "icon-top" | "grid-scroll";

const FIX: Record<Rule, string> = {
	"animation-clash": "animates and transitions opacity or transform; put the animation on a wrapper, or transition only colours, borders and shadows.",
	uppercase: "no uppercase labels; build hierarchy with weight, size and colour.",
	"native-title": "native title tooltip; use Tooltip from src/components/nextui/Tooltip and keep the name in aria-label.",
	"dot-separator": "no dot separators; use spacing, a divider or an icon.",
	"loading-text": 'no "Loading" text; show a spinner, or hold the final size until the data is there.',
	"icon-top": "an icon or picture is centred beside a title with a line under it; put self-start on it (and mt-0.5 on a size-4 icon, to sit on a text-sm line).",
	"grid-scroll": "a scrolling grid with no columns sizes its column to its widest unwrapped line and scrolls sideways; add grid-cols-[minmax(0,1fr)] (or its real columns).",
};

// The utilities that move opacity or transform. Bare `transition` and
// `transition-all` cover both; an arbitrary list counts when it names one.
const MOVING = new Set(["opacity", "transform", "translate", "scale", "rotate", "all"]);
const PSEUDO_ELEMENTS = new Set(["before", "after", "placeholder", "file", "marker", "selection", "first-letter", "first-line", "backdrop"]);
// `motion.div`, or `m.div` inside LazyMotion.
const MOTION_TAG = /^(motion|m)\./;
const FRAMER_PROPS = new Set(["initial", "animate", "exit", "layout", "layoutId", "variants", "whileHover", "whileTap", "whileInView", "whileFocus", "whileDrag"]);
// The `uppercase` utility with variants or the important mark (`sm:uppercase`,
// `uppercase!`), looked for only where classes are written so prose that says
// "uppercase" passes; and the CSS declaration anywhere.
const UPPERCASE_CLASS = /(?:^|[\s:!])!?uppercase!?(?=$|[\s"'`])/;
const UPPERCASE_CSS = /text-transform\s*:\s*uppercase/i;
// grid-scroll: a grid that scrolls, with no columns of its own. Its one automatic column grows to the widest line
// that won't wrap, so `truncate` inside never applies and the box scrolls sideways (the record status menu, #880).
const GRID_CLASS = /(?:^|[\s:!])!?grid!?(?=$|[\s"'`])/;
const SCROLL_CLASS = /(?:^|[\s:!])!?overflow(?:-[xy])?-(?:auto|scroll)!?(?=$|[\s"'`])/;
const COLUMNS_CLASS = /(?:^|[\s:!])!?grid-cols-/;
// shortcut: one class string at a time, so a grid and its overflow split across cn() arguments pass; read the joined list if that happens.
const CLASS_HELPERS = new Set(["cn", "cva", "clsx", "cx", "twMerge", "tv", "classNames"]);
const CLASS_NAMES = /(class(name)?(es|s)?|styles?|variants?|texttransform)$/i;
// The characters, and the entities JSX text keeps undecoded.
const DOT = /[·•]|&(?:middot|bull|#183|#x0*b7|#8226|#x2022);/i;
// A short status label ("Loading", "Loading author profile..."), not a sentence that mentions loading.
const LOADING = /^loading\b[^.!?]{0,40}(…|\.\.\.)?$/i;
// The translation functions: `t`, and `tc` or `tUI` for a second namespace.
const TRANSLATE = /^t([a-z]|[A-Z]\w*)?$/;
const SR_ONLY = /(?:^|[\s"'`])sr-only(?=$|[\s"'`])/;

const allowed = (line: string | undefined, rule: Rule) => new RegExp(`ui-rules-allow:\\s*${rule}\\s+--\\s*\\S`).test(line ?? "");

/** A class without its variants and important mark: `hover:transition-opacity!` is `transition-opacity`. */
const utility = (token: string) => (token.split(":").at(-1) ?? "").replace(/^!|!$/g, "");
/** The box a class styles: the element, or a pseudo-element its variants name (`before:`). */
const box = (token: string) => token.split(":").slice(0, -1).find((variant) => PSEUDO_ELEMENTS.has(variant)) ?? "";

/** Whether a comma-separated list of CSS properties names one that moves opacity or transform. */
const movesAny = (properties: string) => properties.split(",").some((property) => MOVING.has(property.trim()));

// The transition utilities tailwind.config.ts adds (`transition-chrome`), by whether they move opacity or transform.
const CONFIGURED_TRANSITIONS = new Map(
	Object.entries(tailwindConfig.theme?.extend?.transitionProperty ?? {}).map(([name, properties]) => [`transition-${name}`, movesAny(String(properties))]),
);

function transitionsMovement(token: string): boolean {
	const name = utility(token);
	const list = name.match(/^transition-\[(.+)\]$/)?.[1];
	if (list) return movesAny(list);
	return CONFIGURED_TRANSITIONS.get(name) ?? /^transition(-all|-opacity|-transform)?$/.test(name);
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
	// The class lists each constant adds, read once.
	lists: Map<ts.Node, string[]>;
	loadingKeys: ReadonlySet<string>;
	// What the file renders as text: the variables, and the properties within each top-level declaration.
	rendered: Rendered;
	found: string[];
};

// The helpers that join their arguments into one class list; cva and tv take alternatives instead.
const JOINERS = new Set(["cn", "clsx", "cx", "twMerge", "classNames"]);
const joins = (node: ts.Node) => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && JOINERS.has(node.expression.text);
/** A class list written as one value: a string, a template, or a call joining classes. */
const classValue = (node: ts.Node) => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node) || joins(node);

/** The names a declaration or parameter binds, through destructuring. */
function boundNames(name: ts.BindingName): string[] {
	if (ts.isIdentifier(name)) return [name.text];
	return name.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : boundNames(element.name)));
}

/** The variable a block declares under this name, if any. */
const declares = (block: ts.Block | ts.SourceFile, name: string) =>
	block.statements.flatMap((statement) => (ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [])).find((declaration) => boundNames(declaration.name).includes(name));

/** The variable an identifier reads, found as scopes resolve it; a parameter has none. */
function declarationOf(node: ts.Identifier): ts.VariableDeclaration | undefined {
	for (let scope: ts.Node | undefined = node.parent; scope; scope = scope.parent) {
		if (ts.isFunctionLike(scope) && scope.parameters.some((parameter) => boundNames(parameter.name).includes(node.text))) return undefined;
		const declaration = ts.isBlock(scope) || ts.isSourceFile(scope) ? declares(scope, node.text) : undefined;
		if (declaration) return declaration;
	}
	return undefined;
}

/** The value an identifier's variable starts with; a parameter or a destructured name has none. */
function declaredValue(node: ts.Identifier): ts.Expression | undefined {
	const declaration = declarationOf(node);
	return declaration && ts.isIdentifier(declaration.name) ? declaration.initializer : undefined;
}

/** An expression without `( )`, `as`, `satisfies` or `!` around it. */
const unwrap = (node: ts.Expression): ts.Expression =>
	ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node) ? unwrap(node.expression) : node;

/** Whether an identifier reads a variable, rather than naming a property. */
const readsVariable = (node: ts.Node): node is ts.Identifier =>
	ts.isIdentifier(node) && !((ts.isPropertyAccessExpression(node.parent) || ts.isPropertyAssignment(node.parent)) && node.parent.name === node);
const holdsClasses = (value: ts.Expression) => classValue(value) || ts.isConditionalExpression(value) || ts.isBinaryExpression(value) || ts.isIdentifier(value);

/** The value of the same-file constant an identifier reads, when it can hold classes. */
function constantValue(node: ts.Node): ts.Expression | undefined {
	const initializer = readsVariable(node) ? declaredValue(node) : undefined;
	const value = initializer && unwrap(initializer);
	return value && holdsClasses(value) ? value : undefined;
}

// ponytail: past 64 combinations the lists merge into one, which can report a clash between exclusive branches.
const MAX_LISTS = 64;
const capped = (lists: string[]) => {
	const unique = [...new Set(lists)];
	return unique.length > MAX_LISTS ? [[...new Set(unique.join(" ").split(/\s+/))].join(" ")] : unique;
};

/** What a logical operator can give: `a && b` gives b or nothing, `a || b` and `a ?? b` give one side. */
function logicalLists(scan: Scan, node: ts.BinaryExpression, seen: ReadonlySet<ts.Node>): string[] | undefined {
	const kind = node.operatorToken.kind;
	if (kind === ts.SyntaxKind.AmpersandAmpersandToken) return capped([...classLists(scan, node.right, seen), ""]);
	if (kind !== ts.SyntaxKind.BarBarToken && kind !== ts.SyntaxKind.QuestionQuestionToken) return undefined;
	return capped([...classLists(scan, node.left, seen), ...classLists(scan, node.right, seen)]);
}

/** The class lists a constant adds. One that clashes by itself is reported where it is written, so it adds none here. */
function constantLists(scan: Scan, value: ts.Expression, seen: ReadonlySet<ts.Node>): string[] {
	if (seen.has(value)) return [""];
	const cached = scan.lists.get(value);
	if (cached) return cached;
	const lists = classLists(scan, value, new Set([...seen, value]));
	const added = classValue(value) && lists.some((list) => clashes(list, false)) ? [""] : lists;
	scan.lists.set(value, added);
	return added;
}

/**
 * Every class list a className can produce: the two sides of `a ? b : c`
 * never apply together, and a same-file constant adds the classes it holds.
 */
function classLists(scan: Scan, node: ts.Node | undefined, seen: ReadonlySet<ts.Node> = new Set()): string[] {
	if (!node) return [""];
	if (ts.isConditionalExpression(node)) return capped([...classLists(scan, node.whenTrue, seen), ...classLists(scan, node.whenFalse, seen)]);
	const logical = ts.isBinaryExpression(node) ? logicalLists(scan, node, seen) : undefined;
	if (logical) return logical;
	const value = constantValue(node);
	if (value) return constantLists(scan, value, seen);
	const children = node.getChildren(scan.source);
	if (children.length === 0) return [node.getText(scan.source)];
	return children.reduce<string[]>((lists, child) => {
		const texts = classLists(scan, child, seen);
		return capped(lists.flatMap((list) => texts.map((text) => `${list} ${text}`)));
	}, [""]);
}

/** Whether a class value clashes by itself, wherever it is used. */
const clashesAlone = (scan: Scan, node: ts.Node) => classValue(node) && classLists(scan, node, new Set([node])).some((list) => clashes(list, false));

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

const typeOnly = (node: ts.Node) => ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node);

/** Whether a value passes through this parent on its way to being rendered: `a && b` shows only b, a is its condition. */
function passesThrough(parent: ts.Node, child: ts.Node): boolean {
	if (typeOnly(parent)) return true;
	if (ts.isConditionalExpression(parent)) return parent.condition !== child;
	if (!ts.isBinaryExpression(parent) || !RENDERING_OPERATORS.includes(parent.operatorToken.kind)) return false;
	return parent.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken || parent.right === child;
}

/** The node a value lands in once it passes through parentheses and conditions. */
function destination(node: ts.Node): ts.Node | undefined {
	let child = node;
	let parent = node.parent;
	while (parent && passesThrough(parent, child)) {
		child = parent;
		parent = parent.parent;
	}
	return parent;
}

/** Whether a value is rendered as a JSX child, directly or through a condition. */
function renderedInJsx(node: ts.Node): boolean {
	const target = destination(node);
	return !!target && ts.isJsxExpression(target) && !ts.isJsxAttribute(target.parent);
}

type Rendered = { variables: Set<ts.VariableDeclaration>; properties: Set<string> };

/** The statement directly in the file that holds a node: properties are matched by name only within it. */
function topLevel(node: ts.Node): ts.Node {
	let current = node;
	while (current.parent && !ts.isSourceFile(current.parent)) current = current.parent;
	return current;
}

/** The key a rendered property is matched by: its object's variable when the object is written into one (`const config = { label }`), otherwise its name within the top-level declaration, for an object a function returns. */
function propertyKey(holder: ts.Node, name: string): string {
	return ts.isVariableDeclaration(holder) ? `variable ${holder.pos}:${name}` : `top ${topLevel(holder).pos}:${name}`;
}

/** The variable an object literal is written into, or the object itself when it goes elsewhere. */
function objectHolder(object: ts.Node): ts.Node {
	const target = destination(object);
	return target && ts.isVariableDeclaration(target) ? target : object;
}

/** The variable a rendered `object.property` reads its object from, when that object is a literal written into it. */
function readObjectHolder(access: ts.PropertyAccessExpression): ts.Node {
	const base = unwrap(access.expression);
	const declaration = ts.isIdentifier(base) ? declarationOf(base) : undefined;
	const value = declaration?.initializer && unwrap(declaration.initializer);
	return declaration && value && ts.isObjectLiteralExpression(value) ? declaration : access;
}

/** Marks a rendered variable, and the variables it was copied from (`const b = a`). */
function markVariable(variables: Set<ts.VariableDeclaration>, node: ts.Identifier) {
	for (let declaration = declarationOf(node); declaration && !variables.has(declaration); ) {
		variables.add(declaration);
		const value = declaration.initializer && unwrap(declaration.initializer);
		declaration = value && ts.isIdentifier(value) ? declarationOf(value) : undefined;
	}
}

/** What a file renders as text: `{status}` marks the variable `status`, `{config.label}` the property `label` in that top-level declaration. Screen-reader-only text marks nothing. */
function renderedValues(scan: Scan): Rendered {
	const rendered: Rendered = { variables: new Set(), properties: new Set() };
	const collect = (node: ts.Node) => {
		const visible = (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) && renderedInJsx(node) && !screenReaderOnly(scan, node);
		if (visible && ts.isIdentifier(node) && !ts.isPropertyAccessExpression(node.parent)) markVariable(rendered.variables, node);
		if (visible && ts.isPropertyAccessExpression(node)) rendered.properties.add(propertyKey(readObjectHolder(node), node.name.text));
		ts.forEachChild(node, collect);
	};
	collect(scan.source);
	return rendered;
}

/** The variable or property a value is assigned to after its declaration: `status = value`, `config.label = value`. */
function assignedTo(target: ts.Node, value: ts.Node): string | ts.VariableDeclaration | undefined {
	if (!ts.isBinaryExpression(target) || target.operatorToken.kind !== ts.SyntaxKind.EqualsToken || target.right !== value) return undefined;
	const left = unwrap(target.left);
	if (ts.isIdentifier(left)) return declarationOf(left);
	return ts.isPropertyAccessExpression(left) ? propertyKey(readObjectHolder(left), left.name.text) : undefined;
}

/** Whether a value is shown as text: rendered as a JSX child, or held in a variable or property the file renders. */
function shown(scan: Scan, node: ts.Node): boolean {
	const target = destination(node);
	if (!target) return false;
	if (ts.isJsxExpression(target)) return !ts.isJsxAttribute(target.parent);
	if (ts.isVariableDeclaration(target)) return scan.rendered.variables.has(target);
	if (ts.isPropertyAssignment(target)) return scan.rendered.properties.has(propertyKey(objectHolder(target.parent), target.name.getText(scan.source)));
	const assigned = assignedTo(target, destinationChild(node, target));
	return typeof assigned === "string" ? scan.rendered.properties.has(assigned) : !!assigned && scan.rendered.variables.has(assigned);
}

/** The child of `target` that a value travelled through to reach it. */
function destinationChild(node: ts.Node, target: ts.Node): ts.Node {
	let child = node;
	while (child.parent && child.parent !== target) child = child.parent;
	return child;
}

const isStringLike = (node: ts.Node): node is ts.StringLiteralLike | ts.TemplateLiteralLikeNode =>
	ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);

const TRANSLATION_APIS = new Set(["useTranslations", "getTranslations"]);

/** Whether an expression makes a translator: `useTranslations(...)`, or `await getTranslations(...)`. */
function translationFactory(node: ts.Expression | undefined): boolean {
	const value = node && unwrap(node);
	const call = value && (ts.isAwaitExpression(value) ? unwrap(value.expression) : value);
	return !!call && ts.isCallExpression(call) && ts.isIdentifier(call.expression) && TRANSLATION_APIS.has(call.expression.text);
}

// next-intl's ways to read a message besides calling the translator: `t.rich("key")`, `t.markup("key")`, `t.raw("key")`.
const TRANSLATION_METHODS = new Set(["rich", "markup", "raw"]);

/** Whether a called expression translates: named like `t`, `tc` or `tUI`, bound to a translation factory, one called directly, or one of its message methods. */
function translates(callee: ts.Expression): boolean {
	if (ts.isPropertyAccessExpression(callee)) return TRANSLATION_METHODS.has(callee.name.text) && translates(callee.expression);
	if (!ts.isIdentifier(callee)) return translationFactory(callee);
	return TRANSLATE.test(callee.text) || translationFactory(declaredValue(callee));
}

/** The translation call a string is the key of, as in `t("loadingData")`. */
function translationCall(node: ts.Node): ts.CallExpression | undefined {
	const call = node.parent;
	if (!ts.isCallExpression(call) || call.arguments[0] !== node) return undefined;
	return translates(call.expression) ? call : undefined;
}

/** Whether a node sits in an element only screen readers get, in every class its condition can give, where a Loading label names a spinner. */
function screenReaderOnly(scan: Scan, node: ts.Node): boolean {
	for (let parent = node.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
		if (!ts.isJsxElement(parent)) continue;
		const className = parent.openingElement.attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(scan.source) === "className");
		// `not-sr-only` under any variant shows the text again, as `sr-only md:not-sr-only` does on wide screens.
		return classLists(scan, className && ts.isJsxAttribute(className) ? className.initializer : undefined).every((list) => SR_ONLY.test(list) && !/not-sr-only/.test(list));
	}
	return false;
}

/** Whether a string shows a Loading label as text: the label itself, or the key of a translated one. */
function showsLoading(scan: Scan, node: ts.StringLiteralLike | ts.TemplateLiteralLikeNode): boolean {
	const whole = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
	if (whole && LOADING.test(node.text.trim()) && shown(scan, node)) return true;
	const call = translationCall(node);
	return !!call && scan.loadingKeys.has(node.text.split(".").at(-1) ?? "") && shown(scan, call);
}

function checkString(scan: Scan, node: ts.StringLiteralLike | ts.TemplateLiteralLikeNode) {
	const uppercaseClass = UPPERCASE_CLASS.test(node.text) && classContext(node, scan.source);
	if (UPPERCASE_CSS.test(node.text) || uppercaseClass) report(scan, node, "uppercase");
	if (GRID_CLASS.test(node.text) && SCROLL_CLASS.test(node.text) && !COLUMNS_CLASS.test(node.text) && classContext(node, scan.source)) report(scan, node, "grid-scroll");
	if (DOT.test(node.text)) report(scan, node, "dot-separator");
	if (showsLoading(scan, node) && !screenReaderOnly(scan, node)) report(scan, node, "loading-text");
}

function checkText(scan: Scan, node: ts.JsxText) {
	if (DOT.test(node.text)) report(scan, node, "dot-separator");
	if (LOADING.test(node.text.trim()) && !screenReaderOnly(scan, node)) report(scan, node, "loading-text");
}

/** Whether a Framer prop is set to a literal false (`layout={false}`), which turns its animation off. */
const switchedOff = (attribute: ts.JsxAttribute) =>
	!!attribute.initializer && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression?.kind === ts.SyntaxKind.FalseKeyword;

type Attributes = { classLists: string[]; framer: boolean; title: ts.JsxAttribute | null };

function readAttributes(node: ts.JsxOpeningLikeElement, scan: Scan): Attributes {
	const source = scan.source;
	const tag = node.tagName.getText(source);
	const read: Attributes = { classLists: [""], framer: false, title: null };
	for (const attribute of node.attributes.properties.filter(ts.isJsxAttribute)) {
		const name = attribute.name.getText(source);
		if (name === "className") read.classLists = classLists(scan, attribute.initializer);
		if (name === "title") read.title = attribute;
		read.framer ||= FRAMER_PROPS.has(name) && MOTION_TAG.test(tag) && !switchedOff(attribute);
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

// A picture beside text: an icon, an avatar, a tile, a cover or an image; and a value passed in to render as one.
const PICTURE = /^(img|Image|Hugeicon)$|(Icon|Avatar|Flag|Tile|Cover|Face)$/;
const PICTURE_VALUE = /^(icon|avatar|cover|logo|picture|image)$|(Icon|Avatar|Cover|Logo)$/;
// Where icons come from: Hugeicons, and the app's own brand icons.
const ICON_MODULE = /^(@\/components\/icons(\/.*)?|@hugeicons\/.+|simple-icons)$/;
// The tags that take a line of their own.
const BLOCK_TAG = /^(p|div|h[1-6]|ul|ol|dl|section|header|footer)$/;

/** Whether a class list holds this utility with no variant: `items-center`, not `sm:items-center`. */
const hasUtility = (list: string, name: string) => list.split(/[\s"'`{}()]+/).includes(name);
type Child = ts.JsxElement | ts.JsxSelfClosingElement | ts.Expression;
const jsx = (node: ts.Node): node is ts.JsxElement | ts.JsxSelfClosingElement => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
const opening = (element: ts.JsxElement | ts.JsxSelfClosingElement) => (ts.isJsxElement(element) ? element.openingElement : element);
const tagOf = (scan: Scan, element: Child) => (jsx(element) ? opening(element).tagName.getText(scan.source) : "");
/** The last name in an expression: `item.icon` is `icon`. */
const lastName = (node: ts.Expression) => (ts.isIdentifier(node) ? node.text : ts.isPropertyAccessExpression(node) ? node.name.text : "");

function classesOf(scan: Scan, element: Child): string[] {
	const attribute = jsx(element) ? opening(element).attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.getText(scan.source) === "className") : undefined;
	return attribute && ts.isJsxAttribute(attribute) ? classLists(scan, attribute.initializer) : [""];
}

/** What a wrapper around a child renders: a JSX expression's value, a parenthesized one, both sides of a condition, the right of `&&`. */
function wrapped(node: ts.Node): ts.Node[] | undefined {
	if (ts.isJsxExpression(node)) return node.expression ? [node.expression] : [];
	if (ts.isParenthesizedExpression(node)) return [node.expression];
	if (ts.isConditionalExpression(node)) return [node.whenTrue, node.whenFalse];
	return ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? [node.right] : undefined;
}

/** What a child can render, through conditions: `a ? <X /> : <Y />` gives both, `a && <X />` gives X, `{icon}` gives itself. */
function renderable(node: ts.Node): Child[] {
	if (jsx(node)) return [node];
	const inner = wrapped(node);
	if (inner) return inner.flatMap(renderable);
	return ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) || ts.isCallExpression(node) ? [node] : [];
}

/** An element's children, each as what it can render; text renders none. */
const slots = (element: Child) => (ts.isJsxElement(element) ? element.children.map(renderable).filter((slot) => slot.length > 0) : []);

/** A picture, a value named for one (`{icon}`), or a tile around one picture (`<span className="flex size-9 …"><Hugeicon … /></span>`). */
function isPicture(scan: Scan, icons: ReadonlySet<string>, element: Child): boolean {
	if (!jsx(element)) return PICTURE_VALUE.test(lastName(element));
	const tag = tagOf(scan, element);
	if (PICTURE.test(tag) || icons.has(tag) || /\.icon$/.test(tag)) return true;
	const inner = slots(element);
	return /^[a-z]/.test(tag) && inner.length === 1 && inner[0].every((child) => isPicture(scan, icons, child));
}

const takesLine = (scan: Scan, element: Child) =>
	BLOCK_TAG.test(tagOf(scan, element)) || classesOf(scan, element).some((list) => ["block", "flex", "grid"].some((name) => hasUtility(list, name)));

/** Text that runs to a second line: a title with a line under it, stacked by a column or by elements that take a line each. */
function stacks(scan: Scan, element: Child): boolean {
	if (!ts.isJsxElement(element)) return false;
	const lists = classesOf(scan, element);
	if (lists.some((list) => hasUtility(list, "truncate"))) return false;
	const column = lists.some((list) => hasUtility(list, "flex-col") || /(^|\s)space-y-/.test(list));
	if (!column && lists.some((list) => hasUtility(list, "flex") || hasUtility(list, "inline-flex"))) return false;
	return slots(element).filter((slot) => column || slot.some((child) => takesLine(scan, child))).length >= 2;
}

/**
 * A row of a set height keeps its text centred however it is aligned, so self-start there would lift the picture off
 * the text instead; it is left alone. `height: auto` sets nothing.
 */
const setHeight = (scan: Scan, row: ts.JsxElement) =>
	classesOf(scan, row).every((list) => /(^|[\s"'`])h-(\d|\[)/.test(list)) ||
	row.openingElement.attributes.properties.some(
		(property) => ts.isJsxAttribute(property) && property.name.getText(scan.source) === "style" && /\bheight\s*:(?!\s*["'`]?auto\b)/.test(property.initializer?.getText(scan.source) ?? ""),
	);

/** Whether a class list centres a row at any screen size (`items-center`, `sm:items-center`), unless it is a column there. */
function centres(list: string): boolean {
	const tokens = list.split(/[\s"'`{}()]+/);
	const row = !hasUtility(list, "flex-col") || tokens.some((token) => utility(token) === "flex-row");
	return row && tokens.some((token) => utility(token) === "items-center");
}

/** The icons a file imports, which are often named for what they show rather than `…Icon`. */
const importedIcons = (source: ts.SourceFile) =>
	new Set(
		source.statements.flatMap((statement) =>
			ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && ICON_MODULE.test(statement.moduleSpecifier.text) && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
				? statement.importClause.namedBindings.elements.map((element) => element.name.text)
				: [],
		),
	);

/** A centred row that leads with a picture beside text that stacks; a picture after the text, such as a chevron, may stay centred. */
function checkRow(scan: Scan, icons: ReadonlySet<string>, row: ts.JsxElement) {
	const centred = classesOf(scan, row).some(centres);
	if (!centred || setHeight(scan, row)) return;
	const children = slots(row);
	const at = children.findIndex((slot) => slot.some((child) => isPicture(scan, icons, child)));
	const pictures = at < 0 ? [] : children[at].filter((child) => isPicture(scan, icons, child));
	const anchored = (picture: Child) => classesOf(scan, picture).every((list) => hasUtility(list, "self-start"));
	if (pictures.length > 0 && !pictures.every(anchored) && children.slice(at + 1).some((slot) => slot.some((child) => stacks(scan, child)))) report(scan, pictures[0], "icon-top");
}

function checkElement(scan: Scan, node: ts.JsxOpeningLikeElement) {
	const tag = node.tagName.getText(scan.source);
	const read = readAttributes(node, scan);
	if (read.classLists.some((list) => clashes(list, read.framer))) report(scan, node, "animation-clash");
	if (nativeTooltip(node, tag, read)) report(scan, read.title!, "native-title");
}

function visit(scan: Scan, icons: ReadonlySet<string>, node: ts.Node) {
	if (classValue(node) && !insideClassList(node, scan.source) && clashesAlone(scan, node)) report(scan, node, "animation-clash");
	if (isStringLike(node)) checkString(scan, node);
	if (ts.isJsxText(node)) checkText(scan, node);
	if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) checkElement(scan, node);
	if (ts.isJsxElement(node)) checkRow(scan, icons, node);
	ts.forEachChild(node, (child) => visit(scan, icons, child));
}

/** The problems in one .ts or .tsx file; `loadingKeys` are the message keys whose text is a Loading label. */
export function sourceProblems(file: string, text: string, loadingKeys: ReadonlySet<string> = new Set()): string[] {
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
	const scan: Scan = { file, source, lines: text.split("\n"), lists: new Map(), loadingKeys, rendered: { variables: new Set(), properties: new Set() }, found: [] };
	scan.rendered = renderedValues(scan);
	visit(scan, importedIcons(source), source);
	return scan.found;
}

// The words of a CSS transition that name no property.
const TIMING = /^(ease(-in|-out|-in-out)?|linear|step-start|step-end|allow-discrete|normal|-?[\d.]+m?s)$/;

/** Whether one item of a `transition` shorthand moves opacity or transform; an item that names no property transitions all. */
function cssItemMoves(item: string): boolean {
	const words = item.split(/\s+/).filter((word) => word && !TIMING.test(word));
	return words.length === 0 || words.some((word) => MOVING.has(word));
}

type Declaration = [property: string, value: string];

/** The declaration of these properties that applies: a later one wins unless an earlier one is !important. Its value comes without the !important. */
function cascade(declarations: Declaration[], properties: string[]): Declaration | undefined {
	let applied: Declaration | undefined;
	let important = false;
	for (const [property, value] of declarations.filter(([name]) => properties.includes(name))) {
		const strong = /!important\s*$/i.test(value);
		if (strong || !important) applied = [property, value.replace(/!important\s*$/i, "").trim()];
		important ||= strong;
	}
	return applied;
}

/** A comma-separated CSS list; functions go first, so the commas inside cubic-bezier() don't split it. */
const cssList = (value: string) => value.replace(/[\w-]+\([^)]*\)/g, " ").split(",").map((item) => item.trim());

/** Whether a CSS animation or transition declaration animates, or moves opacity or transform. */
const cssAnimates = (animation: Declaration | undefined) => !!animation && cssList(animation[1]).some((item) => item !== "" && !/(^|\s)none(\s|$)/i.test(item));
const cssMoves = (transition: Declaration | undefined) =>
	!!transition && cssList(transition[1]).some((item) => (transition[0] === "transition" ? cssItemMoves(item) : MOVING.has(item)));

// `transition`, `transition-colors` or `transition-[opacity]`; `transition-discrete` and `transition-normal` set behaviour, not properties.
const TRANSITION_UTILITY = /^transition(?!-(none|discrete|normal)$)(-|$)/;
const APPLIED_NONE: Record<string, Declaration> = { "animate-none": ["animation", "none"], "transition-none": ["transition-property", "none"] };

/** What one `@apply` utility sets, as the cascade sees it: an animation, or the properties a transition covers. */
function appliedValue(token: string): Declaration | undefined {
	const name = utility(token);
	if (animates(token)) return ["animation", name];
	if (TRANSITION_UTILITY.test(name)) return ["transition-property", transitionsMovement(token) ? "all" : "color"];
	return APPLIED_NONE[name];
}

/** What one `@apply` utility declares, !important when it or the whole directive carries the mark. */
function appliedDeclaration(token: string, directiveImportant: boolean): Declaration | undefined {
	const declaration = appliedValue(token);
	const important = directiveImportant || /^!|!$/.test(token.split(":").at(-1) ?? "");
	return declaration && important ? [declaration[0], `${declaration[1]} !important`] : declaration;
}

/** The state or screen variants a utility applies under (`hover:`, `md:`); pseudo-elements are its box instead. */
const scope = (token: string) =>
	token
		.split(":")
		.slice(0, -1)
		.filter((variant) => !PSEUDO_ELEMENTS.has(variant))
		.join(":");

/** The declarations an `@apply` list makes, each keyed by the box it styles and the variants it applies under. */
function applyList(list: string): [string, Declaration][] {
	const tokens = list.split(/\s+/).filter(Boolean);
	// `@apply a b !important` makes every utility in it important.
	const important = tokens.includes("!important");
	return tokens.flatMap((token) => {
		const declaration = token === "!important" ? undefined : appliedDeclaration(token, important);
		return declaration ? [[`${box(token)}|${scope(token)}`, declaration] as [string, Declaration]] : [];
	});
}

/**
 * One rule's declarations, in source order, for each box and variant they
 * apply under; `@apply` utilities join where they're written. A variant
 * (`hover:animate-none`) adds to its box's own declarations, never replaces
 * them outside that state; each box is also checked with each pair of its
 * states together, unless they can never hold at once.
 */
function ruleDeclarations(body: string): Declaration[][] {
	const scopes = new Map<string, Declaration[]>([["|", []]]);
	const add = (key: string, declaration: Declaration) => scopes.set(key, [...(scopes.get(key) ?? []), declaration]);
	for (const part of body.split(";").map((piece) => piece.trim())) {
		const applied = part.match(/^@apply\s+([\s\S]+)$/)?.[1];
		const [name, ...value] = part.split(":");
		if (applied) for (const [key, declaration] of applyList(applied)) add(key, declaration);
		else if (value.length) add("|", [name.trim().toLowerCase(), value.join(":").trim()]);
	}
	const keys = [...scopes.keys()];
	return keys.flatMap((key) =>
		keys
			.filter((other) => boxOf(other) === boxOf(key))
			.map((other) => [...new Set([...variantsOf(key), ...variantsOf(other)])])
			.filter(compatible)
			.map((variants) => scopeDeclarations(scopes, key, variants)),
	);
}

const variantsOf = (key: string) => key.split("|")[1].split(":").filter(Boolean);
const boxOf = (key: string) => key.split("|")[0];
// Variants that never hold at once; a breakpoint never holds with its `max-` form either.
const EXCLUSIVE = [
	["motion-safe", "motion-reduce"],
	["portrait", "landscape"],
	["ltr", "rtl"],
	["dark", "light"],
	["enabled", "disabled"],
	["required", "optional"],
	["valid", "invalid"],
	["user-valid", "user-invalid"],
	["in-range", "out-of-range"],
];
/** Whether variants can all hold at once, as `dark:` and `hover:` do when the page is dark and hovered. */
const compatible = (variants: string[]) =>
	!EXCLUSIVE.some(([a, b]) => variants.includes(a) && variants.includes(b)) && !variants.some((variant) => variants.includes(`max-${variant}`));

/** A box's declarations under these variants: each state on top of every less specific state it includes, `dark:hover:` on `dark:` on the base. */
function scopeDeclarations(scopes: Map<string, Declaration[]>, key: string, variants: string[]): Declaration[] {
	return [...scopes]
		.filter(([other]) => boxOf(other) === boxOf(key) && variantsOf(other).every((variant) => variants.includes(variant)))
		.sort(([a], [b]) => variantsOf(a).length - variantsOf(b).length)
		.flatMap(([, declarations]) => declarations);
}

/** Whether one box of a CSS rule, in any state, both animates and transitions opacity or transform. */
const cssClashes = (body: string) =>
	ruleDeclarations(body).some(
		(declarations) => cssAnimates(cascade(declarations, ["animation", "animation-name"])) && cssMoves(cascade(declarations, ["transition", "transition-property"])),
	);

/** Each CSS rule's own declarations, without the rules nested in it, and where its brace opens. */
function cssRules(text: string): { start: number; body: string }[] {
	const rules: { start: number; body: string }[] = [];
	const open: { start: number; body: string }[] = [];
	for (let index = 0; index < text.length; index++) {
		const parent = open.at(-1);
		if (text[index] === "{") {
			// The text since the parent's last declaration is the nested rule's selector.
			if (parent) parent.body = parent.body.replace(/[^;]*$/, "");
			open.push({ start: index, body: "" });
		} else if (text[index] === "}") {
			rules.push(...open.splice(-1));
			if (open.length) open[open.length - 1].body += ";";
		} else if (parent) parent.body += text[index];
	}
	return rules;
}

/** Uppercase declarations, and rules that animate and transition opacity or transform, in one stylesheet. */
export function stylesheetProblems(file: string, text: string): string[] {
	const lines = text.split("\n");
	const uppercase = lines.flatMap((line, index) => (UPPERCASE_CSS.test(line) && !allowed(lines[index - 1], "uppercase") ? [`${file}:${index + 1} uppercase: ${FIX.uppercase}`] : []));
	// Comments blanked with their newlines kept, so a brace in one can't open a rule.
	const plain = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
	const clashing = cssRules(plain)
		.filter((rule) => cssClashes(rule.body))
		.map((rule) => plain.slice(0, rule.start).split("\n").length)
		.sort((a, b) => a - b)
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
