import { readdirSync, readFileSync } from "node:fs";
import { join, posix, relative } from "node:path";
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

/** One file the check reads, together with the text in it. */
export type SourceText = { file: string; source: string };

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
 * Translators handed to another function as an argument, held by the function
 * itself and by which argument it is. `AI_DROPDOWN_ITEMS(t, ...)` in one file
 * tells us what `t` means inside `AI_DROPDOWN_ITEMS` in another. The function
 * is kept as the thing it is, not as a name, so two helpers that share a name
 * in different files never mix.
 */
export type InjectedTranslators = Map<ts.Symbol, Map<number, string>>;

/** What the scanner already knows when it reads a file. */
type WordingContext = {
	checker: ts.TypeChecker;
	/** Helpers that hand back a translator, and the group each one reads. */
	hooks: Map<ts.Symbol, string>;
	/** Translators a function is given by whoever calls it. */
	injected: InjectedTranslators;
};

/** How the files are read. Nothing is built, so no library files are needed. */
const PROGRAM_OPTIONS: ts.CompilerOptions = {
	jsx: ts.JsxEmit.Preserve,
	module: ts.ModuleKind.ESNext,
	noLib: true,
	target: ts.ScriptTarget.Latest,
};

/** The endings a written import is allowed to leave out. */
const MODULE_ENDINGS = [".ts", ".tsx", "/index.ts", "/index.tsx"];
/** The short way this project writes a path that starts at `src`. */
const SOURCE_ALIAS = "@/";

/** The file an import points at, written the way the file list writes it. */
function importedPath(from: string, specifier: string) {
	if (specifier.startsWith(SOURCE_ALIAS)) {
		return posix.join("src", specifier.slice(SOURCE_ALIAS.length));
	}

	return specifier.startsWith(".")
		? posix.join(posix.dirname(from), specifier)
		: undefined;
}

/**
 * Finds an import among the files being read. It matches on the whole path, so
 * two files with the same name in different folders stay apart.
 */
function resolveImport(
	from: string,
	specifier: string,
	sources: Map<string, string>,
): ts.ResolvedModuleFull | undefined {
	const path = importedPath(from, specifier);
	if (path === undefined) return undefined;

	for (const ending of MODULE_ENDINGS) {
		const name = `${path}${ending}`;
		if (!sources.has(name)) continue;

		return {
			resolvedFileName: name,
			extension: name.endsWith(".tsx") ? ts.Extension.Tsx : ts.Extension.Ts,
			isExternalLibraryImport: false,
		};
	}

	return undefined;
}

/** Turns the text of one file into a tree, keeping JSX in mind. */
function parse(file: string, source: string) {
	return ts.createSourceFile(
		file,
		source,
		ts.ScriptTarget.Latest,
		true,
		file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
}

/**
 * Reads these files together from memory, so a name used in one file can be
 * followed to the place in another file where it is made.
 */
function readProgram(files: SourceText[]) {
	const sources = new Map(files.map(({ file, source }) => [file, source]));
	const host: ts.CompilerHost = {
		fileExists: (name) => sources.has(name),
		getCanonicalFileName: (name) => name,
		getCurrentDirectory: () => "",
		getDefaultLibFileName: () => "lib.d.ts",
		getNewLine: () => "\n",
		getSourceFile: (name) => {
			const source = sources.get(name);

			return source === undefined ? undefined : parse(name, source);
		},
		readFile: (name) => sources.get(name),
		resolveModuleNameLiterals: (written, from) =>
			written.map((name) => ({
				resolvedModule: resolveImport(from, name.text, sources),
			})),
		useCaseSensitiveFileNames: () => true,
		writeFile: () => {},
	};

	return ts.createProgram({
		rootNames: [...sources.keys()],
		options: PROGRAM_OPTIONS,
		host,
	});
}

/**
 * The thing a name really points at. An import is followed to the place the
 * thing is made, so the same helper is the same thing in every file.
 */
function thingAt(checker: ts.TypeChecker, node: ts.Node) {
	const found = checker.getSymbolAtLocation(node);
	if (!found || !(found.flags & ts.SymbolFlags.Alias)) return found;
	const made = checker.getAliasedSymbol(found);

	return made.declarations?.length ? made : found;
}

/** The package an imported name came in from, when it came in from one. */
function packageOf(declaration: ts.Declaration) {
	const line = ts.findAncestor(declaration, ts.isImportDeclaration);
	if (!line || !ts.isStringLiteralLike(line.moduleSpecifier)) return undefined;

	return line.moduleSpecifier.text;
}

/** True when this line brings next-intl's own `useTranslations` in. */
function isHookImport(declaration: ts.Declaration) {
	if (!ts.isImportSpecifier(declaration)) return false;
	const imported = declaration.propertyName?.text ?? declaration.name.text;

	return imported === WORDING_HOOK && packageOf(declaration) === WORDING_PACKAGE;
}

/** True when this line brings the whole next-intl package in under a name. */
function isPackageImport(declaration: ts.Declaration) {
	return (
		ts.isNamespaceImport(declaration) &&
		packageOf(declaration) === WORDING_PACKAGE
	);
}

/**
 * True when every place this name is made is the one we are after. A name that
 * also means something else in the file is not trusted, however it is written.
 */
function isAlways(
	thing: ts.Symbol,
	made: (declaration: ts.Declaration) => boolean,
) {
	const places = thing.declarations ?? [];

	return places.length > 0 && places.every(made);
}

/** next-intl's hook read through the package name, as `intl.useTranslations`. */
function isPackageHook(
	callee: ts.PropertyAccessExpression,
	checker: ts.TypeChecker,
) {
	if (callee.name.text !== WORDING_HOOK) return false;
	if (!ts.isIdentifier(callee.expression)) return false;
	const thing = thingAt(checker, callee.expression);

	return thing !== undefined && isAlways(thing, isPackageImport);
}

/** What a call hands back: next-intl's hook, a helper of ours, or nothing. */
type Hook = { kind: "package" } | { kind: "helper"; group: string };

/** Works out whether this call hands back a translator, and of what kind. */
function hookOf(
	callee: ts.Expression,
	context: WordingContext,
): Hook | undefined {
	if (ts.isPropertyAccessExpression(callee)) {
		return isPackageHook(callee, context.checker)
			? { kind: "package" }
			: undefined;
	}
	if (!ts.isIdentifier(callee)) return undefined;
	const thing = thingAt(context.checker, callee);
	if (!thing) return undefined;
	if (isAlways(thing, isHookImport)) return { kind: "package" };
	const group = context.hooks.get(thing);

	return group === undefined ? undefined : { kind: "helper", group };
}

/** The group a call hands a translator back for, when it hands one back. */
function translationsGroup(node: ts.Node, context: WordingContext) {
	if (!ts.isCallExpression(node)) return undefined;
	const hook = hookOf(node.expression, context);
	if (!hook) return undefined;
	if (hook.kind === "helper") return hook.group;

	const [argument] = node.arguments;
	if (argument && ts.isStringLiteralLike(argument)) return argument.text;

	// `useTranslations()` reads the top level, which has no group name.
	return argument ? undefined : "";
}

/** The reader a call goes through, and how it reads the message. */
function readerOf(call: ts.CallExpression, checker: ts.TypeChecker) {
	if (ts.isIdentifier(call.expression)) {
		const reader = checker.getSymbolAtLocation(call.expression);

		return reader ? { reader, method: "call" as const } : undefined;
	}
	if (
		!ts.isPropertyAccessExpression(call.expression) ||
		!ts.isIdentifier(call.expression.expression)
	) {
		return undefined;
	}
	const method = READ_METHODS[call.expression.name.text];
	const reader = checker.getSymbolAtLocation(call.expression.expression);

	return method && reader ? { reader, method } : undefined;
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

/** Walks a whole file, node by node. */
function walk(node: ts.Node, look: (node: ts.Node) => void) {
	look(node);
	node.forEachChild((child) => walk(child, look));
}

/** The function itself, so other files can point at the same one. */
function functionThing(node: ts.SignatureDeclaration, checker: ts.TypeChecker) {
	if (ts.isFunctionDeclaration(node)) {
		return node.name ? checker.getSymbolAtLocation(node.name) : undefined;
	}
	const parent = node.parent;

	return ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)
		? checker.getSymbolAtLocation(parent.name)
		: undefined;
}

/** The body of a function, when the kind of function has one. */
function bodyOf(node: ts.SignatureDeclaration) {
	if (
		ts.isArrowFunction(node) ||
		ts.isFunctionDeclaration(node) ||
		ts.isFunctionExpression(node) ||
		ts.isMethodDeclaration(node)
	) {
		return node.body;
	}

	return undefined;
}

/** Every value a function hands straight back. */
function returnedValues(node: ts.SignatureDeclaration): ts.Expression[] {
	const body = bodyOf(node);
	if (!body) return [];
	if (!ts.isBlock(body)) return [body];

	return body.statements.flatMap((statement) =>
		ts.isReturnStatement(statement) && statement.expression
			? [statement.expression]
			: [],
	);
}

/** Notes a function that hands a translator back, such as a small helper. */
function noteHelperHook(node: ts.Node, context: WordingContext) {
	if (!ts.isFunctionLike(node)) return;
	const owner = functionThing(node, context.checker);
	if (!owner || context.hooks.has(owner)) return;

	for (const value of returnedValues(node)) {
		const group = translationsGroup(value, context);
		if (group === undefined) continue;
		context.hooks.set(owner, group);

		return;
	}
}

/**
 * Every helper that hands a translator back. The files are read again and
 * again until nothing new is found, so a helper that calls another helper is
 * found too.
 */
function helperHooks(program: ts.Program, checker: ts.TypeChecker) {
	const hooks = new Map<ts.Symbol, string>();
	const context: WordingContext = { checker, hooks, injected: new Map() };
	let found = -1;

	while (found !== hooks.size) {
		found = hooks.size;
		for (const tree of program.getSourceFiles()) {
			walk(tree, (node) => noteHelperHook(node, context));
		}
	}

	return hooks;
}

/**
 * The group a value reads for: either a call that hands a translator back, or
 * another name that is already known to hold one.
 */
function groupOfValue(
	value: ts.Expression,
	context: WordingContext,
	translators: Map<ts.Symbol, string>,
) {
	const group = translationsGroup(value, context);
	if (group !== undefined) return group;
	if (!ts.isIdentifier(value)) return undefined;
	const named = context.checker.getSymbolAtLocation(value);

	return named ? translators.get(named) : undefined;
}

/**
 * A `const t = useTranslations("ai")` line names a translator, and so does a
 * `const translate = t` line that gives that translator a second name.
 */
function noteTranslatorVariable(
	node: ts.Node,
	context: WordingContext,
	translators: Map<ts.Symbol, string>,
) {
	if (!ts.isVariableDeclaration(node) || !node.initializer) return;
	if (!ts.isIdentifier(node.name)) return;
	const group = groupOfValue(node.initializer, context, translators);
	const named = context.checker.getSymbolAtLocation(node.name);
	if (group !== undefined && named) translators.set(named, group);
}

/** A function handed a translator knows it under its own argument name. */
function noteGivenTranslators(
	node: ts.Node,
	context: WordingContext,
	translators: Map<ts.Symbol, string>,
) {
	if (!ts.isFunctionLike(node)) return;
	const owner = functionThing(node, context.checker);
	const handed = owner ? context.injected.get(owner) : undefined;
	if (!handed) return;

	node.parameters.forEach((parameter, index) => {
		const group = handed.get(index);
		if (group === undefined || !ts.isIdentifier(parameter.name)) return;
		const named = context.checker.getSymbolAtLocation(parameter.name);
		if (named) translators.set(named, group);
	});
}

/**
 * Every name in this file that holds a translator, and the group it reads.
 *
 * The file is read again and again until nothing new is found, so a second
 * name for a translator, and a second name for that one, are found too.
 */
function translatorsIn(tree: ts.SourceFile, context: WordingContext) {
	const translators = new Map<ts.Symbol, string>();
	let found = -1;

	while (found !== translators.size) {
		found = translators.size;
		walk(tree, (node) => {
			noteTranslatorVariable(node, context, translators);
			noteGivenTranslators(node, context, translators);
		});
	}

	return translators;
}

/** Notes a translator passed straight into another function. */
function noteHandOver(
	call: ts.CallExpression,
	context: WordingContext,
	translators: Map<ts.Symbol, string>,
	handedOver: InjectedTranslators,
) {
	if (!ts.isIdentifier(call.expression)) return;
	const called = thingAt(context.checker, call.expression);
	if (!called) return;

	call.arguments.forEach((argument, index) => {
		if (!ts.isIdentifier(argument)) return;
		const named = context.checker.getSymbolAtLocation(argument);
		const group = named ? translators.get(named) : undefined;
		if (group === undefined) return;
		const perFunction = handedOver.get(called) ?? new Map<number, string>();
		perFunction.set(index, group);
		handedOver.set(called, perFunction);
	});
}

/** Reads the wording one already parsed file asks for. */
function scanFile(tree: ts.SourceFile, context: WordingContext): WordingScan {
	const file = tree.fileName;
	const uses: WordingUse[] = [];
	const dynamic: DynamicWordingUse[] = [];
	const handedOver: InjectedTranslators = new Map();
	const translators = translatorsIn(tree, context);

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

	const readCall = (node: ts.Node) => {
		if (!ts.isCallExpression(node)) return;
		// `useTranslations("ai")("askAI")` reads a message straight away.
		const direct = translationsGroup(node.expression, context);
		if (direct !== undefined) record(direct, "call", node);
		noteHandOver(node, context, translators, handedOver);

		const read = readerOf(node, context.checker);
		if (!read) return;
		const group = translators.get(read.reader);
		if (group !== undefined) record(group, read.method, node);
	};

	walk(tree, readCall);

	return { uses, dynamic, handedOver };
}

/** Reads the wording one file asks for, by parsing it rather than matching text. */
export function scanWordingInSource(file: string, source: string): WordingScan {
	const program = readProgram([{ file, source }]);
	const checker = program.getTypeChecker();
	const tree = program.getSourceFile(file);
	if (!tree) throw new Error(`The file ${file} could not be read.`);

	return scanFile(tree, {
		checker,
		hooks: helperHooks(program, checker),
		injected: new Map(),
	});
}

/** Adds what one file hands over to what the other files hand over. */
function addHandOvers(
	injected: InjectedTranslators,
	handed: InjectedTranslators,
) {
	for (const [owner, byIndex] of handed) {
		const known = injected.get(owner) ?? new Map<number, string>();
		for (const [index, group] of byIndex) known.set(index, group);
		injected.set(owner, known);
	}
}

/**
 * Puts the wording of many files together, keeping each place it is used.
 *
 * The files are read twice. The first reading finds translators handed from
 * one function to another, so the second reading knows what a function that
 * is given a translator is being given.
 */
export function scanWording(files: SourceText[]) {
	const program = readProgram(files);
	const checker = program.getTypeChecker();
	const hooks = helperHooks(program, checker);
	const trees = files.flatMap(({ file }) => {
		const tree = program.getSourceFile(file);

		return tree ? [tree] : [];
	});

	const injected: InjectedTranslators = new Map();
	for (const tree of trees) {
		const first = scanFile(tree, { checker, hooks, injected: new Map() });
		addHandOvers(injected, first.handedOver);
	}

	const uses: WordingUse[] = [];
	const dynamic: DynamicWordingUse[] = [];
	for (const tree of trees) {
		const scan = scanFile(tree, { checker, hooks, injected });
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
	"src/components/features/modals/GenerativeModalView.tsx",
	"src/components/features/newlib/AiWrapper.tsx",
	"src/components/features/resources/EngagedLibraryPanel.tsx",
	"src/components/features/resources/LibrarySearchSelects.tsx",
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
