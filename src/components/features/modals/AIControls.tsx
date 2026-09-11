import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { ArrowDown01Icon, BookOpen01Icon, CodeIcon, Copy01Icon, Csv01Icon, TextIcon } from "@hugeicons/core-free-icons";
import { Dropdown } from "@/components/nextui/Dropdown";
import { Button } from "@/components/nextui/Button";
import { DropdownTrigger, DropdownMenu, DropdownItem } from "@nextui-org/react";
import { ReactNode } from "react";
import { CHAT_EXPORT_OUTPUT, evidenceContent } from "@/lib/ai/transcript-export";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { useTranslations } from "next-intl";
import { twMerge } from "tailwind-merge";
import { useClipboardFeedback } from "@/hooks/useClipboardFeedback";
import { toast } from "@/components/layout/Toast";
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
	const { copy } = useClipboardFeedback();
	const t = useTranslations("ui");
	const handleAction = async (action: ControlAction) => {
		let generated: GeneratedContent;
		try {
			generated = await getContent(action);
		} catch (error) {
			console.error("Generated-content export failed", error);
			toast({ type: "error", title: t("exportFailed"), description: t("tryAgainLater") });
			return;
		}

		if (type === "copy") {
			if (!await copy(generated.content)) return;
			toast({ type: "success", title: t("copied") });
		} else {
			try {
				const blob = new Blob([generated.content], { type: generated.mimeType });
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.href = url;
				const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
				a.download = `${downloadName ?? buttonLabel}_${timestamp}.${generated.extension}`;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				URL.revokeObjectURL(url);
			} catch (error) {
				console.error("Generated-content download failed", error);
				toast({ type: "error", title: t("downloadFailed"), description: t("tryAgainLater") });
				return;
			}
		}

		trackContentAction({ action: type, context: "generated_content", format: action });
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
	isDisabled,
	appearance = "default",
}: {
	content: string;
	isDisabled?: boolean;
	appearance?: "default" | "header";
}) {
	const { identity } = useLibraryConfig();
	const getContent = async (action: ControlAction): Promise<GeneratedContent> => {
		if (action === "csv") throw new Error("Unstructured answers cannot be exported as CSV");
		return {
			content: await evidenceContent(action, content, identity.baseUrl),
			...CHAT_EXPORT_OUTPUT[action],
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
