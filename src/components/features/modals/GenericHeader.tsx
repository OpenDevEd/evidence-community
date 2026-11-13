import { ModalHeader } from "@nextui-org/react";
import { Button } from "@/components/nextui/Button";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { SectionTitle } from "@/components/typography/SectionTitle";
import { twMerge } from "@/lib/tw-merge";
import { useTranslations } from "next-intl";

export default function GenericHeader({
	onClose,
	children,
	startContent,
	actions,
	classNames,
}: {
	onClose?: () => void;
	children?: React.ReactNode;
	startContent?: React.ReactNode;
	actions?: React.ReactNode;
	classNames?: {
		base?: string;
		title?: string;
		titleSpan?: string;
		button?: string;
		buttonIcon?: string;
	};
}) {
	const t = useTranslations("ui");

	return (
		<ModalHeader
			className={twMerge(
				"@container/modal-header flex items-center justify-between gap-3",
				classNames?.base,
			)}
		>
			<SectionTitle
				startContent={startContent}
				className={twMerge(
					"flex min-w-0 flex-1 items-center gap-2",
					classNames?.title,
				)}
			>
				<span className={twMerge("modal-header-title truncate", classNames?.titleSpan)}>
					{children}
				</span>
			</SectionTitle>
			<div className="flex shrink-0 items-center gap-2">
				{actions}
				{onClose && (
					<Button
						onPress={onClose}
						isIconOnly
						variant="transparent"
						className={twMerge("px-0 lg:px-0", classNames?.button)}
						aria-label={t("closePopupAriaLabel")}
						startContent={
							<HugeiconsIcon
								icon={Cancel01Icon}
								className={twMerge(
									"size-6",
									classNames?.buttonIcon,
								)}
							/>
						}
					/>
				)}
			</div>
		</ModalHeader>
	);
}
