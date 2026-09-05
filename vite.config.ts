import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import devtoolsJson from 'vite-plugin-devtools-json';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { sveltekit } from '@sveltejs/kit/vite';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));

/**
 * Short commit of the build. The Docker image builds on node:alpine, which has
 * no git binary, so CI/compose should pass GIT_SHA as a build arg. Falling back
 * to null keeps the build working either way rather than failing over a label.
 */
function resolveGitSha(): string | null {
	if (process.env.GIT_SHA) return process.env.GIT_SHA.trim().slice(0, 7);
	try {
		return execSync('git rev-parse --short HEAD', {
			stdio: ['ignore', 'pipe', 'ignore']
		})
			.toString()
			.trim();
	} catch {
		return null;
	}
}

export default defineConfig({
	plugins: [sveltekit(), devtoolsJson()],
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version),
		__APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
		__APP_GIT_SHA__: JSON.stringify(resolveGitSha())
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
