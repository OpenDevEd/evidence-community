// Google Analytics utility functions for event tracking
// This complements the existing PostHog tracking

declare global {
	interface Window {
		gtag: (...args: any[]) => void;
	}
}

// Google Analytics event tracking function
export function trackGAEvent(
	eventName: string,
	parameters: Record<string, any> = {}
) {
	if (typeof window !== "undefined" && window.gtag) {
		window.gtag("event", eventName, parameters);
	}
}

// Specific functions for PDF-related events
export function trackPDFDownload(key: string, filename: string) {
	trackGAEvent("pdf_download", {
		event_category: "engagement",
		event_label: filename,
		item_key: key,
		file_name: filename,
	});
}

export function trackPDFView(key: string, filename: string) {
	trackGAEvent("pdf_view", {
		event_category: "engagement",
		event_label: filename,
		item_key: key,
		file_name: filename,
	});
}

// General analytics tracking function that can be used for other events
export function trackCustomEvent(
	eventName: string,
	category: string,
	label?: string,
	value?: number
) {
	trackGAEvent(eventName, {
		event_category: category,
		event_label: label,
		value: value,
	});
}
