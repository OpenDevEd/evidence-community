import { MeiliSearch } from "meilisearch";

const client = new MeiliSearch({
	host: process.env.MEILISEARCH_HOST || "",
	apiKey: process.env.MASTER_KEY || "",
	timeout: 100000,
});

export default client;