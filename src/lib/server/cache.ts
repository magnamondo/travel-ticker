import { env } from '$env/dynamic/private';
import { logger } from '$lib/server/logger';

/**
 * Invalidate cache tags in Caddy (via Souin)
 * @param tags Array of surrogate keys to invalidate
 */
export async function invalidateCache(tags: string[]) {
    // Cache invalidation disabled as we've removed the caching layer
    if (tags.length > 0) {
        // logger.debug(`Skipping cache invalidation for tags: ${tags.join(', ')}`);
    }
    return;
}
