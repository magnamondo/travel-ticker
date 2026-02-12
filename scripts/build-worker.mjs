#!/usr/bin/env node
/**
 * Build script for workers
 * 
 * Bundles the TypeScript workers into single JavaScript files using esbuild.
 * This eliminates the need for tsx/esbuild at runtime, reducing:
 * - Process count from 4 to 1
 * - Memory usage
 * - Startup time
 * 
 * Native modules (better-sqlite3) are kept external since they can't be bundled.
 */

import { build } from 'esbuild';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const commonOptions = {
	bundle: true,
	platform: 'node',
	target: 'node24', // Match Dockerfile: FROM node:24-alpine
	format: 'esm',
	
	// Native modules must be external - they can't be bundled
	external: ['better-sqlite3'],
	
	// Source maps for debugging production issues (separate file)
	sourcemap: true,
	
	// Minify for smaller bundle size
	minify: true,
	
	// Tree-shake unused code
	treeShaking: true,
	
	// Strip license comments from bundle (keeps bundle small)
	legalComments: 'none',
	
	// Define production environment
	define: {
		'process.env.NODE_ENV': '"production"'
	},
	
	// Banner: create require() for CJS packages like dotenv that use require('fs')
	banner: {
		js: `import { createRequire } from 'module';
const require = createRequire(import.meta.url);
`
	}
};

// Build video worker
await build({
	...commonOptions,
	entryPoints: [join(root, 'src/worker/video-worker.ts')],
	outfile: join(root, 'build/worker.mjs'),
});
console.log('✅ Video worker built: build/worker.mjs');

// Build notification worker
await build({
	...commonOptions,
	entryPoints: [join(root, 'src/worker/notification-worker.ts')],
	outfile: join(root, 'build/notification-worker.mjs'),
});
console.log('✅ Notification worker built: build/notification-worker.mjs');
