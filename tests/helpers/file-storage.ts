import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { EvidenceFileStorageError, type EvidenceFileStorage, type SignedFileUpload } from "../../src/lib/admin/file-storage";
export class MemoryFileStorage implements EvidenceFileStorage {
	readonly privateFiles = new Map<string, Uint8Array>();
	readonly publicFiles = new Map<string, Uint8Array>();
	privateUploadHook: ((path: string) => Promise<void>) | null = null;
	publicUploadHook: (() => Promise<void>) | null = null;
	private publicUploadsAfterHook = 0;

	async createSignedUpload(path: string): Promise<SignedFileUpload> {
		return {
			path,
			signedUrl: `http://storage.local/upload/${path}`,
			token: `token-${path}`,
		};
	}

	async downloadPrivate(path: string) {
		const data = this.privateFiles.get(path);
		if (!data) throw new EvidenceFileStorageError("private download", `Missing private object: ${path}`, true);
		return data.slice();
	}

	async downloadPublic(path: string) {
		const bytes = this.publicFiles.get(path);
		if (!bytes) throw new EvidenceFileStorageError("public download", `Missing public object ${path}`, true);
		return bytes.slice();
	}

	async uploadPrivate(path: string, data: Uint8Array, _contentType: string) {
		this.privateFiles.set(path, data.slice());
		if (this.privateUploadHook) {
			const hook = this.privateUploadHook;
			this.privateUploadHook = null;
			await hook(path);
		}
	}

	async uploadPublic(path: string, data: Uint8Array, _contentType: string) {
		this.publicFiles.set(path, data.slice());
		if (this.publicUploadHook) {
			this.publicUploadsAfterHook += 1;
			if (this.publicUploadsAfterHook === 2) {
				const hook = this.publicUploadHook;
				this.publicUploadHook = null;
				this.publicUploadsAfterHook = 0;
				await hook();
			}
		}
	}

	publicUrl(path: string) {
		return `http://storage.local/public/${path}`;
	}

	async removePrivate(paths: string[]) {
		for (const path of paths) this.privateFiles.delete(path);
	}

	async removePublic(paths: string[]) {
		for (const path of paths) this.publicFiles.delete(path);
	}
}

export async function createPdf(title: string) {
	const document = await PDFDocument.create();
	const font = await document.embedFont(StandardFonts.Helvetica);
	const page = document.addPage([612, 792]);
	page.drawText(title, { x: 72, y: 700, size: 24, font });
	page.drawText("Evidence Library file lifecycle verification.", {
		x: 72,
		y: 660,
		size: 12,
		font,
	});
	return new Uint8Array(await document.save());
}

export function fileHash(bytes: Uint8Array) {
	return createHash("sha256").update(bytes).digest("hex");
}

