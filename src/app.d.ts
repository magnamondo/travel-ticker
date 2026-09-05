// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Locals {
			user: import('$lib/server/auth').SessionValidationResult['user'];
			session: import('$lib/server/auth').SessionValidationResult['session'];
		}

		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	// Injected at build time by `define` in vite.config.ts
	const __APP_VERSION__: string;
	const __APP_BUILD_TIME__: string;
	const __APP_GIT_SHA__: string | null;
}

export {};
