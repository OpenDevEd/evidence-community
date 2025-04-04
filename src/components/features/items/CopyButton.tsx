import { useDebounce } from "@/hooks/useDebounce";
import { useLocale } from "next-intl";
import { Item } from "@/app/api/item/types";
import { useState, forwardRef } from "react";
import { Button } from "@/components/nextui/Button";
import { FaClipboard, FaClipboardCheck } from "react-icons/fa";
import { useTranslations } from "next-intl";
import { twMerge } from "tailwind-merge";
import { routing } from "@/i18n/routing";
import { FiCheck, FiCopy } from "react-icons/fi";

const CopyButton = forwardRef<
	any,
	{
		itemData?: Item | undefined;
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
	const [isCopied, setIsCopied] = useState(false);
	const [clearCopied] = useDebounce(() => setIsCopied(false), 2000);
	const locale = useLocale();
	const t = useTranslations("ui");

	const handleCopy = () => {
		if (content || contentRef) {
			const contentToCopy = content || contentRef?.current?.textContent;
			navigator.clipboard.writeText(contentToCopy.trim());
		} else {
			const currentUrl = window.location.href;
			const url = new URL(currentUrl);
			if (locale !== routing.defaultLocale) {
				url.pathname = `/${locale}/lib/${itemData?.key}`;
			} else {
				url.pathname = `/lib/${itemData?.key}`;
			}
			url.search = "";
			navigator.clipboard.writeText(url.toString());
		}
		setIsCopied(true);
		clearCopied();
	};

	return (
		<Button
			ref={ref}
			color={"secondary"}
			startContent={isCopied ? <FiCheck className={twMerge("text-success", classNames?.icon)} /> : <FiCopy className={twMerge(classNames?.icon)} />}
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
