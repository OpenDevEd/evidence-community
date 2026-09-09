export function creatorDisplayName(creator: {
	firstName?: string;
	lastName?: string;
	name?: string;
}) {
	return (
		creator.name?.trim() ||
		[creator.firstName, creator.lastName].filter(Boolean).join(" ").trim()
	);
}
