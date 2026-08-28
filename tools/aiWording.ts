import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

/** The ways next-intl hands a message back once the group is chosen. */
export type WordingMethod = "call" | "rich" | "markup" | "raw";

/** One piece of wording a screen asks for: which group, which key, read how. */
export type WordingUse = {
	file: string;
	group: string;
	key: string;
	method: WordingMethod;
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
	/** Translators this file hands to another function. */
	handedOver: InjectedTranslators;
};

/** Every group of messages, as `{ ui: { cancel: "Cancel" } }`. */
export type Messages = Record<string, Record<string, unknown>>;

/** The package that provides wording. Nothing else counts. */
const WORDING_PACKAGE = "next-intl";
const WORDING_HOOK = "useTranslations";
/** Reading a message through one of these still needs the message to exist. */
const READ_METHODS: Record<string, WordingMethod> = {
	rich: "rich",
	markup: "markup",
	raw: "raw",
};

/**
 * What a name means where it is used. A group name is a translator for that
 * group; `NOT_A_TRANSLATOR` is anything else, and it hides a translator of the
 * same name further out.
 */
const NOT_A_TRANSLATOR = Symbol("not a translator");
/** next-intl's own `useTranslations`, under whatever name it came in. */
const WORDING_HOOK_BINDING = Symbol("next-intl useTranslations");
/** A whole next-intl namespace, as in `import * as intl from "next-intl"`. */
const WORDING_NAMESPACE_BINDING = Symbol("next-intl namespace");
type Binding =
	| string
	| typeof NOT_A_TRANSLATOR
	| typeof WORDING_HOOK_BINDING
	| typeof WORDING_NAMESPACE_BINDING;
type Scopes = Map<string, Binding>[];

/**
 * Translators handed to another function as an argument, by the name of that
 * function and which argument it is. `AI_DROPDOWN_ITEMS(t, ...)` in one file
 * tells us what `t` means inside `AI_DROPDOWN_ITEMS` in another.
 */
export type InjectedTranslators = Map<string, Map<number, string>>;

/** What a name means where it is used, looking outwards through the scopes. */
function lookUp(scopes: Scopes, name: string): Binding | undefined {
	for (let index = scopes.length - 1; index >= 0; index -= 1) {
		const binding = scopes[index].get(name);
		if (binding !== undefined) return binding;
	}

	return undefined;
}

/**
 * True when this call goes to next-intl's own hook. The name is looked up
 * where it is used, so anything else of the same name hides it.
 */
function isWordingHook(callee: ts.Expression, scopes: Scopes) {
	if (ts.isIdentifier(callee)) {
		return lookUp(scopes, callee.text) === WORDING_HOOK_BINDING;
	}

	return (
		ts.isPropertyAccessExpression(callee) &&
		ts.isIdentifier(callee.expression) &&
		lookUp(scopes, callee.expression.text) ===
			WORDING_NAMESPACE_BINDING &&
		callee.name.text === WORDING_HOOK
	);
}

/** The group named in a real `useTranslations("ui")` call, when there is one. */
function translationsGroup(
	node: ts.Node,
	scopes: Scopes,
): string | undefined {
	if (!ts.isCallExpression(node)) return undefined;
	if (!isWordingHook(node.expression, scopes)) return undefined;

	const [argument] = node.arguments;
	if (argument && ts.isStringLiteralLike(argument)) return argument.text;

	// `useTranslations()` reads the top level, which has no group name.
	return argument ? undefined : "";
}

/** The reader a call goes through, and how it reads the message. */
function readerOf(call: ts.CallExpression) {
	if (ts.isIdentifier(call.expression)) {
		return { name: call.expression.text, method: "call" as const };
	}
	if (
		ts.isPropertyAccessExpression(call.expression) &&
		ts.isIdentifier(call.expression.expression)
	) {
		const method = READ_METHODS[call.expression.name.text];
		if (method) {
			return { name: call.expression.expression.text, method };
		}
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

/** Nodes that give a name to something that is never a translator. */
const NAMED_DECLARATIONS = new Set<ts.SyntaxKind>([
	ts.SyntaxKind.ClassDeclaration,
	ts.SyntaxKind.FunctionDeclaration,
]);

/** The kinds of node that open a new set of names, such as a function body. */
const SCOPE_KINDS = new Set<ts.SyntaxKind>([
	ts.SyntaxKind.ArrowFunction,
	ts.SyntaxKind.Block,
	ts.SyntaxKind.CatchClause,
	ts.SyntaxKind.Constructor,
	ts.SyntaxKind.ForInStatement,
	ts.SyntaxKind.ForOfStatement,
	ts.SyntaxKind.ForStatement,
	ts.SyntaxKind.FunctionDeclaration,
	ts.SyntaxKind.FunctionExpression,
	ts.SyntaxKind.GetAccessor,
	ts.SyntaxKind.MethodDeclaration,
	ts.SyntaxKind.SetAccessor,
	ts.SyntaxKind.SourceFile,
]);

/** Every plain name a binding introduces, including destructured ones. */
function boundNames(name: ts.BindingName): string[] {
	if (ts.isIdentifier(name)) return [name.text];

	return name.elements.flatMap((element) =>
		ts.isBindingElement(element) ? boundNames(element.name) : [],
	);
}

/** Reads the wording one file asks for, by parsing it rather than matching text. */
export function scanWordingInSource(
	file: string,
	source: string,
	injected: InjectedTranslators = new Map(),
): WordingScan {
	const tree = ts.createSourceFile(
		file,
		source,
		ts.ScriptTarget.Latest,
		true,
		file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
	const uses: WordingUse[] = [];
	const dynamic: DynamicWordingUse[] = [];
	const handedOver: InjectedTranslators = new Map();

	const record = (
		group: string,
		method: WordingMethod,
		call: ts.CallExpression,
	) => {
		const [argument] = call.arguments;
		const keys = argument ? writtenKeys(argument) : null;
		if (keys) {
			for (const key of keys) uses.push({ file, group, key, method });

			return;
		}

		dynamic.push({
			file,
			group,
			line:
				tree.getLineAndCharacterOfPosition(call.getStart(tree)).line + 1,
		});
	};

	/** Records a name in the scope it belongs to, translator or not. */
	const bind = (scopes: Scopes, name: ts.BindingName, binding: Binding) => {
		const scope = scopes[scopes.length - 1];
		for (const bound of boundNames(name)) scope.set(bound, binding);
	};

	/** What a `const` introduces: a translator for a group, or anything else. */
	const declaredVariable = (
		node: ts.VariableDeclaration,
		scopes: Scopes,
	): Binding => {
		const group = node.initializer
			? translationsGroup(node.initializer, scopes)
			: undefined;

		return group ?? NOT_A_TRANSLATOR;
	};

	/** What each name a named import brings in actually is. */
	const declareNamedImports = (
		bindings: ts.NamedImportBindings,
		fromNextIntl: boolean,
		scopes: Scopes,
	) => {
		if (ts.isNamespaceImport(bindings)) {
			bind(
				scopes,
				bindings.name,
				fromNextIntl ? WORDING_NAMESPACE_BINDING : NOT_A_TRANSLATOR,
			);

			return;
		}
		for (const element of bindings.elements) {
			const imported = element.propertyName?.text ?? element.name.text;
			bind(
				scopes,
				element.name,
				fromNextIntl && imported === WORDING_HOOK
					? WORDING_HOOK_BINDING
					: NOT_A_TRANSLATOR,
			);
		}
	};

	/** What each name an import line brings in actually is. */
	const declareImport = (node: ts.ImportDeclaration, scopes: Scopes) => {
		const clause = node.importClause;
		if (!clause) return;
		if (clause.name) bind(scopes, clause.name, NOT_A_TRANSLATOR);
		if (!clause.namedBindings) return;

		declareNamedImports(
			clause.namedBindings,
			ts.isStringLiteralLike(node.moduleSpecifier) &&
				node.moduleSpecifier.text === WORDING_PACKAGE,
			scopes,
		);
	};

	/** Names introduced where the node itself sits. */
	const declare = (node: ts.Node, scopes: Scopes) => {
		if (ts.isImportDeclaration(node)) {
			declareImport(node, scopes);

			return;
		}
		if (ts.isVariableDeclaration(node)) {
			bind(scopes, node.name, declaredVariable(node, scopes));

			return;
		}
		if (!NAMED_DECLARATIONS.has(node.kind)) return;
		const { name } = node as { name?: ts.Identifier };
		if (name) bind(scopes, name, NOT_A_TRANSLATOR);
	};

	/** The name a function is known by, so a handed-over translator can find it. */
	const functionName = (node: ts.SignatureDeclarationBase) => {
		if (ts.isFunctionDeclaration(node)) return node.name?.text;
		const parent = node.parent;

		return ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)
			? parent.name.text
			: undefined;
	};

	/** A function's own arguments belong to the function, not to its caller. */
	const declareParameters = (node: ts.Node, scopes: Scopes) => {
		if (ts.isCatchClause(node)) {
			if (node.variableDeclaration) {
				bind(scopes, node.variableDeclaration.name, NOT_A_TRANSLATOR);
			}

			return;
		}
		if (!ts.isFunctionLike(node)) return;

		const handed = injected.get(functionName(node) ?? "");
		node.parameters.forEach((parameter, index) => {
			const group = handed?.get(index);
			bind(scopes, parameter.name, group ?? NOT_A_TRANSLATOR);
		});
	};

	/** Notes a translator passed straight into another function. */
	const noteHandOver = (node: ts.CallExpression, scopes: Scopes) => {
		if (!ts.isIdentifier(node.expression)) return;
		node.arguments.forEach((argument, index) => {
			if (!ts.isIdentifier(argument)) return;
			const binding = lookUp(scopes, argument.text);
			if (typeof binding !== "string") return;
			const perFunction =
				handedOver.get(node.expression.getText()) ??
				new Map<number, string>();
			perFunction.set(index, binding);
			handedOver.set(node.expression.getText(), perFunction);
		});
	};

	const readCall = (node: ts.Node, scopes: Scopes) => {
		if (!ts.isCallExpression(node)) return;
		// `useTranslations("ai")("askAI")` reads a message straight away.
		const direct = translationsGroup(node.expression, scopes);
		if (direct !== undefined) record(direct, "call", node);
		noteHandOver(node, scopes);

		const reader = readerOf(node);
		if (!reader) return;
		const binding = lookUp(scopes, reader.name);
		if (typeof binding === "string") record(binding, reader.method, node);
	};

	const visit = (node: ts.Node, scopes: Scopes) => {
		declare(node, scopes);
			const next = SCOPE_KINDS.has(node.kind)
			? [...scopes, new Map()]
			: scopes;
		declareParameters(node, next);
		readCall(node, next);
		node.forEachChild((child) => visit(child, next));
	};

	visit(tree, []);

	return { uses, dynamic, handedOver };
}

/**
 * Puts the wording of many files together, keeping each place it is used.
 *
 * The files are read twice. The first reading finds translators handed from
 * one function to another, so the second reading knows what a function that
 * is given a translator is being given.
 */
export function scanWording(files: { file: string; source: string }[]) {
	const injected: InjectedTranslators = new Map();
	for (const { file, source } of files) {
		const handed = scanWordingInSource(file, source).handedOver;
		for (const [name, byIndex] of handed) {
			const known = injected.get(name) ?? new Map<number, string>();
			for (const [index, group] of byIndex) known.set(index, group);
			injected.set(name, known);
		}
	}

	const uses: WordingUse[] = [];
	const dynamic: DynamicWordingUse[] = [];
	for (const { file, source } of files) {
		const scan = scanWordingInSource(file, source, injected);
		uses.push(...scan.uses);
		dynamic.push(...scan.dynamic);
	}

	return { uses, dynamic };
}

/**
 * True when the language holds something usable for this use. Text reads need
 * a sentence; a raw read hands back whatever is there, often a list.
 */
function isPresent(value: unknown, method: WordingMethod) {
	return method === "raw" ? value !== undefined : typeof value === "string";
}

/** The wording a screen asks for that this language does not have. */
export function missingWording(uses: WordingUse[], messages: Messages) {
	const missing = new Set<string>();
	for (const { group, key, method } of uses) {
		const value = group ? messages[group]?.[key] : messages[key];
		if (!isPresent(value, method)) missing.add(`${group}.${key}`);
	}

	return [...missing].sort();
}

/** Everything the reader sees when they use the assistant. */
const AI_SOURCES = [
	"src/components/features/ai",
	"src/components/features/modals/AIControls.tsx",
	"src/components/features/modals/ChatModal.tsx",
	"src/components/features/modals/GenerativeModal.tsx",
	"src/components/features/newlib/AiWrapper.tsx",
	"src/components/pages/EvidenceLibrary.tsx",
	"src/hooks/useAIStream.ts",
];
const MESSAGES_DIRECTORY = "src/messages";

/** Every TypeScript file under a folder, or the file itself. */
function sourceFilesIn(path: string): string[] {
	const entries = (() => {
		try {
			return readdirSync(path, { withFileTypes: true });
		} catch {
			return null;
		}
	})();

	if (!entries) return [path];

	return entries.flatMap((entry) => {
		const child = join(path, entry.name);
		if (entry.isDirectory()) return sourceFilesIn(child);

		return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")
			? [child]
			: [];
	});
}

/** Every AI screen, ready to be read. */
export function aiWordingFiles() {
	return AI_SOURCES.flatMap(sourceFilesIn)
		.sort()
		.map((file) => ({
			file: relative(process.cwd(), file),
			source: readFileSync(file, "utf8"),
		}));
}

export type LocaleMessages = { locale: string; messages: Messages };

/** Every language the library ships. */
export function localeMessages(): LocaleMessages[] {
	return readdirSync(MESSAGES_DIRECTORY)
		.filter((name) => name.endsWith(".json"))
		.sort()
		.map((locale) => ({
			locale,
			messages: JSON.parse(
				readFileSync(join(MESSAGES_DIRECTORY, locale), "utf8"),
			) as Messages,
		}));
}

/** Where each piece of wording is asked for, so it is easy to find. */
function placesAsking(uses: WordingUse[], entry: string) {
	const files = new Set(
		uses
			.filter(({ group, key }) => `${group}.${key}` === entry)
			.map(({ file }) => file),
	);

	return [...files].sort().join(", ");
}

/** The groups whose names a screen only works out while it runs. */
function dynamicGroups(dynamic: DynamicWordingUse[]) {
	return [...new Set(dynamic.map(({ group }) => group))].sort();
}

/**
 * A screen that picks a wording name from a list while it runs cannot be
 * checked name by name, so every language has to hold the same whole group as
 * every other language.
 */
function everyNameInGroup(group: string, locales: LocaleMessages[]) {
	const names = new Set<string>();
	for (const { messages } of locales) {
		for (const key of Object.keys(messages[group] ?? {})) names.add(key);
	}

	return [...names].sort();
}

function missingFromGroup(
	group: string,
	everyName: string[],
	messages: Messages,
) {
	const present = new Set(Object.keys(messages[group] ?? {}));

	return everyName.filter((key) => !present.has(key));
}

/** Everything wrong with the wording these screens ask for, in plain words. */
export function wordingProblems(
	files: { file: string; source: string }[],
	locales: LocaleMessages[],
) {
	const { uses, dynamic } = scanWording(files);
	const problems: string[] = [];

	if (files.length === 0) {
		problems.push(
			`No AI screens were found in ${AI_SOURCES.join(", ")}. The check is looking in the wrong place.`,
		);
	}
	if (uses.length === 0) {
		problems.push(
			"No wording was found in the AI screens. The check is not reading them properly.",
		);
	}
	if (locales.length === 0) {
		problems.push(`No languages were found in ${MESSAGES_DIRECTORY}.`);
	}

	const groups = dynamicGroups(dynamic).map((group) => ({
		group,
		everyName: everyNameInGroup(group, locales),
	}));
	for (const { locale, messages } of locales) {
		const named = missingWording(uses, messages);
		for (const entry of named) {
			problems.push(
				`${locale} has no wording for "${entry}", asked for in ${placesAsking(uses, entry)}.`,
			);
		}
		for (const { group, everyName } of groups) {
			// Anything already named above is not worth saying twice.
			const missing = missingFromGroup(group, everyName, messages).filter(
				(key) => !named.includes(`${group}.${key}`),
			);
			if (missing.length === 0) continue;
			problems.push(
				`${locale} is missing "${group}" wording that a screen picks from a list while it runs: ${missing.join(", ")}.`,
			);
		}
	}

	return problems;
}
