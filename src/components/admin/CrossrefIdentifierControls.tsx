"use client";
import { InspectorChoices } from "./InspectorChoices";
import { Button } from "@/components/nextui/Button";
import { CrossrefIcon } from "@/components/icons/CrossrefIcon";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Link01Icon, Tick01Icon, Add01Icon, Clock01Icon } from "@hugeicons/core-free-icons";
import type { getAdminCrossrefReservation } from "./admin-api";
import type { PublishingChoiceState } from "@/lib/admin/review-contract";
import { zenodoPolicyChangeReason } from "@/lib/publication/identifier-policy";

type Props = {
	reservation:
		Awaited<ReturnType<typeof getAdminCrossrefReservation>> | undefined;
	policy: "reuse-crossref" | "mint-zenodo" | undefined;
	lockedPolicy: PublishingChoiceState["lockedIdentifierPolicy"] | undefined;
	readOnly: boolean;
	saving: boolean;
	onReserve: () => void;
	setPolicy: (policy: "reuse-crossref" | "mint-zenodo") => void;
};

/** A reserved DOI waits for publishing; Crossref has confirmed an active one. */
const DOI_STATES = {
	reserved: {
		label: "Reserved",
		icon: Clock01Icon,
		tone: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
	},
	verified: {
		label: "Active",
		icon: Tick01Icon,
		tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
	},
} as const;

export function CrossrefIdentifierControls({
	reservation,
	policy,
	lockedPolicy,
	readOnly,
	saving,
	onReserve,
	setPolicy,
}: Props) {
	const reservedDoi = reservation?.doi;
	const reserved = Boolean(reservedDoi);
	const state = reservation && DOI_STATES[reservation.lifecycle];
	return (
		<>
			<div className="flex items-center gap-3 p-3">
				<span className="grid size-8 shrink-0 place-items-center self-start rounded-lg bg-card_light text-black/50 dark:bg-white/5 dark:text-white/55">
					<CrossrefIcon className="h-5 w-3.5" />
				</span>
				<div className="min-w-0 flex-1">
					<p className="text-xs font-medium">Crossref DOI</p>
					<p
						className={`mt-1 text-[10px] leading-relaxed text-black/45 dark:text-white/45 ${reserved ? "break-all font-mono" : ""}`}
					>
						{reserved ? reservedDoi : "Registered after approval."}
					</p>
				</div>
				{state ? (
					<span className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium ${state.tone}`}>
						<HugeiconsIcon icon={state.icon} size={12} />
						{state.label}
					</span>
				) : (
					<Button
						size="xs"
						variant="flat"
						color="accent"
						isDisabled={readOnly || saving}
						onPress={onReserve}
						className="h-8 min-w-0 shrink-0 rounded-lg px-2.5 text-[11px] font-semibold"
						startContent={
							<HugeiconsIcon icon={Add01Icon} size={13} />
						}
					>
						Reserve DOI
					</Button>
				)}
			</div>
			<div className="px-3 pb-3">
				<p className="mb-2 text-[11px] font-medium text-black/70 dark:text-white/70">
					Zenodo identifier
				</p>
				<InspectorChoices
					variant="inset"
					label="Zenodo identifier"
					value={policy}
					onChange={setPolicy}
					disabled={readOnly || saving}
					options={[
						{
							key: "reuse-crossref",
							disabledReason: zenodoPolicyChangeReason(lockedPolicy, "reuse-crossref"),
							label: "Use Crossref DOI",
							content: (
								<>
									<HugeiconsIcon
										icon={Link01Icon}
										size={13}
									/>
									Use Crossref DOI
								</>
							),
						},
						{
							key: "mint-zenodo",
							disabledReason: zenodoPolicyChangeReason(lockedPolicy, "mint-zenodo"),
							label: "Separate DOI",
							content: (
								<>
									<HugeiconsIcon icon={Add01Icon} size={13} />
									Separate DOI
								</>
							),
						},
					]}
				/>
			</div>
		</>
	);
}
