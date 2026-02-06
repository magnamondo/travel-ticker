/**
 * Detects if the user is on an Apple platform (iOS or macOS)
 */
export function isApplePlatform(): boolean {
	if (typeof navigator === 'undefined') return false;
	
	const ua = navigator.userAgent || navigator.vendor || '';
	const platform = navigator.platform || '';
	
	// Check for iOS devices
	if (/iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
		return true;
	}
	
	// Check for macOS
	if (platform.startsWith('Mac') || /Macintosh/.test(ua)) {
		return true;
	}
	
	return false;
}

/**
 * Returns the appropriate maps URL for the user's platform
 * - Apple platforms (iOS/macOS): Apple Maps
 * - Other platforms (Windows/Android/Linux): Google Maps
 */
export function getMapsUrl(coordinates: string): string {
	if (isApplePlatform()) {
		// Apple Maps web URL - works even if Maps app is deleted
		return `https://maps.apple.com/?q=${encodeURIComponent(coordinates)}`;
	}
	// Google Maps URL
	return `https://maps.google.com/?q=${encodeURIComponent(coordinates)}`;
}
