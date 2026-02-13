/**
 * Sound Trigger Plugin
 * 
 * Plays a sound when the player gets close to this object.
 * Demonstrates using ArrivalSpace.playSound() and proximity detection.
 * 
 * Features demonstrated:
 * - String property (soundUrl) → shows EditText (single line) in UI  
 * - Number properties with min/max → shows sliders in UI
 */
export class SoundTrigger extends ArrivalScript {
    static scriptName = 'Sound Trigger';
    
    // Properties
    soundUrl = "";
    triggerDistance = 3;
    volume = 0.8;
    cooldown = 5;           // seconds before can trigger again
    
    static properties = {
        soundUrl: { title: 'Sound URL' },
        triggerDistance: { title: 'Trigger Distance', min: 0.5, max: 20 },
        volume: { title: 'Volume', min: 0, max: 1 },
        cooldown: { title: 'Cooldown (seconds)', min: 0, max: 60 }
    };
    
    // Private
    _lastPlayed = 0;
    _isPlaying = false;
    
    update(dt) {
        if (!this.soundUrl) return;
        
        // Find camera (player position)
        const camera = ArrivalSpace.getCamera();
        if (!camera) return;
        
        const playerPos = camera.getPosition();
        const myPos = this.position;
        const distance = playerPos.distance(myPos);
        
        // Check if player is within trigger distance
        if (distance < this.triggerDistance) {
            const now = Date.now() / 1000;
            
            // Check cooldown
            if (now - this._lastPlayed > this.cooldown && !this._isPlaying) {
                this._playSound();
                this._lastPlayed = now;
            }
        }
    }
    
    async _playSound() {
        this._isPlaying = true;
        
        try {
            const { slot } = await ArrivalSpace.playSound(this.soundUrl, {
                position: this.position,
                volume: this.volume
            });
            
            // Wait for sound to finish
            slot.once('end', () => {
                this._isPlaying = false;
            });
        } catch (err) {
            console.error('SoundTrigger: Failed to play sound:', err);
            this._isPlaying = false;
        }
    }
}
