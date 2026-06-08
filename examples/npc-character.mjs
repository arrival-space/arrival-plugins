/**
 * NPC Character
 *
 * Spawns an NPC and makes it follow the local player.
 * Demonstrates ArrivalScript.createNPC(), avatarConfig customization,
 * and simple follow steering with walkTo().
 *
 * Each animation slot (Idle/Walk/Jump) uses a catalog clip (dropdown) by default, or a custom
 * Mixamo .fbx you upload — the upload overrides the dropdown and is converted to a generic clip
 * on the fly, retargeted onto the avatar (works on VRM and modular/RPM).
 *
 * Avatar part IDs (e.g. "male-shirt-11.glb") come from:
 * - ArrivalSpace.getAvatarCatalog('male' | 'female')
 * - male catalog: https://ugc.arrival.space/avatar-parts/catalog.json
 * - female catalog: https://ugc.arrival.space/avatar-parts-female/catalog.json
 */
export class NpcCharacter extends ArrivalScript {
    static scriptName = 'NPC Character';

    avatarConfig = {
        // IDs are catalog keys from ArrivalSpace.getAvatarCatalog(gender)
        parts: {
            body: '57321F-2.glb',
            head: 'face-default.glb',
            hair: 'male-hair-63.glb',
            teeth: 'face-default.glb',
            eyeLeft: 'eyes-1.glb',
            eyeRight: 'eyes-1.glb',
            top: 'male-shirt-11.glb',
            bottom: 'male-pants-1.glb',
            footwear: 'male-shoes-18.glb',
            headwear: 'headwear-29.glb',
        },
        tints: {
            skinColor: '#D48770',
            hairColor: '#4E433F',
        },
        gender: 'male',
        type: 'modular',
    };

    followDistance = 1.8;
    repathInterval = 0.5;
    npcSpeed = 1.2;
    npcTurnSpeed = 14;
    stopDistance = 0.35;


    headLabel = '';
    headLabelColor = '#ffffff';
    idleAnimation = 'idle.glb';
    idleLoop = true;
    walkAnimation = 'walking.glb';
    jumpAnimation = '';

    // Optional custom Mixamo .fbx per slot. When set, it OVERRIDES the catalog dropdown above it:
    // the file is converted to a generic clip on the fly and retargeted onto the avatar (VRM and
    // modular/RPM both work). Leave empty to use the catalog animation.
    idleFbx = '';
    walkFbx = '';
    jumpFbx = '';

    static properties = {
        followDistance: { title: 'Follow Distance', min: 0.5, max: 6, step: 0.1 },
        repathInterval: { title: 'Repath Interval', min: 0.1, max: 2, step: 0.05 },
        npcSpeed: { title: 'NPC Speed', min: 0.1, max: 6, step: 0.1 },
        npcTurnSpeed: { title: 'NPC Turn Speed', min: 1, max: 30, step: 0.5 },
        stopDistance: { title: 'Stop Distance', min: 0.1, max: 2, step: 0.05 },

        avatarConfig: { title: 'Avatar', editor: 'avatar-config' },
        headLabel: { title: 'Head Label' },
        headLabelColor: { title: 'Head Label Color' },
        idleAnimation: { title: 'Idle Animation' },
        idleFbx: { title: 'Idle — Custom FBX (Mixamo)', editor: 'asset', accept: ['.fbx'] },
        idleLoop: { title: 'Idle Loop' },
        walkAnimation: { title: 'Walk Animation' },
        walkFbx: { title: 'Walk — Custom FBX (Mixamo)', editor: 'asset', accept: ['.fbx'] },
        jumpAnimation: { title: 'Jump Animation' },
        jumpFbx: { title: 'Jump — Custom FBX (Mixamo)', editor: 'asset', accept: ['.fbx'] },
    };

    async initialize() {
        this._npc = null;
        this._followTimer = 0;
        this._isInitializing = true;

        await this._syncAnimationOptions();

        const spawnPos = this.entity.getPosition().clone();

        this._npc = await this.createNPC({
            name: `Follower_${Date.now()}`,
            position: spawnPos,
            speed: this.npcSpeed,
            turnSpeed: this.npcTurnSpeed,
            stopDistance: this.stopDistance,
            dynamicCapsule: true,
            avatarConfig: this.avatarConfig,
            headLabel: this.headLabel,
            headLabelColor: this.headLabelColor,
            onClick: () => {
                alert('NPC clicked');
            },
        });

        await this._applyAnimations();
        this._isInitializing = false;
    }

    async onPropertyChanged(name) {
        if (!this._npc || this._isInitializing) return;

        if (name === 'npcSpeed') this._npc.setSpeed(this.npcSpeed);
        if (name === 'npcTurnSpeed') this._npc.setTurnSpeed(this.npcTurnSpeed);
        if (name === 'stopDistance') this._npc.setStopDistance(this.stopDistance);
        if (name === 'headLabel') this._npc.setHeadLabel(this.headLabel);
        if (name === 'headLabelColor') this._npc.setHeadLabelColor(this.headLabelColor);

        if (name === 'avatarConfig') {
            await this._npc.applyAvatarConfig(this.avatarConfig);
            await this._syncAnimationOptions();
        }

        const animationsChanged =
            name === 'avatarConfig' ||
            name === 'idleAnimation' || name === 'idleFbx' ||
            name === 'idleLoop' ||
            name === 'walkAnimation' || name === 'walkFbx' ||
            name === 'jumpAnimation' || name === 'jumpFbx';
        if (animationsChanged) {
            await this._applyAnimations();
        }
    }

    _getAvatarGender() {
        return this.avatarConfig?.gender === 'female' ? 'female' : 'male';
    }

    // A custom .fbx upload (a CDN URL) overrides the catalog dropdown for that slot. The platform
    // converts .fbx refs to a generic clip on the fly, so setAnimation takes either kind of ref.
    _slotRef(catalogValue, fbxUrl) {
        const f = (fbxUrl || '').trim();
        return f || catalogValue;
    }

    async _applyAnimations() {
        if (!this._npc) return;

        const idle = this._slotRef(this.idleAnimation, this.idleFbx);
        const walk = this._slotRef(this.walkAnimation, this.walkFbx);
        const jump = this._slotRef(this.jumpAnimation, this.jumpFbx);

        if (!idle && !walk && !jump) {
            this._npc.setLocomotionMode('idle');
            return;
        }

        if (idle) await this._npc.setAnimation('Idle', idle, { inPlace: true, loop: this.idleLoop });
        if (walk) await this._npc.setAnimation('Forward', walk, { inPlace: true });
        if (jump) await this._npc.setAnimation('Jumping', jump, { inPlace: true });
    }

    async _syncAnimationOptions() {
        const animations = await ArrivalSpace.getAvatarAnimationCatalog(this._getAvatarGender());
        if (!Array.isArray(animations) || animations.length === 0) return;

        const options = ['', ...animations];
        this.setParamOptions('idleAnimation', options, false);
        this.setParamOptions('walkAnimation', options, false);
        this.setParamOptions('jumpAnimation', options, false);
        this.refreshParamSchema();
    }

    update(dt) {
        if (!this._npc) return;

        this._followTimer += dt;
        if (this._followTimer < this.repathInterval) return;
        this._followTimer = 0;

        const localPlayer = ArrivalSpace.getPlayer();
        if (!localPlayer) return;

        const playerPos = localPlayer.getPosition();
        const npcPos = this._npc.entity.getPosition();

        const directionToPlayer = playerPos.clone().sub(npcPos);
        directionToPlayer.y = 0;
        const distanceToPlayer = directionToPlayer.length();

        if (distanceToPlayer <= this.followDistance) {
            if (this._npc.getState?.().walking) {
                this._npc.stop();
            }
            return;
        }

        directionToPlayer.normalize();

        this._npc.walkTo(playerPos.clone(), { stopDistance: this.stopDistance });
    }

    destroy() {
        if (this._npc) {
            this._npc.destroy();
            this._npc = null;
        }
    }
}
