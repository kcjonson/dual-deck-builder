import { BattlefieldLayer } from './BattlefieldLayer';
import { Vehicle as VehicleData } from '../../mechanics/Vehicle';
import { Vehicle as VehicleUI } from '../../ui/Vehicle';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Text } from '../../../engine/components/Text';
import { CombatModel } from './CombatModel';

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
 * Enemy-specific vehicle UI component
 */
class EnemyVehicle extends VehicleUI {
  private intentIndicator!: Rectangle;
  private intentText!: Text;
  private intent: EnemyIntent | null = null;

  protected createElements(): void {
    super.createElements();

    // Add intent indicator
    const width = this.getWidth();
    const height = this.getHeight();

    this.intentIndicator = new Rectangle({
      x: Math.floor(width * 0.7),
      y: Math.floor(height * 0.05),
      width: 30,
      height: 30,
      style: {
        backgroundColor: '#aa4a4a',
        borderColor: '#cc6a6a',
        borderWidth: 2,
        borderRadius: 15,
      },
    });
    this.addChild(this.intentIndicator);

    this.intentText = new Text('!', {
      style: {
        fontSize: 16,
        color: '#ffffff',
        textAlign: 'center',
        fontWeight: 'bold',
      },
    });
    this.intentText.setPosition(Math.floor(width * 0.85), Math.floor(height * 0.2));
    this.addChild(this.intentText);
  }

  protected getPortraitColor(): string {
    return '#4a3a3a'; // Enemy red tint
  }

  protected getBorderColor(): string {
    return '#6a5a5a'; // Enemy red border
  }

  protected getDisplayName(): string {
    // Enemies just show vehicle name, not driver name
    return this.vehicleData.name;
  }

  /**
   * Set enemy intent
   */
  public setIntent(intent: EnemyIntent | null): void {
    this.intent = intent;
    this.updateIntent();
  }

  /**
   * Update intent display
   */
  private updateIntent(): void {
    if (!this.intent) {
      this.intentIndicator.setVisible(false);
      this.intentText.setVisible(false);
      return;
    }

    this.intentIndicator.setVisible(true);
    this.intentText.setVisible(true);
    this.intentIndicator.setFillColor(this.getIntentColor(this.intent.type));
    this.intentText.setText(this.getIntentDisplay(this.intent));
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
}

/**
 * Enemy battlefield display layer
 * Shows enemy vehicles with intent indicators
 */
export class EnemyBattlefieldLayer extends BattlefieldLayer {
  // Map of vehicle IDs to their intents
  private vehicleIntents: Map<string, EnemyIntent> = new Map();

  constructor(options: { 
    x: number; 
    y: number; 
    width: number; 
    height: number;
    combatData?: CombatModel;
  }) {
    super(options);

    // Background for battlefield
    const background = new Rectangle({
      x: 0,
      y: 0,
      width: this.getWidth(),
      height: this.getHeight(),
      style: {
        backgroundColor: '#2a1a1a', // Dark enemy battlefield
      },
    });
    this.addChild(background);

    // Lane dividers
    this.createLaneDividers();

    // Lane labels
    this.createLaneLabels();

    // Background is already first child, so it's at the back
  }

  /**
   * Create visual lane dividers
   */
  private createLaneDividers(): void {
    const laneWidth = Math.floor(this.getWidth() / 3);

    // Divider between Front and Back
    const divider1 = new Rectangle({
      x: laneWidth - 1,
      y: 40,
      width: 2,
      height: this.getHeight() - 40,
      style: {
        backgroundColor: '#3a2a2a',
      },
    });
    this.addChild(divider1);

    // Divider between Back and Flanking
    const divider2 = new Rectangle({
      x: (laneWidth * 2) - 1,
      y: 40,
      width: 2,
      height: this.getHeight() - 40,
      style: {
        backgroundColor: '#3a2a2a',
      },
    });
    this.addChild(divider2);
  }

  /**
   * Create lane labels (mirrored from player)
   */
  private createLaneLabels(): void {
    const laneWidth = Math.floor(this.getWidth() / 3);
    const labels = ['FRONT', 'BACK', 'FLANKING']; // Reversed order for enemy

    labels.forEach((label, index) => {
      const text = new Text(label, {
        style: {
          fontSize: 14,
          color: '#8a6a6a',
          textAlign: 'center',
          fontWeight: 'bold',
        },
      });
      text.setPosition(Math.floor(laneWidth * index + laneWidth / 2), 20);
      this.addChild(text);
    });
  }

  /**
   * Get card dimensions for enemy vehicles
   */
  protected getCardWidth(): number {
    return 140; // Slightly smaller than player vehicles
  }

  protected getCardHeight(): number {
    return Math.floor(this.getHeight() * 0.55); // Slightly smaller
  }

  /**
   * Create a vehicle display component
   */
  protected createVehicleCard(vehicle: VehicleData): VehicleUI {
    const enemyVehicle = new EnemyVehicle({
      x: 0,
      y: 0,
      width: this.getCardWidth(),
      height: this.getCardHeight(),
      vehicleData: vehicle,
      combatData: this.combatData || undefined,
      onClick: (v) => {
        // When clicked, attempt to target this vehicle
        this.combatData?.targetVehicle(v);
      }
    });

    // Set intent if we have one for this vehicle
    const intent = this.vehicleIntents.get(vehicle.id);
    if (intent) {
      enemyVehicle.setIntent(intent);
    }

    return enemyVehicle;
  }

  /**
   * Update an existing vehicle display
   */
  protected updateVehicleCard(vehicle: VehicleData, card: VehicleUI): void {
    // Update the data
    card.data = vehicle;

    // Update intent if it's an enemy vehicle
    if (card instanceof EnemyVehicle) {
      const intent = this.vehicleIntents.get(vehicle.id);
      card.setIntent(intent || null);
    }
  }

  /**
   * Set intent for a specific vehicle
   */
  public setVehicleIntent(vehicleId: string, intent: EnemyIntent): void {
    this.vehicleIntents.set(vehicleId, intent);
    
    // Update the vehicle card if it exists
    const card = this.vehicleCards.get(vehicleId);
    if (card && card instanceof EnemyVehicle) {
      card.setIntent(intent);
    }
  }

  /**
   * Clear intent for a specific vehicle
   */
  public clearVehicleIntent(vehicleId: string): void {
    this.vehicleIntents.delete(vehicleId);
    
    // Update the vehicle card if it exists
    const card = this.vehicleCards.get(vehicleId);
    if (card && card instanceof EnemyVehicle) {
      card.setIntent(null);
    }
  }

  // Removed - targeting is now handled by Vehicle components directly

  /**
   * Handle resize
   */
  protected onResized(): void {
    // Update background
    const background = this.children[0] as Rectangle;
    if (background) {
      background.setWidth(this.getWidth());
      background.setHeight(this.getHeight());
    }

    // Recreate dividers and labels
    // Remove old ones first
    const toRemove = this.children.filter(child =>
      child !== background && !(child instanceof VehicleUI)
    );
    toRemove.forEach(child => this.removeChild(child));

    // Recreate
    this.createLaneDividers();
    this.createLaneLabels();

    // Call parent resize
    super.onResized();
  }
}