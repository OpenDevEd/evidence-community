import { toast } from "@/components/layout/Toast";
import { clientAIError, uiMessageText } from "@/lib/ai/client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useLocale, useTranslations } from "next-intl";
import { getAnalyticsDistinctId } from "@/lib/analytics";
import { useState } from "react";

export default function useAIStream(
	endpoint: string,
	onFinish: (completion: string, id: string) => void,
	id: string,
	feature: "summarize" | "explain",
) {
	const locale = useLocale();
	const t = useTranslations("ai");
	const [requestError, setRequestError] = useState<Error>();
	const [hasRequested, setHasRequested] = useState(false);
	const {
		messages,
		sendMessage,
		status,
		error: streamError,
		setMessages,
		clearError,
	} = useChat({
		id,
		throttle: 50,
		transport: new DefaultChatTransport({
			api: endpoint,
			headers: {
				"Accept-Language": locale,
			},
			prepareSendMessagesRequest: ({ body }) => ({ body: body ?? {} }),
		}),
		onError: (error) => {
			const visibleError = clientAIError(error);
			setRequestError(visibleError);

			if (
				visibleError.message.includes("RATE_LIMITED") ||
				visibleError.message.includes("Rate limit exceeded")
			) {
				toast({
					title: t("rateLimitedMessage", { seconds: 60 }),
					type: "error",
				});
				return;
			}

			toast({
				title: visibleError.message || t("errorMessage"),
				type: "error",
			});
		},
		onFinish: ({ message, isError }) => {
			if (isError) {
				setRequestError(
					(current) =>
						current ??
						new Error(
							"The AI stream ended before returning an answer.",
						),
				);
				return;
			}
			const finalCompletion = uiMessageText(message);
			if (!finalCompletion.trim()) {
				setRequestError(
					new Error("The AI provider returned an empty response."),
				);
				return;
			}
			onFinish(finalCompletion, id);
		},
	});

	const completion = uiMessageText(
		messages.findLast((message) => message.role === "assistant"),
	);
	const isLoading = status === "submitted" || status === "streaming";
	const error =
		requestError ?? (streamError ? clientAIError(streamError) : undefined);

	const stream = (
		prompt: string,
		options: { body?: Record<string, unknown> },
	) => {
		if (isLoading || completion) return;
		setHasRequested(true);
		setRequestError(undefined);
		clearError();
		void sendMessage(
			{ text: prompt },
			{
				body: {
					prompt,
					feature,
					distinctId: getAnalyticsDistinctId() ?? undefined,
					...options.body,
				},
			},
		);
	};

	const setCompletion = (value: string) => {
		setHasRequested(Boolean(value));
		setRequestError(undefined);
		clearError();
		setMessages(
			value
				? [
						{
							id: crypto.randomUUID(),
							role: "assistant",
							parts: [{ type: "text", text: value }],
						},
					]
				: [],
		);
	};

	return {
		response: completion,
		stream,
		isLoading,
		hasRequested,
		error,
		setCompletion,
	};
}
