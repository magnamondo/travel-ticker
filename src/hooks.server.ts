import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import * as auth from '$lib/server/auth';
import { isAdmin } from '$lib/roles';
import { logger } from '$lib/server/logger';
import { env } from '$env/dynamic/private';
import { building } from '$app/environment';

// Validate critical environment variables at startup (skip during build)
/*
if (!building) {
	const errors: string[] = [];

	// ORIGIN is critical for CSRF protection
	if (!env.ORIGIN) {
		errors.push('ORIGIN is required. Set to your domain with protocol (e.g., https://example.com)');
	} else if (env.ORIGIN === 'http://localhost' && env.CADDY_DOMAIN && env.CADDY_DOMAIN !== 'localhost') {
		errors.push(
			`ORIGIN mismatch: ORIGIN is "${env.ORIGIN}" but CADDY_DOMAIN is "${env.CADDY_DOMAIN}". ` +
			`Set ORIGIN to "https://${env.CADDY_DOMAIN}" for production.`
		);
	}

	// DATABASE_URL is validated in db/index.ts but warn here too for clarity
	if (!env.DATABASE_URL) {
		errors.push('DATABASE_URL is required. Set to path of SQLite database file.');
	}

	if (errors.length > 0) {
		logger.error('Environment validation failed:', { errors });
		throw new Error(`Environment validation failed:\n  - ${errors.join('\n  - ')}`);
	}

	logger.info('Environment validation passed', {
		origin: env.ORIGIN,
		caddyDomain: env.CADDY_DOMAIN ?? 'not set',
		hasResendKey: !!env.RESEND_API_KEY
	});
}
*/
const handleAuth: Handle = async ({ event, resolve }) => {
	const sessionToken = event.cookies.get(auth.sessionCookieName);

	if (!sessionToken) {
		event.locals.user = null;
		event.locals.session = null;
	} else {
		const { session, user } = await auth.validateSessionToken(sessionToken);

		if (session) {
			auth.setSessionTokenCookie(event, sessionToken, session.expiresAt);
		} else {
			auth.deleteSessionTokenCookie(event);
		}

		event.locals.user = user;
		event.locals.session = session;
	}

	// Protect admin routes - only allow users with admin role
	if (event.url.pathname.startsWith('/admin')) {
		if (!event.locals.user) {
			throw redirect(303, '/login?redirectTo=' + encodeURIComponent(event.url.pathname));
		}
		if (!isAdmin(event.locals.user.roles)) {
			throw redirect(303, '/');
		}
	}

	return resolve(event);
};

const handleSecurity: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);

	// Content Security Policy
	// Adjust these directives based on your app's needs
	const csp = [
		"default-src 'self'",
		"script-src 'self' 'unsafe-inline'", // unsafe-inline needed for SvelteKit
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"font-src 'self'",
		"connect-src 'self'",
		"media-src 'self' blob:",
		"object-src 'none'",
		"frame-ancestors 'none'",
		"base-uri 'self'",
		"form-action 'self'"
	].join('; ');

	response.headers.set('Content-Security-Policy', csp);
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

	return response;
};

const handleLogging: Handle = async ({ event, resolve }) => {
	const start = Date.now();
	const response = await resolve(event);
	const duration = Date.now() - start;

	// Skip logging for static assets and successful HEAD requests (healthchecks)
	const path = event.url.pathname;
	if (!path.startsWith('/_app/') && !path.startsWith('/favicon') && !(event.request.method === 'HEAD' && response.status === 200)) {
		// Only log 4xx and 5xx errors or slow requests (> 500ms) in production
		const isError = response.status >= 400;
		const isSlow = duration > 500;
		
		if (isError || isSlow || process.env.NODE_ENV !== 'production') {
			logger.request(
				event.request.method,
				path,
				response.status,
				duration,
				{ userId: event.locals.user?.id }
			);
		}
	}

	return response;
};

export const handle: Handle = sequence(handleLogging, handleAuth, handleSecurity);
