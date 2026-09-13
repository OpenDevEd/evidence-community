"use client";

import CopyButton from "@/components/features/newlib/CopyButton";
import { Button } from "@/components/nextui/Button";

export default function PolicyEmailCopyButton({ email }: { email: string }) {
	return (
		<CopyButton textToCopy={email} ariaLabel="Copy email">
			<Button
				isIconOnly
				variant="transparent"
				size="xs"
				title="Copy email"
				className="shrink-0 self-center print:hidden"
			/>
		</CopyButton>
	);
}
