#!/usr/bin/env node

/**
 * Server Wrapper Script
 * 
 * Wraps the SvelteKit Node server with crash detection and logging.
 * Catches all uncaught exceptions and unhandled promise rejections
 * to ensure crashes are logged before the process exits.
 */

import { writeFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const DATA_DIR = process.env.DATA_DIR || 'data';
const CRASH_LOG_DIR = join(DATA_DIR, 'logs');
const CRASH_LOG_FILE = join(CRASH_LOG_DIR, 'crash.log');

// Ensure log directory exists
if (!existsSync(CRASH_LOG_DIR)) {
	mkdirSync(CRASH_LOG_DIR, { recursive: true });
}

/**
 * Log a crash event with full details
 */
function logCrash(type, error, origin) {
	const timestamp = new Date().toISOString();
	const pid = process.pid;
	const memUsage = process.memoryUsage();
	
	const crashEntry = {
		timestamp,
		type, // 'uncaughtException' | 'unhandledRejection' | 'SIGTERM' | 'SIGSEGV' etc.
		pid,
		error: {
			name: error?.name || 'Unknown',
			message: error?.message || String(error),
			stack: error?.stack || 'No stack trace available',
		},
		origin: origin || null,
		memory: {
			heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
			heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
			external: Math.round(memUsage.external / 1024 / 1024) + 'MB',
			rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB',
		},
		uptime: Math.round(process.uptime()) + 's',
		nodeVersion: process.version,
	};
	
	// Log to console with RED text for visibility
	console.error('\n\x1b[31m' + '='.repeat(60) + '\x1b[0m');
	console.error('\x1b[31m💥 CRASH DETECTED: ' + type + '\x1b[0m');
	console.error('\x1b[31m='.repeat(60) + '\x1b[0m');
	console.error(`Timestamp: ${timestamp}`);
	console.error(`PID: ${pid}`);
	console.error(`Uptime: ${crashEntry.uptime}`);
	console.error(`Memory: RSS=${crashEntry.memory.rss}, Heap=${crashEntry.memory.heapUsed}/${crashEntry.memory.heapTotal}`);
	console.error(`Error: ${crashEntry.error.name}: ${crashEntry.error.message}`);
	console.error('Stack trace:');
	console.error(crashEntry.error.stack);
	console.error('\x1b[31m' + '='.repeat(60) + '\x1b[0m\n');
	
	// Append to crash log file
	try {
		const logLine = JSON.stringify(crashEntry) + '\n';
		appendFileSync(CRASH_LOG_FILE, logLine);
		console.error(`📝 Crash logged to ${CRASH_LOG_FILE}`);
	} catch (writeError) {
		console.error('Failed to write crash log:', writeError);
	}
}

/**
 * Handle uncaught exceptions
 * These are synchronous errors that weren't caught
 */
process.on('uncaughtException', (error, origin) => {
	logCrash('uncaughtException', error, origin);
	
	// Give time for async operations (like writing crash log) to complete
	setTimeout(() => {
		process.exit(1);
	}, 1000);
});

/**
 * Handle unhandled promise rejections
 * As of Node.js 15+, these also crash the process by default
 */
process.on('unhandledRejection', (reason, promise) => {
	logCrash('unhandledRejection', reason, {
		promise: String(promise),
	});
	
	// Give time for async operations to complete
	setTimeout(() => {
		process.exit(1);
	}, 1000);
});

/**
 * Handle out of memory (if possible - usually process is killed by OS)
 */
process.on('warning', (warning) => {
	if (warning.name === 'MaxListenersExceededWarning') {
		console.warn('⚠️  MaxListenersExceededWarning:', warning.message);
	}
	
	// Log heap near limit warnings
	const memUsage = process.memoryUsage();
	const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
	const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
	const heapPercent = (heapUsedMB / heapTotalMB) * 100;
	
	if (heapPercent > 90) {
		console.warn(`⚠️  HIGH MEMORY WARNING: Heap at ${heapPercent.toFixed(1)}% (${heapUsedMB.toFixed(0)}/${heapTotalMB.toFixed(0)} MB)`);
	}
});

/**
 * Handle SIGTERM for graceful shutdown logging
 */
process.on('SIGTERM', () => {
	console.log('\n📤 Received SIGTERM - graceful shutdown');
	
	// Log this as an expected shutdown, not a crash
	const timestamp = new Date().toISOString();
	try {
		const logLine = JSON.stringify({
			timestamp,
			type: 'SIGTERM',
			pid: process.pid,
			message: 'Graceful shutdown requested',
			uptime: Math.round(process.uptime()) + 's',
		}) + '\n';
		appendFileSync(CRASH_LOG_FILE, logLine);
	} catch {
		// Ignore write errors during shutdown
	}
	
	// Let the actual server handle the shutdown
});

/**
 * Handle SIGINT (Ctrl+C) for graceful shutdown logging
 */
process.on('SIGINT', () => {
	console.log('\n⏹️  Received SIGINT - shutting down');
});

/**
 * Monitor memory usage periodically
 */
const MEMORY_CHECK_INTERVAL = 60000; // Every minute
const MEMORY_WARNING_THRESHOLD = 0.85; // 85% of max heap

async function checkMemory() {
	const memUsage = process.memoryUsage();
	const v8 = await import('v8');
	const heapStats = v8.getHeapStatistics();
	
	const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
	const heapLimitMB = heapStats.heap_size_limit / 1024 / 1024;
	const heapPercent = memUsage.heapUsed / heapStats.heap_size_limit;
	
	if (heapPercent > MEMORY_WARNING_THRESHOLD) {
		console.warn(`⚠️  MEMORY WARNING: Heap at ${(heapPercent * 100).toFixed(1)}% of limit (${heapUsedMB.toFixed(0)}/${heapLimitMB.toFixed(0)} MB)`);
		console.warn(`    Consider increasing --max-old-space-size or investigating memory leaks`);
	}
}

setInterval(() => {
	checkMemory().catch(err => console.error('Memory check error:', err));
}, MEMORY_CHECK_INTERVAL);

// Log startup
console.log('🛡️  Server wrapper initialized with crash detection');
console.log(`   Crash logs: ${CRASH_LOG_FILE}`);

// Import and run the actual server
const serverPath = new URL('../build/index.js', import.meta.url);
import(serverPath.href);
