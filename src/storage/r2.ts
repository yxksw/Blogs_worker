// R2 Storage Provider Implementation
import type { StorageProvider, UploadResult, R2Config } from './types.js';

export interface R2Bucket {
	get(key: string): Promise<R2Object | null>;
	put(key: string, value: string | ArrayBuffer | ReadableStream): Promise<R2Object>;
	delete(key: string): Promise<void>;
	list(options?: { prefix?: string; delimiter?: string; cursor?: string; limit?: number }): Promise<{
		objects: R2Object[];
		truncated: boolean;
		cursor?: string;
	}>;
}

export interface R2Object {
	key: string;
	readonly body: ReadableStream;
	readonly size: number;
	readonly httpEtag: string;
	readonly customFields: Record<string, string>;
}

export class R2StorageProvider implements StorageProvider {
	readonly type = 'r2' as const;
	readonly name = 'Cloudflare R2';

	constructor(
		private bucket: R2Bucket,
		private config: R2Config
	) {}

	async upload(key: string, data: ArrayBuffer, contentType: string): Promise<UploadResult> {
		await this.bucket.put(key, data);

		return {
			key,
			url: this.getUrl(key),
			size: data.byteLength,
			storageType: 'r2',
		};
	}

	async delete(key: string): Promise<void> {
		await this.bucket.delete(key);
	}

	getUrl(key: string): string {
		return `${this.config.publicUrl}/${key}`;
	}
}
