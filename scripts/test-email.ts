// SMTP 邮件发送测试脚本
// 使用方法: npx tsx scripts/test-email.ts

import { SMTPClient, createQQMailConfig } from '../src/email/smtp.js';

async function testEmail() {
	// 从环境变量读取配置，或使用默认值
	const smtpUser = process.env.SMTP_USER || 'your-qq@qq.com';
	const smtpPass = process.env.SMTP_PASS || 'your-auth-code';
	const emailTo = process.env.EMAIL_TO || smtpUser;

	console.log('🧪 测试 SMTP 邮件发送...');
	console.log(`📧 发件人: ${smtpUser}`);
	console.log(`📧 收件人: ${emailTo}`);

	if (smtpUser === 'your-qq@qq.com' || smtpPass === 'your-auth-code') {
		console.error('\n❌ 错误: 请设置环境变量 SMTP_USER 和 SMTP_PASS');
		console.log('\n使用方法:');
		console.log('  1. 设置环境变量:');
		console.log('     $env:SMTP_USER="your-qq@qq.com"');
		console.log('     $env:SMTP_PASS="your-auth-code"');
		console.log('  2. 运行测试:');
		console.log('     npx tsx scripts/test-email.ts');
		process.exit(1);
	}

	try {
		// 创建 QQ 邮箱配置
		const config = createQQMailConfig({
			user: smtpUser,
			pass: smtpPass,
		});

		const client = new SMTPClient(config);

		console.log('\n📤 正在发送测试邮件...');

		await client.send({
			from: smtpUser,
			to: [emailTo],
			subject: '🎉 SMTP 测试邮件 - 博客评论通知',
			text: `这是一封测试邮件！\n\n如果您的博客收到新评论，您将收到类似这样的通知邮件。\n\n时间: ${new Date().toLocaleString('zh-CN')}`,
			html: `
<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<style>
		body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
		.container { background: white; border-radius: 8px; padding: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
		.header { text-align: center; margin-bottom: 30px; }
		.header h1 { color: #10b981; margin: 0; font-size: 24px; }
		.success-icon { font-size: 48px; margin-bottom: 10px; }
		.content { background: #f0fdf4; border-left: 4px solid #10b981; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0; }
		.footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px; }
	</style>
</head>
<body>
	<div class="container">
		<div class="header">
			<div class="success-icon">✅</div>
			<h1>SMTP 测试成功！</h1>
		</div>
		
		<div class="content">
			<p><strong>恭喜！</strong>您的 SMTP 邮件配置正确，可以正常发送邮件。</p>
			<p>当您的博客收到新评论时，您将收到类似这样的通知邮件。</p>
		</div>
		
		<div class="footer">
			<p>测试时间: ${new Date().toLocaleString('zh-CN')}</p>
			<p>发件人: ${smtpUser}</p>
		</div>
	</div>
</body>
</html>`,
		});

		console.log('✅ 测试邮件发送成功！');
		console.log(`📨 请检查收件箱: ${emailTo}`);
	} catch (error) {
		console.error('\n❌ 测试邮件发送失败:');
		console.error(error);
		process.exit(1);
	}
}

testEmail();
