import { useTranslations } from "next-intl";

import { ConfirmationModal } from "@/components/nextui/ConfirmationModal";
import type { ScreeningSelection } from "@/lib/ai/screening-selection";

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
		/>
	);
}
