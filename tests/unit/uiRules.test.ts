import { describe, expect, it } from "vitest";

import { loadingKeys, messageProblems, sourceProblems, stylesheetProblems } from "../../tools/uiRules";

const rules = (code: string, loading = new Set<string>()) =>
	sourceProblems("src/components/Example.tsx", code, loading).map((problem) => problem.split(" ")[1].replace(":", ""));

describe("animation-clash", () => {
	it("catches an animated element that also transitions opacity or transform", () => {
		expect(rules(`export const A = () => <button className="animate-rise-in transition-transform hover:scale-102">a</button>;`)).toEqual(["animation-clash"]);
		expect(rules(`export const B = () => <motion.div variants={items} className="border transition-all">b</motion.div>;`)).toEqual(["animation-clash"]);
	});

	it("catches arbitrary transition lists and the built-in animations", () => {
		expect(rules(`export const W = () => <div className="animate-in transition-[opacity,transform]">w</div>;`)).toEqual(["animation-clash"]);
		expect(rules(`export const X = () => <div className="animate-pulse transition-opacity">x</div>;`)).toEqual(["animation-clash"]);
		expect(rules(`export const Y = () => <div className="animate-spin transition-[color,background-color]">y</div>;`)).toEqual([]);
		expect(rules(`export const Z = () => <div className="animate-none transition-opacity">z</div>;`)).toEqual([]);
		expect(rules(`export const Z2 = () => <div className="animate-none! transition-opacity">z</div>;`)).toEqual([]);
		expect(rules(`export const Z3 = () => <div className="animate-in transition-[fill-opacity,transform-origin]">z</div>;`)).toEqual([]);
	});

	it("lets an animated element transition only colours, and a pseudo-element transition its own opacity", () => {
		expect(rules(`export const C = () => <motion.div variants={items} className="border transition-colors">c</motion.div>;`)).toEqual([]);
		expect(rules(`export const D = () => <motion.div animate={{ opacity: 1 }} className="before:opacity-100 before:transition-opacity">d</motion.div>;`)).toEqual([]);
		expect(rules(`export const D2 = () => <div className="before:animate-pulse before:transition-opacity">d</div>;`)).toEqual(["animation-clash"]);
		expect(rules(`export const D3 = () => <m.div layout className="transition-all">d</m.div>;`)).toEqual(["animation-clash"]);
	});

	it("reads class constants where they are written and where className uses them", () => {
		expect(rules(`const FX = "animate-pulse transition-opacity";\nexport const H = () => <div className={FX} />;`)).toEqual(["animation-clash"]);
		expect(rules(`export const rowClass = (on: boolean) => cn("animate-in", on && "transition-opacity");`)).toEqual(["animation-clash"]);
		expect(rules(`const card = "rounded-lg transition-all";\nexport const I = () => <motion.div layout className={card} />;`)).toEqual(["animation-clash"]);
		expect(rules(`const FADE = "animate-in";\nexport const J = () => <div className={cn(FADE, "transition-opacity")} />;`)).toEqual(["animation-clash"]);
		expect(rules(`const ENTER = "animate-in";\nconst MOVE = "transition-opacity";\nexport const K = ({ e }) => <div className={e ? ENTER : MOVE} />;`)).toEqual([]);
		expect(rules(`export const button = tv({ variants: { enter: { true: "animate-in" }, move: { true: "transition-opacity" } } });`)).toEqual([]);
	});

	it("follows a constant through as const, aliases and scopes, and never reads a condition as classes", () => {
		expect(rules(`const FX = "transition-opacity" as const;\nexport const L = () => <motion.div layout className={FX} />;`)).toEqual(["animation-clash"]);
		expect(rules(`const BASE = "transition-all";\nconst FX = BASE;\nexport const M = () => <motion.div layout className={FX} />;`)).toEqual(["animation-clash"]);
		expect(rules(`export function N() {\n\tconst classes = "transition-opacity";\n\treturn <motion.div layout className={classes} />;\n}\nexport function O() {\n\tconst classes = "border";\n\treturn <div className={classes} />;\n}`)).toEqual(["animation-clash"]);
		expect(rules(`const classes = "transition-all";\nexport const P = ({ classes }) => <motion.div layout className={classes} />;`)).toEqual([]);
		expect(rules(`const test = "transition-opacity";\nexport const Q = () => <div className={test && "animate-in"} />;`)).toEqual([]);
	});

	it("reads a long chain of constants in bounded time", () => {
		const chain = Array.from({ length: 30 }, (_, index) => `const C${index + 1} = cn(C${index}, on ? "px-${index}" : "py-${index}");`).join("\n");
		const started = performance.now();
		expect(rules(`const on = true;\nconst C0 = "border";\n${chain}\nexport const R = () => <div className={C30} />;`)).toEqual([]);
		expect(performance.now() - started).toBeLessThan(1000);
	});

	it("checks each stylesheet rule for the same clash", () => {
		const css = (text: string) => stylesheetProblems("src/styles/a.module.css", text);
		expect(css(".a {\n\tanimation: rise 200ms;\n\ttransition: opacity 200ms cubic-bezier(0.2, 0, 0, 1);\n}")).toEqual(["src/styles/a.module.css:1 animation-clash: animates and transitions opacity or transform; put the animation on a wrapper, or transition only colours, borders and shadows."]);
		expect(css(".a { animation: rise 200ms; transition: 150ms cubic-bezier(0.2, 0, 0, 1); }")).toHaveLength(1);
		expect(css(".a { animation: rise 200ms; transition: color 150ms, border-color 150ms; }")).toEqual([]);
		expect(css("@media (prefers-reduced-motion: reduce) {\n\t.a { animation: none; transition: all 1s; }\n}")).toEqual([]);
		expect(css("/* ui-rules-allow: animation-clash -- the fade runs after the rise ends */\n.a { animation: rise 1s; transition: opacity 1s; }")).toEqual([]);
	});

	it("reads stylesheet rules the way CSS applies them", () => {
		const css = (text: string) => stylesheetProblems("src/styles/a.module.css", text).length;
		expect(css(".a {\n\t&:hover { color: red; }\n\tanimation: rise 1s;\n\ttransition: opacity 1s;\n\t&:focus { color: blue; }\n}")).toBe(1);
		expect(css(".a { animation: rise 1s; transition: all 1s; transition-property: color; }")).toBe(0);
		expect(css(".a { animation: rise 1s; transition: color 1s; transition-property: opacity; }")).toBe(1);
		expect(css(".a { animation: rise 1s; transition-property: color !important; transition: all 1s; }")).toBe(0);
		expect(css(".a { animation: none, rise 1s; transition: opacity 1s; }")).toBe(1);
		expect(css(".a { animation: rise 1s; transition: 150ms !important; }")).toBe(1);
		expect(css(".a { animation: rise 1s; animation-name: none; transition: opacity 1s; }")).toBe(0);
		expect(css(".a { @apply animate-pulse transition-opacity; }")).toBe(1);
		expect(css(".a {\n\t@apply animate-pulse;\n\ttransition: opacity 1s;\n}")).toBe(1);
		expect(css(".a { @apply scroll-mt-20 xl:scroll-mt-0 transition-opacity; }")).toBe(0);
		expect(css(".a { @apply animate-pulse transition-opacity; animation: none; }")).toBe(0);
		expect(css(".a { @apply animate-pulse transition-opacity; transition-property: color; }")).toBe(0);
		expect(css(".a { @apply before:animate-pulse before:transition-opacity; }")).toBe(1);
		expect(css(".a { @apply before:animate-pulse; transition: opacity 1s; }")).toBe(0);
		expect(css(".a { @apply\n\tanimate-pulse\ttransition-opacity; }")).toBe(1);
		expect(css(".a { @apply animate-pulse transition-opacity!; transition-property: color; }")).toBe(1);
	});

	it("reads the two sides of a condition as separate class lists", () => {
		expect(rules(`export const E = ({ entering }) => <div className={entering ? "animate-in" : "transition-opacity"}>e</div>;`)).toEqual([]);
		expect(rules(`export const F = ({ on }) => <div className={cn("animate-in", on ? "transition-opacity" : "")}>f</div>;`)).toEqual(["animation-clash"]);
		expect(rules(`export const G = ({ on }) => <div className={on ? \`animate-in \${on && "transition-all"}\` : "border"}>g</div>;`)).toEqual(["animation-clash"]);
	});
});

describe("uppercase", () => {
	it("catches the utility where classes are written, with variants and the important mark", () => {
		expect(rules(`export const E = () => <span className="text-xs uppercase!">e</span>;`)).toEqual(["uppercase"]);
		expect(rules(`export const F = ({ on }) => <span className={cn("text-xs", on && "uppercase")}>f</span>;`)).toEqual(["uppercase"]);
		expect(rules(`const labelClass = "text-xs sm:uppercase tracking-wide";`)).toEqual(["uppercase"]);
		expect(rules(`export const css = "span { text-transform: uppercase; }";`)).toEqual(["uppercase"]);
	});

	it("lets prose say uppercase, and checks stylesheets", () => {
		expect(rules(`export const hint = "Use an uppercase letter";`)).toEqual([]);
		expect(stylesheetProblems("src/styles/a.css", ".label { text-transform: uppercase; }")).toHaveLength(1);
		expect(stylesheetProblems("src/styles/a.css", "/* ui-rules-allow: uppercase -- a keyboard key cap */\nkbd { text-transform: uppercase; }")).toEqual([]);
	});
});

describe("native-title", () => {
	it("catches a native tooltip on a built-in element", () => {
		expect(rules(`export const G = () => <button title="Save">g</button>;`)).toEqual(["native-title"]);
		expect(rules(`export const H = () => <abbr className="notunapi-id" title="x">h</abbr>;`)).toEqual(["native-title"]);
		expect(rules(`export const H2 = () => <abbr className="unapi-id" title="Record key">Record</abbr>;`)).toEqual(["native-title"]);
	});

	it("lets components, iframes, links and the empty unAPI record key keep a title", () => {
		expect(rules(`export const I = () => <Card title="Results" />;`)).toEqual([]);
		expect(rules(`export const J = () => <iframe title="Gap map" src="/map" />;`)).toEqual([]);
		expect(rules(`export const K = () => <link rel="unapi-server" title="unAPI" href="/api/unapi" />;`)).toEqual([]);
		expect(rules(`export const L = ({ item }) => <abbr className="unapi-id" title={item.key}></abbr>;`)).toEqual([]);
	});
});

describe("dot-separator", () => {
	it("catches dots in strings, JSX text, entities and messages", () => {
		expect(rules(`export const M = ({ a }) => <span>{a.join(" · ")}</span>;`)).toEqual(["dot-separator"]);
		expect(rules(`export const N = () => <span>A • B</span>;`)).toEqual(["dot-separator"]);
		expect(rules(`export const O = () => <span>A &middot; B &#8226; C</span>;`)).toEqual(["dot-separator"]);
		expect(messageProblems("src/messages/en-US.json", '{\n  "meta": "Authors \\u00b7 Year"\n}')).toEqual(["src/messages/en-US.json:2 dot-separator: no dot separators; use spacing, a divider or an icon."]);
	});

	it("takes an exception with a reason on the line before", () => {
		expect(rules(`export const P = () => (\n\t<span>\n\t\t{/* ui-rules-allow: dot-separator -- the masked digits of a card number */}\n\t\t&bull;&bull;&bull;&bull; {last4}\n\t</span>\n);`)).toEqual([]);
		expect(rules(`export const Q = () => (\n\t<span>\n\t\t{/* ui-rules-allow: dot-separator */}\n\t\t&bull;&bull; {last4}\n\t</span>\n);`)).toEqual(["dot-separator"]);
	});
});

describe("loading-text", () => {
	it("catches a short Loading label as JSX text or a rendered string", () => {
		expect(rules(`export const R = () => <span>Loading topics...</span>;`)).toEqual(["loading-text"]);
		expect(rules(`export const S = ({ pending, value }) => <span>{pending ? "Loading…" : value}</span>;`)).toEqual(["loading-text"]);
		expect(rules("export const S2 = () => <span>{`Loading...`}</span>;")).toEqual(["loading-text"]);
	});

	it("catches a translated Loading label where it is rendered, not where it names a spinner", () => {
		const loading = new Set(loadingKeys('{ "Items": { "loadingData": "Loading Data", "retry": "Retry" }, "A": { "status": "Loading…" }, "B": { "status": "Ready" } }'));
		expect(loading).toEqual(new Set(["loadingData"]));
		expect(rules(`export const T1 = ({ t }) => <p role="status">{t("loadingData")}</p>;`, loading)).toEqual(["loading-text"]);
		expect(rules(`export const T2 = ({ tUI }) => <p>{busy && tUI("Items.loadingData")}</p>;`, loading)).toEqual(["loading-text"]);
		expect(rules(`export const T3 = ({ t }) => <div role="status" aria-label={t("loadingData")}><Spinner /></div>;`, loading)).toEqual([]);
		expect(rules(`export const T4 = ({ t }) => <p>{t("retry")}</p>;`, loading)).toEqual([]);
		expect(rules(`export const T5 = ({ t }) => <p>{t("loading")}</p>;`, new Set(loadingKeys('{ "Common": { "loading": "Loading…" } }')))).toEqual(["loading-text"]);
	});

	it("lets text only screen readers get name a spinner", () => {
		expect(rules(`export const T6 = () => <span className="sr-only">Loading…</span>;`)).toEqual([]);
		expect(rules(`export const T7 = ({ t }) => <span className="sr-only">{t("loadingData")}</span>;`, new Set(["loadingData"]))).toEqual([]);
	});

	it("lets Loading pass as an attribute, a condition or a sentence", () => {
		expect(rules(`export const T = () => <Spinner label="Loading" />;`)).toEqual([]);
		expect(rules(`export const U = ({ state }) => <span>{state === "loading" ? <Spinner /> : null}</span>;`)).toEqual([]);
		expect(rules(`export const V = () => <p>Loading the records takes a minute when the library is large.</p>;`)).toEqual([]);
	});
});
