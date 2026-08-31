# AI crawler policy research

Checked against first-party documentation on 2026-08-31.

## Conclusion

The shield can block model-training crawlers while allowing chatbot search and user-requested fetches for most providers. The current configuration does not make that distinction. It blocks OpenAI search and user fetch traffic alongside OpenAI's training crawler.

Use two independent controls:

1. Publish the provider's training opt-out in `robots.txt`. This covers policy-only tokens that never appear in HTTP requests.
2. At the shield, deny known training crawler HTTP identities and allow known search or user-fetch identities through the shared crawler rate limit.

Keep nuisance-crawler and load rules separate. An SEO scraper can remain blocked for load reasons without being described as an AI training crawler.

## Provider matrix

`HTTP identifier` is the stable token to match as a case-insensitive substring of the HTTP `User-Agent`. A value of `none` means the provider documents a `robots.txt` product token but sends requests under another crawler identity.

| Provider | Purpose | HTTP identifier | `robots.txt` token | `robots.txt` behavior | Recommended policy |
| --- | --- | --- | --- | --- | --- |
| OpenAI | Model training | `GPTBot` | `GPTBot` | Respected | Block in both places |
| OpenAI | ChatGPT Search index | `OAI-SearchBot` | `OAI-SearchBot` | Respected | Allow and rate-limit |
| OpenAI | User-requested ChatGPT or Custom GPT fetch | `ChatGPT-User` | `ChatGPT-User` | May not apply because the fetch is user-initiated | Allow and rate-limit |
| Anthropic | Model development and possible training collection | `ClaudeBot` | `ClaudeBot` | Respected | Block in both places |
| Anthropic | Claude search index | `Claude-SearchBot` | `Claude-SearchBot` | Respected | Allow and rate-limit |
| Anthropic | User-requested Claude fetch | `Claude-User` | `Claude-User` | Anthropic says its bots honor the file | Allow and rate-limit |
| Google | Google Search, AI Overviews, and AI Mode | `Googlebot` | `Googlebot` | Respected | Allow and rate-limit |
| Google | Gemini training and Gemini grounding control | none | `Google-Extended` | Policy-only token | Block in `robots.txt`, subject to the conflict below |
| Google | User-requested agent navigation | `Google-Agent` | none | User-triggered fetchers generally ignore the file | Allow and rate-limit |
| Google | User-supplied Gemini Notebook source | `Google-GeminiNotebook` | none | User-triggered fetcher | Allow and rate-limit |
| Google | Site-owner-requested Vertex AI Agent crawl | `Google-CloudVertexBot` | `Google-CloudVertexBot` | Respected | Allow and rate-limit |
| Apple | Search, Siri, Spotlight, Safari, and current AI context | `Applebot` | `Applebot` | Respected | Allow and rate-limit |
| Apple | Foundation-model training opt-out | none | `Applebot-Extended` | Policy-only token that does not crawl | Block in `robots.txt` |
| Meta | Foundation-model training or direct product indexing | `meta-externalagent` | `meta-externalagent` | Respected | Block in both places |
| Meta | Meta AI search index | `meta-webindexer` | `meta-webindexer` | Respected | Allow and rate-limit |
| Meta | User-requested and agentic fetch | `meta-externalfetcher` | `meta-externalfetcher` | May bypass the file because the fetch is user-requested | Allow and rate-limit |
| Meta | Facebook, Instagram, and Messenger link previews | `facebookexternalhit` | `facebookexternalhit` | May bypass the file for security checks | Allow and rate-limit |
| Perplexity | Perplexity search index, explicitly not foundation-model training | `PerplexityBot` | `PerplexityBot` | Respected | Allow and rate-limit |
| Perplexity | User-requested Perplexity fetch, explicitly not training | `Perplexity-User` | `Perplexity-User` | Generally ignored because the fetch is user-initiated | Allow and rate-limit |
| Amazon | Product improvement and possible Amazon AI model training | `Amazonbot` | `Amazonbot` | Respected for automated crawling | Block in both places |
| Amazon | Alexa and Amazon search, explicitly not training | `Amzn-SearchBot` | `Amzn-SearchBot` | Respected | Allow and rate-limit |
| Amazon | User-requested live fetch, explicitly not training | `Amzn-User` | `Amzn-User` | May not apply because the fetch is user-initiated | Allow and rate-limit |
| Microsoft | Bing Search and Copilot grounding | `bingbot` | `bingbot` | Respected | Allow and rate-limit, subject to the conflict below |
| Common Crawl | Open crawl dataset available for model training and other uses | `CCBot` | `CCBot` | Respected | Block in both places |

Sources: [OpenAI crawler documentation](https://developers.openai.com/api/docs/bots), [Anthropic bot documentation](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler), [Google common crawlers](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers), [Google user-triggered fetchers](https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers), [Google Search AI features](https://developers.google.com/search/docs/appearance/ai-features), [Applebot documentation](https://support.apple.com/en-us/119829), [Meta crawler documentation](https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/), [Perplexity crawler documentation](https://docs.perplexity.ai/docs/resources/perplexity-crawlers), [Amazon crawler documentation](https://developer.amazon.com/amazonbot), [Bing crawler documentation](https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0), [Bing robots metadata documentation](https://www.bing.com/webmasters/help/robots-meta-tags-and-attributes-that-bing-supports-5198d240), and [Common Crawl's CCBot documentation](https://commoncrawl.org/ccbot).

The providers publish complete example strings for many of these identifiers. Versions change, so the shield should match the documented stable token, not a versioned full string. Anthropic currently documents the three exact tokens but not versioned full HTTP strings.

## Provider conflicts

### Google bundles training and Gemini grounding

`Google-Extended` has no separate HTTP `User-Agent`. Google applies it as a use-control token to content fetched by existing Google crawlers. It controls both training future Gemini models and grounding Gemini Apps or Vertex AI with Google Search.

There is no current Google control that blocks only training while retaining that Gemini grounding. Disallowing `Google-Extended` still permits ordinary Google Search, AI Overviews, and AI Mode through `Googlebot`, but it also opts the content out of Gemini Apps and Vertex grounding. Under a strict no-training policy, block `Google-Extended` and accept that loss.

`GoogleOther` is also too broad for the shield's privileged allow list. Google describes it as a generic crawler that product teams may use for one-off internal research and development. Google does not identify it as a search crawler or as a confirmed training crawler. Do not label it as training, but do not grant it the search-crawler bypass either.

### Microsoft does not expose separate crawler identities

Microsoft uses `bingbot` for search indexing and Copilot grounding. Its page-level controls bundle uses:

- `noarchive` blocks foundation-model training but also prevents links in Chat and Copilot.
- `nocache` permits Chat and Copilot to use the URL, title, and snippet, but Microsoft may also use those fields for foundation-model training.

Microsoft therefore has no documented control that permits full Copilot use while forbidding all training use. Keep `bingbot` allowed if chatbot search visibility is the priority. A strict no-training policy would need `noarchive`, which conflicts with the requested chatbot-search behavior.

## Repository findings before implementation

The shield's previous `$ode_bad_bot` map correctly included `GPTBot`,
`ClaudeBot`, `meta-externalagent`, `Amazonbot`, and `CCBot`, but it also included
three identities that this policy should allow:

- `OAI-SearchBot`
- `ChatGPT-User`
- `facebookexternalhit`

It did not recognize several documented allow-side identities, so they fell
into the unknown-client challenge or rejection path:

- `Claude-SearchBot` and `Claude-User`
- `PerplexityBot` and `Perplexity-User`
- `meta-webindexer` and `meta-externalfetcher`
- `Amzn-SearchBot` and `Amzn-User`
- `Google-Agent`, `Google-GeminiNotebook`, and `Google-CloudVertexBot`

The implementation moves the allow-side identities into the crawler
rate-limited path and keeps the training identities in the hard-deny path.

The generated [`robots.txt`](../src/app/robots.ts) previously had only the
wildcard group. The implementation adds a specific full-site disallow group
for:

```text
GPTBot
ClaudeBot
Google-Extended
Applebot-Extended
meta-externalagent
Amazonbot
CCBot
```

Next.js supports multiple user-agent rule groups in `MetadataRoute.Robots`; see its [official `robots` file convention](https://github.com/vercel/next.js/blob/canary/docs/01-app/03-api-reference/03-file-conventions/01-metadata/robots.mdx). Under [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html), a crawler with a specific matching group does not inherit the wildcard group's rules. A full-site training block is unaffected, but any future provider-specific partial rule must repeat the generic path exclusions.

The previous shield also checked its crawler deny before honoring the
`/robots.txt` bypass. The implementation now lets every client fetch the policy
file before applying the training-crawler deny; the hard deny still applies to
every other route.

## Load protection remains separate

`AhrefsBot`, `DataForSeoBot`, `SemrushBot`, `MJ12bot`, `YandexBot`, and other SEO or commercial crawlers in the current deny list are not documented here as AI-training agents. They may remain blocked because of load, scraping, or product policy. Keep them in a separate nuisance-crawler category so the configuration states the real reason.

I found no adequate first-party documentation that proves a training-versus-search purpose for `Bytespider`, `AliyunSecBot`, `SleepBot`, or `YisouSpider`. Preserve any load-based block, but do not present those identities as confirmed training crawlers.

Allowed identities should eventually be verified against provider-published IP ranges where available. A `User-Agent` header alone is spoofable. OpenAI, Anthropic, Google, Apple, Perplexity, and Amazon publish current verification data or IP lists in the linked documentation.
