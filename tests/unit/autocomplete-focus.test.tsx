// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AutocompleteItem, useAutocomplete } from "@nextui-org/autocomplete";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
	true;

it("focuses the selected option and preserves it when its collection changes", async () => {
	let picker!: ReturnType<typeof useAutocomplete>;
	const onSelectionChange = vi.fn();
	let search!: (value: string) => void;
	function Picker({ expanded }: { expanded: boolean }) {
		const [query, setQuery] = useState("");
		search = setQuery;
		picker = useAutocomplete({
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
