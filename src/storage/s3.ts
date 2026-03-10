// S3 Compatible Storage Provider (缤纷云等)
import type { StorageProvider, UploadResult, S3Config } from './types.js';

// AWS Signature V4 implementation for S3 compatible APIs
class AWSSignatureV4 {
	constructor(
		private accessKeyId: string,
		private secretAccessKey: string,
		private region: string,
		private service: string = 's3'
	) {}

	private async hmac(key: ArrayBuffer | string, message: string): Promise<ArrayBuffer> {
		const encoder = new TextEncoder();
		const keyData = typeof key === 'string' ? encoder.encode(key) : key;
		const cryptoKey = await crypto.subtle.importKey(
			'raw',
			keyData,
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign']
		);
		return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
	}

	private async getSignatureKey(dateStamp: string): Promise<ArrayBuffer> {
		const kDate = await this.hmac(`AWS4${this.secretAccessKey}`, dateStamp);
		const kRegion = await this.hmac(kDate, this.region);
		const kService = await this.hmac(kRegion, this.service);
		const kSigning = await this.hmac(kService, 'aws4_request');
		return kSigning;
	}

	private toHex(buffer: ArrayBuffer): string {
		return Array.from(new Uint8Array(buffer))
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');
	}

	async signRequest(
		method: string,
		url: URL,
		headers: Record<string, string>,
		body: ArrayBuffer | null
	): Promise<Record<string, string>> {
		const now = new Date();
		const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, '');
		const dateStamp = amzDate.slice(0, 8);

		// Add required headers
		const signedHeaders: Record<string, string> = {
			...headers,
			'host': url.host,
			'x-amz-date': amzDate,
			'x-amz-content-sha256': body
				? this.toHex(await crypto.subtle.digest('SHA-256', body))
				: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', // empty hash
		};

		// Create canonical request
		const canonicalHeaders = Object.keys(signedHeaders)
			.sort()
			.map(key => `${key.toLowerCase()}:${signedHeaders[key].trim()}\n`)
			.join('');

		const signedHeaderNames = Object.keys(signedHeaders)
			.map(k => k.toLowerCase())
			.sort()
			.join(';');

		const canonicalRequest = [
			method,
			url.pathname,
			url.searchParams.toString(),
			canonicalHeaders,
			signedHeaderNames,
			signedHeaders['x-amz-content-sha256'],
		].join('\n');

		// Create string to sign
		const credentialScope = `${dateStamp}/${this.region}/${this.service}/aws4_request`;
		const stringToSign = [
			'AWS4-HMAC-SHA256',
			amzDate,
			credentialScope,
			this.toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalRequest))),
		].join('\n');

		// Calculate signature
		const signingKey = await this.getSignatureKey(dateStamp);
		const signature = this.toHex(await this.hmac(signingKey, stringToSign));

		// Add authorization header
		signedHeaders['authorization'] =
			`AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, ` +
			`SignedHeaders=${signedHeaderNames}, Signature=${signature}`;

		return signedHeaders;
	}
}

export class S3StorageProvider implements StorageProvider {
	readonly type = 's3' as const;
	readonly name = 'S3 Compatible';
	private signer: AWSSignatureV4;

	constructor(private config: S3Config) {
		this.signer = new AWSSignatureV4(
			config.accessKeyId,
			config.secretAccessKey,
			config.region,
			's3'
		);
	}

	private getObjectUrl(key: string): string {
		// 缤纷云S3 endpoint 格式: https://s3.bitiful.net/bucket-name/key
		return `${this.config.endpoint}/${this.config.bucket}/${key}`;
	}

	async upload(key: string, data: ArrayBuffer, contentType: string): Promise<UploadResult> {
		const url = new URL(this.getObjectUrl(key));

		const headers = await this.signer.signRequest(
			'PUT',
			url,
			{
				'content-type': contentType,
				'content-length': String(data.byteLength),
			},
			data
		);

		const response = await fetch(url.toString(), {
			method: 'PUT',
			headers,
			body: data,
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`S3 upload failed: ${response.status} ${error}`);
		}

		return {
			key,
			url: this.getUrl(key),
			size: data.byteLength,
			storageType: 's3',
		};
	}

	async delete(key: string): Promise<void> {
		const url = new URL(this.getObjectUrl(key));

		const headers = await this.signer.signRequest('DELETE', url, {}, null);

		const response = await fetch(url.toString(), {
			method: 'DELETE',
			headers,
		});

		if (!response.ok && response.status !== 404) {
			const error = await response.text();
			throw new Error(`S3 delete failed: ${response.status} ${error}`);
		}
	}

	getUrl(key: string): string {
		// 使用配置的公共URL（CDN域名）
		return `${this.config.publicUrl}/${key}`;
	}
}
