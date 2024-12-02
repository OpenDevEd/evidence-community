import { MeiliSearch } from "meilisearch";

const client = new MeiliSearch({
	host: process.env.MEILISEARCH_HOST || "",
	apiKey: process.env.MASTER_KEY || "",
});

export default client;