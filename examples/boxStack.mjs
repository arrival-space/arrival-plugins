/**
 * Physics Pyramid Plugin - Creates a pyramid of boxes with spheres
 * 
 * Load it using: await this.loadPlugin('path/to/boxStack.mjs');
 * 
 * Features demonstrated:
 * - Hex color strings (boxColor, sphereColor) → show color picker in UI
 * - Number properties with reasonable ranges
 * - Physics simulation with customizable parameters
 * 
 * Properties:
 * - baseSize: Number of boxes on the base row (2-10)
 * - boxSize: Size of each box in world units
 * - boxColor: Color of the boxes (#hex string → color picker)
 * - sphereCount: Number of spheres to create
 * - sphereSize: Size of spheres
 * - sphereColor: Color of spheres (#hex string → color picker)
 * - sphereHeight: Starting height for spheres
 * - emissiveStrength: Glow intensity (0-1)
 * - mass: Mass of each object (0 = static)
 * - friction: Friction coefficient
 * - restitution: Bounciness (0-1)
 */

export class BoxStack extends pc.Script {
    static scriptName = 'boxStack';
    
    // Public properties - configurable in UI
    baseSize = 5;
    boxSize = 0.3;
    boxColor = '#4a90d9';
    sphereCount = 3;
    sphereSize = 0.25;
    sphereColor = '#d94a4a';
    sphereHeight = 3;
    emissiveStrength = 0.2;
    mass = 1;
    friction = 0.5;
    restitution = 0.3;
    
    // Private properties
    _boxes = [];
    _spheres = [];
    _boxMaterial = null;
    _sphereMaterial = null;
    _lastBaseSize = 0;
    _lastBoxSize = 0;
    _lastSphereCount = 0;
    
    initialize() {
        console.log('🔺 Physics Pyramid initialized on entity:', this.entity.name);
        
        // Create the materials
        this._createMaterials();
        
        // Build initial pyramid and spheres
        this._rebuildAll();
        
        // Cleanup on destroy
        this.once('destroy', () => {
            console.log('Physics Pyramid destroyed');
            this._clearAll();
            if (this._boxMaterial) {
                this._boxMaterial.destroy();
                this._boxMaterial = null;
            }
            if (this._sphereMaterial) {
                this._sphereMaterial.destroy();
                this._sphereMaterial = null;
            }
        });
        
        this.on('enable', () => {
            for (const obj of [...this._boxes, ...this._spheres]) {
                obj.enabled = true;
            }
        });
        
        this.on('disable', () => {
            for (const obj of [...this._boxes, ...this._spheres]) {
                obj.enabled = false;
            }
        });
    }
    
    _hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (result) {
            return {
                r: parseInt(result[1], 16) / 255,
                g: parseInt(result[2], 16) / 255,
                b: parseInt(result[3], 16) / 255
            };
        }
        return { r: 0.5, g: 0.5, b: 0.5 };
    }
    
    _createMaterials() {
        // Box material
        const boxRgb = this._hexToRgb(this.boxColor);
        this._boxMaterial = new pc.StandardMaterial();
        this._boxMaterial.diffuse = new pc.Color(boxRgb.r, boxRgb.g, boxRgb.b);
        this._boxMaterial.emissive = new pc.Color(
            boxRgb.r * this.emissiveStrength,
            boxRgb.g * this.emissiveStrength,
            boxRgb.b * this.emissiveStrength
        );
        this._boxMaterial.update();
        
        // Sphere material
        const sphereRgb = this._hexToRgb(this.sphereColor);
        this._sphereMaterial = new pc.StandardMaterial();
        this._sphereMaterial.diffuse = new pc.Color(sphereRgb.r, sphereRgb.g, sphereRgb.b);
        this._sphereMaterial.emissive = new pc.Color(
            sphereRgb.r * this.emissiveStrength,
            sphereRgb.g * this.emissiveStrength,
            sphereRgb.b * this.emissiveStrength
        );
        this._sphereMaterial.update();
    }
    
    _clearAll() {
        for (const box of this._boxes) {
            if (box && !box._destroyed) box.destroy();
        }
        this._boxes = [];
        
        for (const sphere of this._spheres) {
            if (sphere && !sphere._destroyed) sphere.destroy();
        }
        this._spheres = [];
    }
    
    _rebuildAll() {
        this._clearAll();
        
        const base = Math.max(2, Math.min(10, Math.floor(this.baseSize)));
        const size = Math.max(0.05, this.boxSize);
        
        // Build pyramid: each layer has one less box per side
        for (let layer = 0; layer < base; layer++) {
            const layerSize = base - layer;
            const yPos = (size / 2) + layer * size;
            
            // Offset to center each layer
            const offset = (layerSize - 1) * size / 2;
            
            for (let x = 0; x < layerSize; x++) {
                for (let z = 0; z < layerSize; z++) {
                    const box = new pc.Entity(`PyramidBox_${layer}_${x}_${z}`);
                    this.entity.addChild(box);
                    
                    box.addComponent('render', {
                        type: 'box',
                        material: this._boxMaterial
                    });
                    
                    const xPos = x * size - offset;
                    const zPos = z * size - offset;
                    box.setLocalPosition(xPos, yPos, zPos);
                    box.setLocalScale(size, size, size);
                    
                    box.addComponent('collision', {
                        type: 'box',
                        halfExtents: new pc.Vec3(size / 2, size / 2, size / 2)
                    });
                    
                    box.addComponent('rigidbody', {
                        type: this.mass > 0 ? 'dynamic' : 'static',
                        mass: this.mass,
                        friction: this.friction,
                        restitution: this.restitution
                    });
                    
                    this._boxes.push(box);
                }
            }
        }
        
        // Create spheres
        const sphereCount = Math.max(0, Math.min(10, Math.floor(this.sphereCount)));
        const sphereRadius = Math.max(0.05, this.sphereSize / 2);
        
        for (let i = 0; i < sphereCount; i++) {
            const sphere = new pc.Entity(`Sphere_${i}`);
            this.entity.addChild(sphere);
            
            sphere.addComponent('render', {
                type: 'sphere',
                material: this._sphereMaterial
            });
            
            // Position spheres spread out above the pyramid
            const angle = (i / sphereCount) * Math.PI * 2;
            const radius = 0.5 + i * 0.2;
            const xPos = Math.sin(angle) * radius;
            const zPos = Math.cos(angle) * radius;
            const yPos = this.sphereHeight + i * 0.3;
            
            sphere.setLocalPosition(xPos, yPos, zPos);
            sphere.setLocalScale(this.sphereSize, this.sphereSize, this.sphereSize);
            
            sphere.addComponent('collision', {
                type: 'sphere',
                radius: sphereRadius
            });
            
            sphere.addComponent('rigidbody', {
                type: this.mass > 0 ? 'dynamic' : 'static',
                mass: this.mass * 0.5, // Spheres are lighter
                friction: this.friction,
                restitution: this.restitution + 0.2 // Spheres are bouncier
            });
            
            this._spheres.push(sphere);
        }
        
        // Store current values
        this._lastBaseSize = this.baseSize;
        this._lastBoxSize = this.boxSize;
        this._lastSphereCount = this.sphereCount;
        
        console.log(`Physics Pyramid: Created ${this._boxes.length} boxes and ${this._spheres.length} spheres`);
    }
    
    update(dt) {
        // Check if we need to rebuild
        const needsRebuild = 
            this.baseSize !== this._lastBaseSize ||
            this.boxSize !== this._lastBoxSize ||
            this.sphereCount !== this._lastSphereCount;
        
        if (needsRebuild) {
            this._rebuildAll();
        }
    }
}
