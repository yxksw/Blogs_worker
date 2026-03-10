// Storage Manager - Unified interface for multiple storage providers
import type {
	StorageProvider,
	UploadResult,
	StorageProviderConfig,
	R2Config,
	S3Config,
	TelegramConfig,
} from './types.js';
import { R2StorageProvider, type R2Bucket } from './r2.js';
import { S3StorageProvider } from './s3.js';
import { TelegramStorageProvider } from './telegram.js';

export * from './types.js';
export { R2StorageProvider } from './r2.js';
export { S3StorageProvider } from './s3.js';
export { TelegramStorageProvider } from './telegram.js';

export interface StorageManagerConfig {
	providers: StorageProviderConfig[];
	defaultProvider?: 'r2' | 's3' | 'telegram';
}

export class StorageManager {
	private providers: Map<string, StorageProvider> = new Map();
	private defaultProviderType: 'r2' | 's3' | 'telegram';

	constructor(
		config: StorageManagerConfig,
		r2Bucket?: R2Bucket
	) {
		// 初始化所有启用的存储提供商
		for (const providerConfig of config.providers) {
			if (!providerConfig.enabled) continue;

			switch (providerConfig.type) {
				case 'r2':
					if (r2Bucket) {
						const r2Config = providerConfig as R2Config;
						this.providers.set('r2', new R2StorageProvider(r2Bucket, r2Config));
					}
					break;
				case 's3':
					this.providers.set('s3', new S3StorageProvider(providerConfig as S3Config));
					break;
				case 'telegram':
					this.providers.set('telegram', new TelegramStorageProvider(providerConfig as TelegramConfig));
					break;
			}
		}

		// 设置默认提供商
		this.defaultProviderType = config.defaultProvider || 'r2';

		// 如果默认提供商未启用，使用第一个可用的
		if (!this.providers.has(this.defaultProviderType)) {
			const firstAvailable = Array.from(this.providers.keys())[0];
			if (firstAvailable) {
				this.defaultProviderType = firstAvailable as 'r2' | 's3' | 'telegram';
			}
		}
	}

	/**
	 * 上传文件到指定的存储提供商
	 */
	async upload(
		key: string,
		data: ArrayBuffer,
		contentType: string,
		preferredStorage?: 'r2' | 's3' | 'telegram'
	): Promise<UploadResult> {
		const storageType = preferredStorage || this.defaultProviderType;
		const provider = this.providers.get(storageType);

		if (!provider) {
			throw new Error(`Storage provider '${storageType}' is not configured or enabled`);
		}

		return provider.upload(key, data, contentType);
	}

	/**
	 * 从指定的存储提供商删除文件
	 */
	async delete(key: string, storageType: 'r2' | 's3' | 'telegram'): Promise<void> {
		const provider = this.providers.get(storageType);

		if (!provider) {
			throw new Error(`Storage provider '${storageType}' is not configured or enabled`);
		}

		return provider.delete(key);
	}

	/**
	 * 获取文件URL
	 */
	getUrl(key: string, storageType: 'r2' | 's3' | 'telegram'): string {
		const provider = this.providers.get(storageType);

		if (!provider) {
			throw new Error(`Storage provider '${storageType}' is not configured or enabled`);
		}

		return provider.getUrl(key);
	}

	/**
	 * 获取默认存储类型
	 */
	getDefaultStorageType(): 'r2' | 's3' | 'telegram' {
		return this.defaultProviderType;
	}

	/**
	 * 获取所有可用的存储类型
	 */
	getAvailableStorages(): Array<{ type: 'r2' | 's3' | 'telegram'; name: string }> {
		return Array.from(this.providers.entries()).map(([type, provider]) => ({
			type: type as 'r2' | 's3' | 'telegram',
			name: provider.name,
		}));
	}

	/**
	 * 检查存储提供商是否可用
	 */
	isStorageAvailable(type: 'r2' | 's3' | 'telegram'): boolean {
		return this.providers.has(type);
	}
}

/**
 * 从环境变量创建存储配置
 */
export function createStorageConfigFromEnv(env: Record<string, string | undefined>): StorageManagerConfig {
	const providers: StorageProviderConfig[] = [];

	// R2 配置
	if (env.R2_PUBLIC_URL) {
		providers.push({
			type: 'r2',
			enabled: env.R2_ENABLED !== 'false',
			priority: parseInt(env.R2_PRIORITY || '1', 10),
			publicUrl: env.R2_PUBLIC_URL,
		} as R2Config);
	}

	// S3 (缤纷云) 配置
	if (env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) {
		providers.push({
			type: 's3',
			enabled: env.S3_ENABLED === 'true',
			priority: parseInt(env.S3_PRIORITY || '2', 10),
			endpoint: env.S3_ENDPOINT,
			bucket: env.S3_BUCKET || '',
			region: env.S3_REGION || 'auto',
			accessKeyId: env.S3_ACCESS_KEY_ID,
			secretAccessKey: env.S3_SECRET_ACCESS_KEY,
			publicUrl: env.S3_PUBLIC_URL || env.S3_ENDPOINT,
		} as S3Config);
	}

	// Telegram 配置
	if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
		providers.push({
			type: 'telegram',
			enabled: env.TELEGRAM_ENABLED === 'true',
			priority: parseInt(env.TELEGRAM_PRIORITY || '3', 10),
			botToken: env.TELEGRAM_BOT_TOKEN,
			chatId: env.TELEGRAM_CHAT_ID,
			proxyUrl: env.TELEGRAM_PROXY_URL,
		} as TelegramConfig);
	}

	// 按优先级排序
	providers.sort((a, b) => a.priority - b.priority);

	return {
		providers,
		defaultProvider: (env.DEFAULT_STORAGE as 'r2' | 's3' | 'telegram') || 'r2',
	};
}
