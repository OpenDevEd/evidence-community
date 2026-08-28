import ts from "typescript";

/** One piece of wording a screen asks for: which group, which key. */
export type WordingUse = {
	file: string;
	group: string;
	key: string;
};

/** A place where the key is worked out while the app runs, not written down. */
export type DynamicWordingUse = {
	file: string;
	group: string;
	line: number;
};

export type WordingScan = {
	uses: WordingUse[];
	dynamic: DynamicWordingUse[];
};

/** Every group of messages, as `{ ui: { cancel: "Cancel" } }`. */
export type Messages = Record<string, Record<string, unknown>>;

/** The ways next-intl reads a message once the group is chosen. */
const READ_METHODS = new Set(["rich", "markup", "raw"]);

/** A stack of scopes, so `t` can mean a different group in each function. */
type Scopes = Map<string, string>[];

function lookUp(scopes: Scopes, name: string) {
	for (let index = scopes.length - 1; index >= 0; index -= 1) {
		const group = scopes[index].get(name);
		if (group !== undefined) return group;
	}

	return undefined;
}

/** The group named in `useTranslations("ui")`, when there is one. */
function translationsGroup(node: ts.Node): string | undefined {
	if (!ts.isCallExpression(node)) return undefined;
	if (!ts.isIdentifier(node.expression)) return undefined;
	if (node.expression.text !== "useTranslations") return undefined;

	const [argument] = node.arguments;
	if (argument && ts.isStringLiteralLike(argument)) return argument.text;

	// `useTranslations()` reads the top level, which has no group name.
	return argument ? undefined : "";
}

/** The reader variable a call goes through, as in `t(...)` or `t.rich(...)`. */
function readerName(call: ts.CallExpression): string | undefined {
	if (ts.isIdentifier(call.expression)) return call.expression.text;
	if (
		ts.isPropertyAccessExpression(call.expression) &&
		ts.isIdentifier(call.expression.expression) &&
		READ_METHODS.has(call.expression.name.text)
	) {
		return call.expression.expression.text;
	}

	return undefined;
}

/** The ways a screen picks one of two names it has written out. */
const CHOICE_OPERATORS = new Set([
	ts.SyntaxKind.BarBarToken,
	ts.SyntaxKind.QuestionQuestionToken,
]);

/** Both sides of a choice, but only when both are written out. */
function bothSides(left: ts.Expression, right: ts.Expression) {
	const first = writtenKeys(left);
	const second = writtenKeys(right);

	return first && second ? [...first, ...second] : null;
}

/**
 * Every name a wording argument can end up being, when they are all written
 * out. `t(open ? "a" : "b")` gives both. Anything worked out while the app
 * runs gives nothing.
 */
function writtenKeys(node: ts.Expression): string[] | null {
	if (ts.isStringLiteralLike(node)) return [node.text];
	if (ts.isParenthesizedExpression(node)) return writtenKeys(node.expression);
	if (ts.isConditionalExpression(node)) {
		return bothSides(node.whenTrue, node.whenFalse);
	}
	if (
		ts.isBinaryExpression(node) &&
		CHOICE_OPERATORS.has(node.operatorToken.kind)
	) {
		return bothSides(node.left, node.right);
	}

	return null;
}

/** True when the node opens a new set of names, such as a function body. */
function opensScope(node: ts.Node) {
	return (
		ts.isFunctionDeclaration(node) ||
		ts.isFunctionExpression(node) ||
		ts.isArrowFunction(node) ||
		ts.isMethodDeclaration(node) ||
		ts.isBlock(node) ||
		ts.isSourceFile(node)
	);
}

/** Reads the wording one file asks for, by parsing it rather than matching text. */
export function scanWordingInSource(file: string, source: string): WordingScan {
	const tree = ts.createSourceFile(
		file,
		source,
		ts.ScriptTarget.Latest,
		true,
		file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
	const uses: WordingUse[] = [];
	const dynamic: DynamicWordingUse[] = [];

	const record = (group: string, call: ts.CallExpression) => {
		const [argument] = call.arguments;
		const keys = argument ? writtenKeys(argument) : null;
		if (keys) {
			for (const key of keys) uses.push({ file, group, key });

			return;
		}

		dynamic.push({
			file,
			group,
			line:
				tree.getLineAndCharacterOfPosition(call.getStart(tree)).line + 1,
		});
	};

	/** Remembers `const t = useTranslations("ai")` for the scope it is in. */
	const declareReader = (node: ts.Node, scopes: Scopes) => {
		if (!ts.isVariableDeclaration(node) || !node.initializer) return;
		const group = translationsGroup(node.initializer);
		if (group === undefined || !ts.isIdentifier(node.name)) return;
		scopes[scopes.length - 1].set(node.name.text, group);
	};

	const readCall = (node: ts.Node, scopes: Scopes) => {
		if (!ts.isCallExpression(node)) return;
		// `useTranslations("ai")("askAI")` reads a message straight away.
		const direct = translationsGroup(node.expression);
		if (direct !== undefined) record(direct, node);

		const name = readerName(node);
		if (name === undefined) return;
		const group = lookUp(scopes, name);
		if (group !== undefined) record(group, node);
	};

	const visit = (node: ts.Node, scopes: Scopes) => {
		const next = opensScope(node) ? [...scopes, new Map()] : scopes;
		declareReader(node, next);
		readCall(node, next);
		node.forEachChild((child) => visit(child, next));
	};

	visit(tree, []);

	return { uses, dynamic };
}

/** Puts the wording of many files together, keeping each place it is used. */
export function scanWording(
	files: { file: string; source: string }[],
): WordingScan {
	const uses: WordingUse[] = [];
	const dynamic: DynamicWordingUse[] = [];
	for (const { file, source } of files) {
		const scan = scanWordingInSource(file, source);
		uses.push(...scan.uses);
		dynamic.push(...scan.dynamic);
	}

	return { uses, dynamic };
}

/** The wording a screen asks for that this language does not have. */
export function missingWording(uses: WordingUse[], messages: Messages) {
	const missing = new Set<string>();
	for (const { group, key } of uses) {
		const value = group ? messages[group]?.[key] : messages[key];
		if (typeof value !== "string") missing.add(`${group}.${key}`);
	}

	return [...missing].sort();
}
