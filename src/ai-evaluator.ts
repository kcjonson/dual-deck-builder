// Entry point for the AI Evaluator standalone page
import { AIEvaluator } from './renderer/game/mechanics/AIEvaluator';
import { CardLoader } from './renderer/game/core/CardLoader';
import { DriverLoader } from './renderer/game/core/DriverLoader';

// Export for browser usage
declare global {
	interface Window {
		AIEvaluator: typeof AIEvaluator;
		initializeAIEvaluator: () => Promise<boolean>;
	}
}

// Make AIEvaluator available globally immediately
window.AIEvaluator = AIEvaluator;

// Initialize the loaders
async function initialize(): Promise<boolean> {
	try {
		// Load cards and drivers
		await CardLoader.getInstance().loadCards();
		await DriverLoader.loadDrivers();
		console.log('Cards and drivers loaded successfully');
		console.log('AI Evaluator fully initialized');
		return true;
	} catch (error) {
		console.error('Failed to initialize AI Evaluator:', error);
		return false;
	}
}

// Make initialize function available globally
window.initializeAIEvaluator = initialize;

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
	window.addEventListener('DOMContentLoaded', initialize);
} else {
	// DOM already loaded
	initialize();
}