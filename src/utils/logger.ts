/**
 * Logger utility to standardize application logging across both web and electron
 * environments. This also ensures logs can be properly captured by VS Code.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogOptions {
	source?: string;
	data?: unknown;
}

class Logger {
	private static instance: Logger;

	constructor() {
		if (Logger.instance) {
			return Logger.instance;
		}
		Logger.instance = this;
	}

	/**
	 * Format a log message with consistent structure
	 */
	private formatMessage(level: LogLevel, message: string, options?: LogOptions): string {
		const timestamp = new Date().toISOString();
		const source = options?.source ? `[${options.source}]` : '';
		return `[${timestamp}] [${level.toUpperCase()}]${source} ${message}`;
	}

	/**
	 * Log debug information
	 */
	public debug(message: string, options?: LogOptions): void {
		const formattedMessage = this.formatMessage('debug', message, options);
		console.debug(formattedMessage);
		if (options?.data) {
			console.debug(options.data);
		}
	}

	/**
	 * Log informational messages
	 */
	public info(message: string, options?: LogOptions): void {
		const formattedMessage = this.formatMessage('info', message, options);
		console.info(formattedMessage);
		if (options?.data) {
			console.info(options.data);
		}
	}

	/**
	 * Log warning messages
	 */
	public warn(message: string, options?: LogOptions): void {
		const formattedMessage = this.formatMessage('warn', message, options);
		console.warn(formattedMessage);
		if (options?.data) {
			console.warn(options.data);
		}
	}

	/**
	 * Log error messages
	 */
	public error(message: string, error?: Error, options?: LogOptions): void {
		const formattedMessage = this.formatMessage('error', message, options);
		console.error(formattedMessage);
		if (error) {
			console.error(error);
		}
		if (options?.data) {
			console.error(options.data);
		}
	}
}

export const logger = new Logger();
