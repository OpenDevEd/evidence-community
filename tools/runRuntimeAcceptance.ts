import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	activateLibraryConfig,
	rollbackLibraryConfig,
} from "../src/config/library-config/activation";
import {
	PLATFORM_LOCALES,
	PLATFORM_SEARCH_SCOPE_OPTIONS,
} from "../src/config/library-config/catalogs";
import {
	libraryConfigSchema,
	type LibraryServerConfig,
} from "../src/config/library-config/schema";
import { getRuntimeSearchScopeOptions } from "../src/config/library-config/search";
import {
	formatRgbChannels,
	parseHexColor,
} from "../src/config/library-config/theme";
import { getOrderedRuntimeLocales } from "../src/i18n/runtime";
import {
	localesNames,
	shortLocalesNames,
} from "../src/i18n/routing";
import { replaceFileAtomically } from "../src/lib/atomic-file";

const rootDirectory = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const acceptanceDirectory = path.join(
	rootDirectory,
	"tests",
	"acceptance",
);
const composeFile = path.join(acceptanceDirectory, "compose.yaml");
const configDirectory = path.join(acceptanceDirectory, "configs");
const composeProject =
	process.env.EVIDENCE_LIBRARY_ACCEPTANCE_PROJECT ??
	`evidence-library-acceptance-${process.pid}-${Date.now()}`;
if (!/^[a-z0-9][a-z0-9_-]*$/.test(composeProject)) {
	throw new Error(
		"EVIDENCE_LIBRARY_ACCEPTANCE_PROJECT must contain only lowercase letters, numbers, hyphens, and underscores",
	);
}
const runtimeDirectory = path.join(
	acceptanceDirectory,
	"runtime",
	composeProject,
);
const image =
	process.env.EVIDENCE_LIBRARY_ACCEPTANCE_IMAGE ??
	"evidence-library-acceptance:local";
const searchIndexerImage =
	process.env.EVIDENCE_LIBRARY_ACCEPTANCE_SEARCH_INDEXER_IMAGE ??
	"evidence-library-acceptance-search-indexer:local";
const amberMeilisearchPort =
	process.env.EVIDENCE_LIBRARY_ACCEPTANCE_AMBER_MEILI_PORT ?? "7712";
const indigoMeilisearchPort =
	process.env.EVIDENCE_LIBRARY_ACCEPTANCE_INDIGO_MEILI_PORT ?? "7713";
const fixturePort =
	process.env.EVIDENCE_LIBRARY_ACCEPTANCE_FIXTURE_PORT ?? "4443";
const mailpitPort =
	process.env.EVIDENCE_LIBRARY_ACCEPTANCE_MAILPIT_PORT ?? "38025";
const amberPort =
	process.env.EVIDENCE_LIBRARY_ACCEPTANCE_AMBER_PORT ?? "3142";
const indigoPort =
	process.env.EVIDENCE_LIBRARY_ACCEPTANCE_INDIGO_PORT ?? "3143";
const keepRunning = process.argv.includes("--keep");
const skipBuild = process.argv.includes("--skip-build");

const commandEnvironment = {
	...process.env,
	EVIDENCE_LIBRARY_ACCEPTANCE_IMAGE: image,
	EVIDENCE_LIBRARY_ACCEPTANCE_SEARCH_INDEXER_IMAGE: searchIndexerImage,
	EVIDENCE_LIBRARY_ACCEPTANCE_AMBER_MEILI_PORT: amberMeilisearchPort,
	EVIDENCE_LIBRARY_ACCEPTANCE_INDIGO_MEILI_PORT: indigoMeilisearchPort,
	EVIDENCE_LIBRARY_ACCEPTANCE_FIXTURE_PORT: fixturePort,
	EVIDENCE_LIBRARY_ACCEPTANCE_MAILPIT_PORT: mailpitPort,
	EVIDENCE_LIBRARY_ACCEPTANCE_OWNER_PID: String(process.pid),
	EVIDENCE_LIBRARY_ACCEPTANCE_PERSISTENT: String(keepRunning),
	EVIDENCE_LIBRARY_ACCEPTANCE_RUNTIME_DIR: runtimeDirectory,
};
const ownerLabel =
	"org.opendeved.evidence-library.acceptance.owner-pid";
const persistentLabel =
	"org.opendeved.evidence-library.acceptance.persistent";

type Profile = {
	config: LibraryServerConfig;
	meilisearchPort: string;
	name: "amber" | "indigo";
	port: string;
};

type MeilisearchTask = {
	status: "enqueued" | "processing" | "succeeded" | "failed" | "canceled";
	taskUid: number;
	error?: unknown;
};

type RuntimeConfigHealth = {
	state: "active" | "rejected";
	active: {
		revision: string;
		updatedAt: string;
	} | null;
	rejected: {
		revision: string | null;
	} | null;
};

function run(command: string, args: string[], environment = commandEnvironment) {
	const result = spawnSync(command, args, {
		cwd: rootDirectory,
		env: environment,
		stdio: "inherit",
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(
			`${command} ${args.join(" ")} exited with status ${result.status}`,
		);
	}
}

function capture(command: string, args: string[]) {
	const result = spawnSync(command, args, {
		cwd: rootDirectory,
		env: commandEnvironment,
		encoding: "utf8",
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(
			`${command} ${args.join(" ")} exited with status ${result.status}: ${result.stderr}`,
		);
	}
	return result.stdout;
}

function composeForProject(
	project: string,
	projectRuntimeDirectory: string,
	...args: string[]
) {
	run(
		"docker",
		[
			"compose",
			"--file",
			composeFile,
			"--project-name",
			project,
			...args,
		],
		{
			...commandEnvironment,
			EVIDENCE_LIBRARY_ACCEPTANCE_RUNTIME_DIR:
				projectRuntimeDirectory,
		},
	);
}

function compose(...args: string[]) {
	composeForProject(composeProject, runtimeDirectory, ...args);
}

function captureCompose(...args: string[]) {
	return capture("docker", [
		"compose",
		"--file",
		composeFile,
		"--project-name",
		composeProject,
		...args,
	]);
}

function processIsAlive(pid: number) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function reapAbandonedProjects() {
	const rows = capture("docker", [
		"ps",
		"--all",
		"--filter",
		`label=${ownerLabel}`,
		"--format",
		`{{.Label "com.docker.compose.project"}}|{{.Label "${ownerLabel}"}}|{{.Label "${persistentLabel}"}}`,
	]);
	const projects = new Map<
		string,
		{ ownerPid: number; persistent: boolean }
	>();

	for (const row of rows.split("\n").filter(Boolean)) {
		const [project, ownerPid, persistent] = row.split("|");
		if (!project) continue;
		projects.set(project, {
			ownerPid: Number(ownerPid),
			persistent: persistent === "true",
		});
	}

	for (const [project, state] of projects) {
		if (
			state.persistent ||
			(Number.isInteger(state.ownerPid) &&
				processIsAlive(state.ownerPid))
		) {
			if (project === composeProject) {
				throw new Error(
					`Acceptance project ${project} is already in use; choose a different EVIDENCE_LIBRARY_ACCEPTANCE_PROJECT and ports`,
				);
			}
			continue;
		}

		const abandonedRuntimeDirectory = path.join(
			acceptanceDirectory,
			"runtime",
			project,
		);
		console.log(`Removing abandoned acceptance project ${project}`);
		composeForProject(
			project,
			abandonedRuntimeDirectory,
			"down",
			"--volumes",
			"--remove-orphans",
		);
		rmSync(abandonedRuntimeDirectory, {
			recursive: true,
			force: true,
		});
	}
}

function loadProfile(
	name: Profile["name"],
	port: string,
	meilisearchPort: string,
): Profile {
	const configPath = path.join(configDirectory, `${name}.json`);
	const input = JSON.parse(readFileSync(configPath, "utf8")) as {
		analytics?: { posthog?: { host?: string } };
	};
	if (input.analytics?.posthog?.host) {
		const collectorUrl = new URL(
			input.analytics.posthog.host,
		);
		collectorUrl.port = fixturePort;
		input.analytics.posthog.host = collectorUrl.origin;
	}
	const config = libraryConfigSchema.parse(
		input,
	);
	return { config, meilisearchPort, name, port };
}

function prepareRuntimeConfig(profile: Profile) {
	const targetDirectory = path.join(runtimeDirectory, profile.name);
	mkdirSync(targetDirectory, { recursive: true });
	writeFileSync(
		path.join(targetDirectory, "library.json"),
		`${JSON.stringify(profile.config, null, "\t")}\n`,
		"utf8",
	);
}

async function verifyRootOwnedConfigStartup() {
	const containerName = `${composeProject}-config-permissions`;
	const volumeName = `${composeProject}-root-owned-config`;
	const sourceDirectory = path.join(runtimeDirectory, "amber");

	run("docker", ["volume", "create", volumeName]);
	try {
		run("docker", [
			"run",
			"--rm",
			"--volume",
			`${volumeName}:/runtime/config`,
			"--volume",
			`${sourceDirectory}:/source:ro`,
			"node:22-bookworm-slim",
			"sh",
			"-c",
			"cp /source/library.json /runtime/config/library.json && chown 0:0 /runtime/config/library.json && chmod 600 /runtime/config/library.json",
		]);
		run("docker", [
			"run",
			"--detach",
			"--name",
			containerName,
			"--label",
			`${ownerLabel}=${process.pid}`,
			"--label",
			`${persistentLabel}=false`,
			"--env",
			"LIBRARY_CONFIG_PATH=/runtime/config/library.json",
			"--volume",
			`${volumeName}:/runtime/config`,
			image,
		]);

		const deadline = Date.now() + 60_000;
		let healthy = false;
		while (Date.now() < deadline) {
			const result = spawnSync(
				"docker",
				[
					"exec",
					containerName,
					"node",
					"-e",
					"fetch('http://127.0.0.1:3000/api/library-config/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))",
				],
				{ cwd: rootDirectory, env: commandEnvironment },
			);
			if (result.status === 0) {
				healthy = true;
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
		assert.equal(
			healthy,
			true,
			"the image must start with a root-owned 0600 library config",
		);
		assert.equal(
			capture("docker", [
				"exec",
				containerName,
				"sh",
				"-c",
				"awk '/^Uid:/ {print $2}' /proc/1/status",
			]).trim(),
			"1001",
			"the web process must run as uid 1001",
		);
		console.log(
			"Root-owned config startup passed and the web process runs as uid 1001.",
		);
	} finally {
		spawnSync("docker", ["rm", "--force", containerName], {
			cwd: rootDirectory,
			env: commandEnvironment,
			stdio: "ignore",
		});
		spawnSync("docker", ["volume", "rm", "--force", volumeName], {
			cwd: rootDirectory,
			env: commandEnvironment,
			stdio: "ignore",
		});
	}
}

async function meilisearchRequest<T>(
	profile: Profile,
	pathname: string,
	init?: RequestInit,
): Promise<T> {
	const response = await fetch(
		`http://127.0.0.1:${profile.meilisearchPort}${pathname}`,
		{
			...init,
			headers: {
				Authorization: "Bearer acceptance-master-key",
				"Content-Type": "application/json",
				...init?.headers,
			},
		},
	);
	if (!response.ok) {
		throw new Error(
			`Meilisearch ${init?.method ?? "GET"} ${pathname} failed: ${response.status} ${await response.text()}`,
		);
	}
	return response.json() as Promise<T>;
}

async function waitForTask(profile: Profile, taskUid: number) {
	const deadline = Date.now() + 60_000;

	while (Date.now() < deadline) {
		const task = await meilisearchRequest<MeilisearchTask>(
			profile,
			`/tasks/${taskUid}`,
		);
		if (task.status === "succeeded") return;
		if (task.status === "failed" || task.status === "canceled") {
			throw new Error(
				`Meilisearch task ${taskUid} ${task.status}: ${JSON.stringify(task.error)}`,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`Timed out waiting for Meilisearch task ${taskUid}`);
}

async function enqueue(
	profile: Profile,
	pathname: string,
	method: "POST" | "PATCH",
	body: unknown,
) {
	const task = await meilisearchRequest<MeilisearchTask>(profile, pathname, {
		method,
		body: JSON.stringify(body),
	});
	await waitForTask(profile, task.taskUid);
}

async function seedSearch(profile: Profile) {
	const indexUid = profile.config.services.search.index;
	const amber = profile.name === "amber";
	const colorName = amber ? "Amber" : "Indigo";
	const institution = amber ? "Amber Institute" : "Indigo Lab";
	const country = amber ? "Morocco" : "United Kingdom";
	const countryCode = amber ? "MA" : "GB";
	const year = amber ? "2026" : "2025";
	const searchItemKey = amber
		? "AMBER_SEARCH_FIXTURE"
		: "INDIGO_SEARCH_FIXTURE";

	await enqueue(profile, `/indexes/${indexUid}/documents`, "POST", [
		{
			key: searchItemKey,
			id: `${colorName.toUpperCase()}_ACCEPTANCE`,
			title: `${colorName} runtime evidence`,
			shortTitle: `${colorName} proof`,
			abstractNote: `This record proves the ${profile.name} deployment selected its own runtime search index.`,
			itemType: "JournalArticle",
			deleted: 0,
			date: year,
			datePublished: year,
			fullNames: [`${amber ? "Amina" : "Iris"} ${colorName}`],
			creators: [
				{
					firstName: amber ? "Amina" : "Iris",
					lastName: colorName,
					creatorType: "author",
					institutions: [
						{
							display_name: institution,
							country_code: countryCode,
						},
					],
				},
			],
			institution: [institution],
			country: [country],
			tags: [],
			collections: [],
			collectionsAncestry: [],
			url: `https://${profile.name}.example.org/evidence/${profile.name}`,
			citation: `<div>${colorName}, A. (${year}). ${colorName} runtime evidence.</div>`,
		},
	]);
}

async function seedSharedSearchIndexes(profile: Profile) {
	for (const index of [
		{ uid: "cache", primaryKey: "id" },
		{ uid: "redirects", primaryKey: "id" },
	]) {
		await enqueue(profile, "/indexes", "POST", index);
	}
}

function postgresScalar(database: Profile["name"], sql: string) {
	return captureCompose(
		"exec",
		"--no-TTY",
		"postgres",
		"psql",
		"--set",
		"ON_ERROR_STOP=1",
		"--username",
		"library",
		"--dbname",
		database,
		"--tuples-only",
		"--no-align",
		"--command",
		sql,
	).trim();
}

async function waitForOutboxProcessed(
	profile: Profile,
	key: string,
	description: string,
) {
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		if (
			postgresScalar(
				profile.name,
				`SELECT COUNT(*) FROM "outbox" WHERE "entityType" = 'item' AND "entityKey" = '${key}' AND "revision" = 1 AND "processedAt" IS NOT NULL`,
			) === "1"
		) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(`Timed out waiting for ${description}`);
}

async function meilisearchHasDocument(profile: Profile, key: string) {
	const response = await fetch(
		`http://127.0.0.1:${profile.meilisearchPort}/indexes/items/documents/${key}`,
		{ headers: { Authorization: "Bearer acceptance-master-key" } },
	);
	if (response.status === 404) return false;
	if (!response.ok) {
		throw new Error(
			`${profile.name} Meilisearch document check failed: ${response.status} ${await response.text()}`,
		);
	}
	return true;
}

async function deleteMeilisearchDocument(profile: Profile, key: string) {
	const task = await meilisearchRequest<MeilisearchTask>(
		profile,
		`/indexes/items/documents/${key}`,
		{ method: "DELETE" },
	);
	await waitForTask(profile, task.taskUid);
}

async function verifySearchQueueIsolation(profiles: Profile[]) {
	const amber = profiles.find((profile) => profile.name === "amber");
	const indigo = profiles.find((profile) => profile.name === "indigo");
	assert.ok(amber && indigo, "Both acceptance profiles are required");
	const amberKey = "AMBR6789";
	const indigoKey = "INDG6789";

	compose("pause", "amber-meilisearch");
	try {
		postgresScalar(
			"amber",
			`INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ('${amberKey}', 'native', '${amberKey}'); INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "title", "revision") VALUES ('${amberKey}', 'native', '${amberKey}', 'Report', 'Amber isolated queue evidence', 1); INSERT INTO "outbox" ("entityType", "entityKey", "operation", "revision") VALUES ('item', '${amberKey}', 'upsert', 1)`,
		);
		postgresScalar(
			"indigo",
			`INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ('${indigoKey}', 'native', '${indigoKey}'); INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "title", "revision") VALUES ('${indigoKey}', 'native', '${indigoKey}', 'Report', 'Indigo isolated queue evidence', 1); INSERT INTO "outbox" ("entityType", "entityKey", "operation", "revision") VALUES ('item', '${indigoKey}', 'upsert', 1)`,
		);

		await waitForOutboxProcessed(
			indigo,
			indigoKey,
			"Indigo indexing while Amber search is paused",
		);
		assert.equal(
			postgresScalar(
				"amber",
				`SELECT COUNT(*) FROM "outbox" WHERE "entityType" = 'item' AND "entityKey" = '${amberKey}' AND "revision" = 1 AND "processedAt" IS NOT NULL`,
			),
			"0",
			"Amber work must remain unfinished while only Amber Meilisearch is paused",
		);
	} finally {
		compose("unpause", "amber-meilisearch");
	}

	await waitForOutboxProcessed(
		amber,
		amberKey,
		"Amber indexing after its search service resumes",
	);
	assert.equal(await meilisearchHasDocument(amber, amberKey), true);
	assert.equal(await meilisearchHasDocument(indigo, indigoKey), true);
	assert.equal(await meilisearchHasDocument(amber, indigoKey), false);
	assert.equal(await meilisearchHasDocument(indigo, amberKey), false);
	await Promise.all([
		deleteMeilisearchDocument(amber, amberKey),
		deleteMeilisearchDocument(indigo, indigoKey),
	]);
	postgresScalar(
		"amber",
		`DELETE FROM "outbox" WHERE "entityType" = 'item' AND "entityKey" = '${amberKey}'; DELETE FROM "item" WHERE "key" = '${amberKey}'; DELETE FROM "itemIdentity" WHERE "key" = '${amberKey}'`,
	);
	postgresScalar(
		"indigo",
		`DELETE FROM "outbox" WHERE "entityType" = 'item' AND "entityKey" = '${indigoKey}'; DELETE FROM "item" WHERE "key" = '${indigoKey}'; DELETE FROM "itemIdentity" WHERE "key" = '${indigoKey}'`,
	);
	console.log(
		"Pausing Amber search did not block Indigo, and both search services contain only their own database records.",
	);
}

function publicExpectations(profile: Profile) {
	const { config } = profile;
	const messages = JSON.parse(
		readFileSync(
			path.join(
				rootDirectory,
				"src",
				"messages",
				`${config.localization.defaultLocale}.json`,
			),
			"utf8",
		),
	) as {
		scopes: Record<string, string>;
		ui: Record<string, string>;
	};
	const orderedLocales = getOrderedRuntimeLocales(config.localization);
	const alternateLocales = orderedLocales.filter(
		(locale) => locale !== config.localization.defaultLocale,
	);
	const disabledLocale = PLATFORM_LOCALES.find(
		(locale) => !config.localization.locales.includes(locale),
	);
	if (!disabledLocale) {
		throw new Error(`${profile.name} must leave one locale disabled`);
	}
	const scopes = getRuntimeSearchScopeOptions(config.search);
	const defaultScope =
		scopes.find((scope) => scope.key === config.search.defaultScope) ??
		PLATFORM_SEARCH_SCOPE_OPTIONS[0];
	const externalNavigation = config.navigation.links.find(
		(link) => link.href.startsWith("https://"),
	);
	const logoStyleToken = config.identity.assets.logoStyles
		?.split(";")
		.map((declaration) => declaration.trim())
		.filter(Boolean)
		.at(-1);
	const googleFonts = Array.from(
		new Set(
			[
				config.theme.fonts.heading,
				config.theme.fonts.body,
			]
				.filter((font) => font.source === "google")
				.map((font) => font.family),
		),
	);
	const switchLocale = alternateLocales[0];
	const activeTheme =
		config.theme.forcedMode ??
		(config.theme.defaultMode === "system"
			? "light"
			: config.theme.defaultMode);
	const searchItemPrefix =
		profile.name === "amber" ? "Amber" : "Indigo";
	const databaseItemKey =
		profile.name === "amber" ? "AMBR2345" : "INDG2345";
	const enabledGapMap = config.gapMaps.find(
		(gapMap) => gapMap.enabled,
	);
	const disabledGapMap = config.gapMaps.find(
		(gapMap) => !gapMap.enabled,
	);

	return {
		PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${profile.port}`,
		PLAYWRIGHT_RUNTIME_ACCEPTANCE: "true",
		PLAYWRIGHT_EXPECTED_CONFIG_REVISION: config.revision,
		PLAYWRIGHT_EXPECTED_CONFIG_UPDATED_AT: config.updatedAt,
		PLAYWRIGHT_EXPECTED_IDENTITY_NAME: config.identity.name,
		PLAYWRIGHT_EXPECTED_IDENTITY_SHORT_NAME:
			config.identity.shortName,
		PLAYWRIGHT_EXPECTED_LOGO_URL:
			activeTheme === "dark"
				? config.identity.assets.logoDark
				: config.identity.assets.logoLight,
		PLAYWRIGHT_EXPECTED_LOGO_URLS: [
			config.identity.assets.logoDark,
			config.identity.assets.logoLight,
		].join("|"),
		PLAYWRIGHT_EXPECTED_FAVICON_URL:
			config.identity.assets.favicon,
		PLAYWRIGHT_EXPECTED_LOGO_STYLE_TOKEN: logoStyleToken ?? "",
		PLAYWRIGHT_EXPECTED_ACCENT_RGB: formatRgbChannels(
			parseHexColor(config.theme.colors.accent),
		),
		PLAYWRIGHT_EXPECTED_GOOGLE_FONT_FAMILIES:
			googleFonts.join("|"),
		PLAYWRIGHT_EXPECTED_LOADED_LOGO: "true",
		PLAYWRIGHT_EXPECTED_THEME_CLASS: activeTheme,
		PLAYWRIGHT_EXPECTED_SEARCH_ITEM_KEY:
			`${searchItemPrefix.toUpperCase()}_SEARCH_FIXTURE`,
		PLAYWRIGHT_EXPECTED_SEARCH_ITEM_TITLE:
			`${searchItemPrefix} runtime evidence`,
		PLAYWRIGHT_EXPECTED_DATABASE_ITEM_KEY:
			databaseItemKey,
		PLAYWRIGHT_EXPECTED_DATABASE_ITEM_TITLE:
			`${searchItemPrefix} database evidence`,
		PLAYWRIGHT_EXPECTED_NAVIGATION_LABEL:
			config.navigation.links[0]?.label ?? "",
		PLAYWRIGHT_EXPECTED_EXTERNAL_NAVIGATION_LABEL:
			externalNavigation?.label ?? "",
		PLAYWRIGHT_EXPECTED_FOOTER_SECTION:
			config.footer.sections[0]?.title ?? "",
		PLAYWRIGHT_EXPECTED_CONTACT_EMAIL: config.contact.email ?? "",
		PLAYWRIGHT_EXPECTED_CONTACT_PHONE: config.contact.phone ?? "",
		PLAYWRIGHT_EXPECTED_CONTACT_ADDRESS:
			config.contact.address?.split("\n")[0] ?? "",
		PLAYWRIGHT_EXPECTED_FUNDER_NAME:
			config.footer.funders[0]?.name ?? "",
		PLAYWRIGHT_EXPECTED_DISCLAIMER:
			config.footer.disclaimer ?? "",
		PLAYWRIGHT_EXPECTED_ATTRIBUTION:
			config.footer.attribution ?? "",
		PLAYWRIGHT_EXPECTED_DEFAULT_LOCALE:
			config.localization.defaultLocale,
		PLAYWRIGHT_EXPECTED_ENABLED_LOCALES:
			config.localization.locales.join(","),
		PLAYWRIGHT_EXPECTED_DISABLED_LOCALE: disabledLocale,
		PLAYWRIGHT_EXPECTED_DETECTED_LOCALE:
			config.localization.detectLocale
				? (switchLocale ?? "")
				: "",
		PLAYWRIGHT_EXPECTED_LANGUAGE_SWITCHER: String(
			config.features.languageSwitcher,
		),
		PLAYWRIGHT_EXPECTED_CURRENT_LOCALE_LABEL:
			shortLocalesNames[config.localization.defaultLocale],
		PLAYWRIGHT_EXPECTED_LOCALE_OPTIONS: alternateLocales
			.map((locale) => localesNames[locale])
			.join("|"),
		PLAYWRIGHT_EXPECTED_SWITCH_LOCALE: switchLocale ?? "",
		PLAYWRIGHT_EXPECTED_SWITCH_LOCALE_LABEL: switchLocale
			? localesNames[switchLocale]
			: "",
		PLAYWRIGHT_EXPECTED_SWITCH_BACK_LOCALE_LABEL:
			switchLocale
				? localesNames[config.localization.defaultLocale]
				: "",
		PLAYWRIGHT_EXPECTED_CONSENT_DECLINE:
			messages.ui.cookieDecline,
		PLAYWRIGHT_EXPECTED_SEARCH_SCOPE_COUNT: String(scopes.length),
		PLAYWRIGHT_EXPECTED_DEFAULT_SEARCH_SCOPE_LABEL:
			messages.scopes[defaultScope.key] ?? defaultScope.name,
		PLAYWRIGHT_EXPECTED_YEAR_FILTER: String(
			config.filters.years.enabled,
		),
		PLAYWRIGHT_EXPECTED_INSTITUTION_FILTER_LABEL:
			messages.ui[config.filters.institution.label] ??
			config.filters.institution.label,
		PLAYWRIGHT_EXPECTED_CITATION_URL: String(
			config.citations.showUrl,
		),
		PLAYWRIGHT_EXPECTED_EMBEDDINGS: String(
			config.search.embeddings,
		),
		PLAYWRIGHT_EXPECTED_COUNTRY_FACET: String(
			config.search.country,
		),
		PLAYWRIGHT_EXPECTED_AUTHOR_COUNTRY_FACET: String(
			config.search.authorCountry,
		),
		PLAYWRIGHT_EXPECTED_INSTITUTION_FACET: String(
			config.filters.institution.mode !== "hidden",
		),
		PLAYWRIGHT_EXPECTED_NAVBAR_SEARCH: String(
			config.features.navbarSearch,
		),
		PLAYWRIGHT_EXPECTED_THEME_SWITCHER: String(
			config.features.themeSwitcher,
		),
		PLAYWRIGHT_EXPECTED_LOGIN: String(config.features.login),
		PLAYWRIGHT_EXPECTED_AI: String(config.features.ai),
		PLAYWRIGHT_EXPECTED_AI_SEARCH: String(
			config.features.aiSearch,
		),
		PLAYWRIGHT_EXPECTED_DEEP_RESEARCH: String(
			config.features.deepResearch,
		),
		PLAYWRIGHT_EXPECTED_GAP_MAP: String(
			Boolean(enabledGapMap),
		),
		PLAYWRIGHT_EXPECTED_EXPORT_RIS: String(
			config.features.downloads &&
				Boolean(config.exports.ris),
		),
		PLAYWRIGHT_EXPECTED_EXPORT_BIBTEX: String(
			config.features.downloads &&
				Boolean(config.exports.bibtex),
		),
		PLAYWRIGHT_EXPECTED_EXPORT_ATOM: String(
			config.features.atomFeed &&
				Boolean(config.exports.atom),
		),
		PLAYWRIGHT_EXPECTED_ANALYTICS: String(
			Boolean(
				config.analytics.posthog.host &&
					config.analytics.posthog.key,
			),
		),
		PLAYWRIGHT_EXPECTED_AUTHENTICATION: String(
			config.features.login,
		),
		PLAYWRIGHT_EXPECTED_EMAIL: String(
			Boolean(config.email.contactRecipient),
		),
		PLAYWRIGHT_FIXTURE_ORIGIN:
			config.analytics.posthog.host ??
			`https://collector.localhost:${fixturePort}`,
		PLAYWRIGHT_MAILPIT_ORIGIN: `http://127.0.0.1:${mailpitPort}`,
		PLAYWRIGHT_IGNORE_HTTPS_ERRORS: "true",
		PLAYWRIGHT_GAP_MAP_SLUG: enabledGapMap?.slug ?? "",
		PLAYWRIGHT_GAP_MAP_LABEL: enabledGapMap?.label ?? "",
		PLAYWRIGHT_DISABLED_GAP_MAP_SLUG:
			disabledGapMap?.slug ?? "",
		PLAYWRIGHT_DISABLED_GAP_MAP_LABEL:
			disabledGapMap?.label ?? "",
		PLAYWRIGHT_GAP_MAP_MARKER: "AMBER_GAP_MAP_FIXTURE",
		PLAYWRIGHT_CONTACT_RECIPIENT:
			config.email.contactRecipient ?? "",
		PLAYWRIGHT_EMAIL_SENDER: config.email.smtp.from ?? "",
	};
}

function runBrowserSuite(profile: Profile) {
	console.log(`\nRunning ${profile.name} runtime acceptance suite`);
	run(
		"npx",
		[
			"playwright",
			"test",
			"tests/e2e/smoke.spec.ts",
			"--project",
			"chromium",
		],
		{
			...commandEnvironment,
			...publicExpectations(profile),
		},
	);
	run(
		"npx",
		[
			"playwright",
			"test",
			"tests/e2e/runtime-integrations.spec.ts",
			"--project",
			"chromium",
		],
		{
			...commandEnvironment,
			...publicExpectations(profile),
		},
	);
	run(
		"npx",
		[
			"playwright",
			"test",
			"tests/e2e/runtime-mobile.spec.ts",
			"--project",
			"mobile-chromium",
		],
		{
			...commandEnvironment,
			...publicExpectations(profile),
		},
	);
}

function countServerCollectorRequests(logs: string) {
	return logs
		.split("\n")
		.filter(
			(line) =>
				line.includes('"method":"POST"') &&
				/"uri":"\/(?:batch|e)\//u.test(line),
		).length;
}

function verifyServerAnalyticsTransport(profile: Profile) {
	const { host, key } = profile.config.analytics.posthog;
	if (!host || !key) {
		return;
	}

	const before = countServerCollectorRequests(
		captureCompose("logs", "--no-color", "fixture"),
	);
	const eventName = `acceptance_server_${profile.name}_${Date.now()}`;
	const script = [
		'const { PostHog } = require("posthog-node");',
		"const [host, key, event] = process.argv.slice(1);",
		"const client = new PostHog(key, { host, flushAt: 1, flushInterval: 0 });",
		'client.capture({ distinctId: "runtime-acceptance-server", event });',
		"client.shutdown().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });",
	].join(" ");
	compose(
		"exec",
		"--no-TTY",
		profile.name,
		"node",
		"--eval",
		script,
		host,
		key,
		eventName,
	);
	const after = countServerCollectorRequests(
		captureCompose("logs", "--no-color", "fixture"),
	);
	assert.ok(
		after > before,
		`${profile.name} server-side PostHog did not reach the configured collector`,
	);
	console.log(
		`${profile.name} server-side PostHog reached the configured HTTPS collector.`,
	);
}

function cleanupAcceptanceUsers() {
	compose(
		"exec",
		"--no-TTY",
		"postgres",
		"psql",
		"--set",
		"ON_ERROR_STOP=1",
		"--username",
		"library",
		"--dbname",
		"amber",
		"--command",
		`DELETE FROM "user" WHERE "email" LIKE 'acceptance-%@example.org'`,
	);
}

async function waitForRuntimeHealth(
	profile: Profile,
	predicate: (health: RuntimeConfigHealth) => boolean,
	description: string,
) {
	const deadline = Date.now() + 20_000;
	let lastHealth: RuntimeConfigHealth | null = null;
	let lastError: unknown = null;

	while (Date.now() < deadline) {
		try {
			const response = await fetch(
				`http://127.0.0.1:${profile.port}/api/library-config/health`,
			);
			lastHealth = (await response.json()) as RuntimeConfigHealth;
			if (predicate(lastHealth)) return lastHealth;
		} catch (error) {
			lastError = error;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}

	throw new Error(
		`Timed out waiting for ${description}; last health: ${JSON.stringify(lastHealth)}; last error: ${String(lastError)}`,
	);
}

async function expectRenderedIdentity(
	profile: Profile,
	expectedName: string,
) {
	const response = await fetch(
		`http://127.0.0.1:${profile.port}/${profile.config.localization.defaultLocale}/lib`,
	);
	assert.equal(response.status, 200);
	assert.ok((await response.text()).includes(expectedName));
}

async function observeAtomicActivation(
	profile: Profile,
	allowedRevisions: readonly string[],
	transition: () => Promise<unknown>,
) {
	let finished = false;
	let lastObservationError: unknown = null;
	const observations: RuntimeConfigHealth[] = [];
	const observer = (async () => {
		do {
			try {
				const response = await fetch(
					`http://127.0.0.1:${profile.port}/api/library-config/health`,
				);
				observations.push(
					(await response.json()) as RuntimeConfigHealth,
				);
			} catch (error) {
				if (finished) throw error;
				lastObservationError = error;
			}
			await new Promise((resolve) => setTimeout(resolve, 10));
		} while (!finished);
	})();

	let transitionError: unknown;
	try {
		await transition();
	} catch (error) {
		transitionError = error;
	} finally {
		finished = true;
		try {
			await observer;
		} catch (error) {
			if (!transitionError) throw error;
		}
	}
	if (transitionError) throw transitionError;

	assert.ok(
		observations.length > 0,
		`No runtime health observations were captured; last error: ${String(lastObservationError)}`,
	);
	for (const health of observations) {
		assert.equal(health.state, "active");
		assert.equal(health.rejected, null);
		assert.ok(
			health.active &&
				allowedRevisions.includes(health.active.revision),
			`Unexpected revision during atomic activation: ${JSON.stringify(health)}`,
		);
	}
}

function containerIdentity(service: Profile["name"]) {
	const containerId = captureCompose("ps", "--quiet", service).trim();
	assert.ok(containerId, `No running ${service} container found`);
	return capture("docker", [
		"inspect",
		"--format",
		"{{.Id}}|{{.Image}}",
		containerId,
	]).trim();
}

function timestampAfter(timestamp: string, milliseconds: number) {
	return new Date(Date.parse(timestamp) + milliseconds).toISOString();
}

async function verifyLiveConfigLifecycle(profile: Profile) {
	const targetPath = path.join(
		runtimeDirectory,
		profile.name,
		"library.json",
	);
	const candidatePath = path.join(
		runtimeDirectory,
		profile.name,
		"candidate.json",
	);
	const originalIdentity = containerIdentity(profile.name);
	const activated = structuredClone(profile.config);
	activated.revision = `${profile.config.revision}-activated`;
	activated.updatedAt = timestampAfter(profile.config.updatedAt, 60_000);
	activated.identity.name = "Amber Live Activation";
	await writeFile(
		candidatePath,
		JSON.stringify(activated, null, "\t"),
		"utf8",
	);

	await observeAtomicActivation(
		profile,
		[profile.config.revision, activated.revision],
		() => activateLibraryConfig({ candidatePath, targetPath }),
	);
	const activatedHealth = await waitForRuntimeHealth(
		profile,
		(health) =>
			health.state === "active" &&
			health.active?.revision === activated.revision &&
			health.rejected === null,
		"valid configuration activation",
	);
	await expectRenderedIdentity(profile, activated.identity.name);
	assert.equal(containerIdentity(profile.name), originalIdentity);

	const invalid = structuredClone(activated);
	invalid.revision = `${profile.config.revision}-rejected`;
	invalid.updatedAt = timestampAfter(activated.updatedAt, 60_000);
	const targetMode = (await stat(targetPath)).mode & 0o777;
	invalid.identity.name = "";
	await replaceFileAtomically({
		content: `${JSON.stringify(invalid, null, "\t")}\n`,
		mode: targetMode,
		targetPath,
	});
	await waitForRuntimeHealth(
		profile,
		(health) =>
			health.state === "rejected" &&
			health.active?.revision === activated.revision &&
			health.rejected?.revision === invalid.revision,
		"invalid configuration rejection with last-valid retention",
	);
	await expectRenderedIdentity(profile, activated.identity.name);
	assert.equal(containerIdentity(profile.name), originalIdentity);

	const rollback = await rollbackLibraryConfig({
		minimumUpdatedAt: activatedHealth.active?.updatedAt,
		targetPath,
	});
	profile.config = rollback.active;
	await waitForRuntimeHealth(
		profile,
		(health) =>
			health.state === "active" &&
			health.active?.revision === rollback.active.revision &&
			health.rejected === null,
		"configuration rollback",
	);
	await expectRenderedIdentity(profile, profile.config.identity.name);
	assert.equal(containerIdentity(profile.name), originalIdentity);
	console.log(
		`${profile.name} live config activation, rejection, retention, and rollback passed without a container restart.`,
	);
}

async function main() {
	reapAbandonedProjects();
	const profiles = [
		loadProfile("amber", amberPort, amberMeilisearchPort),
		loadProfile("indigo", indigoPort, indigoMeilisearchPort),
	];

	rmSync(runtimeDirectory, { recursive: true, force: true });
	profiles.forEach(prepareRuntimeConfig);

	try {
		if (!skipBuild) {
			run("docker", ["build", "--tag", image, "."]);
			run("docker", [
				"build",
				"--target",
				"search-indexer",
				"--tag",
				searchIndexerImage,
				".",
			]);
		}
		await verifyRootOwnedConfigStartup();
		compose(
			"up",
			"--wait",
			"--wait-timeout",
			"180",
			"postgres",
			"amber-meilisearch",
			"indigo-meilisearch",
		);
		for (const profile of profiles) {
			await seedSharedSearchIndexes(profile);
		}
		compose(
			"up",
			"--wait",
			"--wait-timeout",
			"180",
			"amber-search-indexer",
			"indigo-search-indexer",
		);
		for (const profile of profiles) {
			assert.equal(
				postgresScalar(
					profile.name,
					`SELECT "searchIndexRebuildPending" FROM "status" WHERE "id" = 1`,
				),
				"f",
				`${profile.name} search rebuild marker must clear before worker health passes`,
			);
		}
		for (const profile of profiles) {
			await seedSearch(profile);
		}
		await verifySearchQueueIsolation(profiles);
		compose(
			"up",
			"--wait",
			"--wait-timeout",
			"180",
			"amber",
			"indigo",
			"amber-search-indexer",
			"indigo-search-indexer",
		);
		await verifyLiveConfigLifecycle(profiles[0]);
		profiles.forEach(verifyServerAnalyticsTransport);
		profiles.forEach(runBrowserSuite);
		cleanupAcceptanceUsers();
		console.log("\nRuntime acceptance passed for Amber and Indigo.");
		if (keepRunning) {
			console.log(
				`Amber: http://127.0.0.1:${amberPort}\nIndigo: http://127.0.0.1:${indigoPort}\nCompose project: ${composeProject}`,
			);
		}
	} catch (error) {
		compose(
			"logs",
			"--no-color",
			"--tail",
			"200",
			"amber",
			"indigo",
			"fixture",
			"mailpit",
			"postgres",
			"amber-meilisearch",
			"indigo-meilisearch",
		);
		throw error;
	} finally {
		if (!keepRunning) {
			compose("down", "--volumes", "--remove-orphans");
			rmSync(runtimeDirectory, {
				recursive: true,
				force: true,
			});
		}
	}
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
