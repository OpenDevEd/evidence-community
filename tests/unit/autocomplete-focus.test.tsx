// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AutocompleteItem, useAutocomplete } from "@nextui-org/react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
	true;

it("focuses the selected option and preserves it when its collection changes", async () => {
	let picker!: ReturnType<typeof useAutocomplete>;
	const onSelectionChange = vi.fn();
	let search!: (value: string) => void;
	// The picker's state reaches the test through a callback, so rendering never writes to the test's variables itself.
	const expose = (state: ReturnType<typeof useAutocomplete>, setQuery: (value: string) => void) => {
		picker = state;
		search = setQuery;
	};
	function Picker({ expanded }: { expanded: boolean }) {
		const [query, setQuery] = useState("");
		const state = useAutocomplete({
			label: "Topics",
			selectedKey: null,
			inputValue: query,
			onInputChange: setQuery,
			onSelectionChange: (key) => {
				onSelectionChange(key);
				setQuery("");
			},
			children: query
				? [<AutocompleteItem key="child">Child</AutocompleteItem>]
				: [
						<AutocompleteItem key="first">First parent</AutocompleteItem>,
						<AutocompleteItem key="second">Second parent</AutocompleteItem>,
						...(expanded
							? [<AutocompleteItem key="child">Child</AutocompleteItem>]
							: []),
					],
		});
		expose(state, setQuery);
		return null;
	}
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	try {
		await act(async () => root.render(<Picker expanded={false} />));
		await act(async () => picker.getPopoverProps().state!.open());
		await act(async () =>
			picker.getListBoxProps().state!.selectionManager.replaceSelection("second"),
		);
		expect(onSelectionChange).toHaveBeenCalledWith("second");
		expect(picker.getListBoxProps().state!.selectionManager.focusedKey).toBe(
			"second",
		);

		await act(async () => root.render(<Picker expanded />));
		expect([...picker.getListBoxProps().state!.collection.getKeys()]).toEqual([
			"first",
			"second",
			"child",
		]);
		expect(picker.getListBoxProps().state!.selectionManager.focusedKey).toBe(
			"second",
		);
		await act(async () => search("Child"));
		await act(async () =>
			picker.getListBoxProps().state!.selectionManager.replaceSelection("child"),
		);
		expect(picker.getListBoxProps().state!.selectionManager.focusedKey).toBe(
			"child",
		);
	} finally {
		await act(async () => root.unmount());
		container.remove();
	}
});

it("keeps a focus the reader cleared while the options stay the same", async () => {
	// Moving the text cursor (ArrowLeft or ArrowRight) clears the active option, so Tab keeps what was typed.
	let picker!: ReturnType<typeof useAutocomplete>;
	// The same option elements on every render, as an Autocomplete's children are while only its own state changes.
	const years = [
		<AutocompleteItem key="2025">2025</AutocompleteItem>,
		<AutocompleteItem key="2024">2024</AutocompleteItem>,
	];
	const expose = (state: ReturnType<typeof useAutocomplete>) => {
		picker = state;
	};
	function Picker() {
		const state = useAutocomplete({
			label: "Year",
			allowsCustomValue: true,
			defaultInputValue: "20",
			children: years,
		});
		expose(state);
		return null;
	}
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	try {
		await act(async () => root.render(<Picker />));
		await act(async () => picker.getPopoverProps().state!.open());
		await act(async () => picker.getListBoxProps().state!.selectionManager.setFocusedKey("2024"));
		await act(async () => picker.getListBoxProps().state!.selectionManager.setFocusedKey(null));
		expect(picker.getListBoxProps().state!.selectionManager.focusedKey).toBeNull();
	} finally {
		await act(async () => root.unmount());
		container.remove();
	}
});
