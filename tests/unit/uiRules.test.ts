import { describe, expect, it } from "vitest";

import { messageProblems, sourceProblems, stylesheetProblems } from "../../tools/uiRules";

const rules = (code: string) => sourceProblems("src/components/Example.tsx", code).map((problem) => problem.split(" ")[1].replace(":", ""));

describe("animation-clash", () => {
	it("catches an animated element that also transitions opacity or transform", () => {
		expect(rules(`export const A = () => <button className="animate-rise-in transition-transform hover:scale-102">a</button>;`)).toEqual(["animation-clash"]);
		expect(rules(`export const B = () => <motion.div variants={items} className="border transition-all">b</motion.div>;`)).toEqual(["animation-clash"]);
	});

	it("lets an animated element transition only colours, and a pseudo-element transition its own opacity", () => {
		expect(rules(`export const C = () => <motion.div variants={items} className="border transition-colors">c</motion.div>;`)).toEqual([]);
		expect(rules(`export const D = () => <motion.div animate={{ opacity: 1 }} className="before:opacity-100 before:transition-opacity">d</motion.div>;`)).toEqual([]);
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
	});

	it("lets Loading pass as an attribute, a condition or a sentence", () => {
		expect(rules(`export const T = () => <Spinner label="Loading" />;`)).toEqual([]);
		expect(rules(`export const U = ({ state }) => <span>{state === "loading" ? <Spinner /> : null}</span>;`)).toEqual([]);
		expect(rules(`export const V = () => <p>Loading the records takes a minute when the library is large.</p>;`)).toEqual([]);
	});
});
