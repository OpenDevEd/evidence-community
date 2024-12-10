
export const currentYear = new Date().getFullYear();

export const years = Array.from({ length: currentYear - 1900 }).map((_, i) =>
	String(currentYear - i)
);