/**
 * AIMD (Additive Increase Multiplicative Decrease) Concurrency Controller
 * 
 * Implements TCP-like congestion control for upload chunk concurrency.
 * 
 * Algorithm:
 * - Start at initial concurrency (default: 1 for safety)
 * - After N consecutive successful chunks, increase by 1 (additive increase)
 * - On timeout or failure, halve the concurrency (multiplicative decrease)
 * - Bounded by min (1) and max (user-specified) concurrency
 * 
 * This provides smooth adaptation to network conditions without magic thresholds.
 */

export interface AIMDConfig {
	/** Starting concurrency level */
	initialConcurrency: number;
	/** Maximum concurrency allowed */
	maxConcurrency: number;
	/** Minimum concurrency (floor) */
	minConcurrency: number;
	/** Number of consecutive successes before increasing concurrency */
	successThreshold: number;
	/** Amount to increase on success (additive) */
	additiveIncrease: number;
	/** Factor to decrease on failure (multiplicative, 0-1) */
	multiplicativeDecrease: number;
	/** Time in ms before we consider the connection "recovered" and start probing up again */
	recoveryTimeMs: number;
}

const DEFAULT_CONFIG: AIMDConfig = {
	initialConcurrency: 1,
	maxConcurrency: 6,
	minConcurrency: 1,
	successThreshold: 5, // Increase after 5 consecutive successes
	additiveIncrease: 1,
	multiplicativeDecrease: 0.5, // Halve on failure
	recoveryTimeMs: 10000 // 10 seconds before we try increasing again after a decrease
};

export type ConcurrencyEvent = 
	| { type: 'success'; durationMs: number; chunkSize: number }
	| { type: 'failure'; reason: 'timeout' | 'error' | 'abort' }
	| { type: 'retry'; attempt: number; maxAttempts: number };

export interface ConcurrencyState {
	currentConcurrency: number;
	consecutiveSuccesses: number;
	lastDecreaseTime: number;
	totalSuccesses: number;
	totalFailures: number;
	averageSpeed: number; // bytes/sec, EMA
}

/**
 * AIMD Concurrency Controller
 * 
 * Create one instance per upload session (file upload).
 * Call onEvent() for each chunk completion/failure.
 * Read currentConcurrency to determine how many parallel uploads to run.
 */
export class AIMDController {
	private config: AIMDConfig;
	private state: ConcurrencyState;
	private speedSamples: number[] = [];
	private readonly EMA_ALPHA = 0.3;

	constructor(config: Partial<AIMDConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.state = {
			currentConcurrency: this.config.initialConcurrency,
			consecutiveSuccesses: 0,
			lastDecreaseTime: 0,
			totalSuccesses: 0,
			totalFailures: 0,
			averageSpeed: 0
		};
	}

	/**
	 * Get current recommended concurrency
	 */
	get currentConcurrency(): number {
		return this.state.currentConcurrency;
	}

	/**
	 * Get current state for debugging/display
	 */
	getState(): Readonly<ConcurrencyState> {
		return { ...this.state };
	}

	/**
	 * Process an event and update concurrency
	 */
	onEvent(event: ConcurrencyEvent): number {
		switch (event.type) {
			case 'success':
				return this.onSuccess(event.durationMs, event.chunkSize);
			case 'failure':
				return this.onFailure(event.reason);
			case 'retry':
				// Retries don't immediately affect concurrency, but we track them
				// Only reduce on final failure
				return this.state.currentConcurrency;
			default:
				return this.state.currentConcurrency;
		}
	}

	private onSuccess(durationMs: number, chunkSize: number): number {
		this.state.totalSuccesses++;
		this.state.consecutiveSuccesses++;

		// Update speed tracking
		if (durationMs > 0) {
			const speed = (chunkSize / durationMs) * 1000; // bytes/sec
			this.updateSpeed(speed);
		}

		// Check if we should increase concurrency
		const timeSinceDecrease = Date.now() - this.state.lastDecreaseTime;
		const recoveredFromDecrease = timeSinceDecrease > this.config.recoveryTimeMs;

		if (
			this.state.consecutiveSuccesses >= this.config.successThreshold &&
			this.state.currentConcurrency < this.config.maxConcurrency &&
			(this.state.lastDecreaseTime === 0 || recoveredFromDecrease)
		) {
			// Additive increase
			this.state.currentConcurrency = Math.min(
				this.state.currentConcurrency + this.config.additiveIncrease,
				this.config.maxConcurrency
			);
			this.state.consecutiveSuccesses = 0; // Reset counter after increase
			console.log(`[AIMD] Increased concurrency to ${this.state.currentConcurrency}`);
		}

		return this.state.currentConcurrency;
	}

	private onFailure(reason: 'timeout' | 'error' | 'abort'): number {
		// Abort is user-initiated, don't penalize
		if (reason === 'abort') {
			return this.state.currentConcurrency;
		}

		this.state.totalFailures++;
		this.state.consecutiveSuccesses = 0;
		this.state.lastDecreaseTime = Date.now();

		// Multiplicative decrease
		const newConcurrency = Math.max(
			Math.floor(this.state.currentConcurrency * this.config.multiplicativeDecrease),
			this.config.minConcurrency
		);

		if (newConcurrency < this.state.currentConcurrency) {
			console.log(`[AIMD] Decreased concurrency from ${this.state.currentConcurrency} to ${newConcurrency} due to ${reason}`);
			this.state.currentConcurrency = newConcurrency;
		}

		return this.state.currentConcurrency;
	}

	private updateSpeed(speed: number): void {
		// Exponential moving average
		if (this.state.averageSpeed === 0) {
			this.state.averageSpeed = speed;
		} else {
			this.state.averageSpeed = this.EMA_ALPHA * speed + (1 - this.EMA_ALPHA) * this.state.averageSpeed;
		}

		// Keep last N samples for variance analysis if needed
		this.speedSamples.push(speed);
		if (this.speedSamples.length > 20) {
			this.speedSamples.shift();
		}
	}

	/**
	 * Reset controller state (e.g., for a new upload)
	 */
	reset(): void {
		this.state = {
			currentConcurrency: this.config.initialConcurrency,
			consecutiveSuccesses: 0,
			lastDecreaseTime: 0,
			totalSuccesses: 0,
			totalFailures: 0,
			averageSpeed: 0
		};
		this.speedSamples = [];
	}

	/**
	 * Get summary string for debugging
	 */
	toString(): string {
		return `AIMD[c=${this.state.currentConcurrency}, succ=${this.state.totalSuccesses}, fail=${this.state.totalFailures}, speed=${Math.round(this.state.averageSpeed / 1024)}KB/s]`;
	}
}

/**
 * Create a new AIMD controller with the given max concurrency
 */
export function createAIMDController(maxConcurrency: number = 3): AIMDController {
	return new AIMDController({
		initialConcurrency: 1, // Always start conservative
		maxConcurrency,
		minConcurrency: 1
	});
}
