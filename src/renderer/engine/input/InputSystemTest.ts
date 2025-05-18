import { InputSystem } from './InputSystem';
import { Rectangle } from '../components/Rectangle';

/**
 * Simple test functions to verify InputSystem functionality
 * This file can be imported and run in the developer screen or test environment
 */
export class InputSystemTest {
  /**
   * Test basic InputSystem functionality with a simple rectangle
   * @param canvas Canvas element to use for the test
   * @returns The test rectangle that was created
   */
  public static runBasicTest(canvas: HTMLCanvasElement): Rectangle {
    console.log('Running InputSystem basic test...');
    
    // Initialize input system with canvas
    InputSystem.getInstance().setup(canvas);
    
    // Create a test rectangle that changes color on hover and click
    const testRect = new Rectangle('test_rect');
    testRect.setPosition(100, 100);
    testRect.setSize(200, 100);
    testRect.setFillColor([0.2, 0.2, 0.8, 1.0]);
    
    // Register event handlers
    InputSystem.registerMouseOver(testRect, () => {
      console.log('Mouse over rectangle');
      testRect.setFillColor([0.3, 0.3, 0.9, 1.0]);
    });
    
    InputSystem.registerMouseOut(testRect, () => {
      console.log('Mouse out rectangle');
      testRect.setFillColor([0.2, 0.2, 0.8, 1.0]);
    });
    
    InputSystem.registerMouseDown(testRect, () => {
      console.log('Mouse down on rectangle');
      testRect.setFillColor([0.1, 0.1, 0.7, 1.0]);
    });
    
    InputSystem.registerMouseUp(testRect, () => {
      console.log('Mouse up on rectangle');
      testRect.setFillColor([0.3, 0.3, 0.9, 1.0]);
      alert('Rectangle clicked!');
    });
    
    // Report success
    console.log('InputSystem test setup complete. Hover and click the blue rectangle to test.');
    
    // Return the test rectangle so it can be added to the scene
    return testRect;
  }
  
  /**
   * Clean up test resources
   * @param testRect The test rectangle created by runBasicTest
   */
  public static cleanupTest(testRect: Rectangle): void {
    if (testRect) {
      InputSystem.unregisterComponent(testRect);
    }
    console.log('InputSystem test cleaned up');
  }
}
