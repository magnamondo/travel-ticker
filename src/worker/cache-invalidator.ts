// Helper to invalidate cache from worker process
import { request } from 'http';

export function invalidateCacheFromWorker(tags: string[]) {
    if (tags.length === 0) return;
    
    // We can't use $env/dynamic/private easily in a worker process, 
    // so we rely on process.env which dotenv loads
    const caddyUrl = process.env.CADDY_API_URL || 'http://travel-ticker-caddy/souin-api/souin';
    const tagHeader = tags.join(', ');
    
    console.log(`[Worker] Invalidating tags: ${tagHeader}`);

    const url = new URL(caddyUrl);
    
    const req = request({
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'PURGE',
        headers: {
            'Surrogate-Key': tagHeader
        }
    }, (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            // Success
        } else {
            console.warn(`[Worker] Cache invalidation failed: ${res.statusCode}`);
        }
    });

    req.on('error', (e) => {
        console.error('[Worker] Cache invalidation error:', e.message);
    });

    req.end();
}
