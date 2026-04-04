type D1Statement = {
	bind(...values: unknown[]): D1Statement;
	first<T>(): Promise<T | null>;
	all<T>(): Promise<{ results?: T[] }>;
	run(): Promise<{ meta?: { changes?: number } }>;
};

type D1Database = {
	prepare(query: string): D1Statement;
};

type R2Bucket = {
	get(key: string): Promise<R2Object | null>;
	put(key: string, value: string | ArrayBuffer | ReadableStream): Promise<R2Object>;
	delete(key: string): Promise<void>;
	list(options?: { prefix?: string; delimiter?: string; cursor?: string; limit?: number }): Promise<{
		objects: R2Object[];
		truncated: boolean;
		cursor?: string;
	}>;
};

type R2Object = {
	key: string;
	readonly body: ReadableStream;
	readonly size: number;
	readonly httpEtag: string;
	readonly customFields: Record<string, string>;
};

type KVNamespace = {
	get(key: string): Promise<string | null>;
	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
	delete(key: string): Promise<void>;
};

type DurableObjectStorage = {
	get<T = unknown>(key: string): Promise<T | undefined>;
	put(key: string, value: unknown, options?: { expirationTtl?: number }): Promise<void>;
};

type DurableObjectState = {
	storage: DurableObjectStorage;
};

type DurableObjectNamespace = {
	idFromName(name: string): unknown;
	get(id: unknown): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
};

type Ai = {
	run(model: string, options: { messages: { role: string; content: string }[] }): Promise<{ response: string }>;
};

type ExecutionContext = {
	waitUntil(promise: Promise<unknown>): void;
};

type Env = {
	DB: D1Database;
	IMAGES: R2Bucket;
	RATE_LIMITER: DurableObjectNamespace;
	RATE_LIMIT_KV: KVNamespace;
	MODERATION_KV: KVNamespace;
	AI: Ai;
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
	PUBLIC_ALLOWED_ORIGIN?: string;
	SESSION_TTL_SECONDS?: string;
	RESEND_API_KEY?: string;
	BASE_URL?: string;
	TURNSTILE_SECRET_KEY?: string;
	DEV?: boolean;
};

type SessionRow = {
	user_id: string;
	login: string;
	name: string | null;
	avatar_url: string | null;
	profile_url: string | null;
	expires_at: number;
};

type PostViewsRow = {
	post_slug: string;
	views: number;
};

const STATE_COOKIE = '__Secure-gh_state';
const VERIFIER_COOKIE = '__Secure-gh_verifier';
const RETURN_TO_COOKIE = '__Secure-gh_return_to';

const OAUTH_COOKIE_TTL_SECONDS = 600;
const RATE_LIMIT_PER_MIN = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const COMMENT_MAX_LENGTH = 2000;
const COMMENT_MIN_LENGTH = 1;
const POST_SLUG_MAX_LENGTH = 180;
const COMMENT_DAILY_LIMIT = 30;

export class RateLimiter {
	constructor(private readonly state: DurableObjectState) {}

	async fetch(request: Request): Promise<Response> {
		if (request.method !== 'POST') {
			return new Response('Method Not Allowed', { status: 405 });
		}

		let payload: { ip?: unknown; route?: unknown; limit?: unknown; windowMs?: unknown };
		try {
			payload = (await request.json()) as { ip?: unknown; route?: unknown; limit?: unknown; windowMs?: unknown };
		} catch {
			return json({ error: 'Invalid JSON' }, 400);
		}

		const ip = typeof payload.ip === 'string' && payload.ip ? payload.ip.slice(0, 80) : 'unknown';
		const route = typeof payload.route === 'string' && payload.route ? payload.route.slice(0, 80) : 'default';
		const limit = clampInt(payload.limit, 1, 100, RATE_LIMIT_PER_MIN);
		const windowMs = clampInt(payload.windowMs, 1000, 10 * 60 * 1000, RATE_LIMIT_WINDOW_MS);

		const now = Date.now();
		const bucket = Math.floor(now / windowMs);
		const key = `${ip}:${route}:${bucket}`;
		const count = Number((await this.state.storage.get<number>(key)) ?? 0);

		if (count >= limit) {
			const retryAfter = Math.max(1, Math.ceil(((bucket + 1) * windowMs - now) / 1000));
			return json({ error: 'Too Many Requests' }, 429, {
				'retry-after': String(retryAfter),
			});
		}

		await this.state.storage.put(key, count + 1, {
			expirationTtl: Math.ceil((windowMs * 2) / 1000),
		});

		return json({ ok: true, remaining: limit - (count + 1) }, 200);
	}
}

export default {
	async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const origin = resolveAllowedOrigin(request, env);

		if (url.pathname.startsWith('/api/') && request.method === 'OPTIONS') {
			if (!origin) {
				return json({ error: 'CORS origin not allowed' }, 403);
			}
			return withCors(
				new Response(null, {
					status: 204,
					headers: {
						'access-control-allow-methods': 'GET,POST,OPTIONS',
						'access-control-allow-headers': 'Authorization, Content-Type',
						'access-control-max-age': '86400',
					},
				}),
				origin
			);
		}

		try {
			let response: Response;
			const routeKey = `${request.method} ${url.pathname}`;
			console.log('Routing request:', routeKey);
			switch (routeKey) {
				case 'GET /api/auth/github/start':
					response = await handleGithubStart(request, env);
					break;
				case 'GET /api/auth/github/callback':
					response = await handleGithubCallback(request, env);
					break;
				case 'GET /api/me':
					response = await handleMe(request, env);
					break;
				case 'POST /api/me':
					response = await handleMeUpdate(request, env);
					break;
				case 'POST /api/auth/logout':
					response = await handleLogout(request, env);
					break;
				case 'GET /api/comments':
					response = await handleCommentsGet(request, env);
					break;
				case 'POST /api/comments':
					response = await handleCommentsPost(request, env);
					break;
				case 'GET /api/views':
					response = await handleViewsGet(request, env);
					break;
				case 'POST /api/views':
					response = await handleViewsPost(request, env);
					break;
				case 'GET /api/images':
					// Route based on query params: key= for serve, prefix= for list
					response = await handleImageRoute(request, env);
					break;
				case 'POST /api/images':
					response = await handleImageUpload(request, env);
					break;
				case 'DELETE /api/images':
					response = await handleImageDelete(request, env);
					break;
				case 'POST /api/upload':
					response = await handleImageUpload(request, env);
					break;
				case 'POST /api/auth/email/send':
					response = await handleEmailSend(request, env);
					break;
				case 'GET /api/auth/email/verify':
					response = await handleEmailVerify(request, env);
					break;
				case 'POST /api/auth/email/verify':
					response = await handleEmailVerify(request, env);
					break;
				case 'POST /api/auth/dev-login':
					response = await handleDevLogin(request, env);
					break;
				case 'POST /api/contact':
					response = await handleContact(request, env);
					break;
				default:
					response = json({ error: 'Not Found' }, 404);
					break;
			}

			if (url.pathname.startsWith('/api/')) {
				return withCors(response, origin);
			}
			return response;
		} catch (error) {
			console.error('worker_error', error);
			return withCors(json({ error: 'Internal Server Error' }, 500), origin);
		}
	},
};

async function handleGithubStart(request: Request, env: Env): Promise<Response> {
	if (!env.GITHUB_CLIENT_ID) {
		return json({ error: 'GITHUB_CLIENT_ID is required' }, 500);
	}

	const rate = await checkRateLimit(request, env, 'oauth_start');
	if (rate) return rate;

	const requestUrl = new URL(request.url);
	const state = randomBase64Url(24);
	const codeVerifier = randomBase64Url(48);
	const codeChallenge = await sha256Base64Url(codeVerifier);
	const returnTo = sanitizeReturnTo(requestUrl.searchParams.get('returnTo'), env);
	const redirectUri = `${requestUrl.origin}/api/auth/github/callback`;

	const githubAuth = new URL('https://github.com/login/oauth/authorize');
	githubAuth.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
	githubAuth.searchParams.set('redirect_uri', redirectUri);
	githubAuth.searchParams.set('scope', 'read:user');
	githubAuth.searchParams.set('state', state);
	githubAuth.searchParams.set('code_challenge', codeChallenge);
	githubAuth.searchParams.set('code_challenge_method', 'S256');

	const headers = new Headers({ location: githubAuth.toString(), 'cache-control': 'no-store' });
	headers.append('set-cookie', cookie(STATE_COOKIE, state, OAUTH_COOKIE_TTL_SECONDS));
	headers.append('set-cookie', cookie(VERIFIER_COOKIE, codeVerifier, OAUTH_COOKIE_TTL_SECONDS));
	headers.append('set-cookie', cookie(RETURN_TO_COOKIE, returnTo, OAUTH_COOKIE_TTL_SECONDS));

	return new Response(null, { status: 302, headers });
}

async function handleGithubCallback(request: Request, env: Env): Promise<Response> {
	if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
		return json({ error: 'OAuth secrets are not configured' }, 500);
	}

	const requestUrl = new URL(request.url);
	const cookies = parseCookies(request.headers.get('cookie'));
	const stateExpected = cookies.get(STATE_COOKIE) ?? '';
	const verifier = cookies.get(VERIFIER_COOKIE) ?? '';
	const returnTo = sanitizeReturnTo(cookies.get(RETURN_TO_COOKIE) ?? '', env);
	const state = requestUrl.searchParams.get('state') ?? '';
	const code = requestUrl.searchParams.get('code') ?? '';

	if (!stateExpected || !verifier || !state || !code || !safeEqual(stateExpected, state)) {
		return redirectWithClearedOAuth(returnTo);
	}

	const tokenPayload = new URLSearchParams();
	tokenPayload.set('client_id', env.GITHUB_CLIENT_ID);
	tokenPayload.set('client_secret', env.GITHUB_CLIENT_SECRET);
	tokenPayload.set('code', code);
	tokenPayload.set('code_verifier', verifier);
	tokenPayload.set('redirect_uri', `${requestUrl.origin}/api/auth/github/callback`);

	const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
		method: 'POST',
		headers: {
			accept: 'application/json',
			'content-type': 'application/x-www-form-urlencoded',
			'user-agent': 'blog-worker',
		},
		body: tokenPayload,
	});

	if (!tokenRes.ok) {
		return redirectWithClearedOAuth(returnTo);
	}

	const tokenData = (await tokenRes.json()) as { access_token?: string };
	const githubAccessToken = typeof tokenData.access_token === 'string' ? tokenData.access_token : '';
	if (!githubAccessToken) {
		return redirectWithClearedOAuth(returnTo);
	}

	const userRes = await fetch('https://api.github.com/user', {
		headers: {
			accept: 'application/vnd.github+json',
			authorization: `Bearer ${githubAccessToken}`,
			'user-agent': 'blog-worker',
		},
	});

	if (!userRes.ok) {
		return redirectWithClearedOAuth(returnTo);
	}

	const ghUser = (await userRes.json()) as {
		id: number;
		login: string;
		name?: string | null;
		avatar_url?: string | null;
		html_url?: string | null;
	};

	if (!ghUser || typeof ghUser.id !== 'number' || typeof ghUser.login !== 'string') {
		return redirectWithClearedOAuth(returnTo);
	}

	const now = Date.now();
	const userId = `github:${ghUser.id}`;

	await env.DB.prepare(
		`INSERT INTO users (id, github_id, login, name, avatar_url, profile_url, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(github_id) DO UPDATE SET
		   login = excluded.login,
		   name = excluded.name,
		   avatar_url = excluded.avatar_url,
		   profile_url = excluded.profile_url,
		   updated_at = excluded.updated_at`
	)
		.bind(
			userId,
			ghUser.id,
			ghUser.login,
			ghUser.name ?? null,
			ghUser.avatar_url ?? null,
			ghUser.html_url ?? null,
			now,
			now
		)
		.run();

	const sessionTtlSeconds = clampInt(env.SESSION_TTL_SECONDS, 300, 365 * 24 * 3600, 30 * 24 * 3600);
	const sessionToken = randomBase64Url(32);
	const expiresAt = now + sessionTtlSeconds * 1000;

	await env.DB.prepare(
		`INSERT INTO sessions (id, user_id, created_at, expires_at, ip, user_agent)
		 VALUES (?, ?, ?, ?, ?, ?)`
	)
		.bind(
			sessionToken,
			userId,
			now,
			expiresAt,
			clientIp(request),
			(request.headers.get('user-agent') ?? '').slice(0, 256)
		)
		.run();

	const redirectTo = `${FRONTEND_URL}/#token=${encodeURIComponent(sessionToken)}`;
	const headers = new Headers({ location: redirectTo, 'cache-control': 'no-store' });
	headers.append('set-cookie', clearCookie(STATE_COOKIE));
	headers.append('set-cookie', clearCookie(VERIFIER_COOKIE));
	headers.append('set-cookie', clearCookie(RETURN_TO_COOKIE));

	return new Response(null, { status: 302, headers });
}

async function handleMe(request: Request, env: Env): Promise<Response> {
	const token = bearerToken(request);
	if (!token) {
		return json({ error: 'Unauthorized' }, 401);
	}

	const row = await findSessionUser(env, token);
	if (!row) {
		return json({ error: 'Unauthorized' }, 401);
	}

	return json({
		user: {
			id: row.user_id,
			login: row.login,
			name: row.name,
			avatarUrl: row.avatar_url,
			profileUrl: row.profile_url,
		},
	});
}

async function handleLogout(request: Request, env: Env): Promise<Response> {
	const token = bearerToken(request);
	if (!token) {
		return json({ error: 'Unauthorized' }, 401);
	}

	await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(token).run();
	return json({ ok: true }, 200);
}

async function handleEmailSend(request: Request, env: Env): Promise<Response> {
	// Get client IP
	const ip = getClientIp(request);

	// Check IP rate limit (5 requests per minute)
	const ipKey = `rate_limit:ip:${ip}`;
	const ipCount = await env.RATE_LIMIT_KV.get(ipKey);
	if (ipCount && parseInt(ipCount) >= 5) {
		return json({ error: 'Too many requests' }, 429);
	}

	if (!env.RESEND_API_KEY) {
		return json({ error: 'Email service is not configured' }, 500);
	}

	let payload: { email?: unknown; turnstileToken?: unknown };
	try {
		payload = (await request.json()) as { email?: unknown; turnstileToken?: unknown };
	} catch {
		return json({ error: 'Invalid JSON' }, 400);
	}

	const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
	const turnstileToken = typeof payload.turnstileToken === 'string' ? payload.turnstileToken : '';

	// Basic email validation
	if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return json({ error: 'Invalid email address' }, 400);
	}

	// Verify Turnstile if configured
	if (env.TURNSTILE_SECRET_KEY) {
		if (!turnstileToken) {
			return json({ error: 'Captcha required' }, 400);
		}
		const turnstileValid = await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET_KEY, ip);
		if (!turnstileValid) {
			return json({ error: 'Invalid captcha' }, 400);
		}
	}

	// Check email rate limit (1 request per 60 seconds)
	const emailKey = `rate_limit:email:${email}`;
	const lastSent = await env.RATE_LIMIT_KV.get(emailKey);
	if (lastSent) {
		return json({ ok: true, message: 'Login email already sent, please check your inbox' });
	}

	// Check if there's an existing unused token for this email (within 15 minutes)
	const existingToken = await env.DB.prepare(
		`SELECT token FROM email_logins WHERE email = ? AND used = 0 AND expires_at > ? LIMIT 1`
	)
		.bind(email, Date.now())
		.first<{ token: string }>();

	let token: string;
	let tokenId: string;

	if (existingToken) {
		// Reuse existing token
		token = existingToken.token;
		tokenId = '';
	} else {
		// Generate new token
		token = randomBase64Url(32);
		tokenId = `em_${randomBase64Url(12)}`;
		const now = Date.now();
		const expiresAt = now + 15 * 60 * 1000;

		// Store token in database
		await env.DB.prepare(
			`INSERT INTO email_logins (id, email, token, expires_at, used, created_at)
			 VALUES (?, ?, ?, ?, 0, ?)`
		)
			.bind(tokenId, email, token, expiresAt, now)
			.run();
	}

	// Build login URL
	const baseUrl = env.BASE_URL || 'https://api.danarnoux.com';
	const loginUrl = `${baseUrl}/api/auth/email/verify?token=${encodeURIComponent(token)}`;

	// Send email
	const htmlEmail = buildLoginEmailHtml(loginUrl, email);

	try {
		const { Resend } = await import('resend');
		const resend = new Resend(env.RESEND_API_KEY);

		await resend.emails.send({
			from: 'Dan\'s Blog Login <login@mail.danarnoux.com>',
			to: [email],
			subject: '🔐 Sign in to Dan\'s Blog',
			html: htmlEmail,
		});
	} catch (error) {
		console.error('Failed to send email:', error);
		return json({ error: 'Failed to send email' }, 500);
	}

	// Set rate limit keys with TTL
	const currentCount = ipCount ? parseInt(ipCount) : 0;
	await env.RATE_LIMIT_KV.put(ipKey, String(currentCount + 1), { expirationTtl: 60 });
	await env.RATE_LIMIT_KV.put(emailKey, '1', { expirationTtl: 60 });

	// Random delay to prevent abuse (300-800ms)
	await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 500));

	return json({ ok: true, message: 'Login email sent' });
}

async function verifyTurnstile(token: string, secret: string, remoteIp?: string): Promise<boolean> {
	try {
		const formData = new FormData();
		formData.append('response', token);
		formData.append('secret', secret);
		if (remoteIp) {
			formData.append('remoteip', remoteIp);
		}

		const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
			method: 'POST',
			body: formData,
		});

		const outcome = (await result.json()) as { success: boolean };
		return outcome.success === true;
	} catch (error) {
		console.error('Turnstile verification failed:', error);
		return false;
	}
}

function getClientIp(request: Request): string {
	const forwarded = request.headers.get('CF-Connecting-IP');
	if (forwarded) return forwarded.split(',')[0].trim();

	const realIp = request.headers.get('X-Real-IP');
	if (realIp) return realIp;

	return 'unknown';
}

function buildLoginEmailHtml(loginUrl: string, email: string): string {
	return `
<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
	<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f4f4f5; padding: 48px 20px;">
		<tr>
			<td align="center">
				<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 420px; background-color: #ffffff; border-radius: 8px; border: 1px solid #e4e4e7;">
					<!-- Header -->
					<tr>
						<td style="padding: 24px 24px 0; text-align: center;">
							<h1 style="margin: 0; font-size: 20px; font-weight: 600; color: #18181b;">Dan's Blog</h1>
						</td>
					</tr>
					<!-- Content -->
					<tr>
						<td style="padding: 24px 24px 20px; text-align: center;">
							<p style="margin: 0 0 16px; font-size: 14px; color: #52525b; line-height: 1.5;">
								Click to sign in:
							</p>
							<!-- CTA Button -->
							<div style="padding: 0 0 16px;">
								<a href="${loginUrl}" style="display: inline-block; padding: 10px 20px; font-size: 14px; font-weight: 500; color: #ffffff; background-color: #18181b; text-decoration: none; border-radius: 6px;">Sign in</a>
							</div>
							<!-- Email info -->
							<p style="margin: 0; font-size: 13px; color: #71717a;">
								Sign in with: ${email}
							</p>
						</td>
					</tr>
					<!-- Footer -->
					<tr>
						<td style="padding: 16px 24px; background-color: #fafafa; border-top: 1px solid #e4e4e7; border-radius: 0 0 8px 8px;">
							<p style="margin: 0; font-size: 12px; color: #a1a1aa; text-align: center;">
								Link expires in 15 minutes
							</p>
						</td>
					</tr>
				</table>
				<p style="margin: 20px 0 0; font-size: 11px; color: #a1a1aa; text-align: center;">
					Ignore if you didn't request this
				</p>
			</td>
		</tr>
	</table>
</body>
</html>
	`;
}

async function handleEmailVerify(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const token = request.method === 'POST'
		? await readEmailVerifyTokenFromPost(request)
		: url.searchParams.get('token') ?? '';

	if (!token) {
		return json({ error: 'Missing token' }, 400);
	}

	// Find the token in database
	const row = await env.DB.prepare(
		`SELECT id, email, expires_at, used FROM email_logins WHERE token = ? LIMIT 1`
	)
		.bind(token)
		.first<{ id: string; email: string; expires_at: number; used: number }>();

	if (!row) {
		return emailVerifyMessagePage('Invalid token.', 400);
	}

	if (row.used) {
		return emailVerifyMessagePage('This login link has already been used.', 400);
	}

	if (Number(row.expires_at) <= Date.now()) {
		return emailVerifyMessagePage('This login link has expired.', 400);
	}

	if (request.method === 'GET') {
		return emailVerifyConfirmPage(token);
	}

	const consumeResult = await env.DB.prepare(
		`UPDATE email_logins
		 SET used = 1
		 WHERE token = ? AND used = 0 AND expires_at > ?`
	)
		.bind(token, Date.now())
		.run();

	const consumed = Number(consumeResult.meta?.changes ?? 0) === 1;

	if (!consumed) {
		const latestRow = await env.DB.prepare(
			`SELECT id, email, expires_at, used FROM email_logins WHERE token = ? LIMIT 1`
		)
			.bind(token)
			.first<{ id: string; email: string; expires_at: number; used: number }>();

		if (!latestRow) {
			return emailVerifyMessagePage('Link invalid.', 400);
		}

		if (latestRow.used) {
			return emailVerifyMessagePage('Link already used.', 400);
		}

		if (Number(latestRow.expires_at) <= Date.now()) {
			return emailVerifyMessagePage('Link expired.', 400);
		}

		return emailVerifyMessagePage('Sign in failed.', 400);
	}

	// Find or create user
	const email = row.email;
	const now = Date.now();
	const generatedUserId = `email:${email}`;

	// Email logins use their own account namespace and do not merge into GitHub users.
	const existingUser = await env.DB.prepare('SELECT id FROM users WHERE id = ? LIMIT 1')
		.bind(generatedUserId)
		.first<{ id: string }>();

	const existingEmailOwner = await env.DB.prepare('SELECT id FROM users WHERE email = ? LIMIT 1')
		.bind(email)
		.first<{ id: string }>();

	const userId = existingUser?.id ?? generatedUserId;

	if (!existingUser) {
		if (existingEmailOwner && existingEmailOwner.id !== generatedUserId && !existingEmailOwner.id.startsWith('email:')) {
			await env.DB.prepare(
				`UPDATE users SET email = NULL, email_verified = 0, updated_at = ? WHERE id = ?`
			)
				.bind(now, existingEmailOwner.id)
				.run();
		}

		const login = email.split('@')[0];
		const syntheticGithubId = syntheticGithubIdForKey(`email:${email}`);
		await env.DB.prepare(
			`INSERT INTO users (id, github_id, login, name, email, email_verified, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
		)
			.bind(generatedUserId, syntheticGithubId, login, null, email, now, now)
			.run();
	} else {
		await env.DB.prepare(
			`UPDATE users SET email = ?, email_verified = 1, updated_at = ? WHERE id = ?`
		)
			.bind(email, now, userId)
			.run();
	}

	// Create session
	const sessionTtlSeconds = clampInt(env.SESSION_TTL_SECONDS, 300, 365 * 24 * 3600, 30 * 24 * 3600);
	const sessionToken = randomBase64Url(32);
	const expiresAt = now + sessionTtlSeconds * 1000;

	await env.DB.prepare(
		`INSERT INTO sessions (id, user_id, created_at, expires_at, ip, user_agent)
		 VALUES (?, ?, ?, ?, ?, ?)`
	)
		.bind(sessionToken, userId, now, expiresAt, clientIp(request), (request.headers.get('user-agent') ?? '').slice(0, 256))
		.run();

	// Redirect to frontend with token
	const redirectTo = `${FRONTEND_URL}/#token=${encodeURIComponent(sessionToken)}`;
	return new Response(null, { status: 302, headers: { location: redirectTo, 'cache-control': 'no-store' } });
}

async function handleMeUpdate(request: Request, env: Env): Promise<Response> {
	const token = bearerToken(request);
	if (!token) {
		return json({ error: 'Unauthorized' }, 401);
	}

	const session = await findSessionUser(env, token);
	if (!session) {
		return json({ error: 'Unauthorized' }, 401);
	}

	if (!request.headers.get('content-type')?.includes('application/json')) {
		return json({ error: 'Content-Type must be application/json' }, 415);
	}

	let payload: { avatarUrl?: unknown; username?: unknown };
	try {
		payload = (await request.json()) as { avatarUrl?: unknown; username?: unknown };
	} catch {
		return json({ error: 'Invalid JSON' }, 400);
	}

	const avatarUrl = normalizeAvatarUrl(payload.avatarUrl);
	if (payload.avatarUrl !== undefined && avatarUrl === null) {
		return json({ error: 'Invalid avatar URL' }, 400);
	}

	// Handle username update with AI moderation
	let newName = session.name;
	let shouldUpdateName = false;
	if (payload.username !== undefined) {
		const usernameStr = typeof payload.username === 'string' ? payload.username.trim() : '';
		if (!usernameStr) {
			return json({ error: 'Username cannot be empty' }, 400);
		}
		if (usernameStr.length < 2 || usernameStr.length > 30) {
			return json({ error: 'Username must be 2-30 characters' }, 400);
		}

		// Moderate username with AI (uses more lenient username-specific moderation)
		const modResult = await moderateUsername(usernameStr, env);
		if (modResult.result === 'REJECT') {
			return json({ error: 'Username rejected by moderation. Please choose a different name.' }, 400);
		}

		newName = usernameStr;
		shouldUpdateName = true;
	}

	// Only update avatar if explicitly provided and valid
	if (payload.avatarUrl !== undefined) {
		if (avatarUrl === null) {
			return json({ error: 'Invalid avatar URL' }, 400);
		}
		await env.DB.prepare(
			`UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?`
		)
			.bind(avatarUrl, Date.now(), session.user_id)
			.run();
	}

	// Only update name if explicitly provided
	if (shouldUpdateName) {
		await env.DB.prepare(
			`UPDATE users SET name = ?, updated_at = ? WHERE id = ?`
		)
			.bind(newName, Date.now(), session.user_id)
			.run();
	}

	const updated = await env.DB.prepare(
		`SELECT id, login, name, avatar_url, profile_url FROM users WHERE id = ? LIMIT 1`
	)
		.bind(session.user_id)
		.first<{
			id: string;
			login: string;
			name: string | null;
			avatar_url: string | null;
			profile_url: string | null;
		}>();

	if (!updated) {
		return json({ error: 'User not found' }, 404);
	}

	return json({
		user: {
			id: updated.id,
			login: updated.login,
			name: updated.name,
			avatarUrl: updated.avatar_url,
			profileUrl: updated.profile_url,
		},
	});
}

async function readEmailVerifyTokenFromPost(request: Request): Promise<string> {
	const contentType = request.headers.get('content-type') ?? '';

	if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
		const form = await request.formData();
		const token = form.get('token');
		return typeof token === 'string' ? token : '';
	}

	if (contentType.includes('application/json')) {
		try {
			const payload = (await request.json()) as { token?: unknown };
			return typeof payload.token === 'string' ? payload.token : '';
		} catch {
			return '';
		}
	}

	try {
		const body = await request.text();
		const params = new URLSearchParams(body);
		return params.get('token') ?? '';
	} catch {
		return '';
	}
}

function emailVerifyConfirmPage(token: string): Response {
	const html = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Confirm Sign In</title>
</head>
<body style="margin:0;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:radial-gradient(circle at top,#fafaf9 0,#f4f4f5 42%,#ededed 100%);color:#18181b;">
	<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;">
		<div style="position:relative;width:100%;max-width:460px;background:rgba(255,255,255,0.92);border:1px solid #e4e4e7;border-radius:20px;padding:32px;box-sizing:border-box;box-shadow:0 24px 80px rgba(24,24,27,0.08);backdrop-filter:blur(10px);">
			<div style="display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid #e4e4e7;border-radius:999px;background:#fafafa;color:#52525b;font-size:12px;font-weight:600;letter-spacing:0.02em;">Dan's Blog</div>
			<h1 style="margin:18px 0 10px;font-size:30px;line-height:1.1;letter-spacing:-0.03em;">Finish sign in.</h1>
			<p style="margin:0 0 22px;line-height:1.7;color:#52525b;font-size:15px;">One more step. Then you're in.</p>
			<div style="margin:0 0 20px;padding:14px 16px;border-radius:14px;background:#fafafa;border:1px solid #e4e4e7;">
				<div style="font-size:12px;font-weight:600;letter-spacing:0.03em;text-transform:uppercase;color:#71717a;">Secure Sign In</div>
				<div style="margin-top:8px;font-size:14px;line-height:1.6;color:#3f3f46;">Press the button to continue to <span style="font-weight:600;color:#18181b;">danarnoux.com</span>.</div>
			</div>
			<form method="post" action="/api/auth/email/verify" style="margin:0;">
				<input type="hidden" name="token" value="${escapeHtml(token)}">
				<button type="submit" style="width:100%;border:0;border-radius:12px;background:#18181b;color:#fff;padding:14px 18px;font-size:14px;font-weight:600;letter-spacing:0.01em;cursor:pointer;box-shadow:0 12px 28px rgba(24,24,27,0.18);">Sign in to Dan's Blog</button>
			</form>
			<p style="margin:16px 0 0;color:#71717a;font-size:12px;line-height:1.5;">This helps block automatic email scans.</p>
			<a href="${FRONTEND_URL}" style="display:inline-block;margin-top:14px;color:#52525b;font-size:13px;text-decoration:none;">Back to homepage</a>
		</div>
	</div>
</body>
</html>`;

	return new Response(html, {
		status: 200,
		headers: {
			'content-type': 'text/html; charset=utf-8',
			'cache-control': 'no-store',
		},
	});
}

function emailVerifyMessagePage(message: string, status: number): Response {
	const html = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Email Sign In</title>
</head>
<body style="margin:0;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:linear-gradient(180deg,#fafafa 0,#f4f4f5 100%);color:#18181b;">
	<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;">
		<div style="width:100%;max-width:460px;background:#fff;border:1px solid #e4e4e7;border-radius:20px;padding:32px;box-sizing:border-box;text-align:center;box-shadow:0 24px 80px rgba(24,24,27,0.08);">
			<div style="display:inline-flex;width:52px;height:52px;align-items:center;justify-content:center;border-radius:999px;background:#18181b;color:#fff;font-size:22px;font-weight:700;">i</div>
			<h1 style="margin:18px 0 10px;font-size:30px;line-height:1.1;letter-spacing:-0.03em;">Can't sign in.</h1>
			<p style="margin:0 0 22px;line-height:1.7;color:#52525b;font-size:15px;">${escapeHtml(message)}</p>
			<a href="${FRONTEND_URL}" style="display:inline-block;border-radius:12px;background:#18181b;color:#fff;padding:14px 18px;font-size:14px;font-weight:600;text-decoration:none;box-shadow:0 12px 28px rgba(24,24,27,0.18);">Return to homepage</a>
		</div>
	</div>
</body>
</html>`;

	return new Response(html, {
		status,
		headers: {
			'content-type': 'text/html; charset=utf-8',
			'cache-control': 'no-store',
		},
	});
}

// ============================================
// Content Moderation System
// ============================================

import { ruleFilter, ModerationResult } from './moderation-rules';

// Hash content for cache key
async function hashContent(content: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(content);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Layer 2: Cache check
async function checkCache(contentHash: string, env: Env): Promise<ModerationResult | null> {
	const cached = await env.MODERATION_KV.get(`mod:${contentHash}`);
	if (cached) {
		return cached as ModerationResult;
	}
	return null;
}

// Layer 2: Cache result
async function cacheResult(contentHash: string, result: ModerationResult, env: Env): Promise<void> {
	// Cache for 24 hours
	await env.MODERATION_KV.put(`mod:${contentHash}`, result, { expirationTtl: 86400 });
}

// Layer 3: AI moderation
async function callAI(content: string, env: Env): Promise<ModerationResult> {
	try {
		const result = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
			messages: [
				{
					role: 'system',
					content: `You are a content quality moderator for a personal blog. Evaluate the user message and respond with EXACTLY one word: ALLOW or REJECT.

ALLOW: All normal, friendly communication is allowed:
- Questions of any kind (technical, casual, curious)
- Positive feedback, praise, appreciation (even short phrases like "great post!", "谢谢", "很棒")
- Thoughtful comments, opinions, discussions
- Technical feedback, suggestions
- Short acknowledgments like "thanks", "赞", "好评"
- Normal English comments without harmful intent

REJECT: Reject any content containing:
- English vulgar abbreviations: "rm", "kys", "stfu", "f**k", "s**t", "bitch", "damn", "ass", "dick", "pussy", "fag", "nigger" etc. (even in lowercase or with symbols)
- Any form of harassment, insults, or verbal abuse (English or Chinese)
- Profanity or cursing words
- Implicit threats or hostile language
- Spam or advertisements

IMPORTANT: Even if a comment seems positive overall, if it contains English vulgar abbreviations or harassment words, REJECT it. "Good article! rm yourself!" should be REJECTED because of "rm".`,
				},
				{
					role: 'user',
					content: `Message to check:\n${content}`,
				},
			],
		});

		const response = (result as { response: string }).response;
		const text = (response || '').trim().toUpperCase();

		console.log('AI raw response:', response);
		console.log('AI parsed text:', text);

		if (text === 'ALLOW' || text === 'REJECT') {
			return text;
		}
		if (text.includes('ALLOW')) return 'ALLOW';
		if (text.includes('REJECT')) return 'REJECT';

		// Unexpected response = allow by default
		console.log('AI response unexpected, defaulting to ALLOW');
		return 'ALLOW';
	} catch (error) {
		console.error('AI moderation failed:', error);
		return 'ALLOW'; // Allow on error
	}
}

// Main moderation function
async function moderateContent(
	content: string,
	env: Env
): Promise<{ result: ModerationResult; reason?: string; cached?: boolean }> {
	// Layer 1: Rule-based filtering
	const ruleResult = ruleFilter(content);
	console.log('Moderation RuleFilter result:', ruleResult);
	if (ruleResult.result !== 'ALLOW') {
		return ruleResult;
	}

	// Layer 2: Cache check
	const contentHash = await hashContent(content);
	console.log('Moderation cache check for hash:', contentHash.slice(0, 16));
	const cachedResult = await checkCache(contentHash, env);
	if (cachedResult) {
		console.log('Moderation cache HIT, returning:', cachedResult);
		return { result: cachedResult, cached: true };
	}

	// Layer 3: AI moderation
	console.log('Moderation calling AI...');
	const aiResult = await callAI(content, env);
	console.log('Moderation AI result:', aiResult);

	// Cache the result
	await cacheResult(contentHash, aiResult, env);

	return { result: aiResult };
}

// Username moderation - more lenient for simple names
async function callAIForUsername(username: string, env: Env): Promise<ModerationResult> {
	try {
		const result = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
			messages: [
				{
					role: 'system',
					content: `You are a username quality moderator for a personal blog. Evaluate the username and respond with EXACTLY one word: ALLOW or REJECT.

ALLOW: Any normal, acceptable username including:
- Simple names like "John", "Mike", "dandan", "小明", "测试"
- English or Chinese names
- Nicknames and aliases
- Any name that is not explicitly offensive

REJECT: Only reject usernames that are:
- Obviously offensive or vulgar ( slurs, curses)
- Spam or advertisement ( "buy now", "free money")
- Extremely long or nonsensical strings

IMPORTANT: Be very permissive with usernames. Short names like "dan", "test", "dandan" should be ALLOWED. Only reject clearly offensive content.`,
				},
				{
					role: 'user',
					content: `Username to check:\n${username}`,
				},
			],
		});

		const response = (result as { response: string }).response;
		const text = (response || '').trim().toUpperCase();

		console.log('Username AI raw response:', response);
		console.log('Username AI parsed text:', text);

		if (text === 'ALLOW' || text === 'REJECT') return text;
		if (text.includes('ALLOW')) return 'ALLOW';
		if (text.includes('REJECT')) return 'REJECT';

		return 'ALLOW'; // Default to allow for username
	} catch (error) {
		console.error('Username AI moderation failed:', error);
		return 'ALLOW'; // Fail open for username
	}
}

async function moderateUsername(
	username: string,
	env: Env
): Promise<{ result: ModerationResult; reason?: string }> {
	const ruleResult = ruleFilter(username);
	if (ruleResult.result !== 'ALLOW') {
		return ruleResult;
	}

	const aiResult = await callAIForUsername(username, env);
	return { result: aiResult };
}

// ============================================
// Contact Handler
// ============================================

async function handleContact(request: Request, env: Env): Promise<Response> {
	const ip = getClientIp(request);

	// Rate limit: 3 messages per minute per IP
	const ipKey = `rate_limit:contact:ip:${ip}`;
	const ipCount = await env.RATE_LIMIT_KV.get(ipKey);
	if (ipCount && parseInt(ipCount) >= 3) {
		return json({ error: 'Too many requests, please try again later' }, 429);
	}

	if (!env.RESEND_API_KEY) {
		return json({ error: 'Contact form is not configured' }, 500);
	}

	let payload: { name?: unknown; email?: unknown; message?: unknown; turnstileToken?: unknown };
	try {
		payload = (await request.json()) as { name?: unknown; email?: unknown; message?: unknown; turnstileToken?: unknown };
	} catch {
		return json({ error: 'Invalid JSON' }, 400);
	}

	const name = typeof payload.name === 'string' ? payload.name.trim().slice(0, 100) : '';
	const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
	const message = typeof payload.message === 'string' ? payload.message.trim().slice(0, 2000) : '';
	const turnstileToken = typeof payload.turnstileToken === 'string' ? payload.turnstileToken : '';

	// Validation
	if (!name || !email || !message) {
		return json({ error: 'Name, email and message are required' }, 400);
	}

	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return json({ error: 'Invalid email address' }, 400);
	}

	if (message.length < 10) {
		return json({ error: 'Message is too short' }, 400);
	}

	// Verify Turnstile
	if (env.TURNSTILE_SECRET_KEY) {
		if (!turnstileToken) {
			return json({ error: 'Captcha required' }, 400);
		}
		const turnstileValid = await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET_KEY, ip);
		if (!turnstileValid) {
			return json({ error: 'Invalid captcha' }, 400);
		}
	}

	// Moderate content
	const fullContent = `${name} ${email} ${message}`;
	const modResult = await moderateContent(fullContent, env);

	// If rejected, block the message
	if (modResult.result === 'REJECT') {
		console.log('Message rejected by moderation:', modResult.reason);
		return json({ error: 'Message rejected' }, 400);
	}

	// Send email to owner
	try {
		const { Resend } = await import('resend');
		const resend = new Resend(env.RESEND_API_KEY);

		const htmlContent = `
<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
	<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f4f4f5; padding: 48px 20px;">
		<tr>
			<td align="center">
				<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 420px; background-color: #ffffff; border-radius: 8px; border: 1px solid #e4e4e7;">
					<!-- Header -->
					<tr>
						<td style="padding: 24px 24px 0; text-align: center;">
							<h1 style="margin: 0; font-size: 20px; font-weight: 600; color: #18181b;">Dan's Blog</h1>
						</td>
					</tr>
					<!-- Content -->
					<tr>
						<td style="padding: 24px 24px 20px; text-align: center;">
							<p style="margin: 0 0 16px; font-size: 14px; color: #52525b; line-height: 1.5;">
								You received a new message:
							</p>
							<!-- Message preview -->
							<div style="background-color: #f4f4f5; border-radius: 8px; padding: 16px; margin-bottom: 16px; text-align: left;">
								<p style="margin: 0 0 8px; font-size: 13px; color: #71717a;">
									<strong>From:</strong> ${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;
								</p>
								<p style="margin: 0; font-size: 14px; color: #18181b; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(message)}</p>
							</div>
							<p style="margin: 0; font-size: 13px; color: #71717a;">
								Reply directly to this email to respond to ${escapeHtml(name)}.
							</p>
						</td>
					</tr>
					<!-- Footer -->
					<tr>
						<td style="padding: 16px 24px; background-color: #fafafa; border-top: 1px solid #e4e4e7; border-radius: 0 0 8px 8px;">
							<p style="margin: 0; font-size: 12px; color: #a1a1aa; text-align: center;">
								Sent from contact form
							</p>
						</td>
					</tr>
				</table>
				<p style="margin: 20px 0 0; font-size: 11px; color: #a1a1aa; text-align: center;">
					${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
				</p>
			</td>
		</tr>
	</table>
</body>
</html>`;

		await resend.emails.send({
			from: 'DAN ARNOUX <contact@mail.danarnoux.com>',
			to: ['DanArnoux@outlook.com'],
			replyTo: email,
			subject: `📬 ${name} sent you a message`,
			html: htmlContent,
		});
	} catch (error) {
		console.error('Failed to send contact email:', error);
		return json({ error: 'Failed to send message' }, 500);
	}

	// Update rate limit
	const currentCount = ipCount ? parseInt(ipCount) : 0;
	await env.RATE_LIMIT_KV.put(ipKey, String(currentCount + 1), { expirationTtl: 60 });

	return json({ ok: true, message: 'Message sent successfully' });
}

// Development-only mock login (only works in local dev)
async function handleDevLogin(request: Request, env: Env): Promise<Response> {
	// Development only - skip check since wrangler dev is local only
	// In production, this endpoint won't be exposed anyway

	let payload: { login?: unknown; name?: unknown };
	try {
		payload = (await request.json()) as { login?: unknown; name?: unknown };
	} catch {
		return json({ error: 'Invalid JSON' }, 400);
	}

	const login = typeof payload.login === 'string' ? payload.login.trim() : 'dev_user';
	const name = typeof payload.name === 'string' ? payload.name.trim() : 'Dev User';

	// Create or get dev user
	const userId = `dev:${login}`;
	const now = Date.now();
	const syntheticGithubId = syntheticGithubIdForKey(userId);

	await env.DB.prepare(
		`INSERT INTO users (id, github_id, login, name, avatar_url, profile_url, created_at, updated_at)
		 VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET name = ?, updated_at = ?`
	)
		.bind(userId, syntheticGithubId, login, name, now, now, name, now)
		.run();

	// Create session
	const sessionToken = randomBase64Url(32);
	const sessionTtlSeconds = 30 * 24 * 3600;
	const expiresAt = now + sessionTtlSeconds * 1000;

	await env.DB.prepare(
		`INSERT INTO sessions (id, user_id, created_at, expires_at, ip, user_agent)
		 VALUES (?, ?, ?, ?, ?, ?)`
	)
		.bind(sessionToken, userId, now, expiresAt, '127.0.0.1', 'dev')
		.run();

	return json({ ok: true, token: sessionToken });
}

async function handleCommentsGet(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const post = normalizePostSlug(url.searchParams.get('post_id'));
	if (!post) {
		return json({ error: 'Invalid post slug' }, 400);
	}

	const result = await env.DB.prepare(
		`SELECT
		 c.id AS id,
		 c.parent_id AS parent_id,
		 c.post_slug AS post_slug,
		 c.body AS body,
		 c.status AS status,
		 c.created_at AS created_at,
		 u.id AS user_id,
		 u.login AS user_login,
		 u.name AS user_name,
		 u.avatar_url AS user_avatar_url,
		 u.profile_url AS user_profile_url
		 FROM comments c
		 JOIN users u ON u.id = c.user_id
		 WHERE c.post_slug = ? AND c.status = 'approved'
		 ORDER BY c.created_at ASC`
	)
		.bind(post)
		.all<{
			id: string;
			parent_id: string | null;
			post_slug: string;
			body: string;
			status: string;
			created_at: number;
			user_id: string;
			user_login: string;
			user_name: string | null;
			user_avatar_url: string | null;
			user_profile_url: string | null;
		}>();

	// Build nested comment structure
	const commentMap = new Map<string, any>();
	const rootComments: any[] = [];

	// First pass: create all comment objects
	for (const row of result.results ?? []) {
		const comment = {
			id: row.id,
			parentId: row.parent_id,
			postSlug: row.post_slug,
			body: row.body,
			status: row.status,
			createdAt: row.created_at,
			replies: [],
			user: {
				id: row.user_id,
				login: row.user_login,
				name: row.user_name,
				avatarUrl: row.user_avatar_url,
				profileUrl: row.user_profile_url,
			},
		};
		commentMap.set(row.id, comment);
	}

	// Second pass: organize into tree structure
	for (const comment of commentMap.values()) {
		if (comment.parentId && commentMap.has(comment.parentId)) {
			commentMap.get(comment.parentId).replies.push(comment);
		} else {
			rootComments.push(comment);
		}
	}

	return json({ comments: rootComments });
}

async function handleViewsGet(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const post = normalizePostSlug(url.searchParams.get('post'));
	if (!post) {
		return json({ error: 'Invalid post slug' }, 400);
	}

	const row = await env.DB.prepare('SELECT post_slug, views FROM post_views WHERE post_slug = ? LIMIT 1')
		.bind(post)
		.first<PostViewsRow>();

	return json({
		post,
		views: Number(row?.views ?? 0),
	});
}

async function handleViewsPost(request: Request, env: Env): Promise<Response> {
	const rate = await checkRateLimit(request, env, 'post_views');
	if (rate) return rate;

	if (!request.headers.get('content-type')?.includes('application/json')) {
		return json({ error: 'Content-Type must be application/json' }, 415);
	}

	let payload: { post?: unknown };
	try {
		payload = (await request.json()) as { post?: unknown };
	} catch {
		return json({ error: 'Invalid JSON' }, 400);
	}

	const post = normalizePostSlug(payload.post);
	if (!post) {
		return json({ error: 'Invalid post slug' }, 400);
	}

	const now = Date.now();
	await env.DB.prepare(
		`INSERT INTO post_views (post_slug, views, created_at, updated_at)
		 VALUES (?, 1, ?, ?)
		 ON CONFLICT(post_slug) DO UPDATE SET
		 	views = post_views.views + 1,
		 	updated_at = excluded.updated_at`
	)
		.bind(post, now, now)
		.run();

	const row = await env.DB.prepare('SELECT post_slug, views FROM post_views WHERE post_slug = ? LIMIT 1')
		.bind(post)
		.first<PostViewsRow>();

	return json({
		post,
		views: Number(row?.views ?? 0),
		incremented: true,
	});
}

async function handleCommentsPost(request: Request, env: Env): Promise<Response> {
	console.log('handleCommentsPost called, url:', request.url);
	const rate = await checkRateLimit(request, env, 'comment_post');
	if (rate) return rate;

	const authHeader = request.headers.get('authorization') || 'NONE';
	console.log('Auth header:', authHeader.substring(0, 50));
	const token = bearerToken(request);
	if (!token) {
		console.log('No token - bearerToken returned null');
		return json({ error: 'Unauthorized', reason: 'no token' }, 401);
	}
	console.log('Token length:', token.length);

	let session;
	try {
		session = await findSessionUser(env, token);
		if (!session) {
			console.log('No session found for token');
			return json({ error: 'Unauthorized', reason: 'invalid session' }, 401);
		}
		console.log('Session found for user:', session.login);
	} catch (e) {
		console.error('Session lookup error:', e);
		return json({ error: 'Unauthorized', reason: 'session error' }, 401);
	}

	if (!request.headers.get('content-type')?.includes('application/json')) {
		return json({ error: 'Content-Type must be application/json' }, 415);
	}

	let payload: { post_id?: unknown; content?: unknown; parent_id?: unknown };
	try {
		payload = (await request.json()) as { post_id?: unknown; content?: unknown; parent_id?: unknown };
	} catch {
		return json({ error: 'Invalid JSON' }, 400);
	}

	console.log('Payload:', JSON.stringify(payload));
	const post = normalizePostSlug(payload.post_id);
	if (!post) {
		console.log('Invalid post slug:', payload.post_id, 'type:', typeof payload.post_id);
		return json({ error: 'Invalid post slug' }, 400);
	}

	const body = typeof payload.content === 'string' ? payload.content.trim() : '';
	console.log('Comment body length:', body.length, 'content:', body.substring(0, 50));
	if (body.length < COMMENT_MIN_LENGTH || body.length > COMMENT_MAX_LENGTH) {
		return json({ error: `Comment length must be ${COMMENT_MIN_LENGTH}-${COMMENT_MAX_LENGTH}` }, 400);
	}
	if (containsHtml(body)) {
		console.log('HTML detected in body');
		return json({ error: 'HTML is not allowed' }, 400);
	}

	// Check daily comment limit (resets at midnight UTC)
	const now = Date.now();
	const midnightUTC = new Date();
	midnightUTC.setUTCHours(24, 0, 0, 0);
	const todayStart = midnightUTC.getTime() - 24 * 60 * 60 * 1000;

	const dailyCountRow = await env.DB.prepare(
		`SELECT COUNT(*) as count FROM comments WHERE user_id = ? AND created_at >= ?`
	)
		.bind(session.user_id, todayStart)
		.first<{ count: number }>();

	if (dailyCountRow && dailyCountRow.count >= COMMENT_DAILY_LIMIT) {
		return json({ error: `Daily comment limit reached (${COMMENT_DAILY_LIMIT}/day). Resets at midnight UTC.` }, 429);
	}

	// Validate parent_id if provided (for replies)
	let parentId: string | null = null;
	if (payload.parent_id) {
		const parentIdStr = typeof payload.parent_id === 'string' ? payload.parent_id.trim() : '';
		if (parentIdStr) {
			// Verify parent comment exists and belongs to the same post
			const parentRow = await env.DB.prepare(
				`SELECT id FROM comments WHERE id = ? AND post_slug = ? LIMIT 1`
			)
				.bind(parentIdStr, post)
				.first<{ id: string }>();
			if (parentRow) {
				parentId = parentIdStr;
			}
		}
	}

	// Moderate content
	const modResult = await moderateContent(body, env);
	if (modResult.result === 'REJECT') {
		return json({ error: 'Comment rejected by moderation' }, 400);
	}

	// Auto-approve comments that pass moderation (user is authenticated via GitHub OAuth)
	const commentId = `c_${randomBase64Url(12)}`;

	await env.DB.prepare(
		`INSERT INTO comments (id, parent_id, post_slug, user_id, body, status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, 'approved', ?, ?)`
	)
		.bind(commentId, parentId, post, session.user_id, body, now, now)
		.run();

	return json(
		{
			comment: {
				id: commentId,
				parentId,
				postSlug: post,
				body,
				status: 'approved',
				createdAt: now,
				user: {
					id: session.user_id,
					login: session.login,
					name: session.name,
					avatarUrl: session.avatar_url,
					profileUrl: session.profile_url,
				},
			},
		},
		201
	);
}

// Image route handler - decides between list and serve based on query params
async function handleImageRoute(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const hasKey = url.searchParams.has('key');
	const hasPrefix = url.searchParams.has('prefix');

	if (hasPrefix) {
		return handleImageList(request, env);
	} else if (hasKey) {
		return handleImageServe(request, env);
	} else {
		// No params - return list by default
		return handleImageList(request, env);
	}
}

// Image serve handler - returns the actual image data
async function handleImageServe(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const key = url.searchParams.get('key');

	if (!key) {
		return json({ error: 'Missing key parameter' }, 400);
	}

	// Sanitize key to prevent path traversal
	const safeKey = key.replace(/[^a-zA-Z0-9\-_./]/g, '');

	try {
		const object = await env.IMAGES.get(safeKey);
		if (!object) {
			return json({ error: 'Image not found' }, 404);
		}

		const headers = new Headers();
		headers.set('Content-Type', object.httpEtag.includes('image') ? 'image/webp' : 'application/octet-stream');
		headers.set('Cache-Control', 'public, max-age=31536000');

		return new Response(object.body, { headers });
	} catch (error) {
		console.error('R2 get error:', error);
		return json({ error: 'Failed to get image' }, 500);
	}
}

// Image list handler - lists images by prefix
async function handleImageList(request: Request, env: Env): Promise<Response> {
	const token = bearerToken(request);
	if (!token) {
		return json({ error: 'Unauthorized' }, 401);
	}

	const session = await findSessionUser(env, token);
	if (!session) {
		return json({ error: 'Unauthorized' }, 401);
	}

	const url = new URL(request.url);
	const prefix = url.searchParams.get('prefix') || '';
	const cursor = url.searchParams.get('cursor') || undefined;
	const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 1000);

	// Sanitize prefix - only allow safe characters
	const safePrefix = prefix.replace(/[^a-zA-Z0-9\-_/]/g, '');

	// Users can only list their own images (prefixed with their user_id)
	const userPrefix = `images/${session.user_id}/`;
	const effectivePrefix = safePrefix ? `${userPrefix}${safePrefix}/` : userPrefix;

	try {
		const result = await env.IMAGES.list({
			prefix: effectivePrefix,
			limit,
			cursor,
			delimiter: '/',
		});

		const images = result.objects.map((obj) => ({
			key: obj.key,
			size: obj.size,
			url: `https://img.danarnoux.com/${obj.key}`,
		}));

		return json({
			images,
			truncated: result.truncated,
			cursor: result.cursor,
		});
	} catch (error) {
		console.error('R2 list error:', error);
		return json({ error: 'Failed to list images' }, 500);
	}
}

async function handleImageUpload(request: Request, env: Env): Promise<Response> {
	const token = bearerToken(request);
	if (!token) {
		return json({ error: 'Unauthorized' }, 401);
	}

	const session = await findSessionUser(env, token);
	if (!session) {
		return json({ error: 'Unauthorized' }, 401);
	}

	const rateLimitRes = await checkRateLimit(request, env, 'image_upload');
	if (rateLimitRes) return rateLimitRes;

	const contentType = request.headers.get('content-type') || '';
	if (!contentType.startsWith('image/')) {
		return json({ error: 'Content-Type must be an image' }, 400);
	}

	const url = new URL(request.url);
	const filename = url.searchParams.get('filename') || 'image';
	const category = url.searchParams.get('category') || 'misc';

	// Validate category
	const validCategories = ['posts', 'avatars', 'misc'];
	const safeCategory = validCategories.includes(category) ? category : 'misc';

	// Generate key: avatars/{user_id}/{filename} or {category}/{filename}
	// Supports overwriting by using provided filename
	const safeFilename = filename.replace(/[^a-zA-Z0-9\-_.]/g, '_').replace(/^\.+/, '') || 'image';
	const safeUserId = session.user_id.replace(':', '_');
	const key = safeCategory === 'avatars'
		? `avatars/${safeUserId}/${safeFilename}`
		: `${safeCategory}/${safeFilename}`;

	try {
		const arrayBuffer = await request.arrayBuffer();
		await env.IMAGES.put(key, arrayBuffer);

		// Return the full URL using custom domain
		const imageUrl = `https://img.danarnoux.com/${key}`;

		return json({ key, url: imageUrl }, 201);
	} catch (error) {
		console.error('R2 upload error:', error);
		return json({ error: 'Failed to upload image' }, 500);
	}
}

async function handleImageDelete(request: Request, env: Env): Promise<Response> {
	const token = bearerToken(request);
	if (!token) {
		return json({ error: 'Unauthorized' }, 401);
	}

	const session = await findSessionUser(env, token);
	if (!session) {
		return json({ error: 'Unauthorized' }, 401);
	}

	let payload: { key?: unknown };
	try {
		payload = (await request.json()) as { key?: unknown };
	} catch {
		return json({ error: 'Invalid JSON' }, 400);
	}

	const key = typeof payload.key === 'string' ? payload.key : '';
	if (!key) {
		return json({ error: 'Missing key parameter' }, 400);
	}

	// Only allow users to delete their own images
	if (!key.startsWith(`images/${session.user_id}/`)) {
		return json({ error: 'Cannot delete other users\' images' }, 403);
	}

	try {
		await env.IMAGES.delete(key);
		return json({ ok: true });
	} catch (error) {
		console.error('R2 delete error:', error);
		return json({ error: 'Failed to delete image' }, 500);
	}
}

async function findSessionUser(env: Env, token: string): Promise<SessionRow | null> {
	const row = await env.DB.prepare(
		`SELECT
		 s.user_id AS user_id,
		 s.expires_at AS expires_at,
		 u.login AS login,
		 u.name AS name,
		 u.avatar_url AS avatar_url,
		 u.profile_url AS profile_url
		 FROM sessions s
		 JOIN users u ON u.id = s.user_id
		 WHERE s.id = ?
		 LIMIT 1`
	)
		.bind(token)
		.first<SessionRow>();

	if (!row) return null;

	if (Number(row.expires_at) <= Date.now()) {
		await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(token).run();
		return null;
	}

	return row;
}

async function checkRateLimit(request: Request, env: Env, route: string): Promise<Response | null> {
	const ip = clientIp(request);
	const id = env.RATE_LIMITER.idFromName(ip);
	const stub = env.RATE_LIMITER.get(id);

	const res = await stub.fetch('https://rate-limiter.internal/consume', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			ip,
			route,
			limit: RATE_LIMIT_PER_MIN,
			windowMs: RATE_LIMIT_WINDOW_MS,
		}),
	});

	if (res.status !== 429) {
		return null;
	}

	return json({ error: 'Too Many Requests' }, 429, {
		'retry-after': res.headers.get('retry-after') ?? '60',
	});
}

function sanitizeReturnTo(raw: string | null, env: Env): string {
	const fallbackOrigin = firstAllowedOriginFromEnv(env.PUBLIC_ALLOWED_ORIGIN);
	const fallback = fallbackOrigin || '/';
	if (!raw) return fallback;

	if (raw.startsWith('/')) {
		return fallbackOrigin ? new URL(raw, fallbackOrigin).toString() : raw;
	}

	try {
		const url = new URL(raw);
		if (isAllowedExternalOrigin(url.origin, env.PUBLIC_ALLOWED_ORIGIN)) {
			return url.toString();
		}
	} catch {
		return fallback;
	}

	return fallback;
}

function appendTokenFragment(returnTo: string, token: string): string {
	const clean = returnTo.split('#')[0] || '/';
	if (clean.startsWith('http://') || clean.startsWith('https://')) {
		const url = new URL(clean);
		url.hash = `token=${encodeURIComponent(token)}`;
		return url.toString();
	}
	return `${clean}#token=${encodeURIComponent(token)}`;
}

function normalizePostSlug(input: unknown): string | null {
	if (typeof input !== 'string') return null;
	const trimmed = input.trim();
	if (!trimmed || trimmed.length > POST_SLUG_MAX_LENGTH) return null;
	if (!/^[A-Za-z0-9/_-]+$/.test(trimmed)) return null;
	return trimmed;
}

function normalizeAvatarUrl(input: unknown): string | null {
	if (input === null) return null;
	if (typeof input !== 'string') return null;

	const trimmed = input.trim();
	if (!trimmed) return null;
	if (trimmed.length > 1000) return null;

	try {
		const url = new URL(trimmed);
		if (url.protocol !== 'https:' && url.protocol !== 'http:') {
			return null;
		}
		return url.toString();
	} catch {
		return null;
	}
}

function bearerToken(request: Request): string | null {
	const auth = request.headers.get('authorization') ?? '';
	const match = auth.match(/^Bearer\s+([A-Za-z0-9._~-]{20,512})$/i);
	return match ? match[1] : null;
}

function containsHtml(text: string): boolean {
	return /<[^>]*>/.test(text) || text.includes('<') || text.includes('>');
}

function parseCookies(raw: string | null): Map<string, string> {
	const out = new Map<string, string>();
	if (!raw) return out;
	for (const part of raw.split(';')) {
		const i = part.indexOf('=');
		if (i <= 0) continue;
		const k = part.slice(0, i).trim();
		const v = part.slice(i + 1).trim();
		try {
			out.set(k, decodeURIComponent(v));
		} catch {
			out.set(k, v);
		}
	}
	return out;
}

function cookie(name: string, value: string, maxAge: number): string {
	return [
		`${name}=${encodeURIComponent(value)}`,
		'Path=/',
		`Max-Age=${Math.max(0, Math.floor(maxAge))}`,
		'HttpOnly',
		'Secure',
		'SameSite=Lax',
	].join('; ');
}

function clearCookie(name: string): string {
	return cookie(name, '', 0);
}

const FRONTEND_URL = 'https://danarnoux.com';

function redirectWithClearedOAuth(returnTo: string): Response {
	// Always redirect to frontend URL, not API domain
	const location = returnTo.includes('danarnoux.com') ? returnTo : FRONTEND_URL;
	const headers = new Headers({ location, 'cache-control': 'no-store' });
	headers.append('set-cookie', clearCookie(STATE_COOKIE));
	headers.append('set-cookie', clearCookie(VERIFIER_COOKIE));
	headers.append('set-cookie', clearCookie(RETURN_TO_COOKIE));
	return new Response(null, { status: 302, headers });
}

function clientIp(request: Request): string {
	const raw = request.headers.get('CF-Connecting-IP') ?? request.headers.get('x-forwarded-for') ?? 'unknown';
	return raw.split(',')[0]?.trim().slice(0, 80) || 'unknown';
}

function resolveAllowedOrigin(request: Request, env: Env): string | null {
	const origin = request.headers.get('origin');
	if (!origin) return null;
	return isAllowedExternalOrigin(origin, env.PUBLIC_ALLOWED_ORIGIN) ? origin : null;
}

function isAllowedExternalOrigin(origin: string, envAllowList?: string): boolean {
	if (/^https:\/\/[a-z0-9-]+\.pages\.dev$/i.test(origin)) {
		return true;
	}
	const list = (envAllowList ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	return list.includes(origin);
}

function firstAllowedOriginFromEnv(envAllowList?: string): string | null {
	const list = (envAllowList ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	return list[0] ?? null;
}

function withCors(response: Response, origin: string | null): Response {
	if (!origin) return response;
	const headers = new Headers(response.headers);
	headers.set('access-control-allow-origin', origin);
	headers.set('vary', 'Origin');
	headers.set('access-control-allow-headers', 'Authorization, Content-Type');
	headers.set('access-control-allow-methods', 'GET,POST,OPTIONS');
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function json(payload: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': 'no-store',
			...extraHeaders,
		},
	});
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.max(min, Math.min(max, Math.floor(n)));
}

function safeEqual(a: string, b: string): boolean {
	const len = Math.max(a.length, b.length);
	let mismatch = a.length === b.length ? 0 : 1;
	for (let i = 0; i < len; i += 1) {
		mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
	}
	return mismatch === 0;
}

function syntheticGithubIdForKey(key: string): number {
	let hash = 2166136261;
	for (let i = 0; i < key.length; i += 1) {
		hash ^= key.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return -Math.max(1, hash >>> 0);
}

function randomBase64Url(byteLength: number): string {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return toBase64Url(bytes);
}

async function sha256Base64Url(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return toBase64Url(new Uint8Array(digest));
}

function toBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
