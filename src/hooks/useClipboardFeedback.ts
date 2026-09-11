"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@/components/layout/Toast";

/** Show success only after the browser accepts the clipboard write. */
export function useClipboardFeedback() {
	const t = useTranslations("ui");
	const [copied, setCopied] = useState(false);
	const attempt = useRef(0);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => () => {
		attempt.current += 1;
		clearTimeout(timer.current);
	}, []);

	async function copy(text: string) {
		const currentAttempt = ++attempt.current;
		clearTimeout(timer.current);
		setCopied(false);
		try {
			await navigator.clipboard.writeText(text);
			if (currentAttempt !== attempt.current) return false;
			setCopied(true);
			timer.current = setTimeout(() => setCopied(false), 2000);
			return true;
		} catch (error) {
			if (currentAttempt !== attempt.current) return false;
			console.error("Clipboard copy failed", error);
			toast({ type: "error", title: t("copyFailed"), description: t("copyFailedHelp") });
			return false;
		}
	}

	return { copy, copied };
}
