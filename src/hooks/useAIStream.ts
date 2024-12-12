import { useLocale } from "next-intl";
import { useState, useCallback, useRef } from "react";

export default function useAIStream(endpoint: string) {
    const [response, setResponse] = useState<string>("");
    const fetched = useRef(false);
	const locale = useLocale();

	const stream = useCallback(async (data: any) => {
		if (fetched.current) return;
		fetched.current = true;

		const res = await fetch(endpoint, {
			method: "POST",
			body: JSON.stringify(data),
			headers: {
				"Content-Type": "application/json",
				"Accept-Language": locale,
			},
		});

		const reader = res.body?.getReader();
		const decoder = new TextDecoder();

		if (!reader) {
			fetched.current = false;
			return;
		}

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const text = decoder.decode(value, { stream: true });
			setResponse((prev) => prev + text);
		}
	}, [endpoint, locale]);

	return { response, stream };
}
