// Telegram Storage Provider Implementation
// Based on CloudFlare-ImgBed's telegramAPI.js
import type { StorageProvider, UploadResult, TelegramConfig } from './types.js';

interface TelegramFileInfo {
	file_id: string;
	file_name: string;
	file_size: number;
	file_path?: string;
}

interface TelegramApiResponse {
	ok: boolean;
	result?: {
		message_id?: number;
		photo?: Array<{
			file_id: string;
			file_unique_id: string;
			file_size: number;
			width: number;
			height: number;
		}>;
		document?: {
			file_id: string;
			file_unique_id: string;
			file_name?: string;
			file_size?: number;
			mime_type?: string;
		};
		video?: {
			file_id: string;
			file_unique_id: string;
			file_name?: string;
			file_size?: number;
			mime_type?: string;
		};
	};
	description?: string;
}

export class TelegramStorageProvider implements StorageProvider {
	readonly type = 'telegram' as const;
	readonly name = 'Telegram Channel';
	private baseURL: string;
	private fileDomain: string;
	private defaultHeaders: Record<string, string>;
	private useProxy: boolean;

	constructor(private config: TelegramConfig) {
		// 如果设置了代理域名，使用代理域名，否则使用官方 API
		// proxyUrl 可以是自定义域名，如 "api.danarnoux.com"
		this.useProxy = !!config.proxyUrl;

		if (this.useProxy) {
			// 使用后端代理
			// URL 格式: https://api.danarnoux.com/api/telegram-proxy?bot=<token>&method=<method>
			this.baseURL = `https://${config.proxyUrl}/api/telegram-proxy`;
			this.fileDomain = 'https://api.telegram.org'; // 文件下载仍使用官方地址
		} else {
			// 直接使用 Telegram API
			this.baseURL = `https://api.telegram.org/bot${config.botToken}`;
			this.fileDomain = 'https://api.telegram.org';
		}

		this.defaultHeaders = {
			'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
		};
	}

	private getProxyUrl(method: string): string {
		return `${this.baseURL}?bot=${this.config.botToken}&method=${method}`;
	}

	async upload(key: string, data: ArrayBuffer, contentType: string): Promise<UploadResult> {
		// 根据文件类型选择合适的上传方法
		const isImage = contentType.startsWith('image/');
		const isVideo = contentType.startsWith('video/');

		let responseData: TelegramApiResponse;

		if (isImage) {
			responseData = await this.sendPhoto(data, key, contentType);
		} else if (isVideo) {
			responseData = await this.sendVideo(data, key, contentType);
		} else {
			responseData = await this.sendDocument(data, key, contentType);
		}

		if (!responseData.ok) {
			throw new Error(`Telegram API error: ${responseData.description || 'Unknown error'}`);
		}

		const fileInfo = this.extractFileInfo(responseData);
		if (!fileInfo) {
			throw new Error('Failed to extract file info from Telegram response');
		}

		// 存储文件信息到key中，格式: telegram:{file_id}:{filename}
		const storageKey = `telegram:${fileInfo.file_id}:${fileInfo.file_name}`;

		return {
			key: storageKey,
			url: this.getUrl(storageKey),
			size: fileInfo.file_size || data.byteLength,
			storageType: 'telegram',
			metadata: {
				fileId: fileInfo.file_id,
				fileName: fileInfo.file_name,
				messageId: responseData.result?.message_id,
			},
		};
	}

	private async sendPhoto(data: ArrayBuffer, filename: string, contentType: string): Promise<TelegramApiResponse> {
		const formData = new FormData();
		formData.append('chat_id', this.config.chatId);

		const blob = new Blob([data], { type: contentType });
		formData.append('photo', blob, filename);

		const url = this.useProxy ? this.getProxyUrl('sendPhoto') : `${this.baseURL}/sendPhoto`;

		const response = await fetch(url, {
			method: 'POST',
			headers: this.defaultHeaders,
			body: formData,
		});

		if (!response.ok) {
			throw new Error(`Telegram sendPhoto failed: ${response.statusText}`);
		}

		return response.json() as Promise<TelegramApiResponse>;
	}

	private async sendVideo(data: ArrayBuffer, filename: string, contentType: string): Promise<TelegramApiResponse> {
		const formData = new FormData();
		formData.append('chat_id', this.config.chatId);

		const blob = new Blob([data], { type: contentType });
		formData.append('video', blob, filename);

		const url = this.useProxy ? this.getProxyUrl('sendVideo') : `${this.baseURL}/sendVideo`;

		const response = await fetch(url, {
			method: 'POST',
			headers: this.defaultHeaders,
			body: formData,
		});

		if (!response.ok) {
			throw new Error(`Telegram sendVideo failed: ${response.statusText}`);
		}

		return response.json() as Promise<TelegramApiResponse>;
	}

	private async sendDocument(data: ArrayBuffer, filename: string, contentType: string): Promise<TelegramApiResponse> {
		const formData = new FormData();
		formData.append('chat_id', this.config.chatId);

		const blob = new Blob([data], { type: contentType });
		formData.append('document', blob, filename);

		const url = this.useProxy ? this.getProxyUrl('sendDocument') : `${this.baseURL}/sendDocument`;

		const response = await fetch(url, {
			method: 'POST',
			headers: this.defaultHeaders,
			body: formData,
		});

		if (!response.ok) {
			throw new Error(`Telegram sendDocument failed: ${response.statusText}`);
		}

		return response.json() as Promise<TelegramApiResponse>;
	}

	private extractFileInfo(responseData: TelegramApiResponse): TelegramFileInfo | null {
		if (!responseData.ok || !responseData.result) {
			return null;
		}

		const result = responseData.result;

		// 处理图片
		if (result.photo && result.photo.length > 0) {
			const largestPhoto = result.photo.reduce((prev, current) =>
				(prev.file_size > current.file_size) ? prev : current
			);
			return {
				file_id: largestPhoto.file_id,
				file_name: largestPhoto.file_unique_id,
				file_size: largestPhoto.file_size,
			};
		}

		// 处理视频
		if (result.video) {
			return {
				file_id: result.video.file_id,
				file_name: result.video.file_name || result.video.file_unique_id,
				file_size: result.video.file_size || 0,
			};
		}

		// 处理文档
		if (result.document) {
			return {
				file_id: result.document.file_id,
				file_name: result.document.file_name || result.document.file_unique_id,
				file_size: result.document.file_size || 0,
			};
		}

		return null;
	}

	async delete(_key: string): Promise<void> {
		// Telegram API 不支持直接删除已发送的消息
		// 需要通过 deleteMessage API，但需要 message_id
		// 这里我们记录为不支持，或者可以实现通过存储的metadata来删除
		console.warn('Telegram storage does not support file deletion through this API');
	}

	getUrl(key: string): string {
		// key格式: telegram:{file_id}:{filename}
		// 返回通过bot获取文件的URL
		const parts = key.split(':');
		if (parts.length >= 2 && parts[0] === 'telegram') {
			const fileId = parts[1];
			// 使用API端点获取文件，实际文件URL需要通过getFile获取
			if (this.useProxy) {
				return `${this.baseURL}?bot=${this.config.botToken}&method=getFile&file_id=${fileId}`;
			}
			return `${this.baseURL}/getFile?file_id=${fileId}`;
		}
		return key;
	}

	// 获取实际的文件下载URL
	async getFileDownloadUrl(fileId: string): Promise<string | null> {
		try {
			const url = this.useProxy
				? `${this.baseURL}?bot=${this.config.botToken}&method=getFile&file_id=${fileId}`
				: `${this.baseURL}/getFile?file_id=${fileId}`;

			const response = await fetch(url, {
				method: 'GET',
				headers: this.defaultHeaders,
			});

			const data = await response.json() as TelegramApiResponse;
			if (data.ok && data.result?.file_path) {
				return `${this.fileDomain}/file/bot${this.config.botToken}/${data.result.file_path}`;
			}
			return null;
		} catch (error) {
			console.error('Error getting file URL:', error);
			return null;
		}
	}
}
