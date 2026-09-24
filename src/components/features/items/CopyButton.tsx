import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Copy01Icon, Tick01Icon } from "@hugeicons/core-free-icons";
import { useClipboardFeedback } from "@/hooks/useClipboardFeedback";
import { useLibraryItemUrl } from "@/hooks/useLibraryItemUrl";
import { Item, ListItem } from "@/app/api/item/types";
import { forwardRef } from "react";
import { Button } from "@/components/nextui/Button";
import { useTranslations } from "next-intl";
import { twMerge } from "@/lib/tw-merge";
const CopyButton = forwardRef<
	any,
	{
		itemData?: Item | ListItem | undefined;
		content?: string;
		text?: string;
		textOnCopy?: string;
		className?: string;
		classNames?: {
			button?: string;
			icon?: string;
			text?: string;
		};
		shrinkOnMobile?: boolean;
		isIconOnly?: boolean;
		contentRef?: React.RefObject<any>;
	}
>(({ itemData, content, text, textOnCopy, className, shrinkOnMobile = false, isIconOnly = false, contentRef, classNames }, ref) => {
	const { copy, copied: isCopied } = useClipboardFeedback();
	const t = useTranslations("ui");
	const itemUrl = useLibraryItemUrl();

	const handleCopy = () => {
		const textToCopy = content ?? contentRef?.current?.textContent;
		if (typeof textToCopy === "string") return copy(textToCopy.trim());
		if (itemData) return copy(itemUrl(itemData.key));
	};

	return (
		<Button
			ref={ref}
			color={"secondary"}
			startContent={isCopied ? <HugeiconsIcon icon={Tick01Icon} className={twMerge("text-success", classNames?.icon)} /> : <HugeiconsIcon icon={Copy01Icon} className={twMerge(classNames?.icon)} />}
			size="sm"
			onPress={handleCopy}
			className={twMerge(shrinkOnMobile && "px-0 min-w-0 aspect-square lg:aspect-auto lg:px-3", classNames?.button, className)}
			isIconOnly={isIconOnly}
			aria-label={`${isCopied ? textOnCopy || t("copied") : text || t("copy")}`}
		>
			{!isIconOnly && <span className={twMerge(shrinkOnMobile && "hidden lg:block", classNames?.text)}>
				{isCopied ? textOnCopy || t("copied") : text || t("copy")}
			</span>}
		</Button>
	);
});

CopyButton.displayName = "CopyButton";

export default CopyButton;
