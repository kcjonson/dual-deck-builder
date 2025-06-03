import { Layer } from '../../../engine/components/Layer';
import { Text } from '../../../engine/components/Text';
import { Rectangle } from '../../../engine/components/Rectangle';
import { InputSystem } from '../../../engine/input/InputSystem';

/**
 * Enemy data structure for combat
 */
export interface EnemyVehicle {
	id: string;
	name: string;
	maxHealth: number;
	currentHealth: number;
	armor: number;
	intent: EnemyIntent;
}

/**
 * Enemy intent indicator types
 */
export type IntentType = 'attack' | 'defend' | 'repair' | 'special';

export interface EnemyIntent {
	type: IntentType;
	value?: number; // Damage amount, armor gain, etc.
	description: string;
}

/**
 * Enemy layer for the top 25% of combat screen
 * Displays enemy vehicles with health, armor, and intent indicators
 */
export class EnemyLayer extends Layer {
	private enemies: EnemyVehicle[] = [];
	private enemyElements: Map<string, {
		container: Layer;
		portrait: Rectangle;
		healthBar: Rectangle;
		healthBarFill: Rectangle;
		healthText: Text;
		armorIcon: Rectangle;
		armorText: Text;
		intentIcon: Rectangle;
		intentText: Text;
		nameText: Text;
	}> = new Map();
	
	// Highlighting state for targeting
	private highlightedEnemyId: string | null = null;
	
	// Target callback
	private onTargetCallback: ((enemy: EnemyVehicle) => void) | null = null;

	/**
	 * Create enemy layer
	 */
	constructor(options: { x: number; y: number; width: number; height: number }) {
		super(options);
		
		// Background for enemy area
		const background = new Rectangle({
			x: 0,
			y: 0,
			width: this.getWidth(),
			height: this.getHeight(),
			style: {
				backgroundColor: '#2a1a1a', // Dark background for enemy area
			},
		});
		this.addChild(background);

		// Set up click handling for targeting
		this.setupTargeting();
	}

	/**
	 * Set the enemies to display
	 */
	public setEnemies(enemies: EnemyVehicle[]): void {
		this.enemies = enemies;
		this.clearEnemyElements();
		this.createEnemyElements();
	}

	/**
	 * Update enemy data (health, armor, intent changes)
	 */
	public updateEnemy(enemyId: string, updates: Partial<EnemyVehicle>): void {
		const enemy = this.enemies.find(e => e.id === enemyId);
		if (!enemy) return;

		// Update enemy data
		Object.assign(enemy, updates);
		
		// Update visual elements
		this.updateEnemyVisuals(enemy);
	}

	/**
	 * Clear all enemy visual elements
	 */
	private clearEnemyElements(): void {
		for (const elements of this.enemyElements.values()) {
			this.removeChild(elements.container);
		}
		this.enemyElements.clear();
	}

	/**
	 * Create visual elements for all enemies
	 */
	private createEnemyElements(): void {
		if (this.enemies.length === 0) return;

		const layerWidth = this.getWidth();
		const layerHeight = this.getHeight();
		
		// Enemy cards are fixed size - same as normal playing cards
		const enemyWidth = 160; // Fixed width for enemy vehicle cards
		const enemyHeight = Math.floor(layerHeight * 0.8); // 80% of layer height
		
		// Calculate spacing between cards
		const cardSpacing = 20;
		const totalWidth = this.enemies.length * enemyWidth + (this.enemies.length - 1) * cardSpacing;
		const startX = Math.floor((layerWidth - totalWidth) / 2);

		this.enemies.forEach((enemy, index) => {
			const x = startX + index * (enemyWidth + 20);
			const y = Math.floor(layerHeight * 0.1); // 10% margin from top

			const elements = this.createSingleEnemyElement(enemy, x, y, enemyWidth, enemyHeight);
			this.enemyElements.set(enemy.id, elements);
			this.addChild(elements.container);
		});
	}

	/**
	 * Create visual elements for a single enemy
	 */
	private createSingleEnemyElement(
		enemy: EnemyVehicle, 
		x: number, 
		y: number, 
		width: number, 
		height: number
	) {
		// Container for this enemy
		const container = new Layer({
			x,
			y,
			width,
			height,
		});

		// Enemy portrait (placeholder)
		const portrait = new Rectangle({
			x: 0,
			y: 0,
			width,
			height: Math.floor(height * 0.6),
			style: {
				backgroundColor: '#4a3a3a',
				borderColor: '#6a5a5a',
				borderWidth: 2,
			},
		});
		container.addChild(portrait);

		// Enemy name
		const nameText = new Text(enemy.name, {
			style: {
				fontSize: 12,
				color: '#ffffff',
				textAlign: 'center',
				fontWeight: 'bold',
			},
		});
		nameText.setPosition(Math.floor(width / 2), Math.floor(height * 0.62));
		container.addChild(nameText);

		// Health bar background
		const healthBar = new Rectangle({
			x: Math.floor(width * 0.1),
			y: Math.floor(height * 0.68),
			width: Math.floor(width * 0.8),
			height: 8,
			style: {
				backgroundColor: '#333333',
				borderColor: '#555555',
				borderWidth: 1,
			},
		});
		container.addChild(healthBar);

		// Health bar fill
		const healthPercentage = enemy.currentHealth / enemy.maxHealth;
		const healthBarFill = new Rectangle({
			x: Math.floor(width * 0.1),
			y: Math.floor(height * 0.68),
			width: Math.floor(width * 0.8 * healthPercentage),
			height: 8,
			style: {
				backgroundColor: healthPercentage > 0.5 ? '#4a8a4a' : healthPercentage > 0.25 ? '#8a8a4a' : '#8a4a4a',
			},
		});
		container.addChild(healthBarFill);

		// Health text
		const healthText = new Text(`${enemy.currentHealth}/${enemy.maxHealth}`, {
			style: {
				fontSize: 10,
				color: '#ffffff',
				textAlign: 'center',
			},
		});
		healthText.setPosition(Math.floor(width / 2), Math.floor(height * 0.78));
		container.addChild(healthText);

		// Armor indicator
		const armorIcon = new Rectangle({
			x: Math.floor(width * 0.05),
			y: Math.floor(height * 0.82),
			width: 16,
			height: 16,
			style: {
				backgroundColor: '#6a6aaa',
				borderRadius: 8,
			},
		});
		container.addChild(armorIcon);

		const armorText = new Text(enemy.armor.toString(), {
			style: {
				fontSize: 10,
				color: '#ffffff',
				textAlign: 'center',
			},
		});
		armorText.setPosition(Math.floor(width * 0.05) + 8, Math.floor(height * 0.82) + 8);
		container.addChild(armorText);

		// Intent indicator
		const intentIcon = new Rectangle({
			x: Math.floor(width * 0.75),
			y: Math.floor(height * 0.82),
			width: 20,
			height: 16,
			style: {
				backgroundColor: this.getIntentColor(enemy.intent.type),
				borderColor: '#ffffff',
				borderWidth: 1,
			},
		});
		container.addChild(intentIcon);

		const intentText = new Text(this.getIntentDisplay(enemy.intent), {
			style: {
				fontSize: 8,
				color: '#ffffff',
				textAlign: 'center',
			},
		});
		intentText.setPosition(Math.floor(width * 0.75) + 10, Math.floor(height * 0.82) + 8);
		container.addChild(intentText);

		return {
			container,
			portrait,
			healthBar,
			healthBarFill,
			healthText,
			armorIcon,
			armorText,
			intentIcon,
			intentText,
			nameText,
		};
	}

	/**
	 * Update visual elements for a specific enemy
	 */
	private updateEnemyVisuals(enemy: EnemyVehicle): void {
		const elements = this.enemyElements.get(enemy.id);
		if (!elements) return;

		// Update health bar
		const healthPercentage = enemy.currentHealth / enemy.maxHealth;
		const healthBarWidth = Math.floor(elements.healthBar.getWidth() * healthPercentage);
		elements.healthBarFill.setWidth(healthBarWidth);
		elements.healthBarFill.setFillColor(
			healthPercentage > 0.5 ? '#4a8a4a' : healthPercentage > 0.25 ? '#8a8a4a' : '#8a4a4a'
		);

		// Update health text
		elements.healthText.setText(`${enemy.currentHealth}/${enemy.maxHealth}`);

		// Update armor
		elements.armorText.setText(enemy.armor.toString());

		// Update intent
		elements.intentIcon.setFillColor(this.getIntentColor(enemy.intent.type));
		elements.intentIcon.setBorderColor('#ffffff');
		elements.intentIcon.setBorderWidth(1);
		elements.intentText.setText(this.getIntentDisplay(enemy.intent));
	}

	/**
	 * Get color for intent type
	 */
	private getIntentColor(intentType: IntentType): string {
		switch (intentType) {
			case 'attack':
				return '#cc4444';
			case 'defend':
				return '#4444cc';
			case 'repair':
				return '#44cc44';
			case 'special':
				return '#cc8844';
			default:
				return '#666666';
		}
	}

	/**
	 * Get display text for intent
	 */
	private getIntentDisplay(intent: EnemyIntent): string {
		switch (intent.type) {
			case 'attack':
				return intent.value ? intent.value.toString() : '?';
			case 'defend':
				return '🛡';
			case 'repair':
				return '🔧';
			case 'special':
				return '!';
			default:
				return '?';
		}
	}

	/**
	 * Get enemies that can be targeted
	 */
	public getTargetableEnemies(): EnemyVehicle[] {
		return this.enemies.filter(enemy => enemy.currentHealth > 0);
	}

	/**
	 * Get enemy at screen position (for targeting)
	 */
	public getEnemyAtPosition(x: number, y: number): EnemyVehicle | null {
		// Convert to local coordinates
		const localPos = this.globalToLocal(x, y);
		
		for (const [enemyId, elements] of this.enemyElements) {
			const container = elements.container;
			if (localPos.x >= container.getX() && 
				localPos.x <= container.getX() + container.getWidth() &&
				localPos.y >= container.getY() && 
				localPos.y <= container.getY() + container.getHeight()) {
				return this.enemies.find(e => e.id === enemyId) || null;
			}
		}
		
		return null;
	}

	/**
	 * Highlight an enemy for targeting
	 */
	public highlightEnemy(enemyId: string | null): void {
		// Clear previous highlight
		if (this.highlightedEnemyId) {
			const prevElements = this.enemyElements.get(this.highlightedEnemyId);
			if (prevElements) {
				prevElements.portrait.setBorderColor('#6a5a5a');
				prevElements.portrait.setBorderWidth(2);
			}
		}

		this.highlightedEnemyId = enemyId;

		// Apply new highlight
		if (enemyId) {
			const elements = this.enemyElements.get(enemyId);
			if (elements) {
				elements.portrait.setBorderColor('#ff4444'); // Red highlight for enemies
				elements.portrait.setBorderWidth(3);
			}
		}
	}

	/**
	 * Clear all highlights
	 */
	public clearHighlights(): void {
		this.highlightEnemy(null);
	}

	/**
	 * Get the center position of an enemy for arrow targeting
	 */
	public getEnemyCenterPosition(enemyId: string): { x: number; y: number } | null {
		const elements = this.enemyElements.get(enemyId);
		if (!elements) return null;

		const container = elements.container;
		const globalPos = this.localToGlobal(
			container.getX() + container.getWidth() / 2,
			container.getY() + container.getHeight() / 2
		);

		return globalPos;
	}

	/**
	 * Set targeting callback
	 */
	public setOnTarget(callback: ((enemy: EnemyVehicle) => void) | null): void {
		this.onTargetCallback = callback;
	}

	/**
	 * Set up targeting click handling
	 */
	private setupTargeting(): void {
		InputSystem.registerMouseDown(this, () => {
			if (!this.onTargetCallback) return;

			const mousePos = InputSystem.getMousePosition();
			const targetedEnemy = this.getEnemyAtPosition(mousePos.x, mousePos.y);
			
			if (targetedEnemy) {
				this.onTargetCallback(targetedEnemy);
			}
		});
	}
}