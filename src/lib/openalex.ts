export type OpenAlexLocation = {
	is_oa?: boolean;
	pdf_url?: string | null;
};

export type OpenAlexWork = {
	best_oa_location?: OpenAlexLocation | null;
	primary_location?: OpenAlexLocation | null;
	locations?: OpenAlexLocation[];
};

export function getOpenAlexPdfUrl(work: OpenAlexWork) {
	const locations = [
		work.best_oa_location,
		work.primary_location,
		...(work.locations ?? []),
	].filter((location): location is OpenAlexLocation => Boolean(location));

	return (
		locations.find((location) => location.is_oa && location.pdf_url)?.pdf_url ??
		undefined
	);
}
