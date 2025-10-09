import { StoredUtm, UTM_KEYS } from "@/components/features/UtmProvider";
import { sendGAEvent } from "@next/third-parties/google";

export type PdfEventParams = {
	file_id: string;
	filename: string;
	file_title?: string;
	parent_type?: string;
	parent_id?: string;
	parent_title?: string;
	file_size_bytes?: number;
	file_mime_type?: string;
	link_url?: string;
	link_text?: string;
	method?: "view" | "download" | "open";
	file_md5?: string;
	posthog_distinct_id?: string;
	user_id?: string;
} & StoredUtm["utm"];

// Specific functions for PDF-related events
export function trackPDFDownload(params: PdfEventParams) {
	sendGAEvent("event", "pdf_download", {
		engagement_time_msec: 1,
		method: "download",
		...params,
		// debug_mode: true,
	});
}

export function trackPDFView(params: PdfEventParams) {
	sendGAEvent("event", "pdf_view", {
		engagement_time_msec: 1,
		method: "view",
		...params,
		// debug_mode: true,
	});
}

export function payloadToPosthog(params: PdfEventParams) {
	const obj: Record<string, any> = {
		key: params.file_id,
		filename: params.filename,
		fileTitle: params.file_title,
		parentKey: params.parent_id,
		parentTitle: params.parent_title,
		parentType: params.parent_type,
		fileMimeType: params.file_mime_type,
		fileMd5: params.file_md5,
		linkText: params.link_text,
		linkUrl: params.link_url,
		userId: params.user_id,
	};

	for (const key of UTM_KEYS) {
		if (params[key]) {
			obj[key] = params[key];
		}
	}

	return obj;
}
