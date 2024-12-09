
export const currentYear = new Date().getFullYear();

export const years = Array.from({ length: 300 }).map((_, i) =>
	String(currentYear - i)
);