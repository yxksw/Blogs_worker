import { SMTPClient, SMTPConfig, createQQMailConfig, createGmailConfig, create163MailConfig } from './smtp.js';

export interface EmailConfig {
	provider: 'resend' | 'smtp';
	resendApiKey?: string;
	smtpConfig?: SMTPConfig;
	fromEmail: string;
	fromName: string;
	toEmail: string;
}

export interface CommentNotificationData {
	postSlug: string;
	postTitle?: string;
	postUrl?: string;
	commentId: string;
	commentContent: string;
	authorName: string;
	authorUsername: string;
	authorAvatar?: string;
	parentComment?: {
		authorName: string;
		authorEmail?: string;
		content: string;
	};
	createdAt: number;
}

export class EmailService {
	constructor(private config: EmailConfig) {}

	async sendCommentNotification(data: CommentNotificationData): Promise<void> {
		console.log('EmailService: sendCommentNotification called, provider:', this.config.provider);
		try {
			if (this.config.provider === 'resend') {
				console.log('EmailService: Using Resend provider');
				await this.sendViaResend(data);
			} else if (this.config.provider === 'smtp') {
				console.log('EmailService: Using SMTP provider');
				await this.sendViaSMTP(data);
			} else {
				console.log('EmailService: Unknown provider:', this.config.provider);
			}
		} catch (error: any) {
			console.error('EmailService: Error in sendCommentNotification:', error?.message || error);
			throw error;
		}
	}

	private async sendViaResend(data: CommentNotificationData): Promise<void> {
		if (!this.config.resendApiKey) {
			console.error('Resend API key not configured');
			return;
		}

		const subject = data.parentComment
			? `💬 ${data.authorName} 回复了你在「${data.postTitle || data.postSlug}」的评论`
			: `📝 新评论：${data.authorName} 评论了「${data.postTitle || data.postSlug}」`;

		const html = this.buildEmailTemplate(data);

		const to = data.parentComment?.authorEmail || this.config.toEmail;

		try {
			const response = await fetch('https://api.resend.com/emails', {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${this.config.resendApiKey}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					from: `${this.config.fromName} <${this.config.fromEmail}>`,
					to: [to],
					subject,
					html,
				}),
			});

			if (!response.ok) {
				const error = await response.text();
				console.error('Failed to send email via Resend:', error);
			} else {
				console.log('Email sent successfully to:', to);
			}
		} catch (error) {
			console.error('Error sending email:', error);
		}
	}

	private async sendViaSMTP(data: CommentNotificationData): Promise<void> {
		if (!this.config.smtpConfig) {
			console.error('SMTP config not provided');
			return;
		}

		const subject = data.parentComment
			? `💬 ${data.authorName} 回复了你在「${data.postTitle || data.postSlug}」的评论`
			: `📝 新评论：${data.authorName} 评论了「${data.postTitle || data.postSlug}」`;

		const html = this.buildEmailTemplate(data);
		const text = this.buildPlainText(data);

		const to = data.parentComment?.authorEmail || this.config.toEmail;

		console.log('SMTP: Starting email send to:', to);
		console.log('SMTP: Config host:', this.config.smtpConfig.host, 'port:', this.config.smtpConfig.port);

		try {
			const client = new SMTPClient(this.config.smtpConfig);
			console.log('SMTP: Client created');
			await client.send({
				from: this.config.fromEmail,
				to: [to],
				subject,
				text,
				html,
			});
			console.log('Email sent successfully via SMTP to:', to);
		} catch (error: any) {
			console.error('Error sending email via SMTP:', error.message || error);
			console.error('SMTP Error details:', JSON.stringify(error));
		}
	}

	private buildPlainText(data: CommentNotificationData): string {
		const postUrl = data.postUrl || `https://blog.261770.xyz/blog/${data.postSlug}`;
		const date = new Date(data.createdAt).toLocaleString('zh-CN');

		if (data.parentComment) {
			return `评论回复通知

有人在文章「${data.postTitle || data.postSlug}」中回复了你

你的原评论：
${data.parentComment.content}

${data.authorName} (@${data.authorUsername}) 回复：
${data.commentContent}

时间：${date}

查看回复：${postUrl}#comment-${data.commentId}

---
此邮件由系统自动发送，请勿直接回复`;
		}

		return `新评论通知

你的博客收到了一条新评论

文章：${data.postTitle || data.postSlug}

评论者：${data.authorName} (@${data.authorUsername})

评论内容：
${data.commentContent}

时间：${date}

查看评论：${postUrl}#comment-${data.commentId}

---
此邮件由系统自动发送，请勿直接回复`;
	}

	private buildEmailTemplate(data: CommentNotificationData): string {
		const postUrl = data.postUrl || `https://blog.261770.xyz/blog/${data.postSlug}`;
		const date = new Date(data.createdAt).toLocaleString('zh-CN');

		if (data.parentComment) {
			return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>评论回复通知</title>
	<style>
		body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
		.container { background: white; border-radius: 8px; padding: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
		.header { text-align: center; margin-bottom: 30px; }
		.header h1 { color: #2563eb; margin: 0; font-size: 24px; }
		.divider { height: 1px; background: #e5e7eb; margin: 20px 0; }
		.comment-box { background: #f9fafb; border-left: 4px solid #2563eb; padding: 15px; margin: 15px 0; border-radius: 0 8px 8px 0; }
		.comment-header { display: flex; align-items: center; margin-bottom: 10px; }
		.avatar { width: 32px; height: 32px; border-radius: 50%; margin-right: 10px; }
		.author-info { flex: 1; }
		.author-name { font-weight: 600; color: #111827; }
		.author-username { color: #6b7280; font-size: 14px; }
		.comment-content { color: #374151; white-space: pre-wrap; }
		.original-comment { background: #fef3c7; border-left-color: #f59e0b; }
		.footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; }
		.button { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 15px; }
		.button:hover { background: #1d4ed8; }
		.timestamp { color: #9ca3af; font-size: 12px; margin-top: 10px; }
	</style>
</head>
<body>
	<div class="container">
		<div class="header">
			<h1>💬 评论回复通知</h1>
			<p>有人在文章「<strong>${data.postTitle || data.postSlug}</strong>」中回复了你</p>
		</div>
		
		<div class="divider"></div>
		
		<div class="comment-box original-comment">
			<div class="comment-header">
				<div class="author-info">
					<div class="author-name">${data.parentComment.authorName}</div>
					<div class="author-username">你的评论</div>
				</div>
			</div>
			<div class="comment-content">${this.escapeHtml(data.parentComment.content)}</div>
		</div>
		
		<div class="comment-box">
			<div class="comment-header">
				${data.authorAvatar ? `<img src="${data.authorAvatar}" class="avatar" alt="${data.authorName}">` : ''}
				<div class="author-info">
					<div class="author-name">${data.authorName}</div>
					<div class="author-username">@${data.authorUsername}</div>
				</div>
			</div>
			<div class="comment-content">${this.escapeHtml(data.commentContent)}</div>
			<div class="timestamp">${date}</div>
		</div>
		
		<div class="footer">
			<a href="${postUrl}#comment-${data.commentId}" class="button">查看回复</a>
			<p style="color: #9ca3af; font-size: 12px; margin-top: 20px;">
				此邮件由系统自动发送，请勿直接回复
			</p>
		</div>
	</div>
</body>
</html>`;
		}

		return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>新评论通知</title>
	<style>
		body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
		.container { background: white; border-radius: 8px; padding: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
		.header { text-align: center; margin-bottom: 30px; }
		.header h1 { color: #2563eb; margin: 0; font-size: 24px; }
		.divider { height: 1px; background: #e5e7eb; margin: 20px 0; }
		.comment-box { background: #f9fafb; border-left: 4px solid #2563eb; padding: 15px; margin: 15px 0; border-radius: 0 8px 8px 0; }
		.comment-header { display: flex; align-items: center; margin-bottom: 10px; }
		.avatar { width: 32px; height: 32px; border-radius: 50%; margin-right: 10px; }
		.author-info { flex: 1; }
		.author-name { font-weight: 600; color: #111827; }
		.author-username { color: #6b7280; font-size: 14px; }
		.comment-content { color: #374151; white-space: pre-wrap; }
		.post-info { background: #eff6ff; padding: 15px; border-radius: 8px; margin: 15px 0; }
		.post-title { font-weight: 600; color: #1e40af; }
		.footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; }
		.button { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 15px; }
		.button:hover { background: #1d4ed8; }
		.timestamp { color: #9ca3af; font-size: 12px; margin-top: 10px; }
	</style>
</head>
<body>
	<div class="container">
		<div class="header">
			<h1>📝 新评论通知</h1>
			<p>你的博客收到了一条新评论</p>
		</div>
		
		<div class="divider"></div>
		
		<div class="post-info">
			<div class="post-title">📄 ${data.postTitle || data.postSlug}</div>
		</div>
		
		<div class="comment-box">
			<div class="comment-header">
				${data.authorAvatar ? `<img src="${data.authorAvatar}" class="avatar" alt="${data.authorName}">` : ''}
				<div class="author-info">
					<div class="author-name">${data.authorName}</div>
					<div class="author-username">@${data.authorUsername}</div>
				</div>
			</div>
			<div class="comment-content">${this.escapeHtml(data.commentContent)}</div>
			<div class="timestamp">${date}</div>
		</div>
		
		<div class="footer">
			<a href="${postUrl}#comment-${data.commentId}" class="button">查看评论</a>
			<p style="color: #9ca3af; font-size: 12px; margin-top: 20px;">
				此邮件由系统自动发送，请勿直接回复
			</p>
		</div>
	</div>
</body>
</html>`;
	}

	private escapeHtml(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}
}

export function createEmailConfigFromEnv(env: {
	RESEND_API_KEY?: string;
	SMTP_HOST?: string;
	SMTP_PORT?: string;
	SMTP_USER?: string;
	SMTP_PASS?: string;
	SMTP_PROVIDER?: string;
	EMAIL_FROM?: string;
	EMAIL_FROM_NAME?: string;
	EMAIL_TO?: string;
	NOTIFY_ON_COMMENT?: string;
}): EmailConfig | null {
	// Priority: Resend > SMTP
	if (env.RESEND_API_KEY) {
		return {
			provider: 'resend',
			resendApiKey: env.RESEND_API_KEY,
			fromEmail: env.EMAIL_FROM || 'noreply@yourdomain.com',
			fromName: env.EMAIL_FROM_NAME || '博客评论通知',
			toEmail: env.EMAIL_TO || env.EMAIL_FROM || 'admin@yourdomain.com',
		};
	}

	// SMTP Configuration
	if (env.SMTP_USER && env.SMTP_PASS) {
		let smtpConfig: SMTPConfig;

		// Auto-detect provider based on email domain or explicit setting
		const provider = env.SMTP_PROVIDER?.toLowerCase();
		const emailDomain = env.SMTP_USER.split('@')[1]?.toLowerCase();

		if (provider === 'qq' || emailDomain === 'qq.com') {
			smtpConfig = createQQMailConfig({ user: env.SMTP_USER, pass: env.SMTP_PASS });
		} else if (provider === '163' || emailDomain === '163.com' || emailDomain === '126.com') {
			smtpConfig = create163MailConfig({ user: env.SMTP_USER, pass: env.SMTP_PASS });
		} else if (provider === 'gmail' || emailDomain === 'gmail.com') {
			smtpConfig = createGmailConfig({ user: env.SMTP_USER, pass: env.SMTP_PASS });
		} else {
			// Custom SMTP configuration
			smtpConfig = {
				host: env.SMTP_HOST || 'smtp.qq.com',
				port: parseInt(env.SMTP_PORT || '587'),
				secure: parseInt(env.SMTP_PORT || '587') === 465,
				auth: {
					user: env.SMTP_USER,
					pass: env.SMTP_PASS,
				},
			};
		}

		return {
			provider: 'smtp',
			smtpConfig,
			fromEmail: env.EMAIL_FROM || env.SMTP_USER,
			fromName: env.EMAIL_FROM_NAME || '博客评论通知',
			toEmail: env.EMAIL_TO || env.SMTP_USER,
		};
	}

	return null;
}

export { createQQMailConfig, createGmailConfig, create163MailConfig };
export type { SMTPConfig };
