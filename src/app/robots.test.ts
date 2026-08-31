import assert from "node:assert/strict";
import test from "node:test";
import robots from "./robots";

type Rule = {
	userAgent?: string | string[];
	allow?: string | string[];
	disallow?: string | string[];
};

function ruleFor(rules: Rule[], userAgent: string): Rule | undefined {
	return rules.find((rule) => {
		const agents = Array.isArray(rule.userAgent)
			? rule.userAgent
			: [rule.userAgent];
		return agents.includes(userAgent);
	});
}

test("robots blocks training use while allowing assistant search and user fetches", () => {
	process.env.BASE_URL = "https://docs.example.test";
	const result = robots();
	assert.ok(Array.isArray(result.rules));

	for (const userAgent of [
		"GPTBot",
		"ClaudeBot",
		"meta-externalagent",
		"Amazonbot",
		"CCBot",
		"Google-Extended",
		"Applebot-Extended",
	]) {
		assert.equal(ruleFor(result.rules, userAgent)?.disallow, "/", userAgent);
	}

	for (const userAgent of [
		"OAI-SearchBot",
		"ChatGPT-User",
		"Claude-SearchBot",
		"Claude-User",
		"PerplexityBot",
		"Perplexity-User",
		"Meta-WebIndexer",
		"Meta-ExternalFetcher",
		"Amzn-SearchBot",
		"Amzn-User",
		"Google-Agent",
		"Google-GeminiNotebook",
		"Google-CloudVertexBot",
	]) {
		assert.equal(ruleFor(result.rules, userAgent)?.allow, "/", userAgent);
	}
});
