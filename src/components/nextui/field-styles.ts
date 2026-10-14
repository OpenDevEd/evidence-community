/** Filled editor fields share the autocomplete's light surface. */
export const filledFieldSurface =
	"bg-default-100 dark:bg-secondary border-transparent shadow-none group-data-[focus]:bg-default-100 dark:group-data-[focus]:bg-secondary group-data-[hover]:bg-default-200 dark:group-data-[hover]:bg-white/[4%] data-[hover]:bg-default-200 dark:data-[hover]:bg-white/[4%] data-[focus]:outline data-[focus]:outline-2 data-[focus]:outline-focus";

export const filledInputSlots = {
	inputWrapper: filledFieldSurface,
	input: "placeholder:text-black/60 dark:placeholder:text-white/40",
};

/** A field in the record editor, such as Item type and Study type: one height and corner for all of them. */
export const inspectorInputClassNames = {
	input: "text-sm",
	inputWrapper: `h-10 min-h-10 rounded-xl ${filledFieldSurface}`,
} as const;
