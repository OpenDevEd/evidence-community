type ZoteroGroupItem = {
	groupExternalId: number | null;
	key: string;
};

export function getZoteroGroupItemLinks(
	item: ZoteroGroupItem | null | undefined
) {
	if (!item?.groupExternalId || item.groupExternalId === 1) {
		return null;
	}

	const groupId = item.groupExternalId;
	const itemKey = encodeURIComponent(item.key);

	return {
		desktop: `zotero://select/groups/${groupId}/items/${itemKey}`,
		web: `https://www.zotero.org/groups/${groupId}/items/${itemKey}`,
	};
}
