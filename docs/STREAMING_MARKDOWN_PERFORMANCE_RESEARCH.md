# Streaming Markdown Performance Research

## Finding

The current renderer is the main streaming bottleneck. `react-markdown` reparses the complete accumulated message on every update. Its maintainer explicitly states that it has no streaming mode and that every update is a clean render. That matches the browser profile for this application, where Markdown parsing functions dominate scripting time during a long response.

Vercel AI SDK also renders on every incoming chunk by default. Its official guidance is to throttle `useChat` updates when complex Markdown causes rendering pressure. The application now uses a 50 ms throttle, which reduces work but cannot remove the full-message Markdown reparse.

## Options

| Option                                                | Fit                                                                                                                                                   | Decision                                                                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Keep `react-markdown` and write a stable-block parser | Could solve the hot path, but creates custom parsing and reconciliation code                                                                          | Reject; too much bespoke machinery                                                                            |
| Render plain text until streaming finishes            | Cheap, but visibly changes formatting and citations when the stream completes                                                                         | Reject; poor experience                                                                                       |
| `@llm-ui/react`                                       | Streaming-oriented, but its Markdown setup still uses `react-markdown`, its current peer range targets React 18, and it adds a larger block framework | Reject for this React 19 application                                                                          |
| `markstream-react`                                    | Purpose-built and includes advanced streaming/virtualization features                                                                                 | Reject for now; current package is `0.0.x` and its broader editor/diagram feature surface is unnecessary here |
| Vercel Streamdown                                     | Streaming block memoization, incomplete Markdown repair, React 19 support, AI SDK examples, and compatible custom components/plugins                  | Recommended                                                                                                   |

## Recommended implementation

Replace `react-markdown` with `streamdown` only inside the existing shared `AIMarkdown` wrapper. Keep the current page citation chips, publication cards, and styling overrides through Streamdown's `components`, `remarkPlugins`, and `rehypePlugins` props. Pass `isAnimating` only for the assistant message that is actively streaming and keep the existing 50 ms AI SDK throttle.

Because custom `rehypePlugins` replace Streamdown's defaults, include its default raw, sanitize, and hardening plugins alongside the existing citation transforms. Do not enable animation, syntax-highlighting, math, or diagram plugins unless the product needs them.

The current `streamdown@2.5.0` package declares Mermaid as a runtime dependency even when its diagram plugin is unused, which increases installation size. The compiled development chunks contained no Mermaid references because the diagram plugin is not enabled. A future production bundle check can confirm the same tree-shaking behavior for release output.

## Applied result

The shared `AIMarkdown` renderer now uses `streamdown@2.5.0`. Completed messages use static mode; only the actively growing assistant response uses streaming mode. Custom PDF citations and publication cards remain in the shared wrapper. Streamdown's extra table controls and animation CSS are disabled, and its table renderer is overridden so the project's dark `background` token does not produce black tables in the light theme.

In a five-second active-stream browser profile on the same publication chat, scripting fell from approximately 563 ms with the stabilized `react-markdown` implementation to 144 ms with Streamdown. Layout work fell from approximately 11 ms to 3.6 ms. Live verification also confirmed that PDF chips show only page numbers and retain their internal `#page=` links.

## Primary sources

- [react-markdown maintainer discussion](https://github.com/orgs/remarkjs/discussions/1262)
- [Vercel AI SDK chat rendering and throttling](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot)
- [Streamdown repository](https://github.com/vercel/streamdown)
- [Streamdown usage](https://streamdown.ai/docs/usage)
- [Streamdown configuration](https://streamdown.ai/docs/configuration)
- [Streamdown custom components](https://streamdown.ai/docs/components)
- [Streamdown plugin behavior](https://streamdown.ai/docs/plugins)
- [Streamdown security behavior](https://streamdown.ai/docs/security)
- [llm-ui official quick start](https://llm-ui.com/docs/quick-start)
- [Markstream repository](https://github.com/Simon-He95/markstream-vue)
- [Streamdown Mermaid dependency issue](https://github.com/vercel/streamdown/issues/503)
