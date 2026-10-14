// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDebounce } from "@/hooks/useDebounce";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
	true;

describe("waiting for typing to stop", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		vi.useFakeTimers();
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => {
			root.unmount();
		});
		container.remove();
		vi.useRealTimers();
	});

	/** Renders the hook and hands its parts back. */
	function mount(onRun: (value: string) => void) {
		let parts: { run: (value: string) => void; cancel: () => void; flush: () => void };

		function Probe({
			onReady,
		}: {
			onReady: (ready: {
				run: (value: string) => void;
				cancel: () => void;
				flush: () => void;
			}) => void;
		}) {
			const [run, , cancel, flush] = useDebounce(onRun, 300);

			useEffect(() => {
				onReady({ run, cancel, flush });
			}, [cancel, flush, onReady, run]);

			return null;
		}

		act(() => {
			root.render(
				<Probe
					onReady={(ready) => {
						parts = ready;
					}}
				/>,
			);
		});

		return parts!;
	}

	it("runs once the calls stop", () => {
		const onRun = vi.fn();
		const { run } = mount(onRun);

		act(() => {
			run("te");
			run("tea");
			run("teacher");
			vi.advanceTimersByTime(300);
		});

		expect(onRun.mock.calls).toEqual([["teacher"]]);
	});

	// Clearing the search field must not let the earlier search through: it
	// would change the page address a second time, moments later.
	it("drops a call that is still waiting when it is cancelled", () => {
		const onRun = vi.fn();
		const { run, cancel } = mount(onRun);

		act(() => {
			run("teacher");
			cancel();
			vi.advanceTimersByTime(1000);
		});

		expect(onRun).not.toHaveBeenCalled();
	});

	// A search the reader acts on before its wait is over, as Open in OpenScholar right after typing, is the one typed.
	it("runs a waiting call at once when flushed, and only once", () => {
		const onRun = vi.fn();
		const { run, flush } = mount(onRun);

		act(() => {
			run("teacher");
			flush();
			flush();
			vi.advanceTimersByTime(1000);
		});

		expect(onRun.mock.calls).toEqual([["teacher"]]);
	});

	it("still works after a cancelled call", () => {
		const onRun = vi.fn();
		const { run, cancel } = mount(onRun);

		act(() => {
			run("teacher");
			cancel();
			run("meals");
			vi.advanceTimersByTime(300);
		});

		expect(onRun.mock.calls).toEqual([["meals"]]);
	});
});
