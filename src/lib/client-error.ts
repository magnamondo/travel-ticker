/**
 * Client-side error reporting
 * Reports errors to the server for visibility in logs
 * Fire-and-forget - doesn't throw or block
 */

interface ClientErrorReport {
	type: string;           // e.g., 'upload_error', 'api_error', 'fetch_error'
	status?: number;        // HTTP status code if applicable
	url?: string;           // URL that failed
	message?: string;       // Error message
	stack?: string;         // Stack trace if available
	context?: Record<string, unknown>; // Additional context
}

let initialized = false;

/**
 * Report a client-side error to the server
 * Non-blocking, fire-and-forget
 */
export function reportError(error: ClientErrorReport): void {
	// Fire and forget - don't await, don't throw
	fetch('/api/client-error', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			...error,
			userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
			pageUrl: typeof location !== 'undefined' ? location.href : undefined
		})
	}).catch(() => {
		// Silently ignore - we tried our best
	});
}

/**
 * Report a failed HTTP response
 * Convenience wrapper for common case
 */
export function reportHttpError(
	url: string,
	status: number,
	message?: string,
	context?: Record<string, unknown>
): void {
	// Only report 4xx and 5xx errors
	if (status >= 400) {
		reportError({
			type: 'http_error',
			url,
			status,
			message,
			context
		});
	}
}

/**
 * Initialize global error handlers (call once on app startup)
 * Catches uncaught errors and unhandled promise rejections
 */
export function initErrorReporting(): void {
	if (initialized || typeof window === 'undefined') return;
	initialized = true;

	// Catch uncaught errors
	window.addEventListener('error', (event) => {
		// Ignore errors from browser extensions or cross-origin scripts
		if (!event.filename || event.filename.includes('extension://')) return;
		
		reportError({
			type: 'uncaught_error',
			message: event.message,
			stack: event.error?.stack,
			context: {
				filename: event.filename,
				lineno: event.lineno,
				colno: event.colno
			}
		});
	});

	// Catch unhandled promise rejections
	window.addEventListener('unhandledrejection', (event) => {
		const reason = event.reason;
		reportError({
			type: 'unhandled_rejection',
			message: reason?.message || String(reason),
			stack: reason?.stack
		});
	});

	// Monkey-patch fetch to automatically report HTTP errors
	const originalFetch = window.fetch;
	window.fetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		
		try {
			const response = await originalFetch.call(this, input, init);
			
			// Report 4xx/5xx errors (but not to our own error endpoint to avoid loops)
			if (response.status >= 400 && !url.includes('/api/client-error')) {
				reportError({
					type: 'http_error',
					status: response.status,
					url,
					message: response.statusText,
					context: {
						method: init?.method || 'GET'
					}
				});
			}
			
			return response;
		} catch (err) {
			// Report network errors (fetch throws on network failure)
			if (!url.includes('/api/client-error')) {
				reportError({
					type: 'network_error',
					url,
					message: err instanceof Error ? err.message : String(err),
					context: {
						method: init?.method || 'GET'
					}
				});
			}
			throw err;
		}
	};

	// Monkey-patch XMLHttpRequest to catch XHR errors (used by upload chunks)
	const originalXHROpen = XMLHttpRequest.prototype.open;
	const originalXHRSend = XMLHttpRequest.prototype.send;
	
	XMLHttpRequest.prototype.open = function(method: string, url: string | URL, ...args: unknown[]) {
		(this as XMLHttpRequest & { _method: string; _url: string })._method = method;
		(this as XMLHttpRequest & { _url: string })._url = typeof url === 'string' ? url : url.href;
		return originalXHROpen.apply(this, [method, url, ...args] as Parameters<typeof originalXHROpen>);
	};

	XMLHttpRequest.prototype.send = function(body?: Document | XMLHttpRequestBodyInit | null) {
		const xhr = this as XMLHttpRequest & { _method: string; _url: string };
		const url = xhr._url || '';
		const method = xhr._method || 'GET';

		// Skip our own error endpoint to avoid loops
		if (url.includes('/api/client-error')) {
			return originalXHRSend.call(this, body);
		}

		this.addEventListener('load', function() {
			if (this.status >= 400) {
				reportError({
					type: 'xhr_error',
					status: this.status,
					url,
					message: this.statusText,
					context: { method }
				});
			}
		});

		this.addEventListener('error', function() {
			reportError({
				type: 'xhr_network_error',
				url,
				message: 'Network error',
				context: { method }
			});
		});

		return originalXHRSend.call(this, body);
	};
}
