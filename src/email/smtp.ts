// SMTP Client for Cloudflare Workers using TCP Sockets
// Note: cloudflare:sockets types are provided by @cloudflare/workers-types

import { connect } from 'cloudflare:sockets';

export interface SMTPConfig {
	host: string;
	port: number;
	secure: boolean; // true for 465, false for 587 (STARTTLS)
	auth: {
		user: string;
		pass: string;
	};
}

export interface SMTPMessage {
	from: string;
	to: string[];
	subject: string;
	text?: string;
	html?: string;
}

export class SMTPClient {
	private socket: ReturnType<typeof connect> | null = null;
	private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
	private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
	private encoder = new TextEncoder();
	private decoder = new TextDecoder();

	constructor(private config: SMTPConfig) {}

	async send(message: SMTPMessage): Promise<void> {
		try {
			console.log('SMTP: Starting send process...');
			await this.connect();
			console.log('SMTP: Connected, sending EHLO...');
			await this.ehlo();
			console.log('SMTP: EHLO done');
			
			// STARTTLS for port 587 (not used for port 465 which is direct TLS)
			if (!this.config.secure && this.config.port === 587) {
				console.log('SMTP: Starting STARTTLS...');
				await this.startTls();
				console.log('SMTP: STARTTLS done, sending EHLO again...');
				await this.ehlo();
				console.log('SMTP: EHLO after STARTTLS done');
			}
			
			console.log('SMTP: Authenticating...');
			await this.auth();
			console.log('SMTP: Auth done');
			
			console.log('SMTP: Setting MAIL FROM...');
			await this.mailFrom(message.from);
			console.log('SMTP: MAIL FROM done');
			
			for (const to of message.to) {
				console.log('SMTP: Setting RCPT TO:', to);
				await this.rcptTo(to);
				console.log('SMTP: RCPT TO done');
			}
			
			console.log('SMTP: Sending DATA...');
			await this.data(message);
			console.log('SMTP: DATA done');
			
			console.log('SMTP: Sending QUIT...');
			await this.quit();
			console.log('SMTP: QUIT done');
			
			console.log('SMTP: Email sent successfully!');
		} catch (error: any) {
			console.error('SMTP: Error during send:', error?.message || error);
			throw error;
		} finally {
			console.log('SMTP: Closing connection...');
			await this.close();
			console.log('SMTP: Connection closed');
		}
	}

	private async connect(): Promise<void> {
		const { host, port, secure } = this.config;
		
		console.log(`SMTP: Connecting to ${host}:${port}, secure=${secure}`);
		
		// Use TLS for port 465, plain TCP for 587 (STARTTLS)
		try {
			this.socket = connect({ hostname: host, port }, { secureTransport: secure ? 'on' : 'off', allowHalfOpen: false });
			console.log('SMTP: Socket created');
		} catch (err: any) {
			console.error('SMTP: Failed to create socket:', err?.message || err);
			throw err;
		}
		
		if (!this.socket) {
			throw new Error('Failed to create socket');
		}
		
		console.log('SMTP: Getting reader and writer...');
		try {
			this.reader = this.socket.readable.getReader();
			this.writer = this.socket.writable.getWriter();
			console.log('SMTP: Reader and writer obtained');
		} catch (err: any) {
			console.error('SMTP: Failed to get reader/writer:', err?.message || err);
			throw err;
		}
		
		// Wait for greeting
		console.log('SMTP: Waiting for greeting (220)...');
		await this.readResponse(220);
		console.log('SMTP: Greeting received');
	}

	private async ehlo(): Promise<void> {
		await this.write(`EHLO cloudflare-worker\r\n`);
		await this.readResponse(250);
	}

	private async startTls(): Promise<void> {
		await this.write(`STARTTLS\r\n`);
		await this.readResponse(220);
		
		// Upgrade to TLS - close current streams and reconnect with TLS
		await this.close();
		
		this.socket = connect(
			{ hostname: this.config.host, port: this.config.port },
			{ secureTransport: 'on', allowHalfOpen: false }
		);
		if (!this.socket) {
			throw new Error('Failed to create TLS socket');
		}
		this.reader = this.socket.readable.getReader();
		this.writer = this.socket.writable.getWriter();
		
		await this.readResponse(220);
	}

	private async auth(): Promise<void> {
		const { user, pass } = this.config.auth;
		
		// Try AUTH LOGIN first (most compatible)
		await this.write(`AUTH LOGIN\r\n`);
		await this.readResponse(334);
		
		// Send username (base64 encoded)
		await this.write(`${btoa(user)}\r\n`);
		await this.readResponse(334);
		
		// Send password (base64 encoded)
		await this.write(`${btoa(pass)}\r\n`);
		await this.readResponse(235);
	}

	private async mailFrom(from: string): Promise<void> {
		await this.write(`MAIL FROM:<${from}>\r\n`);
		await this.readResponse(250);
	}

	private async rcptTo(to: string): Promise<void> {
		await this.write(`RCPT TO:<${to}>\r\n`);
		await this.readResponse(250);
	}

	private async data(message: SMTPMessage): Promise<void> {
		await this.write(`DATA\r\n`);
		await this.readResponse(354);
		
		const { from, to, subject, text, html } = message;
		const boundary = `----=${Math.random().toString(36).substring(2)}`;
		const messageId = `<${Date.now()}.${Math.random().toString(36).substring(2)}@cloudflare-worker>`;
		const date = new Date().toUTCString();
		
		let data = '';
		data += `From: ${from}\r\n`;
		data += `To: ${to.join(', ')}\r\n`;
		data += `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=\r\n`;
		data += `Message-ID: ${messageId}\r\n`;
		data += `Date: ${date}\r\n`;
		data += `MIME-Version: 1.0\r\n`;
		
		if (html && text) {
			// Multipart alternative
			data += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n`;
			data += `\r\n`;
			data += `--${boundary}\r\n`;
			data += `Content-Type: text/plain; charset=utf-8\r\n`;
			data += `Content-Transfer-Encoding: base64\r\n`;
			data += `\r\n`;
			data += `${this.base64Encode(text)}\r\n`;
			data += `\r\n`;
			data += `--${boundary}\r\n`;
			data += `Content-Type: text/html; charset=utf-8\r\n`;
			data += `Content-Transfer-Encoding: base64\r\n`;
			data += `\r\n`;
			data += `${this.base64Encode(html)}\r\n`;
			data += `\r\n`;
			data += `--${boundary}--\r\n`;
		} else if (html) {
			data += `Content-Type: text/html; charset=utf-8\r\n`;
			data += `Content-Transfer-Encoding: base64\r\n`;
			data += `\r\n`;
			data += `${this.base64Encode(html)}\r\n`;
		} else {
			data += `Content-Type: text/plain; charset=utf-8\r\n`;
			data += `Content-Transfer-Encoding: base64\r\n`;
			data += `\r\n`;
			data += `${this.base64Encode(text || '')}\r\n`;
		}
		
		data += `.\r\n`;
		
		await this.write(data);
		await this.readResponse(250);
	}

	private async quit(): Promise<void> {
		await this.write(`QUIT\r\n`);
		await this.readResponse(221);
	}

	private async write(data: string): Promise<void> {
		if (!this.writer) throw new Error('Not connected');
		await this.writer.write(this.encoder.encode(data));
	}

	private async readResponse(expectedCode: number): Promise<string> {
		if (!this.reader) throw new Error('Not connected');
		
		console.log(`SMTP: Waiting for response ${expectedCode}...`);
		let response = '';
		let attempts = 0;
		const maxAttempts = 100; // Prevent infinite loop
		
		while (attempts < maxAttempts) {
			attempts++;
			
			try {
				const { done, value } = await this.reader.read();
				if (done) {
					console.log('SMTP: Reader done (stream closed)');
					throw new Error('SMTP connection closed unexpectedly');
				}
				
				response += this.decoder.decode(value, { stream: true });
				console.log(`SMTP: Received raw data: ${JSON.stringify(response)}`);
				
				// Check if we have a complete response line
				const lines = response.split('\r\n');
				for (let i = 0; i < lines.length - 1; i++) {
					const line = lines[i];
					console.log(`SMTP: Checking line: "${line}"`);
					if (line.length >= 3) {
						const code = parseInt(line.substring(0, 3));
						// Check if this is the last line (no dash after code)
						const isLastLine = !line.substring(3).startsWith('-');
						console.log(`SMTP: Got response code ${code}, expected ${expectedCode}, isLastLine: ${isLastLine}`);
						if (isLastLine) {
							if (code !== expectedCode) {
								throw new Error(`SMTP Error: Expected ${expectedCode} but got ${code}: ${line}`);
							}
							return response;
						}
					}
				}
			} catch (err: any) {
				console.error(`SMTP: Error reading response on attempt ${attempts}:`, err?.message || err);
				throw err;
			}
		}
		
		throw new Error(`SMTP: Max read attempts reached, response: ${response}`);
	}

	private async close(): Promise<void> {
		if (this.writer) {
			await this.writer.close();
			this.writer = null;
		}
		if (this.reader) {
			await this.reader.cancel();
			this.reader = null;
		}
		this.socket = null;
	}

	private base64Encode(str: string): string {
		const bytes = new TextEncoder().encode(str);
		const binString = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
		return btoa(binString);
	}
}

// QQ Mail SMTP Configuration Helper
export function createQQMailConfig(auth: { user: string; pass: string }): SMTPConfig {
	return {
		host: 'smtp.qq.com',
		port: 465, // Use direct TLS on 465 instead of STARTTLS on 587
		secure: true, // Direct TLS connection
		auth,
	};
}

// Gmail SMTP Configuration Helper
export function createGmailConfig(auth: { user: string; pass: string }): SMTPConfig {
	return {
		host: 'smtp.gmail.com',
		port: 587,
		secure: false,
		auth,
	};
}

// 163 Mail SMTP Configuration Helper
export function create163MailConfig(auth: { user: string; pass: string }): SMTPConfig {
	return {
		host: 'smtp.163.com',
		port: 465,
		secure: true,
		auth,
	};
}
