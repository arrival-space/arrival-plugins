/**
 * GLB Model Plugin - Demonstrates using ArrivalPluginUtils
 * 
 * This plugin shows how to use the shared utility functions from scripts/pluginUtils.mjs
 * to load GLB models with much less boilerplate code.
 * 
 * Load it using: await this.loadPlugin('path/to/glbModel.mjs');
 * 
 * UTILITY USAGE:
 * - Uses `loadGLB()` from ArrivalPluginUtils for model loading
 * - Uses `createMaterial()` for fallback box material
 * - Uses `disposeEntity()` for cleanup
 * 
 * Available utilities (window.ArrivalPluginUtils):
 * - loadGLB(url, options)         - Load GLB/GLTF models
 * - loadTexture(url, options)     - Load textures
 * - createHTMLPanel(options)      - Create interactive 3D HTML panels
 * - createTexturePanel(options)   - Create transparent 3D panels with links
 * - playSound(url, options)       - Play 3D positional audio
 * - createMaterial(options)       - Create materials easily
 * - disposeEntity(entity)         - Safe cleanup
 * 
 * See: scripts/PLUGIN_UTILS_README.md for full documentation
 */

// Get utilities - available globally after pluginUtils.mjs is loaded
const { loadGLB, createMaterial, disposeEntity } = window.ArrivalPluginUtils || {};

export class BouncyBox extends pc.Script {
    static scriptName = 'bouncyBox';
    
    // Public properties - these will be synced with this.data.params
    // and can be exposed in the UI
    rotationSpeed = 45; // degrees per second
    bounceHeight = 0.5;
    bounceSpeed = 2;
    modelScale = 1.0;
    modelUrl = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Duck/glTF-Binary/Duck.glb';
    
    // Private properties (starting with _) are ignored
    _time = 0;
    _startY = 0;
    _modelEntity = null;
    _currentModelUrl = null;
    _isLoading = false;
    
    initialize() {
        console.log('🚀 BouncyBox initialized on entity:', this.entity.name);
        
        // Store the initial Y position for bouncing
        this._startY = this.entity.getLocalPosition().y;
        
        // Load the model using utilities
        this._loadModel(this.modelUrl);
        
        // Listen for enable/disable events
        this.on('enable', () => {
            console.log('BouncyBox enabled');
            if (this._modelEntity) this._modelEntity.enabled = true;
        });
        
        this.on('disable', () => {
            console.log('BouncyBox disabled');
            if (this._modelEntity) this._modelEntity.enabled = false;
        });
        
        this.once('destroy', () => {
            console.log('BouncyBox destroyed');
            if (this._modelEntity) {
                // Use utility for safe cleanup
                if (disposeEntity) {
                    disposeEntity(this._modelEntity);
                } else {
                    this._modelEntity.destroy();
                }
                this._modelEntity = null;
            }
        });
    }
    
    async _loadModel(url) {
        if (!url || this._isLoading) return;
        
        // Don't reload the same URL
        if (url === this._currentModelUrl && this._modelEntity) return;
        
        this._isLoading = true;
        console.log('BouncyBox: Loading model from:', url);
        
        // Destroy existing model
        if (this._modelEntity) {
            if (disposeEntity) {
                disposeEntity(this._modelEntity);
            } else {
                this._modelEntity.destroy();
            }
            this._modelEntity = null;
        }
        
        // Use utility if available, otherwise fallback to manual loading
        if (loadGLB) {
            try {
                const { entity } = await loadGLB(url, {
                    parent: this.entity,
                    name: 'PluginModel',
                    scale: this.modelScale,
                    onLoad: () => console.log('BouncyBox: Model loaded successfully')
                });
                this._modelEntity = entity;
                this._currentModelUrl = url;
            } catch (err) {
                console.error('BouncyBox: Failed to load model:', err);
                this._createFallbackBox();
            }
        } else {
            // Fallback: manual loading if utilities not available
            this._loadModelManual(url);
        }
        
        this._isLoading = false;
    }
    
    // Fallback manual loading (if utilities not loaded)
    _loadModelManual(url) {
        this._modelEntity = new pc.Entity('PluginModel');
        this.entity.addChild(this._modelEntity);
        this._modelEntity.setLocalScale(this.modelScale, this.modelScale, this.modelScale);
        
        const asset = new pc.Asset('pluginModel', 'container', { url: url });
        
        asset.on('load', (asset) => {
            this._currentModelUrl = url;
            if (!this._modelEntity) return;
            const modelInstance = asset.resource.instantiateRenderEntity();
            this._modelEntity.addChild(modelInstance);
        });
        
        asset.on('error', () => this._createFallbackBox());
        
        this.app.assets.add(asset);
        this.app.assets.load(asset);
    }
    
    _createFallbackBox() {
        if (!this._modelEntity) {
            this._modelEntity = new pc.Entity('PluginFallbackBox');
            this.entity.addChild(this._modelEntity);
        }
        
        // Clear children
        while (this._modelEntity.children.length > 0) {
            this._modelEntity.children[0].destroy();
        }
        
        // Add render component with box primitive
        if (!this._modelEntity.render) {
            this._modelEntity.addComponent('render', {
                type: 'box'
            });
        }
        
        // Use utility for material if available
        let material;
        if (createMaterial) {
            material = createMaterial({
                diffuse: { r: 0.8, g: 0.2, b: 0.2 },
                emissive: { r: 0.4, g: 0.1, b: 0.1 }
            });
        } else {
            material = new pc.StandardMaterial();
            material.diffuse = new pc.Color(0.8, 0.2, 0.2);
            material.emissive = new pc.Color(0.4, 0.1, 0.1);
            material.update();
        }
        this._modelEntity.render.material = material;
        
        this._modelEntity.setLocalScale(this.modelScale * 0.3, this.modelScale * 0.3, this.modelScale * 0.3);
    }
    
    update(dt) {
        this._time += dt;
        
        // Rotate the entity
        this.entity.rotate(0, this.rotationSpeed * dt, 0);
        
        // Bounce up and down using sine wave
        const pos = this.entity.getLocalPosition();
        pos.y = this._startY + Math.sin(this._time * this.bounceSpeed) * this.bounceHeight;
        this.entity.setLocalPosition(pos);
        
        // Check if modelUrl changed and reload if needed
        if (this.modelUrl !== this._currentModelUrl && !this._isLoading) {
            this._loadModel(this.modelUrl);
        }
        
        // Update model scale
        if (this._modelEntity) {
            this._modelEntity.setLocalScale(this.modelScale, this.modelScale, this.modelScale);
        }
    }
    
    // Custom method that can be called from outside
    setSpeed(rotation, bounce) {
        this.rotationSpeed = rotation;
        this.bounceSpeed = bounce;
        console.log(`BouncyBox: Speed updated - rotation: ${rotation}, bounce: ${bounce}`);
    }
}
