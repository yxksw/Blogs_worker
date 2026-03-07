type D1Statement = {
	bind(...values: unknown[]): D1Statement;
	first<T>(): Promise<T | null>;
	all<T>(): Promise<{ results?: T[] }>;
	run(): Promise<unknown>;
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

type ExecutionContext = {
	waitUntil(promise: Promise<unknown>): void;
};

type Env = {
	DB: D1Database;
	IMAGES: R2Bucket;
	RATE_LIMITER: DurableObjectNamespace;
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
	PUBLIC_ALLOWED_ORIGIN?: string;
	SESSION_TTL_SECONDS?: string;
};

type SessionRow = {
	user_id: string;
	login: string;
	name: string | null;
	avatar_url: string | null;
	profile_url: string | null;
	expires_at: number;
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
			switch (`${request.method} ${url.pathname}`) {
				case 'GET /api/auth/github/start':
					response = await handleGithubStart(request, env);
					break;
				case 'GET /api/auth/github/callback':
					response = await handleGithubCallback(request, env);
					break;
				case 'GET /api/me':
					response = await handleMe(request, env);
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

async function handleCommentsGet(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const post = normalizePostSlug(url.searchParams.get('post'));
	if (!post) {
		return json({ error: 'Invalid post slug' }, 400);
	}

	const result = await env.DB.prepare(
		`SELECT
		 c.id AS id,
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

	const comments = (result.results ?? []).map((row) => ({
		id: row.id,
		postSlug: row.post_slug,
		body: row.body,
		status: row.status,
		createdAt: row.created_at,
		user: {
			id: row.user_id,
			login: row.user_login,
			name: row.user_name,
			avatarUrl: row.user_avatar_url,
			profileUrl: row.user_profile_url,
		},
	}));

	return json({ comments });
}

async function handleCommentsPost(request: Request, env: Env): Promise<Response> {
	const rate = await checkRateLimit(request, env, 'comment_post');
	if (rate) return rate;

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

	let payload: { post?: unknown; body?: unknown };
	try {
		payload = (await request.json()) as { post?: unknown; body?: unknown };
	} catch {
		return json({ error: 'Invalid JSON' }, 400);
	}

	const post = normalizePostSlug(payload.post);
	if (!post) {
		return json({ error: 'Invalid post slug' }, 400);
	}

	const body = typeof payload.body === 'string' ? payload.body.trim() : '';
	if (body.length < COMMENT_MIN_LENGTH || body.length > COMMENT_MAX_LENGTH) {
		return json({ error: `Comment length must be ${COMMENT_MIN_LENGTH}-${COMMENT_MAX_LENGTH}` }, 400);
	}
	if (containsHtml(body)) {
		return json({ error: 'HTML is not allowed' }, 400);
	}

	const now = Date.now();
	const commentId = `c_${randomBase64Url(12)}`;

	await env.DB.prepare(
		`INSERT INTO comments (id, post_slug, user_id, body, status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, 'pending', ?, ?)`
	)
		.bind(commentId, post, session.user_id, body, now, now)
		.run();

	return json(
		{
			comment: {
				id: commentId,
				postSlug: post,
				body,
				status: 'pending',
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
