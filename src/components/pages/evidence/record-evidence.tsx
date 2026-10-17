"use client";

import { FlowchartIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { Link, useRouter } from "@/i18n/routing";
import { libraryHost, VERDICTS } from "./data";
import data from "./records.json";
import { VerdictChip } from "./verdict-chip";
import { VERDICT } from "./verdicts";

/**
 * What the evidence map knows about a library record, built with the map's data: Björn's check, whether it is in a chain the
 * map can draw, and for a meta-analysis he analysed, how its references split into the studies it analysed, how many of those
 * the library holds, and the other works it cites.
 */
export type EvidenceRecord = { verdict: number; chain: boolean; analysed?: number; analysedHere?: number; reviews?: number; other?: number };

const records = data.records as Record<string, EvidenceRecord>;

/**
 * Whether this library has the evidence map. Its data is built for one library (AIED) and every library runs the same image,
 * so the map, its buttons and its checks show only where the library's address matches the data's.
 */
function useEvidenceMap() {
	const { identity } = useLibraryConfig();
	return libraryHost(identity.baseUrl) === data.host;
}

/** What the map knows about a record of this library, or nothing in a library without the map. */
export function useEvidenceRecord(key: string | undefined): EvidenceRecord | null {
	const enabled = useEvidenceMap();
	return enabled && key ? (records[key] ?? null) : null;
}

/** The rating badge as a control: a ring in its ink on hover, and a focus ring of its own. */
const CHIP_CONTROL = "group/chip rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent";
const CHIP_HOVER = "transition-shadow group-hover/chip:ring-[color:var(--ink)] dark:group-hover/chip:ring-[color:var(--ink-dark)]";

/**
 * Björn's check on the record, beside its study type. On a record in a chain it opens that chain on the evidence map. A card
 * is one link already, so there it is a button that opens the chain and keeps the card's link from following.
 */
export function EvidenceVerdict({ item, insideLink = false }: { item: { key?: string } | undefined; insideLink?: boolean }) {
	const itemKey = item?.key;
	const router = useRouter();
	const record = useEvidenceRecord(itemKey);
	if (!record?.verdict) return null;
	if (!record.chain) return <VerdictChip verdict={record.verdict} />;
	const href = `/evidence?paper=${itemKey}`;
	const label = `${VERDICT[VERDICTS[record.verdict] as keyof typeof VERDICT].label}, open its chain`;
	const chip = <VerdictChip verdict={record.verdict} className={CHIP_HOVER} />;
	if (insideLink) {
		return (
			<button type="button" data-evidence-chip aria-label={label} className={CHIP_CONTROL} onClick={(event) => { event.preventDefault(); event.stopPropagation(); router.push(href); }}>
				{chip}
			</button>
		);
	}
	return <Link href={href} data-evidence-chip aria-label={label} className={CHIP_CONTROL}>{chip}</Link>;
}

/**
 * Whether a record is on the evidence map: a paper in one of Björn's chains, or any record with a citation to or from another
 * in the library, which is what gives it a place on the map. A card knows its links, so it can tell on its first frame.
 */
function useOnMap(item: { key?: string; links?: { cites: unknown[]; citedBy: unknown[] } } | undefined) {
	const enabled = useEvidenceMap(), record = useEvidenceRecord(item?.key);
	return enabled && Boolean(item?.key && (record?.chain || item.links?.cites.length || item.links?.citedBy.length));
}

/**
 * Opens the record on the evidence map: a paper in a chain opens its chain in Björn's columns, any other its citations in
 * the library. On a card it is an icon until the card is wide enough for its name, as the card's other actions are.
 */
export function VisualizeButton({ item, compact = false }: { item: Parameters<typeof useOnMap>[0]; compact?: boolean }) {
	if (!useOnMap(item)) return null;
	return (
		<Button
			as={Link}
			href={`/evidence?paper=${item!.key}`}
			size="sm"
			aria-label="Visualize"
			startContent={<HugeiconsIcon icon={FlowchartIcon} className="size-4" />}
			className={compact ? "px-0 min-w-0 aspect-square @[720px]:aspect-auto @[720px]:px-3" : undefined}
		>
			<span className={compact ? "hidden @[720px]:inline" : undefined}>Visualize</span>
		</Button>
	);
}
