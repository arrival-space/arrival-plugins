export class HoverBoard extends ArrivalScript {
    static scriptName = "Hover Board";

    sizeX = 1.394;
    sizeY = 0.20415;
    sizeZ = 0.47788;
    mass = 2;
    friction = 0.0175;
    restitution = 0.1;
    linearDamping = 0.05;
    angularDamping = 0.1;

    boardColor = "#3388ff";
    boardOffsetY = 0.02;
    boardScaleY = 0.45275;
    rideIdleUrl = "skate_idle.glb";
    rideActionUrl = "skate_accelerating.glb";
    rideActionStartTime = 1;
    playerOffsetY = -0.15;
    pushForce = 20;

    colliderOffsetX = 0;
    colliderOffsetY = 0.13;
    colliderOffsetZ = 0;

    detectorY = -5;

    static properties = {
        sizeX: { title: "Collider Size X", min: 0.05, max: 5 },
        sizeY: { title: "Collider Size Y", min: 0.02, max: 2 },
        sizeZ: { title: "Collider Size Z", min: 0.05, max: 5 },
        mass: { title: "Mass", min: 0.1, max: 50 },
        friction: { title: "Friction", min: 0, max: 1 },
        restitution: { title: "Restitution", min: 0, max: 1 },
        linearDamping: { title: "Linear Damping", min: 0, max: 1 },
        angularDamping: { title: "Angular Damping", min: 0, max: 1 },
        boardColor: { title: "Board Color" },
        boardOffsetY: { title: "Board Visual Y Offset", min: -2, max: 2, step: 0.01 },
        boardScaleY: { title: "Board Visual Y Scale", min: 0.01, max: 2, step: 0.01 },
        rideIdleUrl: { title: "Ride Idle Animation" },
        rideActionUrl: { title: "Ride Action Animation" },
        rideActionStartTime: { title: "Ride Action Start Time", min: 0, max: 60, step: 0.01 },
        playerOffsetY: { title: "Player Y Offset", min: -2, max: 2, step: 0.01 },
        pushForce: { title: "Push Force", min: 0, max: 50, step: 0.5 },
        colliderOffsetX: { title: "Collider Offset X", min: -5, max: 5 },
        colliderOffsetY: { title: "Collider Offset Y", min: -5, max: 5 },
        colliderOffsetZ: { title: "Collider Offset Z", min: -5, max: 5 },
        detectorY: { title: "Fall Detector Y", min: -100, max: 10 }
    };

    _boardEntity = null;
    _boardMaterial = null;
    _lastSizeX = null;
    _lastSizeY = null;
    _lastSizeZ = null;
    _initialPosition = null;
    _initialRotation = null;
    _resetCooldown = 0;
    _standingObjectChangedOff = null;
    _isPlayerStandingOnBoard = false;
    _rideActionKeyDownOff = null;
    _rideActionKeyUpOff = null;
    _rideActionActive = false;
    _hintEl = null;

    async initialize() {
        this._lastSizeX = this.sizeX;
        this._lastSizeY = this.sizeY;
        this._lastSizeZ = this.sizeZ;
        this._initialPosition = this.entity.getPosition().clone();
        this._initialRotation = this.entity.getRotation().clone();
        await this._syncAnimationOptions();
        this._isPlayerStandingOnBoard = ArrivalSpace.getStandingObject() === this.entity;
        this._rideActionKeyDownOff = this.onKeyDown("e", () => {
            if (!this._isPlayerStandingOnBoard) return;
            this._setRideActionActive(true);
        });
        this._rideActionKeyUpOff = this.onKeyUp("e", () => {
            this._setRideActionActive(false);
        });

        this._standingObjectChangedOff = ArrivalSpace.onStandingObjectChanged((currentEntity, previousEntity) => {
            const wasStandingOnBoard = previousEntity === this.entity;
            const isStandingOnBoard = currentEntity === this.entity;

            this._isPlayerStandingOnBoard = isStandingOnBoard;

            console.log("[HoverBoard] standing object changed", {
                current: currentEntity?.name || null,
                previous: previousEntity?.name || null
            });

            if (isStandingOnBoard) {
                this._applyRideIdle();
                this._applyRideActionAnimation();
                this.setPlayerAvatarOffset(0, this.playerOffsetY, 0);
                this._showHint(true);
            } else if (wasStandingOnBoard) {
                this.setPlayerAvatarOffset(0, 0, 0);
                ArrivalSpace.setPlayerAnimation("Idle", null);
                ArrivalSpace.setPlayerAnimation("Signature1", null);
                this._setRideActionActive(false);
                this._showHint(false);
            }
        });

        if (this._isPlayerStandingOnBoard) {
            await this._applyRideIdle();
            await this._applyRideActionAnimation();
            this.setPlayerAvatarOffset(0, this.playerOffsetY, 0);
            this._showHint(true);
        }

        this.rebuildPhysics();
        this._buildBoard();
        this._createHint();
    }

    update(dt) {
        if (this.sizeX !== this._lastSizeX || this.sizeY !== this._lastSizeY || this.sizeZ !== this._lastSizeZ) {
            this.rebuildPhysics();
        }

        if (!this._isPlayerStandingOnBoard) {
            this._setRideActionActive(false);
        }

        if (this._rideActionActive && this.entity.rigidbody && this.pushForce > 0) {
            const forward = this.getPlayerForward();
            if (forward) {
                this.entity.rigidbody.applyForce(
                    forward.x * this.pushForce,
                    0,
                    forward.z * this.pushForce
                );
            }
        }

        if (this._resetCooldown > 0) {
            this._resetCooldown -= dt;
        } else if (this.entity.getPosition().y <= this.detectorY) {
            this.resetToInitial();
        }
    }

    postUpdate() {
        if (!this._isPlayerStandingOnBoard) return;
        this.setPlayerAvatarOffset(0, this.playerOffsetY, 0);
    }

    resetToInitial() {
        if (this.entity.rigidbody) {
            this.entity.rigidbody.linearVelocity = pc.Vec3.ZERO;
            this.entity.rigidbody.angularVelocity = pc.Vec3.ZERO;
            this.entity.rigidbody.teleport(this._initialPosition, this._initialRotation);
        } else {
            this.entity.setPosition(this._initialPosition);
            this.entity.setRotation(this._initialRotation);
        }

        this._buildBoard();
        this._resetCooldown = 0.5;
    }

    rebuildPhysics() {
        if (this.entity.rigidbody) {
            this.entity.removeComponent("rigidbody");
        }

        if (this.entity.collision) {
            this.entity.removeComponent("collision");
        }

        const half = new pc.Vec3(this.sizeX * 0.5, this.sizeY * 0.5, this.sizeZ * 0.5);
        const offset = new pc.Vec3(this.colliderOffsetX, this.colliderOffsetY, this.colliderOffsetZ);
        this.entity.addComponent("collision", {
            type: "box",
            halfExtents: half,
            linearOffset: offset
        });

        this.entity.addComponent("rigidbody", {
            type: pc.BODYTYPE_DYNAMIC,
            mass: this.mass,
            friction: this.friction,
            restitution: this.restitution,
            linearDamping: this.linearDamping,
            angularDamping: this.angularDamping
        });

        ArrivalSpace.enableContinuousCollisionDetection(this.entity);

        this._lastSizeX = this.sizeX;
        this._lastSizeY = this.sizeY;
        this._lastSizeZ = this.sizeZ;
    }

    _buildBoard() {
        if (this._boardEntity && !this._boardEntity._destroyed) {
            this._boardEntity.destroy();
        }

        this._boardMaterial = new pc.StandardMaterial();
        this._updateBoardColor();

        this._boardEntity = new pc.Entity("BoardVisual");
        this._boardEntity.addComponent("render", { type: "box" });
        this._boardEntity.render.material = this._boardMaterial;
        this._boardEntity.render.castShadows = true;
        this._boardEntity.render.receiveShadows = true;
        this._boardEntity.setLocalScale(this.sizeX, this.sizeY * this.boardScaleY, this.sizeZ);
        this._boardEntity.setLocalPosition(this.colliderOffsetX, this.colliderOffsetY + this.boardOffsetY, this.colliderOffsetZ);
        this.entity.addChild(this._boardEntity);
    }

    _updateBoardColor() {
        if (!this._boardMaterial) return;
        const rgb = this.hexToRgb(this.boardColor);
        this._boardMaterial.diffuse = new pc.Color(rgb.r, rgb.g, rgb.b);
        this._boardMaterial.emissive = new pc.Color(rgb.r * 0.3, rgb.g * 0.3, rgb.b * 0.3);
        this._boardMaterial.update();
    }

    async _syncAnimationOptions() {
        const avatarConfig = await ArrivalSpace.getAvatarConfig();
        const gender = avatarConfig?.gender === "female" ? "female" : "male";
        const animations = await ArrivalSpace.getAvatarAnimationCatalog(gender);
        if (!Array.isArray(animations) || animations.length === 0) return;

        this.setParamOptions("rideIdleUrl", ["", ...animations], false);
        this.setParamOptions("rideActionUrl", ["", ...animations], false);
        this.refreshParamSchema();
    }

    async _applyRideIdle() {
        if (!this._isPlayerStandingOnBoard) return;
        await ArrivalSpace.setPlayerAnimation("Idle", this.rideIdleUrl || null);
    }

    async _applyRideActionAnimation() {
        if (!this._isPlayerStandingOnBoard) return;
        await ArrivalSpace.setPlayerAnimation("Signature1", this.rideActionUrl || null, {
            startTime: this.rideActionStartTime
        });
    }

    _setRideActionActive(active) {
        if (this._rideActionActive === active) return;
        this._rideActionActive = active;
        this.app.fire("firstperson:signature", active, 1);
        if (active) this._showHint(false);
    }

    _createHint() {
        const ui = this.getUIContainer();
        ui.innerHTML = `
            <style>
                .hoverboard-hint {
                    position: fixed;
                    bottom: 120px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: rgba(0, 0, 0, 0.6);
                    color: #fff;
                    padding: 6px 16px;
                    border-radius: 6px;
                    font: 13px/1.4 sans-serif;
                    pointer-events: none;
                    opacity: 0;
                    transition: opacity 0.25s;
                    white-space: nowrap;
                }
                .hoverboard-hint.visible { opacity: 1; }
                .hoverboard-hint kbd {
                    background: rgba(255,255,255,0.15);
                    border: 1px solid rgba(255,255,255,0.25);
                    border-radius: 3px;
                    padding: 1px 6px;
                    margin-right: 4px;
                    font-family: inherit;
                }
            </style>
            <div class="hoverboard-hint">Hold <kbd>E</kbd> to push</div>
        `;
        this._hintEl = ui.querySelector(".hoverboard-hint");
    }

    _showHint(visible) {
        if (!this._hintEl) return;
        this._hintEl.classList.toggle("visible", visible);
    }

    hexToRgb(hex) {
        const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
        if (!match) {
            return { r: 0, g: 1, b: 0.53 };
        }

        return {
            r: parseInt(match[1], 16) / 255,
            g: parseInt(match[2], 16) / 255,
            b: parseInt(match[3], 16) / 255
        };
    }

    onPropertyChanged(name, value) {
        if (name === "friction" && this.entity.rigidbody) {
            this.entity.rigidbody.friction = value;
            return;
        }

        if (name === "restitution" && this.entity.rigidbody) {
            this.entity.rigidbody.restitution = value;
            return;
        }

        if (name === "linearDamping" && this.entity.rigidbody) {
            this.entity.rigidbody.linearDamping = value;
            return;
        }

        if (name === "angularDamping" && this.entity.rigidbody) {
            this.entity.rigidbody.angularDamping = value;
            return;
        }

        if (name === "mass" || name === "sizeX" || name === "sizeY" || name === "sizeZ") {
            this.rebuildPhysics();
            if (this._boardEntity) {
                this._boardEntity.setLocalScale(this.sizeX, this.sizeY * this.boardScaleY, this.sizeZ);
            }
            return;
        }

        if (name === "boardColor") {
            this._updateBoardColor();
            return;
        }

        if (name === "boardScaleY") {
            if (this._boardEntity) {
                this._boardEntity.setLocalScale(this.sizeX, this.sizeY * this.boardScaleY, this.sizeZ);
            }
            return;
        }

        if (name === "boardOffsetY") {
            if (this._boardEntity) {
                this._boardEntity.setLocalPosition(this.colliderOffsetX, this.colliderOffsetY + this.boardOffsetY, this.colliderOffsetZ);
            }
            return;
        }

        if (name === "rideIdleUrl") {
            if (this._isPlayerStandingOnBoard) {
                this._applyRideIdle();
            }
            return;
        }

        if (name === "rideActionUrl") {
            if (this._isPlayerStandingOnBoard) {
                this._applyRideActionAnimation();
            }
            if (!this.rideActionUrl) {
                this._setRideActionActive(false);
            }
            return;
        }

        if (name === "rideActionStartTime") {
            if (this._isPlayerStandingOnBoard && this.rideActionUrl) {
                this._applyRideActionAnimation();
            }
            return;
        }

        if (name === "playerOffsetY") {
            return;
        }

        if (name === "colliderOffsetX" || name === "colliderOffsetY" || name === "colliderOffsetZ") {
            if (this.entity.collision && this.entity.collision.linearOffset) {
                this.entity.collision.linearOffset.set(this.colliderOffsetX, this.colliderOffsetY, this.colliderOffsetZ);
            } else if (this.entity.collision) {
                this.rebuildPhysics();
            }
            if (this._boardEntity) {
                this._boardEntity.setLocalPosition(this.colliderOffsetX, this.colliderOffsetY + this.boardOffsetY, this.colliderOffsetZ);
            }
            return;
        }
    }

    destroy() {
        if (this._standingObjectChangedOff) {
            this._standingObjectChangedOff();
            this._standingObjectChangedOff = null;
        }
        if (this._rideActionKeyDownOff) {
            this._rideActionKeyDownOff();
            this._rideActionKeyDownOff = null;
        }
        if (this._rideActionKeyUpOff) {
            this._rideActionKeyUpOff();
            this._rideActionKeyUpOff = null;
        }

        this._showHint(false);
        this._hintEl = null;

        if (this._isPlayerStandingOnBoard) {
            ArrivalSpace.setPlayerAnimation("Idle", null);
            ArrivalSpace.setPlayerAnimation("Signature1", null);
            this.setPlayerAvatarOffset(0, 0, 0);
            this._isPlayerStandingOnBoard = false;
        }
        this._setRideActionActive(false);
        this.setPlayerAvatarOffset(0, 0, 0);

        if (this.entity.rigidbody) {
            this.entity.removeComponent("rigidbody");
        }

        if (this.entity.collision) {
            this.entity.removeComponent("collision");
        }

        if (this._boardEntity && !this._boardEntity._destroyed) {
            this._boardEntity.destroy();
            this._boardEntity = null;
        }
        if (this._boardMaterial) {
            this._boardMaterial.destroy();
            this._boardMaterial = null;
        }
    }
}
