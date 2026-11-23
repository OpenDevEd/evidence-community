"use client";

import { useTranslations } from "next-intl";
import { FlowchartIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { Link } from "@/i18n/routing";
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

/** The check on the record, beside its study type. On a record in a chain it opens that chain on the evidence map. */
export function EvidenceVerdict({ item }: { item: { key?: string } | undefined }) {
	const t = useTranslations("evidenceMap");
	const itemKey = item?.key;
	const record = useEvidenceRecord(itemKey);
	if (!record?.verdict) return null;
	if (!record.chain) return <VerdictChip verdict={record.verdict} />;
	const label = t("openItsChain", { verdict: t(VERDICT[VERDICTS[record.verdict] as keyof typeof VERDICT].label) });
	return (
		<Link href={`/evidence?paper=${itemKey}`} rel="nofollow" aria-label={label} className={CHIP_CONTROL}>
			<VerdictChip verdict={record.verdict} className={CHIP_HOVER} />
		</Link>
	);
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
	const t = useTranslations("evidenceMap");
	if (!useOnMap(item)) return null;
	return (
		<Button
			as={Link}
			href={`/evidence?paper=${item!.key}`}
			rel="nofollow"
			size="sm"
			aria-label={t("visualize")}
			startContent={<HugeiconsIcon icon={FlowchartIcon} className="size-4" />}
			className={compact ? "px-0 min-w-0 aspect-square @[720px]:aspect-auto @[720px]:px-3" : undefined}
		>
			<span className={compact ? "hidden @[720px]:inline" : undefined}>{t("visualize")}</span>
		</Button>
	);
}
