import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { ArrowDown01Icon, BookOpen01Icon, CodeIcon, Copy01Icon, Csv01Icon, TextIcon } from "@hugeicons/core-free-icons";
import { Dropdown } from "@/components/nextui/Dropdown";
import { Button } from "@/components/nextui/Button";
import { DropdownTrigger, DropdownMenu, DropdownItem } from "@nextui-org/react";
import { ReactNode } from "react";
import { parsePageCitation } from "@/lib/ai/citations";
import { useTranslations } from "next-intl";
import { twMerge } from "tailwind-merge";
import { trackContentAction } from "@/lib/analytics";

export type ControlAction = "markdown" | "html" | "plaintext" | "csv";
type ControlType = "copy" | "download";

export type GeneratedContent = {
	content: string;
	extension: string;
	mimeType: string;
};

interface Control {
	label: string;
	icon: ReactNode;
	action: ControlAction;
}

interface AIControlsProps {
	controls: Control[];
	type: ControlType;
	buttonLabel: string;
	buttonIcon: ReactNode;
	getContent: (
		action: ControlAction,
	) => GeneratedContent | Promise<GeneratedContent>;
	downloadName?: string;
	isDisabled?: boolean;
	appearance?: "default" | "header" | "inline";
}

function AIControls({
	controls,
	type,
	buttonLabel,
	buttonIcon,
	getContent,
	downloadName,
	isDisabled,
	appearance = "default",
}: AIControlsProps) {
	const handleAction = async (action: ControlAction) => {
		const generated = await getContent(action);

		if (type === "copy") {
			await navigator.clipboard.writeText(generated.content);
		} else {
			const blob = new Blob([generated.content], {
				type: generated.mimeType,
			});
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
			a.download = `${downloadName ?? buttonLabel}_${timestamp}.${generated.extension}`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		}

		trackContentAction({
			action: type,
			context: "generated_content",
			format: action,
		});
	};

	return (
		<Dropdown>
			<DropdownTrigger>
				<Button
					size="sm"
					variant={
						appearance === "default" ? "default" : "transparent"
					}
					startContent={buttonIcon}
					endContent={
						<HugeiconsIcon icon={ArrowDown01Icon}
							className={
								appearance === "inline" ? "size-3.5 opacity-70" : undefined
							}
						/>
					}
					isDisabled={isDisabled}
					aria-label={buttonLabel}
					className={twMerge(
						appearance === "header" &&
							"h-8 min-w-0 gap-1.5 rounded-2xl px-2.5 text-sm text-black/65 hover:bg-black/5 dark:text-white/65 dark:hover:bg-white/10 data-[disabled=true]:bg-transparent",
						appearance === "inline" &&
							"!h-7 !min-w-0 gap-1 rounded-lg border-0 bg-transparent px-2 text-xs text-black/45 shadow-none hover:bg-black/[0.05] hover:text-black/70 dark:text-white/45 dark:hover:bg-white/[0.07] dark:hover:text-white/75 data-[disabled=true]:bg-transparent",
					)}
				>
					<span
						className={
							appearance === "inline" ? undefined : "hidden lg:block"
						}
					>
						{buttonLabel}
					</span>
				</Button>
			</DropdownTrigger>
			<DropdownMenu>
				{controls.map((control) => (
					<DropdownItem
						key={control.action}
						startContent={control.icon}
						onPress={() => handleAction(control.action)}
					>
						{control.label}
					</DropdownItem>
				))}
			</DropdownMenu>
		</Dropdown>
	);
}

export function AIGeneratedContentControls({
	getContent,
	downloadName,
	isDisabled,
	appearance = "default",
	includeCsv = false,
}: {
	getContent: (
		action: ControlAction,
	) => GeneratedContent | Promise<GeneratedContent>;
	downloadName?: string;
	isDisabled?: boolean;
	appearance?: "default" | "header" | "inline";
	includeCsv?: boolean;
}) {
	const t = useTranslations("ai");
	const copyControls: Control[] = [
		{
			label: t("copyAsPlainText"),
			icon: <HugeiconsIcon icon={TextIcon} />,
			action: "plaintext",
		},
		{
			label: t("copyAsMarkdown"),
			icon: <HugeiconsIcon icon={TextIcon} />,
			action: "markdown",
		},
		{ label: t("copyAsHTML"), icon: <HugeiconsIcon icon={CodeIcon} />, action: "html" },
	];
	const exportControls: Control[] = [
		{
			label: t("exportAsPlainText"),
			icon: <HugeiconsIcon icon={TextIcon} />,
			action: "plaintext",
		},
		{
			label: t("exportAsMarkdown"),
			icon: <HugeiconsIcon icon={TextIcon} />,
			action: "markdown",
		},
		{ label: t("exportAsHTML"), icon: <HugeiconsIcon icon={CodeIcon} />, action: "html" },
	];

	if (includeCsv) {
		copyControls.push({
			label: t("copyAsCSV"),
			icon: <HugeiconsIcon icon={Csv01Icon} />,
			action: "csv",
		});
		exportControls.push({
			label: t("exportAsCSV"),
			icon: <HugeiconsIcon icon={Csv01Icon} />,
			action: "csv",
		});
	}

	return (
		<>
			<AIControls
				controls={copyControls}
				getContent={getContent}
				type="copy"
				buttonLabel={t("copy")}
				buttonIcon={<HugeiconsIcon icon={Copy01Icon} />}
				isDisabled={isDisabled}
				appearance={appearance}
			/>
			<AIControls
				controls={exportControls}
				getContent={getContent}
				type="download"
				buttonLabel={t("export")}
				buttonIcon={<HugeiconsIcon icon={BookOpen01Icon} />}
				downloadName={downloadName}
				isDisabled={isDisabled}
				appearance={appearance}
			/>
		</>
	);
}

export function AIContentControls({
	content,
	contentRef,
	isDisabled,
	appearance = "default",
}: {
	content: string;
	contentRef: React.RefObject<HTMLDivElement | null>;
	isDisabled?: boolean;
	appearance?: "default" | "header";
}) {
	const getContent = (action: ControlAction): GeneratedContent => {
		if (action === "markdown") {
			let transformed = content.replace(
				/\[QUOTE\s*(.*?)\s*QUOTE\/\][\s.,]*/g,
				"\n> $1\n",
			);
			transformed = transformed.replace(
				/\[PAGE\s*(.*?)\s*PAGE\/\]/g,
				(_match, citation: string) => {
					const parsed = parsePageCitation(citation);
					return parsed.href
						? `[Source, p. ${parsed.page}](${parsed.href})`
						: `(Source unavailable, p. ${parsed.page})`;
				},
			);
			transformed = transformed.replace(
				/\[RESOURCE\s+(\/lib\/([^/?#\s]+))\s+RESOURCE\/\]/g,
				(_match, href: string, itemKey: string) =>
					`[Publication ${itemKey}](${href})`,
			);
			transformed = transformed.replace(
				/\[SECTION\s*(.*?)\s*SECTION\/\]/g,
				"(s.$1)",
			);
			return {
				content: transformed,
				extension: "md",
				mimeType: "text/markdown;charset=utf-8",
			};
		}

		if (action === "html") {
			const html = contentRef.current?.innerHTML || "";
			return {
				content: html
					.replace(/^<div[^>]*>([\s\S]*)<\/div>$/, "$1")
					.replace(/<([a-zA-Z0-9]+)[^>]*>/g, "<$1>"),
				extension: "html",
				mimeType: "text/html;charset=utf-8",
			};
		}

		return {
			content:
				action === "plaintext"
					? contentRef.current?.textContent || ""
					: content,
			extension: "txt",
			mimeType: "text/plain;charset=utf-8",
		};
	};

	return (
		<AIGeneratedContentControls
			getContent={getContent}
			isDisabled={isDisabled}
			appearance={appearance}
		/>
	);
}

export function AIStructuredContentControls({
	formats,
	downloadName,
	isDisabled,
	appearance = "default",
}: {
	formats: Record<ControlAction, GeneratedContent>;
	downloadName: string;
	isDisabled?: boolean;
	appearance?: "default" | "header";
}) {
	const getContent = (action: ControlAction) => formats[action];

	return (
		<AIGeneratedContentControls
			getContent={getContent}
			downloadName={downloadName}
			isDisabled={isDisabled}
			appearance={appearance}
			includeCsv
		/>
	);
}
