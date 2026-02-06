/**
 * Simple structured logger for production use
 * Outputs JSON in production, pretty-printed in development
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
	timestamp: string;
	level: LogLevel;
	message: string;
	[key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3
};

const MIN_LEVEL = (process.env.LOG_LEVEL as LogLevel) || 'info';
const IS_PROD = process.env.NODE_ENV === 'production';

function formatEntry(entry: LogEntry): string {
	if (IS_PROD) {
		return JSON.stringify(entry);
	}

	// Pretty format for development
	const { timestamp, level, message, ...rest } = entry;
	const levelColors: Record<LogLevel, string> = {
		debug: '\x1b[90m', // gray
		info: '\x1b[36m',  // cyan
		warn: '\x1b[33m',  // yellow
		error: '\x1b[31m' // red
	};
	const reset = '\x1b[0m';
	const color = levelColors[level];
	const time = new Date(timestamp).toLocaleTimeString();
	
	let output = `${color}[${level.toUpperCase()}]${reset} ${time} ${message}`;
	
	if (Object.keys(rest).length > 0) {
		output += ` ${JSON.stringify(rest)}`;
	}
	
	return output;
}

function shouldLog(level: LogLevel): boolean {
	return LOG_LEVELS[level] >= LOG_LEVELS[MIN_LEVEL];
}

function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
	if (!shouldLog(level)) return;

	const entry: LogEntry = {
		timestamp: new Date().toISOString(),
		level,
		message,
		...meta
	};

	const output = formatEntry(entry);

	if (level === 'error') {
		console.error(output);
	} else if (level === 'warn') {
		console.warn(output);
	} else {
		console.log(output);
	}
}

export const logger = {
	debug: (message: string, meta?: Record<string, unknown>) => log('debug', message, meta),
	info: (message: string, meta?: Record<string, unknown>) => log('info', message, meta),
	warn: (message: string, meta?: Record<string, unknown>) => log('warn', message, meta),
	error: (message: string, meta?: Record<string, unknown>) => log('error', message, meta),

	/**
	 * Create a child logger with default metadata
	 */
	child: (defaultMeta: Record<string, unknown>) => ({
		debug: (message: string, meta?: Record<string, unknown>) => 
			log('debug', message, { ...defaultMeta, ...meta }),
		info: (message: string, meta?: Record<string, unknown>) => 
			log('info', message, { ...defaultMeta, ...meta }),
		warn: (message: string, meta?: Record<string, unknown>) => 
			log('warn', message, { ...defaultMeta, ...meta }),
		error: (message: string, meta?: Record<string, unknown>) => 
			log('error', message, { ...defaultMeta, ...meta })
	}),

	/**
	 * Log an HTTP request (for use in hooks)
	 */
	request: (method: string, path: string, status: number, durationMs: number, meta?: Record<string, unknown>) => {
		const level: LogLevel = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
		log(level, `${method} ${path} ${status}`, { 
			method, 
			path, 
			status, 
			durationMs,
			...meta 
		});
	}
};

export type Logger = typeof logger;
