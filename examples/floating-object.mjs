/**
 * Floating Object Plugin
 * 
 * Makes an object float up and down with a smooth sine wave motion.
 * Demonstrates properties with schema hints.
 * 
 * Features demonstrated:
 * - Number properties with min/max → shows slider in UI
 * - Boolean property → shows toggle in UI
 * - Static properties schema → provides title, min, max for UI
 */
export class FloatingObject extends ArrivalScript {
    static scriptName = 'floatingObject';
    
    // Number properties (shown in editor with slider when min/max defined)
    height = 0.5;
    speed = 2;
    // Boolean property (shown as toggle)
    enabled = true;
    
    // Schema for better UI - defines title and constraints
    static properties = {
        height: { title: 'Float Height', min: 0, max: 5 },
        speed: { title: 'Float Speed', min: 0, max: 10 },
        enabled: { title: 'Enable Floating' }
    };
    
    // Private state
    _time = 0;
    _startY = 0;
    
    initialize() {
        this._startY = this.localPosition.y;
    }
    
    update(dt) {
        if (!this.enabled) return;
        
        this._time += dt;
        
        const pos = this.localPosition;
        pos.y = this._startY + Math.sin(this._time * this.speed) * this.height;
        this.localPosition = pos;
    }
}
