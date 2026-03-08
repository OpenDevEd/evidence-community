import dotenv from "dotenv";

dotenv.config();

async function main() {
	const { syncRuntimeFeatureFlags } = await import(
		"@/lib/runtime-feature-flags"
	);

	const result = await syncRuntimeFeatureFlags();

	console.log(
		JSON.stringify(
			{
				reason: result.reason,
				refreshed: result.refreshed,
				count: Object.keys(result.flags).length,
			},
			null,
			2
		)
	);
}

main().catch((error) => {
	console.error("Feature flag sync command failed", error);
	process.exit(1);
});
