import { useMemo, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { useFormatter, useTranslations } from "next-intl";
import { useStickToBottom } from "use-stick-to-bottom";

import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import useBreakpoint from "@/hooks/useBreakpoint";
import type { useAIFeature } from "@/hooks/useAIFeature";
import { clientAIError } from "@/lib/ai/client";
import type { AIHistory } from "@/types/ai";
import GenerativeModalView, {
	type GenerativeContentView,
	type GenerativeHistoryView,
} from "./GenerativeModalView";

type GenerativeModalProps = {
	currentKey: string;
	currentModelId: string | null;
	currentTitle: string;
	feature: ReturnType<typeof useAIFeature>;
	history: AIHistory[];
	id: string;
	onClearCurrent: () => void;
	pdfSources?: Record<string, string>;
	setHistory: (history: AIHistory[]) => void;
	title: string;
};

function makeCurrentItem({
	content,
	currentDate,
	currentKey,
	currentModelId,
	currentTitle,
	hasCurrentRequest,
	id,
	persistedItem,
}: {
	content: string;
	currentDate: Date;
	currentKey: string;
	currentModelId: string | null;
	currentTitle: string;
	hasCurrentRequest: boolean;
	id: string;
	persistedItem: AIHistory | undefined;
}): AIHistory | undefined {
	if (!hasCurrentRequest || !currentModelId) return undefined;
	return {
		id,
		content,
		date: persistedItem?.date ?? currentDate,
		title: currentTitle,
		key: currentKey,
		modelId: currentModelId,
	};
}

function withCurrentItem(history: AIHistory[], currentItem?: AIHistory) {
	if (!currentItem) return history;
	return [
		currentItem,
		...history.filter((item) => item.id !== currentItem.id),
	];
}

function selectedHistoryItem(items: AIHistory[], selectedId: string) {
	return items.find((item) => item.id === selectedId) ?? items[0];
}

function nextSelectedHistoryId(items: AIHistory[], selectedItem: AIHistory) {
	const selectedIndex = items.findIndex(
		(item) => item.id === selectedItem.id,
	);
	const remainingItems = items.filter((item) => item.id !== selectedItem.id);
	return (
		remainingItems[Math.min(selectedIndex, remainingItems.length - 1)]
			?.id ?? ""
	);
}

function visibleErrorMessage(error: Error | undefined, fallback: string) {
	return error ? clientAIError(error).message || fallback : "";
}

function currentSelectionId(
	selection: { requestId: string; historyId: string },
	requestId: string,
) {
	return selection.requestId === requestId ? selection.historyId : requestId;
}

function currentRequestIsVisible(
	content: string,
	dismissedError: Error | undefined,
	error: Error | undefined,
	isLoading: boolean,
) {
	const hasVisibleError = error !== undefined && error !== dismissedError;
	return isLoading || content.length > 0 || hasVisibleError;
}

function historyDeleteIsDisabled(
	isLoading: boolean,
	isShowingCurrentRequest: boolean,
	selectedItem: AIHistory | undefined,
) {
	return (isLoading && isShowingCurrentRequest) || !selectedItem;
}

function deleteHistoryItem({
	displayHistory,
	error,
	history,
	id,
	isShowingCurrentRequest,
	onClearCurrent,
	selectedItem,
	setDismissedError,
	setHistory,
	setSelection,
}: {
	displayHistory: AIHistory[];
	error: Error | undefined;
	history: AIHistory[];
	id: string;
	isShowingCurrentRequest: boolean;
	onClearCurrent: () => void;
	selectedItem: AIHistory | undefined;
	setDismissedError: (error: Error | undefined) => void;
	setHistory: (history: AIHistory[]) => void;
	setSelection: (selection: { requestId: string; historyId: string }) => void;
}) {
	if (!selectedItem) return;
	setHistory(history.filter((item) => item.id !== selectedItem.id));
	if (isShowingCurrentRequest) {
		onClearCurrent();
		setDismissedError(error);
	}
	setSelection({
		requestId: id,
		historyId: nextSelectedHistoryId(displayHistory, selectedItem),
	});
}

function contentIsLoaded(
	isLoading: boolean,
	content: string,
	error: Error | undefined,
	isShowingCurrentRequest: boolean,
) {
	return (
		!isLoading ||
		content.length > 0 ||
		Boolean(error) ||
		!isShowingCurrentRequest
	);
}

function makeContentView({
	currentKey,
	error,
	isLoading,
	isShowingCurrentRequest,
	onRetry,
	pdfSources,
	selectedItem,
	stickToBottom,
	visibleErrorFallback,
}: {
	currentKey: string;
	error: Error | undefined;
	isLoading: boolean;
	isShowingCurrentRequest: boolean;
	onRetry: () => void;
	pdfSources: Record<string, string>;
	selectedItem: AIHistory | undefined;
	stickToBottom: ReturnType<typeof useStickToBottom>;
	visibleErrorFallback: string;
}): GenerativeContentView {
	const contentToDisplay = selectedItem?.content ?? "";
	return {
		content: contentToDisplay,
		errorMessage: visibleErrorMessage(error, visibleErrorFallback),
		isAnimating: isLoading && isShowingCurrentRequest,
		isLoaded: contentIsLoaded(
			isLoading,
			contentToDisplay,
			error,
			isShowingCurrentRequest,
		),
		onRetry,
		pdfSources: selectedItem?.key === currentKey ? pdfSources : undefined,
		selectedId: selectedItem?.id,
		showError: Boolean(error) && isShowingCurrentRequest,
		stickToBottom,
	};
}

function useGenerativeModalView(props: GenerativeModalProps) {
	const {
		currentKey,
		currentModelId,
		currentTitle,
		feature,
		history,
		id,
		onClearCurrent,
		pdfSources = {},
		setHistory,
		title,
	} = props;
	const {
		isOpen,
		onOpenChange,
		response: content,
		error,
		isLoading,
		retry: onRetry,
	} = feature;
	const t = useTranslations("ai");
	const tUI = useTranslations("ui");
	const { ai } = useLibraryConfig();
	const format = useFormatter();
	const [selection, setSelection] = useState({
		requestId: id,
		historyId: id,
	});
	const [isHistoryOpen, setIsHistoryOpen] = useState(false);
	const [dismissedError, setDismissedError] = useState<Error>();
	const stickToBottom = useStickToBottom({
		initial: "smooth",
		resize: "smooth",
	});
	const prefersReducedMotion = useReducedMotion();
	const isDesktop = useBreakpoint("lg");
	const currentDate = useMemo(() => new Date(), [id]);
	const selectedHistoryId = currentSelectionId(selection, id);
	const persistedItem = history.find((item) => item.id === id);
	const currentItem = makeCurrentItem({
		content,
		currentDate,
		currentKey,
		currentModelId,
		currentTitle,
		hasCurrentRequest: currentRequestIsVisible(
			content,
			dismissedError,
			error,
			isLoading,
		),
		id,
		persistedItem,
	});
	const displayHistory = withCurrentItem(history, currentItem);
	const selectedItem = selectedHistoryItem(displayHistory, selectedHistoryId);
	const isShowingCurrentRequest = selectedItem?.id === id;

	const deleteSelectedHistory = () => {
		deleteHistoryItem({
			displayHistory,
			error,
			history,
			id,
			isShowingCurrentRequest,
			onClearCurrent,
			selectedItem,
			setDismissedError,
			setHistory,
			setSelection,
		});
	};

	const historyView: GenerativeHistoryView = {
		currentId: id,
		deleteDisabled: historyDeleteIsDisabled(
			isLoading,
			isShowingCurrentRequest,
			selectedItem,
		),
		displayHistory,
		format,
		isLoading,
		label: t("history"),
		onDelete: deleteSelectedHistory,
		onSelect: (historyId) => setSelection({ requestId: id, historyId }),
		providers: ai.providers,
		selectedItem,
	};
	const contentView = makeContentView({
		currentKey,
		error,
		isLoading,
		isShowingCurrentRequest,
		onRetry,
		pdfSources,
		selectedItem,
		stickToBottom,
		visibleErrorFallback: t("errorMessage"),
	});

	return {
		content: contentView,
		history: historyView,
		isDesktop,
		isHistoryOpen,
		isOpen,
		labels: {
			delete: t("delete"),
			deleteAriaLabel: tUI("deleteHistoryItemAriaLabel"),
			history: t("history"),
			jumpToLatest: t("jumpToLatest"),
			retry: tUI("retry"),
		},
		onHistoryOpenChange: setIsHistoryOpen,
		onOpenChange,
		prefersReducedMotion,
		title,
	};
}

export default function GenerativeModal(props: GenerativeModalProps) {
	return <GenerativeModalView {...useGenerativeModalView(props)} />;
}
