import { encodeBase64, decodeBase64 } from '@oslojs/encoding';

const ITERATIONS = 100000;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * Hash a password using PBKDF2 with SHA-256
 * Returns format: base64(salt):base64(hash)
 */
export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
	const encoder = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		encoder.encode(password),
		'PBKDF2',
		false,
		['deriveBits']
	);

	const hash = await crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			salt,
			iterations: ITERATIONS,
			hash: 'SHA-256'
		},
		keyMaterial,
		KEY_LENGTH * 8
	);

	return `${encodeBase64(salt)}:${encodeBase64(new Uint8Array(hash))}`;
}

/**
 * Verify a password against a stored hash
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
	const [saltB64, hashB64] = storedHash.split(':');
	if (!saltB64 || !hashB64) {
		return false;
	}

	const salt = new Uint8Array(decodeBase64(saltB64));
	const storedHashBytes = new Uint8Array(decodeBase64(hashB64));

	const encoder = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		encoder.encode(password),
		'PBKDF2',
		false,
		['deriveBits']
	);

	const hash = await crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			salt,
			iterations: ITERATIONS,
			hash: 'SHA-256'
		},
		keyMaterial,
		KEY_LENGTH * 8
	);

	const hashBytes = new Uint8Array(hash);
	
	// Constant-time comparison to prevent timing attacks
	if (hashBytes.length !== storedHashBytes.length) {
		return false;
	}
	
	let result = 0;
	for (let i = 0; i < hashBytes.length; i++) {
		result |= hashBytes[i] ^ storedHashBytes[i];
	}
	
	return result === 0;
}
