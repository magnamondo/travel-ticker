/**
 * Single rAF-coalesced window scroll tracker.
 *
 * One passive listener feeds one state update per frame, so any number of
 * consumers on a page share a single scroll subscription. Call during
 * component initialisation; the listener is torn down with the component.
 */
export function createScrollTracker() {
	let scrollY = $state(0);

	$effect(() => {
		let frame = 0;

		const read = () => {
			frame = 0;
			scrollY = window.scrollY;
		};

		const schedule = () => {
			if (frame) return;
			frame = requestAnimationFrame(read);
		};

		read();
		window.addEventListener('scroll', schedule, { passive: true });
		window.addEventListener('resize', schedule, { passive: true });

		return () => {
			if (frame) cancelAnimationFrame(frame);
			window.removeEventListener('scroll', schedule);
			window.removeEventListener('resize', schedule);
		};
	});

	return {
		get scrollY() {
			return scrollY;
		}
	};
}
