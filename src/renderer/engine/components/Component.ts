/**
 * Base Component class that all components will inherit from
 */
export abstract class Component {
  protected id: string;
  protected x: number = 0;
  protected y: number = 0;
  protected width: number = 0;
  protected height: number = 0;
  protected visible: boolean = true;
  protected parent: Component | null = null;
  protected children: Component[] = [];

  /**
   * Create a new component
   * @param id Unique identifier for this component
   */
  constructor(id: string) {
    this.id = id;
  }

  /**
   * Get the component's unique ID
   */
  public getId(): string {
    return this.id;
  }

  /**
   * Set the component's position
   */
  public setPosition(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }

  /**
   * Set the component's size
   */
  public setSize(width: number, height: number): this {
    this.width = width;
    this.height = height;
    return this;
  }

  /**
   * Set the component's visibility
   */
  public setVisible(visible: boolean): this {
    this.visible = visible;
    return this;
  }

  /**
   * Get the component's x position
   */
  public getX(): number {
    return this.x;
  }

  /**
   * Get the component's y position
   */
  public getY(): number {
    return this.y;
  }

  /**
   * Get the component's width
   */
  public getWidth(): number {
    return this.width;
  }

  /**
   * Get the component's height
   */
  public getHeight(): number {
    return this.height;
  }

  /**
   * Get whether the component is visible
   */
  public isVisible(): boolean {
    return this.visible;
  }

  /**
   * Add a child component
   */
  public addChild(child: Component): this {
    child.parent = this;
    this.children.push(child);
    return this;
  }

  /**
   * Remove a child component
   */
  public removeChild(child: Component): boolean {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children[index].parent = null;
      this.children.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get all child components
   */
  public getChildren(): Component[] {
    return this.children;
  }

  /**
   * Get parent component
   */
  public getParent(): Component | null {
    return this.parent;
  }

  /**
   * Check if a point is inside this component
   */
  public containsPoint(x: number, y: number): boolean {
    return (
      x >= this.x &&
      x <= this.x + this.width &&
      y >= this.y &&
      y <= this.y + this.height
    );
  }

  /**
   * Update method for game logic
   * @param dt Time since last update in seconds
   */
  public update(dt: number): void {
    // Update children
    for (const child of this.children) {
      child.update(dt);
    }
  }

  /**
   * Render method to draw the component
   * This should be implemented by each subclass
   */
  public abstract render(): void;
}
