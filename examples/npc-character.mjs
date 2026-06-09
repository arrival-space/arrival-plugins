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

// First entry in every animation dropdown. Selecting it applies no override, so the avatar
// keeps the clip it was assigned at import. The dropdown shows the option string verbatim, so
// a plain '' would render as a blank line — this label makes the "no override" choice readable.
// _slotRef() resolves it back to '' for all the apply/revert logic.
const BUILTIN_ANIMATION = '<built-in>';

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
    jumpAnimation = BUILTIN_ANIMATION;

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
            // A URL-avatar swap rebuilds the NPC with a fresh anim graph (no overrides),
            // so clear our bookkeeping to force every active slot to be re-installed below.
            this._animSlots = null;
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
    // BUILTIN_ANIMATION means "no override" — resolve it (and any blank) to '' so the avatar keeps
    // its import clip and the apply/revert logic stays unaware of the dropdown label.
    _slotRef(catalogValue, fbxUrl) {
        const f = (fbxUrl || '').trim();
        if (f) return f;
        return catalogValue === BUILTIN_ANIMATION ? '' : catalogValue;
    }

    async _applyAnimations() {
        if (!this._npc) return;

        // Per-slot bookkeeping so we only touch a state when it actually changes:
        //  - `key`    : last-applied ref (plus loop for Idle); unchanged key => skip entirely,
        //               which avoids re-loading the same clip every edit (that can freeze the
        //               state graph on frame 0).
        //  - `active` : whether we currently have an override installed. Only then do we issue
        //               setAnimation(state, '') to REVERT — passing '' to a slot we never
        //               overrode would strip its built-in clip instead of leaving it alone.
        if (!this._animSlots) {
            this._animSlots = {
                Idle: { key: '', active: false },
                Forward: { key: '', active: false },
                Jumping: { key: '', active: false },
            };
        }

        const idle = this._slotRef(this.idleAnimation, this.idleFbx);
        const walk = this._slotRef(this.walkAnimation, this.walkFbx);
        const jump = this._slotRef(this.jumpAnimation, this.jumpFbx);

        const slots = [
            { state: 'Idle', ref: idle, options: { inPlace: true, loop: this.idleLoop }, key: `${idle}|${this.idleLoop}` },
            { state: 'Forward', ref: walk, options: { inPlace: true }, key: walk },
            { state: 'Jumping', ref: jump, options: { inPlace: true }, key: jump },
        ];

        for (const { state, ref, options, key } of slots) {
            const slot = this._animSlots[state];
            if (slot.key === key) continue;

            if (ref) {
                await this._npc.setAnimation(state, ref, options);
                slot.active = true;
            } else if (slot.active) {
                // Cleared an override -> revert to the avatar's built-in (import) clip.
                await this._npc.setAnimation(state, '');
                slot.active = false;
            }
            slot.key = key;
        }
    }

    async _syncAnimationOptions() {
        const animations = await ArrivalSpace.getAvatarAnimationCatalog(this._getAvatarGender());
        if (!Array.isArray(animations) || animations.length === 0) return;

        // Show the built-in label for any blank slot (e.g. an NPC saved before this label existed)
        // so the dropdown reads "<built-in>" instead of an empty line. Resolves back to '' in _slotRef.
        if (!this.idleAnimation) this.idleAnimation = BUILTIN_ANIMATION;
        if (!this.walkAnimation) this.walkAnimation = BUILTIN_ANIMATION;
        if (!this.jumpAnimation) this.jumpAnimation = BUILTIN_ANIMATION;

        const options = [BUILTIN_ANIMATION, ...animations];
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
