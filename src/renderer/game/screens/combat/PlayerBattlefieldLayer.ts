import { BattlefieldLayer } from './BattlefieldLayer';
import { Vehicle as VehicleData } from '../../mechanics/Vehicle';
import { Vehicle as VehicleUI } from '../../ui/Vehicle';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Text } from '../../../engine/components/Text';
import { CombatModel } from './CombatModel';

/**
 * Player-specific vehicle UI component
 */
class PlayerVehicle extends VehicleUI {
  protected getPortraitColor(): string {
    return '#4a5a4a'; // Player green tint
  }

  protected getBorderColor(): string {
    return '#6a8a6a'; // Player green border
  }
}

/**
 * Player battlefield display layer
 * Shows player vehicles with targeting support
 */
export class PlayerBattlefieldLayer extends BattlefieldLayer {
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
        backgroundColor: '#3a2a1a', // Dusty battlefield color
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

    // Divider between Flanking and Back
    const divider1 = new Rectangle({
      x: laneWidth - 1,
      y: 40,
      width: 2,
      height: this.getHeight() - 40,
      style: {
        backgroundColor: '#4a3a2a',
      },
    });
    this.addChild(divider1);

    // Divider between Back and Front
    const divider2 = new Rectangle({
      x: (laneWidth * 2) - 1,
      y: 40,
      width: 2,
      height: this.getHeight() - 40,
      style: {
        backgroundColor: '#4a3a2a',
      },
    });
    this.addChild(divider2);
  }

  /**
   * Create lane labels
   */
  private createLaneLabels(): void {
    const laneWidth = Math.floor(this.getWidth() / 3);
    const labels = ['FLANKING', 'BACK', 'FRONT'];

    labels.forEach((label, index) => {
      const text = new Text(label, {
        style: {
          fontSize: 14,
          color: '#8a7a6a',
          textAlign: 'center',
          fontWeight: 'bold',
        },
      });
      text.setPosition(Math.floor(laneWidth * index + laneWidth / 2), 20);
      this.addChild(text);
    });
  }

  /**
   * Get card dimensions for player vehicles
   */
  protected getCardWidth(): number {
    return 160;
  }

  protected getCardHeight(): number {
    return Math.floor(this.getHeight() * 0.6);
  }

  /**
   * Create a vehicle display component
   */
  protected createVehicleCard(vehicle: VehicleData): VehicleUI {
    return new PlayerVehicle({
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
  }

  /**
   * Update an existing vehicle display
   */
  protected updateVehicleCard(vehicle: VehicleData, card: VehicleUI): void {
    // Just update the data, the Vehicle component handles the rest
    card.data = vehicle;
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