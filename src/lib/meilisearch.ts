import { MeiliSearch } from "meilisearch";

// The MeiliSearch constructor validates `host` eagerly and throws on an empty
// string, so we can't instantiate at module load — `next build`'s page-data
// collection imports route files (which transitively import this) without the
// runtime env set. Lazy-construct on first property access via a Proxy so
// every existing `import client from '@/lib/meilisearch'` keeps working
// unchanged.
let _client: MeiliSearch | null = null;

function getClient(): MeiliSearch {
	if (!_client) {
		_client = new MeiliSearch({
			host: process.env.MEILISEARCH_HOST || "",
			apiKey: process.env.MASTER_KEY || "",
			timeout: 10000000,
		});
	}
	return _client;
}

const client = new Proxy({} as MeiliSearch, {
	get(_target, prop, receiver) {
		const real = getClient();
		const value = Reflect.get(real, prop, real);
		return typeof value === "function" ? value.bind(real) : value;
	},
});

export default client;