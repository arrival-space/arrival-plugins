/**
 * Model Loader Plugin
 * 
 * Loads a GLB model when the plugin initializes.
 * Demonstrates async initialization and ArrivalSpace.loadGLB().
 * 
 * Features demonstrated:
 * - String property (modelUrl) → shows EditText (single line) in UI
 * - Number property with min/max → shows slider in UI
 * - Boolean properties → show toggles in UI
 */
export class ModelLoader extends ArrivalScript {
    static scriptName = 'modelLoader';
    
    // Properties
    modelUrl = "";
    scale = 1.0;
    castShadows = true;
    receiveShadows = true;
    
    static properties = {
        modelUrl: { title: 'Model URL' },
        scale: { title: 'Scale', min: 0.01, max: 10 },
        castShadows: { title: 'Cast Shadows' },
        receiveShadows: { title: 'Receive Shadows' }
    };
    
    // Private
    _loadedEntity = null;
    
    async initialize() {
        if (this.modelUrl) {
            await this._loadModel();
        }
    }
    
    async _loadModel() {
        // Remove existing model if any
        if (this._loadedEntity) {
            this._loadedEntity.destroy();
            this._loadedEntity = null;
        }
        
        if (!this.modelUrl) return;
        
        try {
            const { entity } = await ArrivalSpace.loadGLB(this.modelUrl, {
                parent: this.entity,
                scale: this.scale,
                castShadows: this.castShadows,
                receiveShadows: this.receiveShadows
            });
            
            this._loadedEntity = entity;
            console.log('ModelLoader: Loaded', this.modelUrl);
            
        } catch (err) {
            console.error('ModelLoader: Failed to load model:', err);
        }
    }
}
