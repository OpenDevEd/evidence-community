import { describe, expect, it } from "vitest";
import { CRAWLER_USER_AGENT, readsPagesWhole } from "@/lib/crawlers.mjs";

describe("which visitors are crawlers", () => {
	it("takes search engines, answer engines and link previews for crawlers", () => {
		for (const userAgent of [
			"Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
			"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36",
			"Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)",
			"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)",
			"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
			"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
			"Mozilla/5.0 (compatible; Claude-SearchBot/1.0; +https://www.anthropic.com)",
			"Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)",
			"Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
			"Mozilla/5.0 (compatible; YandexImages/3.0; +http://yandex.com/bots)",
			"Sogou web spider/4.0(+http://www.sogou.com/docs/help/webmasters.htm#07)",
			"DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)",
			"facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
			"WhatsApp/2.23.20.0",
			"Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
		]) expect(CRAWLER_USER_AGENT.test(userAgent), userAgent).toBe(true);
	});

	// A browser taken for a crawler waits for the whole page before anything shows.
	it("leaves people's browsers alone: a Cubot phone's, Sogou's and Yandex's included", () => {
		for (const userAgent of [
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
			"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
			"Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0",
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
			"Mozilla/5.0 (Linux; Android 11; CUBOT NOTE 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
			"Mozilla/5.0 (Linux; U; Android 13; zh-cn; 23049RAD8C Build/TKQ1.221114.001) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/78.0.3904.108 MQQBrowser/9.1 Mobile Safari/537.36 SogouMobileBrowser/5.21.8",
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 YaBrowser/24.1.0.0 Safari/537.36",
			"Mozilla/5.0 (Linux; arm_64; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.5993.731 YandexSearch/23.110 YandexSearchBrowser/23.110 BroPP/1.0 SA/3 Mobile Safari/537.36",
			"",
		]) expect(CRAWLER_USER_AGENT.test(userAgent), userAgent).toBe(false);
	});

	// PageSpeed Insights would otherwise score a page no person receives.
	it("gives Lighthouse the head a crawler gets and the page a person gets", () => {
		const lighthouse = "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse";
		expect(CRAWLER_USER_AGENT.test(lighthouse)).toBe(true);
		expect(readsPagesWhole(lighthouse)).toBe(false);
		expect(readsPagesWhole("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(true);
		expect(readsPagesWhole("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")).toBe(false);
	});
});
