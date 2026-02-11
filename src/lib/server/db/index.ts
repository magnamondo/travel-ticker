import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

const client = new Database(env.DATABASE_URL);

// Enable WAL mode for better concurrency (allows reads while writing)
// Required for multi-process access (web server + video worker)
client.pragma('journal_mode = WAL');

// Set busy timeout to 5 seconds - throws error instead of blocking forever
// This ensures we get a visible error instead of a frozen process
client.pragma('busy_timeout = 5000');

export const db = drizzle(client, { schema });
