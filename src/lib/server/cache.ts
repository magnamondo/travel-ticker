import { env } from '$env/dynamic/private';
import { logger } from '$lib/server/logger';

/**
 * Invalidate cache tags in Caddy (via Souin)
 * @param tags Array of surrogate keys to invalidate
 */
export async function invalidateCache(tags: string[]) {
    if (tags.length === 0) return;

    // Default to the service name in docker-compose
    // If running outside docker, might need localhost:port
    const caddyUrl = env.CADDY_API_URL || 'http://travel-ticker-caddy/souin-api/souin';
    
    // Souin expects a comma-separated list of keys in the Surrogate-Key header
    // or we can fire multiple requests. 
    // The standard implementation often takes a regex or list.
    // For Souin specifically, sending 'Surrogate-Key' header with the exact key usually invalidates that key.
    // To invalidate multiple specific keys, we might need multiple requests 
    // or a regex like `key1|key2` if supported, but let's stick to simple individual requests 
    // or comma separated if the plugin supports it (Souin usually supports comma separated keys in the header).
    
    const stringifiedTags = tags.join(', ');

    try {
        const response = await fetch(caddyUrl, {
            method: 'PURGE',
            headers: {
                'Surrogate-Key': stringifiedTags
            }
        });

        if (!response.ok) {
            logger.warn(`Failed to invalidate cache tags: ${stringifiedTags}`, { 
                status: response.status, 
                statusText: response.statusText 
            });
        } else {
            logger.info(`Invalidated cache tags: ${stringifiedTags}`);
        }
    } catch (e) {
        // Don't crash the app if cache invalidation fails
        logger.error('Error invalidating cache', { error: e, tags });
    }
}
