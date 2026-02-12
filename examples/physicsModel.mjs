/**
 * Physics Model Plugin for Arrival.Space
 * 
 * This plugin loads a GLB model and adds a rigid body with physics simulation.
 * Load it using: await this.loadPlugin('path/to/physicsModel.mjs');
 * 
 * Physics parameters are exposed in the UI for real-time tweaking.
 */

export class PhysicsModel extends pc.Script {
    static scriptName = 'physicsModel';
    
    // Model properties
    modelUrl = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Box/glTF-Binary/Box.glb';
    modelScale = 1.0;
    
    // Physics properties
    mass = 1.0;           // 0 = static/kinematic
    friction = 0.5;       // 0-1, how much friction when sliding
    restitution = 0.3;    // 0-1, bounciness
    linearDamping = 0.0;  // 0-1, air resistance for movement
    angularDamping = 0.0; // 0-1, air resistance for rotation
    
    // Collision shape
    collisionScale = 1.0;    // Multiplier for the auto-calculated collision size
    useBoxCollision = true;  // true = box (uses mesh AABB), false = sphere
    
    // Private properties
    _modelEntity = null;
    _currentModelUrl = null;
    _isLoading = false;
    _rigidBody = null;
    _meshAabb = null;        // Cached AABB from loaded mesh
    
    initialize() {
        console.log('🎱 PhysicsModel initialized on entity:', this.entity.name);
        
        // Load the model first - physics will be set up after model loads
        this._loadModel(this.modelUrl);
        
        // Listen for destroy event
        this.once('destroy', () => {
            console.log('PhysicsModel destroyed');
            this._cleanupPhysics();
            if (this._modelEntity) {
                this._modelEntity.destroy();
                this._modelEntity = null;
            }
        });
    }
    
    _cleanupPhysics() {
        // Remove physics components in correct order
        if (this.entity.rigidbody) {
            this.entity.removeComponent('rigidbody');
            this._rigidBody = null;
        }
        if (this.entity.collision) {
            this.entity.removeComponent('collision');
        }
    }
    
    _setupCollision() {
        try {
            // Remove existing rigidbody first (must be removed before collision)
            if (this.entity.rigidbody) {
                this.entity.removeComponent('rigidbody');
                this._rigidBody = null;
            }
            
            // Remove existing collision if any
            if (this.entity.collision) {
                this.entity.removeComponent('collision');
            }
            
            const collisionType = this.useBoxCollision ? 'box' : 'sphere';
            
            // Calculate size from AABB if available, otherwise use default
            const scale = this.modelScale * this.collisionScale;
            
            let halfExtents = { x: 0.5 * scale, y: 0.5 * scale, z: 0.5 * scale };
            let radius = 0.5 * scale;
            
            if (this._meshAabb) {
                const he = this._meshAabb.halfExtents;
                halfExtents = { x: he.x * scale, y: he.y * scale, z: he.z * scale };
                radius = Math.max(he.x, he.y, he.z) * scale;
            }
            
            if (this.useBoxCollision) {
                this.entity.addComponent('collision', {
                    type: 'box',
                    halfExtents: new pc.Vec3(halfExtents.x, halfExtents.y, halfExtents.z)
                });
                console.log(`PhysicsModel: Added box collision`, halfExtents);
            } else {
                this.entity.addComponent('collision', {
                    type: 'sphere',
                    radius: radius
                });
                console.log(`PhysicsModel: Added sphere collision, radius:`, radius);
            }
        } catch (err) {
            console.error('PhysicsModel: Error setting up collision:', err);
        }
    }
    
    _setupRigidBody() {
        try {
            // Remove existing rigidbody if any
            if (this.entity.rigidbody) {
                this.entity.removeComponent('rigidbody');
            }
            
            // Make sure collision exists before adding rigidbody
            if (!this.entity.collision) {
                console.warn('PhysicsModel: Cannot add rigidbody without collision component');
                return;
            }
            
            const bodyType = this.mass === 0 ? pc.BODYTYPE_STATIC : pc.BODYTYPE_DYNAMIC;
            
            this.entity.addComponent('rigidbody', {
                type: bodyType,
                mass: this.mass,
                friction: this.friction,
                restitution: this.restitution,
                linearDamping: this.linearDamping,
                angularDamping: this.angularDamping
            });
            
            this._rigidBody = this.entity.rigidbody;
            console.log(`PhysicsModel: Added rigidbody (type: ${bodyType === pc.BODYTYPE_STATIC ? 'static' : 'dynamic'})`);
        } catch (err) {
            console.error('PhysicsModel: Error setting up rigidbody:', err);
            this._rigidBody = null;
        }
    }
    
    _loadModel(url) {
        if (!url || this._isLoading) return;
        
        // Don't reload the same URL
        if (url === this._currentModelUrl && this._modelEntity) return;
        
        this._isLoading = true;
        console.log('PhysicsModel: Loading model from:', url);
        
        // Destroy existing model
        if (this._modelEntity) {
            this._modelEntity.destroy();
            this._modelEntity = null;
        }
        
        // Create container entity for the model
        this._modelEntity = new pc.Entity('PhysicsPluginModel');
        this.entity.addChild(this._modelEntity);
        this._modelEntity.setLocalScale(this.modelScale, this.modelScale, this.modelScale);
        
        // Load the GLB/GLTF
        const asset = new pc.Asset('physicsPluginModel', 'container', { url: url });
        
        asset.on('load', (asset) => {
            console.log('PhysicsModel: Model loaded successfully');
            this._currentModelUrl = url;
            this._isLoading = false;
            
            if (!this._modelEntity) return; // Entity was destroyed during load
            
            // Instantiate the model
            const modelInstance = asset.resource.instantiateRenderEntity();
            this._modelEntity.addChild(modelInstance);
            
            // Calculate AABB from the loaded model
            this._calculateMeshAabb(modelInstance);
            
            // Now set up physics with correct size (delayed to next frame for stability)
            setTimeout(() => {
                if (this.entity && this._meshAabb) {
                    this._setupCollision();
                    this._setupRigidBody();
                }
            }, 0);
        });
        
        asset.on('error', (err) => {
            console.error('PhysicsModel: Failed to load model:', err);
            this._isLoading = false;
            
            // Create fallback box on error
            this._createFallbackBox();
        });
        
        this.app.assets.add(asset);
        this.app.assets.load(asset);
    }
    
    _createFallbackBox() {
        if (!this._modelEntity) {
            this._modelEntity = new pc.Entity('PhysicsFallbackBox');
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
        
        // Create a simple colored material
        const material = new pc.StandardMaterial();
        material.diffuse = new pc.Color(0.2, 0.5, 0.8); // Blue for physics
        material.emissive = new pc.Color(0.1, 0.2, 0.4);
        material.update();
        this._modelEntity.render.material = material;
        
        this._modelEntity.setLocalScale(this.modelScale * 0.3, this.modelScale * 0.3, this.modelScale * 0.3);
    }
    
    _calculateMeshAabb(rootEntity) {
        // Calculate combined AABB from all render components in the hierarchy
        const aabb = new pc.BoundingBox();
        let first = true;
        
        const processEntity = (entity) => {
            if (entity.render && entity.render.meshInstances) {
                for (const mi of entity.render.meshInstances) {
                    if (first) {
                        aabb.copy(mi.aabb);
                        first = false;
                    } else {
                        aabb.add(mi.aabb);
                    }
                }
            }
            
            for (const child of entity.children) {
                processEntity(child);
            }
        };
        
        processEntity(rootEntity);
        
        if (!first) {
            this._meshAabb = aabb;
            console.log('PhysicsModel: Calculated AABB', {
                center: aabb.center.toString(),
                halfExtents: aabb.halfExtents.toString()
            });
        } else {
            console.warn('PhysicsModel: No mesh instances found for AABB calculation');
            this._meshAabb = null;
        }
    }
    
    // Store previous values to detect changes
    _prevMass = null;
    _prevFriction = null;
    _prevRestitution = null;
    _prevLinearDamping = null;
    _prevAngularDamping = null;
    _prevCollisionScale = null;
    _prevUseBoxCollision = null;
    _prevModelScale = null;
    
    update(dt) {
        // Check if modelUrl changed and reload if needed
        if (this.modelUrl !== this._currentModelUrl && !this._isLoading) {
            this._loadModel(this.modelUrl);
        }
        
        // Update model scale
        if (this._modelEntity) {
            this._modelEntity.setLocalScale(this.modelScale, this.modelScale, this.modelScale);
        }
        
        // Update physics properties if changed
        if (this._rigidBody) {
            if (this._prevMass !== this.mass) {
                // Mass change requires recreating the rigidbody
                this._setupRigidBody();
                this._prevMass = this.mass;
            }
            
            if (this._prevFriction !== this.friction) {
                this._rigidBody.friction = this.friction;
                this._prevFriction = this.friction;
            }
            
            if (this._prevRestitution !== this.restitution) {
                this._rigidBody.restitution = this.restitution;
                this._prevRestitution = this.restitution;
            }
            
            if (this._prevLinearDamping !== this.linearDamping) {
                this._rigidBody.linearDamping = this.linearDamping;
                this._prevLinearDamping = this.linearDamping;
            }
            
            if (this._prevAngularDamping !== this.angularDamping) {
                this._rigidBody.angularDamping = this.angularDamping;
                this._prevAngularDamping = this.angularDamping;
            }
        }
        
        // Update collision if scale or type changed
        if (this._prevCollisionScale !== this.collisionScale || 
            this._prevUseBoxCollision !== this.useBoxCollision ||
            this._prevModelScale !== this.modelScale) {
            // Defer to next frame to avoid physics conflicts
            setTimeout(() => {
                if (this.entity) {
                    this._setupCollision();
                    this._setupRigidBody();
                }
            }, 0);
            this._prevCollisionScale = this.collisionScale;
            this._prevUseBoxCollision = this.useBoxCollision;
            this._prevModelScale = this.modelScale;
        }
    }
    
    // Apply an impulse to the rigid body
    applyImpulse(x, y, z) {
        if (this._rigidBody && this.mass > 0) {
            this._rigidBody.applyImpulse(new pc.Vec3(x, y, z));
            console.log(`PhysicsModel: Applied impulse (${x}, ${y}, ${z})`);
        }
    }
    
    // Apply torque impulse to make it spin
    applyTorqueImpulse(x, y, z) {
        if (this._rigidBody && this.mass > 0) {
            this._rigidBody.applyTorqueImpulse(new pc.Vec3(x, y, z));
            console.log(`PhysicsModel: Applied torque impulse (${x}, ${y}, ${z})`);
        }
    }
    
    // Reset position and velocity
    reset() {
        if (this._rigidBody) {
            this._rigidBody.linearVelocity = pc.Vec3.ZERO;
            this._rigidBody.angularVelocity = pc.Vec3.ZERO;
            this._rigidBody.teleport(this.entity.getLocalPosition(), this.entity.getLocalRotation());
            console.log('PhysicsModel: Reset position and velocity');
        }
    }
}
