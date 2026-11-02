// @vitest-environment jsdom
// The evidence map's data is built for one library (AIED) and every library runs the same image. Another library must never
// show that data: no map, no search route, no checks or Visualize buttons on its records.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const library = vi.hoisted(() => ({ baseUrl: "https://aied.openscholar.ai" }));

vi.mock("next-intl", async () => ({ ...(await vi.importActual<typeof import("next-intl")>("next-intl")), ...(await (await import("../helpers/next-intl-english")).englishIntl()) }));
vi.mock("server-only", () => ({}));
// A route asks for a request scope, which a test has none of.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.mock("@/context/LibraryConfigProvider", () => ({ useLibraryConfig: () => ({ identity: { baseUrl: library.baseUrl } }) }));
vi.mock("@/config/library-config/server", () => ({ getLibraryConfig: async () => ({ identity: { baseUrl: library.baseUrl } }) }));
vi.mock("@/i18n/routing", () => ({
	Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const { EvidenceVerdict, VisualizeButton } = await import("@/components/pages/evidence/record-evidence");
const { GET } = await import("@/app/api/evidence/hits/route");

// A checked meta-analysis in AIED, part of a chain.
const record = { key: "YHAI6ACS", links: { cites: [], citedBy: [] } };

let container: HTMLDivElement, root: Root;
beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

const render = (element: React.ReactElement) => act(async () => root.render(element));

describe("the evidence map in a library", () => {
	it("shows a record's check and its Visualize button in AIED", async () => {
		library.baseUrl = "https://aied.openscholar.ai";
		await render(<><EvidenceVerdict item={record} /><VisualizeButton item={record} /></>);
		expect(container.querySelector('[href="/evidence?paper=YHAI6ACS"]')).not.toBeNull();
		expect(container.querySelector('[aria-label="Visualize"]')).not.toBeNull();
	});

	it("shows neither in another library, even for a record key AIED's data knows", async () => {
		library.baseUrl = "https://tvet.openscholar.ai";
		await render(<><EvidenceVerdict item={record} /><VisualizeButton item={{ ...record, links: { cites: ["X"], citedBy: [] } }} /></>);
		expect(container.innerHTML).toBe("");
	});

	it("refuses the map's search in another library", async () => {
		library.baseUrl = "https://tvet.openscholar.ai";
		const response = await GET(new Request("http://localhost/api/evidence/hits?search=learning") as never);
		expect(response.status).toBe(404);
	});
});
