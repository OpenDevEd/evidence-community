"use client";
import { useId, type ReactNode } from "react";
import { Button } from "@/components/nextui/Button";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Upload01Icon } from "@hugeicons/core-free-icons";

export function PdfFileInput({
	attachmentKey,
	disabled,
	label = "Upload PDF",
	onUpload,
	children,
}: {
	attachmentKey: string;
	disabled?: boolean;
	label?: string;
	onUpload: (attachmentKey: string, file: File) => void;
	children?: (open: () => void) => ReactNode;
}) {
	const inputId = useId();
	const open = () => document.getElementById(inputId)?.click();
	return (
		<>
			<input
				id={inputId}
				accept="application/pdf,.pdf"
				hidden
				tabIndex={-1}
				disabled={disabled}
				type="file"
				onChange={(event) => {
					const file = event.currentTarget.files?.[0];
					if (file) onUpload(attachmentKey, file);
					event.currentTarget.value = "";
				}}
			/>
			{children ? (
				children(open)
			) : (
				<Button
					isDisabled={disabled}
					onPress={open}
					size="xs"
					variant="muted"
					startContent={
						<HugeiconsIcon
							icon={Upload01Icon}
							aria-hidden
							size={15}
						/>
					}
				>
					{label}
				</Button>
			)}
		</>
	);
}
