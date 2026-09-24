export type TopicSelectionNode = {
	id: string;
	parent: string | null;
};

function nodeMap(nodes: readonly TopicSelectionNode[]) {
	return new Map(nodes.map((node) => [node.id, node]));
}

function ancestry(id: string, nodes: ReadonlyMap<string, TopicSelectionNode>) {
	const path: string[] = [];
	const visited = new Set<string>();
	let current = nodes.get(id);
	while (current && !visited.has(current.id)) {
		visited.add(current.id);
		path.unshift(current.id);
		current = current.parent ? nodes.get(current.parent) : undefined;
	}
	return path;
}

/** All selected nodes and their known ancestors, once each. */
export function expandTopicAncestry(
	ids: readonly string[],
	nodes: readonly TopicSelectionNode[],
) {
	const byId = nodeMap(nodes);
	return [...new Set(ids.flatMap((id) => ancestry(id, byId)))];
}

/** The deepest selected nodes on each branch. These are OR-ed by search. */
export function selectionFrontier(
	selected: readonly string[],
	nodes: readonly TopicSelectionNode[],
) {
	const byId = nodeMap(nodes);
	const known = [...new Set(selected)].filter((id) => byId.has(id));
	const ancestorIds = new Set(
		known.flatMap((id) => ancestry(id, byId).slice(0, -1)),
	);
	return known.filter((id) => !ancestorIds.has(id));
}

/** Expands a new selection to its path, or removes a selected branch. */
export function toggleTopicSelection(
	selected: readonly string[],
	id: string,
	nodes: readonly TopicSelectionNode[],
) {
	const byId = nodeMap(nodes);
	if (!byId.has(id)) return [...selected];

	if (selected.includes(id)) {
		return selected.filter(
			(entry) => entry !== id && !ancestry(entry, byId).includes(id),
		);
	}

	return [...new Set([...selected, ...ancestry(id, byId)])];
}
