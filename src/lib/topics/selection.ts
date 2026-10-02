export type TopicSelectionNode = {
	id: string;
	parent: string | null;
};

function nodeMap(nodes: readonly TopicSelectionNode[]) {
	return new Map(nodes.map((node) => [node.id, node]));
}

/** The IDs from the root down to `id`, as far as `nodes` knows them. */
export function topicAncestry(
	id: string,
	nodes: ReadonlyMap<string, TopicSelectionNode>,
) {
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

/** The deepest selected nodes on each branch. These are OR-ed by search. */
export function selectionFrontier(
	selected: readonly string[],
	nodes: readonly TopicSelectionNode[],
) {
	const byId = nodeMap(nodes);
	const known = [...new Set(selected)].filter((id) => byId.has(id));
	const ancestorIds = new Set(
		known.flatMap((id) => topicAncestry(id, byId).slice(0, -1)),
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
			(entry) => entry !== id && !topicAncestry(entry, byId).includes(id),
		);
	}

	return [...new Set([...selected, ...topicAncestry(id, byId)])];
}

/**
 * A domain stays chosen only while something under it is: the topic tree shows a domain as its section's heading, not
 * as a box, so a domain left behind on its own would filter the results with no way to see or clear it. Topics the tree
 * doesn't know are kept.
 */
export function withoutBareRoots(
	selected: readonly string[],
	nodes: readonly TopicSelectionNode[],
) {
	const parents = new Map(nodes.map((node) => [node.id, node.parent]));
	const rootOf = (id: string): string => {
		const parent = parents.get(id);
		return parent ? rootOf(parent) : id;
	};
	const isRoot = (id: string) => parents.get(id) === null;
	const kept = new Set(selected.filter((id) => !isRoot(id)).map(rootOf));
	return selected.filter((id) => !isRoot(id) || kept.has(id));
}
