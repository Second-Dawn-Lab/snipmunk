// Undo and redo (no React): a stack of states with a cursor. Each capture has its own; they live in memory while the
// session runs (the annotations themselves are saved with the capture).

export class History<T> {
  private states: T[];
  private at = 0;
  private lastKey: string | null = null;
  private lastTime = 0;

  constructor(
    initial: T,
    private readonly limit = 200,
    private readonly now: () => number = Date.now,
  ) {
    this.states = [initial];
  }

  get current(): T {
    return this.states[this.at];
  }

  get canUndo(): boolean {
    return this.at > 0;
  }

  get canRedo(): boolean {
    return this.at < this.states.length - 1;
  }

  /**
   * A new state after a change. Changes with the same `key` within `windowMs` of each other (dragging a slider, typing)
   * replace the top state instead of adding steps. Anything that could have been redone is gone.
   */
  push(state: T, key: string | null = null, windowMs = 700): void {
    const t = this.now();
    this.states.length = this.at + 1;
    if (key !== null && key === this.lastKey && t - this.lastTime <= windowMs && this.at > 0) {
      this.states[this.at] = state;
    } else {
      this.states.push(state);
      this.at++;
      if (this.states.length > this.limit) {
        this.states.shift();
        this.at--;
      }
    }
    this.lastKey = key;
    this.lastTime = t;
  }

  undo(): T | null {
    if (!this.canUndo) return null;
    this.at--;
    this.lastKey = null;
    return this.current;
  }

  redo(): T | null {
    if (!this.canRedo) return null;
    this.at++;
    this.lastKey = null;
    return this.current;
  }
}
