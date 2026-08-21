// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
	AdminIdentifiersView,
	AdminPublicationProviderView,
} from "@/lib/publication/admin-publication-view";

vi.mock("server-only", () => ({}));

import { AdminIdentifiersCard } from "@/components/admin/AdminIdentifiersCard";

function provider(
	changes: Partial<AdminPublicationProviderView> = {},
): AdminPublicationProviderView {
	return {
		provider: "crossref",
		environment: "test",
		displayState: "inactive",
		status: { label: "Not activated", description: "", shouldPoll: false },
		waitingOn: null,
		blockers: [],
		externalDoi: null,
		capabilities: {
			canActivate: true,
			canRetry: false,
			actionLabel: "Activate Crossref DOI",
			allowedIdentifierPolicies: [],
		},
		exact: {
			targetActive: false,
			target: null,
			identifierPolicy: null,
			state: null,
			plan: { status: "skipped" },
			job: null,
			identifiers: [],
			pending: false,
			pendingSubmission: null,
			journal: false,
			failure: null,
		},
		links: [],
		...changes,
	} as AdminPublicationProviderView;
}

function identifiers(
	changes: Partial<AdminIdentifiersView> = {},
): AdminIdentifiersView {
	return {
		doi: null,
		registration: { state: "none" },
		archive: { state: "none" },
		attention: false,
		actions: [
			{
				id: "register-crossref",
				provider: "crossref",
				label: "Register a DOI with Crossref",
				available: true,
				readiness: [
					{ label: "Add a title before activating publication", ok: false, field: "title" },
				],
				ready: false,
			},
			{
				id: "mint-zenodo",
				provider: "zenodo",
				label: "Archive on Zenodo and get its DOI",
				available: true,
				readiness: [{ label: "Record details", ok: true, field: null }],
				ready: true,
			},
		],
		...changes,
	};
}

describe("AdminIdentifiersCard", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
	});

	const onActivate = vi.fn();

	async function render(view: AdminIdentifiersView) {
		await act(async () => {
			root.render(
				<AdminIdentifiersCard
					busy={false}
					identifiers={view}
					itemKey="ABCDEFGH"
					onActivate={onActivate}
					onOpenAttachments={() => {}}
					onRetry={() => {}}
					providers={{ crossref: provider(), zenodo: provider({ provider: "zenodo" }) }}
				/>,
			);
		});
	}

	function toggle() {
		return container.querySelector<HTMLButtonElement>(
			"button[aria-expanded]",
		)!;
	}

	it("is closed by default and shows a missing DOI without any error", async () => {
		await render(identifiers());
		expect(toggle().getAttribute("aria-expanded")).toBe("false");
		expect(container.textContent).toContain("No DOI");
		expect(container.querySelector("[role=alert]")).toBeNull();
		expect(container.textContent).not.toContain("Fix");
	});

	it("shows the record's own DOI and where it came from at a glance", async () => {
		await render(
			identifiers({
				doi: { value: "10.9999/external", origin: "source", url: "https://doi.org/10.9999/external" },
				actions: [],
			}),
		);
		expect(container.textContent).toContain("10.9999/external");
		expect(container.textContent).toContain("from a source");
		expect(container.textContent).toContain("Not archived");
	});

	it("opens to show actions, then a readiness checklist for the picked action", async () => {
		await render(identifiers());
		await act(async () => toggle().click());
		expect(toggle().getAttribute("aria-expanded")).toBe("true");
		const buttons = [...container.querySelectorAll("button")];
		const register = buttons.find((b) => b.textContent?.includes("Register a DOI with Crossref"))!;
		expect(register).toBeDefined();
		await act(async () => register.click());
		const list = container.querySelector("ul[aria-label='Before registering']")!;
		expect(list).not.toBeNull();
		expect(list.textContent).toContain("Add a title before activating publication");
		expect(list.querySelector("button")?.textContent).toContain("Go to field");
		const confirm = [...container.querySelectorAll("button")].find((b) =>
			b.textContent?.includes("Activate Crossref DOI"),
		)!;
		expect(confirm.disabled).toBe(true);
		expect(container.textContent).toContain("1 thing to add first");
		expect(container.querySelector("[role=alert]")).toBeNull();
	});

	it("enables the confirm button for a ready action and hands over to the dialog", async () => {
		await render(identifiers());
		await act(async () => toggle().click());
		const archive = [...container.querySelectorAll("button")].find((b) =>
			b.textContent?.includes("Archive on Zenodo and get its DOI"),
		)!;
		await act(async () => archive.click());
		const confirm = [...container.querySelectorAll("button")].find((b) =>
			b.textContent?.includes("Publish to Zenodo"),
		)!;
		expect(confirm.disabled).toBe(false);
		await act(async () => confirm.click());
		expect(onActivate).toHaveBeenCalledWith("mint-zenodo");
	});

	it("opens itself and turns red only when something activated has failed", async () => {
		await render(
			identifiers({
				doi: { value: "10.5555/library.000042", origin: "crossref", url: "https://doi.org/10.5555/library.000042" },
				registration: {
					state: "active",
					provider: "crossref",
					displayState: "failed",
					status: { label: "Needs attention", description: "Crossref publishing failed. Review the error and try again.", shouldPoll: false },
					links: [],
				},
				attention: true,
				actions: [],
			}),
		);
		expect(toggle().getAttribute("aria-expanded")).toBe("true");
		const alert = container.querySelector("[role=alert]");
		expect(alert?.textContent).toContain("Needs attention");
	});
});
