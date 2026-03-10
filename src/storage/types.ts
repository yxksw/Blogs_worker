// Storage types and interfaces for multi-provider image storage

export interface StorageConfig {
	type: 'r2' | 's3' | 'telegram';
	enabled: boolean;
	priority: number;
}

export interface R2Config extends StorageConfig {
	type: 'r2';
	bucketName?: string;
	publicUrl: string;
}

export interface S3Config extends StorageConfig {
	type: 's3';
	endpoint: string;
	bucket: string;
	region: string;
	accessKeyId: string;
	secretAccessKey: string;
	publicUrl: string;
}

export interface TelegramConfig extends StorageConfig {
	type: 'telegram';
	botToken: string;
	chatId: string;
	proxyUrl?: string;
}

export type StorageProviderConfig = R2Config | S3Config | TelegramConfig;

export interface UploadResult {
	key: string;
	url: string;
	size: number;
	storageType: 'r2' | 's3' | 'telegram';
	metadata?: Record<string, unknown>;
}

export interface StorageProvider {
	readonly type: 'r2' | 's3' | 'telegram';
	readonly name: string;
	upload(key: string, data: ArrayBuffer, contentType: string): Promise<UploadResult>;
	delete(key: string): Promise<void>;
	getUrl(key: string): string;
}

export interface ImageMetadata {
	id: string;
	key: string;
	storageType: 'r2' | 's3' | 'telegram';
	url: string;
	thumbnailUrl?: string;
	size: number;
	contentType: string;
	userId: string;
	category: string;
	filename: string;
	createdAt: number;
	metadata?: Record<string, unknown>;
}
