import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { ModalHeader } from "@nextui-org/react";
import { Button } from "@/components/nextui/Button";
import { SectionTitle } from "@/components/typography/SectionTitle";
import { twMerge } from "tailwind-merge";
import { useTranslations } from "next-intl";

export default function GenericHeader({ onClose, children, startContent, classNames }: { onClose?: () => void, children?: React.ReactNode, startContent?: React.ReactNode, classNames?: { base?: string, title?: string, titleSpan?: string, button?: string, buttonIcon?: string } }) {
	const t = useTranslations("ui");

	return (
		<ModalHeader className={twMerge("flex items-center justify-between gap-2", classNames?.base)}>
			<SectionTitle
				startContent={startContent}
				className={twMerge("flex items-center gap-2", classNames?.title)}
			>
				<span className={twMerge(classNames?.titleSpan)}>
					{children}
				</span>
			</SectionTitle>
			{onClose && (
				<Button
					aria-hidden="true"
					onPress={onClose}
					isIconOnly
					variant="transparent"
					className={twMerge("lg:px-0 px-0 translate-x-2 rtl:-translate-x-2", classNames?.button)}
					aria-label={t("closePopupAriaLabel")}
				startContent={
					<HugeiconsIcon icon={Cancel01Icon} className={twMerge("size-6", classNames?.buttonIcon)} />
				}
			/>
			)}
		</ModalHeader>
	)
}
