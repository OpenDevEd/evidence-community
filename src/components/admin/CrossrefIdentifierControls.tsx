"use client";
import { InspectorChoices } from "./InspectorChoices";
import { Button } from "@/components/nextui/Button";
import { CrossrefIcon } from "@/components/icons/CrossrefIcon";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Link01Icon, Tick01Icon, Add01Icon } from "@hugeicons/core-free-icons";
import type { getAdminCrossrefReservation } from "./admin-api";

type Props = {
	reservation:
		Awaited<ReturnType<typeof getAdminCrossrefReservation>> | undefined;
	policy: "reuse-crossref" | "mint-zenodo" | undefined;
	readOnly: boolean;
	saving: boolean;
	onReserve: () => void;
	setPolicy: (policy: "reuse-crossref" | "mint-zenodo") => void;
};

export function CrossrefIdentifierControls({
	reservation,
	policy,
	readOnly,
	saving,
	onReserve,
	setPolicy,
}: Props) {
	const reservedDoi = reservation?.doi;
	const reserved = Boolean(reservedDoi);
	return (
		<>
			<div className="flex items-center gap-3 p-3">
				<span className="grid size-8 shrink-0 place-items-center rounded-lg bg-card_light text-black/50 dark:bg-white/5 dark:text-white/55">
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
				{reserved ? (
					<span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
						<HugeiconsIcon icon={Tick01Icon} size={12} />
						{reservation?.lifecycle === "verified"
							? "Registered"
							: "Reserved"}
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
