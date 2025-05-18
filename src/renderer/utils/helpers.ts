/**
 * General utility helper functions
 */

/**
 * Generate a unique ID string
 * @returns Unique ID
 */
export function generateId(): string {
	return '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * Debounce a function to limit how often it can be called
 * @param func Function to debounce
 * @param wait Time to wait in milliseconds
 * @returns Debounced function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
	func: T,
	wait: number,
): (...args: Parameters<T>) => void {
	let timeout: number | null = null;

	return function (...args: Parameters<T>): void {
		const later = () => {
			timeout = null;
			func(...args);
		};

		if (timeout !== null) {
			clearTimeout(timeout);
		}

		timeout = window.setTimeout(later, wait);
	};
}

/**
 * Deep clone an object
 * @param obj Object to clone
 * @returns Cloned object
 */
export function deepClone<T>(obj: T): T {
	return JSON.parse(JSON.stringify(obj));
}

/**
 * Deep merge objects
 * @param target Target object
 * @param sources Source objects
 * @returns Merged object
 */
export function deepMerge<T extends Record<string, unknown>>(
	target: T,
	...sources: Partial<T>[]
): T {
	if (!sources.length) return target;

	const source = sources.shift();

	if (source === undefined) {
		return target;
	}

	if (isObject(target) && isObject(source)) {
		for (const key in source) {
			if (isObject(source[key])) {
				if (!target[key]) Object.assign(target, { [key]: {} });
				deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
			} else {
				Object.assign(target, { [key]: source[key] });
			}
		}
	}

	return deepMerge(target, ...sources);
}

/**
 * Check if a value is an object
 * @param item Value to check
 * @returns Whether the value is an object
 */
export function isObject(item: unknown): item is Record<string, unknown> {
	return item && typeof item === 'object' && !Array.isArray(item);
}

/**
 * Load an image from a URL
 * @param url URL of the image
 * @returns Promise that resolves with the loaded image
 */
export function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
		img.src = url;
	});
}

/**
 * Format a number with commas as thousands separators
 * @param num Number to format
 * @returns Formatted number string
 */
export function formatNumber(num: number): string {
	return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Get the parameter value from a URL query string
 * @param name Parameter name
 * @param url URL to search (defaults to window.location.href)
 * @returns Parameter value or null if not found
 */
export function getUrlParameter(name: string, url?: string): string | null {
	if (!url) url = window.location.href;
	name = name.replace(/[\[\]]/g, '\\$&');
	const regex = new RegExp(`[?&]${name}(=([^&#]*)|&|#|$)`);
	const results = regex.exec(url);
	if (!results) return null;
	if (!results[2]) return '';
	return decodeURIComponent(results[2].replace(/\+/g, ' '));
}
