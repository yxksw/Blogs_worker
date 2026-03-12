// SMTP 邮件发送测试脚本 (Node.js 版本)
// 使用 nodemailer 测试 SMTP 配置
// 使用方法: npx tsx scripts/test-smtp-node.ts

import nodemailer from 'nodemailer';

async function testEmail() {
	const smtpUser = process.env.SMTP_USER || '3149261770@qq.com';
	const smtpPass = process.env.SMTP_PASS || '';
	const emailTo = process.env.EMAIL_TO || 'yxksw@foxmail.com';

	console.log('🧪 测试 SMTP 邮件发送...');
	console.log(`📧 发件人: ${smtpUser}`);
	console.log(`📧 收件人: ${emailTo}`);

	if (!smtpPass) {
		console.error('\n❌ 错误: 请设置环境变量 SMTP_PASS（QQ邮箱授权码）');
		console.log('\n使用方法:');
		console.log('  1. 设置环境变量:');
		console.log('     $env:SMTP_USER="3149261770@qq.com"');
		console.log('     $env:SMTP_PASS="你的授权码"');
		console.log('     $env:EMAIL_TO="yxksw@foxmail.com"');
		console.log('  2. 运行测试:');
		console.log('     npx tsx scripts/test-smtp-node.ts');
		process.exit(1);
	}

	// 根据邮箱域名自动选择 SMTP 服务器
	const emailDomain = smtpUser.split('@')[1]?.toLowerCase();
	let smtpConfig: any;

	if (emailDomain === 'qq.com') {
		smtpConfig = {
			host: 'smtp.qq.com',
			port: 587,
			secure: false, // STARTTLS
			auth: {
				user: smtpUser,
				pass: smtpPass,
			},
		};
	} else if (emailDomain === '163.com' || emailDomain === '126.com') {
		smtpConfig = {
			host: 'smtp.163.com',
			port: 465,
			secure: true, // SSL
			auth: {
				user: smtpUser,
				pass: smtpPass,
			},
		};
	} else if (emailDomain === 'gmail.com') {
		smtpConfig = {
			host: 'smtp.gmail.com',
			port: 587,
			secure: false,
			auth: {
				user: smtpUser,
				pass: smtpPass,
			},
		};
	} else {
		console.error(`❌ 不支持的邮箱域名: ${emailDomain}`);
		console.log('支持的邮箱: QQ邮箱(@qq.com), 163邮箱(@163.com), 126邮箱(@126.com), Gmail(@gmail.com)');
		process.exit(1);
	}

	console.log(`\n📡 SMTP服务器: ${smtpConfig.host}:${smtpConfig.port}`);
	console.log(`🔐 加密方式: ${smtpConfig.secure ? 'SSL' : 'STARTTLS'}`);

	try {
		const transporter = nodemailer.createTransport(smtpConfig);

		// 验证连接
		console.log('\n🔌 正在连接 SMTP 服务器...');
		await transporter.verify();
		console.log('✅ SMTP 连接成功！');

		// 发送测试邮件
		console.log('\n📤 正在发送测试邮件...');
		const info = await transporter.sendMail({
			from: `"博客评论通知" <${smtpUser}>`,
			to: emailTo,
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
			<p><strong>恭喜！</strong>您的 SMTP 配置正确，可以正常发送邮件。</p>
			<p>当您的博客收到新评论时，您将收到类似这样的通知邮件。</p>
		</div>
		
		<div class="footer">
			<p>测试时间: ${new Date().toLocaleString('zh-CN')}</p>
			<p>发件人: ${smtpUser}</p>
			<p>SMTP服务器: ${smtpConfig.host}</p>
		</div>
	</div>
</body>
</html>`,
		});

		console.log('✅ 测试邮件发送成功！');
		console.log(`📨 邮件ID: ${info.messageId}`);
		console.log(`📬 请检查收件箱: ${emailTo}`);
		console.log('\n💡 提示: 如果收件箱没有，请检查垃圾邮件文件夹');
	} catch (error: any) {
		console.error('\n❌ 测试邮件发送失败:');
		console.error(error.message);
		
		if (error.message.includes('Invalid login')) {
			console.log('\n💡 可能的原因:');
			console.log('  1. 授权码错误 - 请使用 QQ 邮箱生成的授权码，不是邮箱密码');
			console.log('  2. 邮箱地址错误');
			console.log('  3. SMTP 服务未开启');
		}
		
		process.exit(1);
	}
}

testEmail();
