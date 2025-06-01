/**
 * Style properties for UI components
 * Modeled after CSS-in-JS and React styling patterns
 */
export interface Style {
  // Position and Layout (always absolute)
  left?: string | number;
  top?: string | number;
  right?: string | number;
  bottom?: string | number;
  width?: string | number;
  height?: string | number;
  
  // Background and Colors
  backgroundColor?: string | [number, number, number, number];
  color?: string | [number, number, number, number];
  
  // Border
  border?: string;
  borderWidth?: string | number;
  borderColor?: string | [number, number, number, number];
  borderRadius?: string | number;
  
  // Typography
  fontSize?: string | number;
  fontFamily?: string;
  fontWeight?: 'normal' | 'bold' | number;
  textAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  
  // Display and Visibility
  display?: 'block' | 'none';
  visibility?: 'visible' | 'hidden';
  opacity?: number;
  
  // Spacing
  padding?: string | number;
  paddingTop?: string | number;
  paddingRight?: string | number;
  paddingBottom?: string | number;
  paddingLeft?: string | number;
  margin?: string | number;
  marginTop?: string | number;
  marginRight?: string | number;
  marginBottom?: string | number;
  marginLeft?: string | number;
  
  // Transform and Effects
  transform?: string;
  transformOrigin?: string;
  filter?: string;
  
  // Interactive States
  cursor?: 'pointer' | 'default' | 'text';
  
  // Custom game-specific properties
  zIndex?: number;
}

/**
 * Component creation options
 */
export interface ComponentOptions {
  id?: string;
  style?: Style;
}

/**
 * Text-specific options
 */
export interface TextOptions extends ComponentOptions {
  style?: Style;
}

/**
 * Utility functions for style value parsing
 */
export class StyleParser {
  /**
   * Parse a color value to RGBA array
   */
  static parseColor(color: string | [number, number, number, number]): [number, number, number, number] {
    if (Array.isArray(color)) {
      return color;
    }
    
    // Handle hex colors
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      if (hex.length === 3) {
        // #rgb -> #rrggbb
        const r = parseInt(hex[0] + hex[0], 16) / 255;
        const g = parseInt(hex[1] + hex[1], 16) / 255;
        const b = parseInt(hex[2] + hex[2], 16) / 255;
        return [r, g, b, 1];
      } else if (hex.length === 6) {
        // #rrggbb
        const r = parseInt(hex.slice(0, 2), 16) / 255;
        const g = parseInt(hex.slice(2, 4), 16) / 255;
        const b = parseInt(hex.slice(4, 6), 16) / 255;
        return [r, g, b, 1];
      } else if (hex.length === 8) {
        // #rrggbbaa
        const r = parseInt(hex.slice(0, 2), 16) / 255;
        const g = parseInt(hex.slice(2, 4), 16) / 255;
        const b = parseInt(hex.slice(4, 6), 16) / 255;
        const a = parseInt(hex.slice(6, 8), 16) / 255;
        return [r, g, b, a];
      }
    }
    
    // Handle rgb/rgba functions
    if (color.startsWith('rgb')) {
      const match = color.match(/rgba?\(([^)]+)\)/);
      if (match) {
        const values = match[1].split(',').map(v => parseFloat(v.trim()));
        if (values.length >= 3) {
          return [
            values[0] / 255,
            values[1] / 255,
            values[2] / 255,
            values.length > 3 ? values[3] : 1
          ];
        }
      }
    }
    
    // Default to white if parsing fails
    return [1, 1, 1, 1];
  }
  
  /**
   * Parse a size value to pixels
   */
  static parseSize(size: string | number): number {
    if (typeof size === 'number') {
      return size;
    }
    
    // Remove 'px' suffix if present
    if (size.endsWith('px')) {
      return parseFloat(size.slice(0, -2));
    }
    
    // For now, just parse as number
    return parseFloat(size) || 0;
  }
}