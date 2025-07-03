/**
 * @jest-environment jsdom
 */
import { InputSystem } from './InputSystem';
import { Rectangle } from '../components/Rectangle';

describe('InputSystem', () => {
	let mockCanvas: HTMLCanvasElement;
	let inputSystem: InputSystem;
	let testRect: Rectangle;

	beforeEach(() => {
		// Create a mock canvas element
		mockCanvas = document.createElement('canvas');
		mockCanvas.width = 800;
		mockCanvas.height = 600;
		document.body.appendChild(mockCanvas);

		// Get InputSystem instance and set it up
		inputSystem = InputSystem.getInstance();
		inputSystem.setup(mockCanvas);

		// Create test rectangle
		testRect = new Rectangle({
			x: 100,
			y: 100,
			width: 200,
			height: 100,
			style: {
				backgroundColor: '#3333cc',
			},
		});
	});

	afterEach(() => {
		// Unmount
		InputSystem.unregisterComponent(testRect);
		inputSystem.unmount();
		document.body.removeChild(mockCanvas);
	});

	test('should register component for mouse events', () => {
		// Create spy functions for event handlers
		const onMouseOver = jest.fn();
		const onMouseOut = jest.fn();
		const onMouseDown = jest.fn();
		const onMouseUp = jest.fn();

		// Register event handlers
		InputSystem.registerMouseOver(testRect, onMouseOver);
		InputSystem.registerMouseOut(testRect, onMouseOut);
		InputSystem.registerMouseDown(testRect, onMouseDown);
		InputSystem.registerMouseUp(testRect, onMouseUp);

		// Simulate mouse events

		// Mouse over test rectangle
		const mouseOverEvent = new MouseEvent('mousemove', {
			clientX: 150, // Inside rectangle
			clientY: 150, // Inside rectangle
			bubbles: true,
		});
		mockCanvas.dispatchEvent(mouseOverEvent);

		// Mouse down on test rectangle
		const mouseDownEvent = new MouseEvent('mousedown', {
			clientX: 150,
			clientY: 150,
			bubbles: true,
		});
		mockCanvas.dispatchEvent(mouseDownEvent);

		// Mouse up on test rectangle
		const mouseUpEvent = new MouseEvent('mouseup', {
			clientX: 150,
			clientY: 150,
			bubbles: true,
		});
		mockCanvas.dispatchEvent(mouseUpEvent);

		// Mouse out of test rectangle
		const mouseOutEvent = new MouseEvent('mousemove', {
			clientX: 50, // Outside rectangle
			clientY: 50, // Outside rectangle
			bubbles: true,
		});
		mockCanvas.dispatchEvent(mouseOutEvent);

		// Check that all event handlers were called
		expect(onMouseOver).toHaveBeenCalled();
		expect(onMouseDown).toHaveBeenCalled();
		expect(onMouseUp).toHaveBeenCalled();
		expect(onMouseOut).toHaveBeenCalled();
	});

	test('should unregister component', () => {
		// Create spy functions for event handlers
		const onMouseOver = jest.fn();
		const onMouseDown = jest.fn();

		// Register event handlers
		InputSystem.registerMouseOver(testRect, onMouseOver);
		InputSystem.registerMouseDown(testRect, onMouseDown);

		// Unregister component
		InputSystem.unregisterComponent(testRect);

		// Simulate mouse events
		const mouseEvent = new MouseEvent('mousemove', {
			clientX: 150, // Inside rectangle
			clientY: 150, // Inside rectangle
			bubbles: true,
		});
		mockCanvas.dispatchEvent(mouseEvent);

		// Check that event handlers were not called
		expect(onMouseOver).not.toHaveBeenCalled();
		expect(onMouseDown).not.toHaveBeenCalled();
	});
});
