"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@/components/layout/Toast";

/** Show success only after the browser accepts the clipboard write. */
export function useClipboardFeedback() {
	const t = useTranslations("ui");
	const [copied, setCopied] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);

	async function copy(text: string) {
		clearTimeout(timer.current);
		setCopied(false);
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			timer.current = setTimeout(() => setCopied(false), 2000);
			return true;
		} catch (error) {
			console.error("Clipboard copy failed", error);
			toast({ type: "error", title: t("copyFailed"), description: t("copyFailedHelp") });
			return false;
		}
	}

	return { copy, copied };
}
