type ToastType = 'success' | 'error' | 'info';

export type Toast = {
	id: number;
	message: string;
	type: ToastType;
};

class ToastStore {
	toasts = $state<Toast[]>([]);
	private nextId = 0;

	add(message: string, type: ToastType = 'info', duration = 4000) {
		const id = this.nextId++;
		this.toasts = [...this.toasts, { id, message, type }];
		
		if (duration > 0) {
			setTimeout(() => {
				this.remove(id);
			}, duration);
		}
		
		return id;
	}

	remove(id: number) {
		this.toasts = this.toasts.filter(t => t.id !== id);
	}

	success(message: string, duration = 4000) {
		return this.add(message, 'success', duration);
	}

	error(message: string, duration = 6000) {
		return this.add(message, 'error', duration);
	}

	info(message: string, duration = 4000) {
		return this.add(message, 'info', duration);
	}
}

export const toasts = new ToastStore();
