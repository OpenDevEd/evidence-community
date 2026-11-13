/**
 * The user agents of crawlers: search engines, link previews and answer engines. Next.js's own list plus Googlebot and
 * every other name that says bot, crawler or spider. Cubot is a phone maker, whose browsers aren't crawlers.
 *
 * A crawler gets a page whole: its title, description and canonical address in the head (`htmlLimitedBots` in
 * next.config.mjs), and its content in place with no stand-ins before it (`PageBoundary`). A plain module, because
 * next.config.mjs reads it too.
 */
export const CRAWLER_USER_AGENT = /(?<!cu)bot|crawler|spider|[\w-]+-Google|Google-[\w-]+|Chrome-Lighthouse|Slurp|yandex|sogou|tumblr|vkShare|quora link preview|ia_archiver|BingPreview|facebookexternalhit|facebookcatalog|WhatsApp|SkypeUriPreview|Yeti|googleweblight|ChatGPT-User|Claude-User|Perplexity-User/i;

/**
 * Whether a visitor gets a page's content in place, with no stand-ins. Lighthouse is on the list for the head's sake,
 * but it measures what people get, so it keeps the stand-ins people see.
 */
export const readsPagesWhole = (/** @type {string} */ userAgent) => CRAWLER_USER_AGENT.test(userAgent) && !/Chrome-Lighthouse/i.test(userAgent);
