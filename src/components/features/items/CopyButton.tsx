import { useDebounce } from "@/hooks/useDebounce";
import { useLocale } from "next-intl";
import { Item } from "@/app/api/item/types";
import { useState, forwardRef } from "react";
import { Button } from "@/components/nextui/Button";
import { FaClipboard, FaClipboardCheck } from "react-icons/fa";
import { useTranslations } from "next-intl";
import { twMerge } from "tailwind-merge";

const CopyButton = forwardRef<
	HTMLButtonElement,
	{
		itemData?: Item | undefined;
		content?: string;
		text?: string;
		textOnCopy?: string;
		className?: string;
		shrinkOnMobile?: boolean;
	}
>(({ itemData, content, text, textOnCopy, className, shrinkOnMobile = false }, ref) => {
	const [isCopied, setIsCopied] = useState(false);
	const [clearCopied] = useDebounce(() => setIsCopied(false), 2000);
	const locale = useLocale();
	const t = useTranslations("ui");

	const handleCopy = () => {
		if (content) {
			navigator.clipboard.writeText(content);
		} else {
			const currentUrl = window.location.href;
			const url = new URL(currentUrl);
			url.pathname = `/${locale}/lib/${itemData?.key}`;
			url.search = "";
			navigator.clipboard.writeText(url.toString());
		}
		setIsCopied(true);
		clearCopied();
	};

	return (
		<Button
			ref={ref}
			color={isCopied ? "success" : "secondary"}
			startContent={isCopied ? <FaClipboardCheck /> : <FaClipboard />}
			size="sm"
			onClick={handleCopy}
			className={twMerge(shrinkOnMobile && "px-0 min-w-0 aspect-square", className)}
		>
			<span className={twMerge(shrinkOnMobile && "hidden xl:block")}>
				{isCopied ? textOnCopy || t("copied") : text || t("copy")}
			</span>
		</Button>
	);
});

CopyButton.displayName = "CopyButton";

export default CopyButton;
