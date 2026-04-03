/**
 * Content Moderation Rules
 * Separate file for easy rule management
 *
 * NOTE: This file only contains technical attack pattern detection.
 * Semantic content (offensive language, political content, spam) is
 * handled by AI moderation. Keep this file free of explicit keyword lists
 * to avoid sensitive content in open source.
 */

export type ModerationResult = 'ALLOW' | 'REVIEW' | 'REJECT';

// ============================================
// Technical Attack Patterns (Rule-based)
// ============================================

// SQL injection - obvious patterns that indicate malicious input
export const SQL_INJECTION_PATTERNS = [
	/(\b(select|union|insert|update|delete|drop|alter|create|truncate)\b)/i,
	/(--|;|'|"|\`|\\|\*|xp_|sp_|exec|execute)/i,
	/(or\s+1\s*=\s*1|and\s+1\s*=\s*1)/i,
];

// XSS patterns - obvious script/injection attempts
export const XSS_PATTERNS = [
	/(<script|javascript:|onerror|onclick|onload|onmouse)/i,
	/(<iframe|<object|<embed|<svg)/i,
	/(alert\s*\(|eval\s*\(|document\.|window\.)/i,
	/(&lt;script|&lt;iframe)/i,
];

// ============================================
// AI Moderation (handled by callAI)
// ============================================
// The AI layer handles:
// - Offensive language / harassment
// - Political sensitive content
// - Advertisements / spam
// - General content quality assessment

// Content length limits (apply to all content)
export const MAX_CONTENT_LENGTH = 5000;
export const MAX_REPEAT_CHARS = 10;

/**
 * Technical attack detection - Layer 1 of moderation
 * Returns ALLOW if content passes all checks
 */
export function ruleFilter(content: string): { result: ModerationResult; reason?: string } {
	// Check for SQL injection
	for (const pattern of SQL_INJECTION_PATTERNS) {
		if (pattern.test(content)) {
			return { result: 'REJECT', reason: 'Invalid input pattern detected' };
		}
	}

	// Check for XSS
	for (const pattern of XSS_PATTERNS) {
		if (pattern.test(content)) {
			return { result: 'REJECT', reason: 'Invalid input pattern detected' };
		}
	}

	// Check for excessive length
	if (content.length > MAX_CONTENT_LENGTH) {
		return { result: 'REJECT', reason: 'Content exceeds maximum length' };
	}

	// Check for repetitive characters (spam indicator)
	if (new RegExp(`(.)\\1{${MAX_REPEAT_CHARS},}`).test(content)) {
		return { result: 'REJECT', reason: 'Invalid content pattern detected' };
	}

	// Content passes technical checks - AI will handle semantic analysis
	return { result: 'ALLOW' };
}
