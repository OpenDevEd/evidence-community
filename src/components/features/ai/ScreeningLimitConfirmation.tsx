import { useTranslations } from "next-intl";

import { ConfirmationModal } from "@/components/nextui/ConfirmationModal";
import type { ScreeningSelection } from "@/lib/ai/screening-selection";
import { OpenInOpenScholar, useSmartScreeningFields } from "@/components/features/openscholar/OpenInOpenScholar";
import { recordsOf } from "@/lib/openscholar/handoff";

export function ScreeningLimitConfirmation({
	selection,
	onCancel,
	onConfirm,
}: {
	selection?: ScreeningSelection;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	const t = useTranslations("ui");
	const fields = useSmartScreeningFields();
	// Every record the conversation links, which OpenScholar screens past this limit.
	const handed = selection ? recordsOf(selection.allKeys) : [];

	return (
		<ConfirmationModal
			isOpen={selection !== undefined}
			onOpenChange={(open) => {
				if (!open) onCancel();
			}}
			title={t("screeningLimitTitle", {
				count: selection?.keys.length ?? 0,
			})}
			description={t("screeningLimitDescription", {
				total: selection?.total ?? 0,
				count: selection?.keys.length ?? 0,
				omitted: selection?.omitted ?? 0,
			})}
			confirmLabel={t("screeningLimitConfirm", {
				count: selection?.keys.length ?? 0,
			})}
			cancelLabel={t("cancel")}
			onConfirm={onConfirm}
			extra={
				handed.length ? (
					<OpenInOpenScholar
						label={t("screenAllInOpenScholar", { total: handed.length })}
						handoff={() => ({ from: "smartScreening", source: { records: handed }, fields })}
					/>
				) : null
			}
		/>
	);
}
