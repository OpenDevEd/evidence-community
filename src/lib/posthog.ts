import { PostHog } from 'posthog-node'

// PostHog's constructor reads the API key eagerly and some versions throw on
// missing values, so we can't instantiate at module load — `next build`'s
// page-data collection imports route files (which transitively import this)
// without the runtime env set. Lazy-construct on first property access via a
// Proxy so every `import posthogClient from './posthog'` keeps working.
let _client: PostHog | null = null;

function getClient(): PostHog {
	if (!_client) {
		_client = new PostHog(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
			host: process.env.NEXT_PUBLIC_POSTHOG_HOST!,
			flushAt: 1,
			flushInterval: 0,
		});
	}
	return _client;
}

const posthogClient = new Proxy({} as PostHog, {
	get(_target, prop) {
		const real = getClient();
		const value = Reflect.get(real, prop, real);
		return typeof value === "function" ? value.bind(real) : value;
	},
});

export default posthogClient;
