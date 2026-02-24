/**
 * Avatar Animation - override character animations with custom GLBs.
 * Showcase: setPlayerAnimation(), setPlayerAnimSpeed(), setPlayerSpeed().
 *
 * Each field accepts either:
 * - an avatar animation catalog key (e.g. "walking.glb", "shooter/rifle_run.glb")
 * - or a full URL to a GLB file containing an animation clip.
 * Leave empty to clear that override and use the default animation.
 *
 * Available animation states: Idle, Forward (walk), Jumping,
 *   Signature1, Signature2, Signature3, Signature4 (emotes)
 *
 * Catalog options come from:
 * - ArrivalSpace.getAvatarAnimationCatalog('male' | 'female')
 *
 * You can use any GLB with a single animation clip. Mixamo (https://www.mixamo.com)
 * is a great source - export as GLB (binary) with skin and 30fps.
 *
 * Root bone movement is automatically stripped (in-place mode) so animations
 * with locomotion (like rifle_run) do not make the character drift.
 * To keep root motion: setPlayerAnimation('Forward', refOrUrl, { inPlace: false })
 */
export class AvatarAnimation extends ArrivalScript {
    static scriptName = 'avatarAnimation';

    idleUrl = 'dancing.glb';
    walkUrl = 'special_walking.glb';
    jumpUrl = 'dying.glb';

    moveSpeed = 0.364;
    walkAnimSpeed = 1.0;
    idleAnimSpeed = 1.0;

    static properties = {
        idleUrl: { title: 'Idle Animation' },
        walkUrl: { title: 'Walk Animation' },
        jumpUrl: { title: 'Jump Animation' },
        moveSpeed: { title: 'Move Speed', min: 0.01, max: 5, step: 0.01 },
        walkAnimSpeed: { title: 'Walk Anim Speed', min: 0, max: 10, step: 0.1 },
        idleAnimSpeed: { title: 'Idle Anim Speed', min: 0, max: 10, step: 0.1 },
    };

    async initialize() {
        await this._syncAnimationOptions();
        await this._applyAnimations();
        this._applySpeeds();
    }

    async onPropertyChanged(name) {
        if (name === 'idleUrl' || name === 'walkUrl' || name === 'jumpUrl') {
            await this._applyAnimations();
        }
        this._applySpeeds();
    }

    async _applyAnimations() {
        await ArrivalSpace.setPlayerAnimation('Forward', this.walkUrl || null);
        await ArrivalSpace.setPlayerAnimation('Idle', this.idleUrl || null);
        await ArrivalSpace.setPlayerAnimation('Jumping', this.jumpUrl || null);
    }

    async _syncAnimationOptions() {
        const avatarConfig = await ArrivalSpace.getAvatarConfig();
        const gender = avatarConfig?.gender === 'female' ? 'female' : 'male';
        const animations = await ArrivalSpace.getAvatarAnimationCatalog(gender);
        if (!Array.isArray(animations) || animations.length === 0) return;

        const options = ['', ...animations];
        this.setParamOptions('idleUrl', options, false);
        this.setParamOptions('walkUrl', options, false);
        this.setParamOptions('jumpUrl', options, false);
        this.refreshParamSchema();
    }

    _applySpeeds() {
        ArrivalSpace.setPlayerSpeed(this.moveSpeed);
        ArrivalSpace.setPlayerAnimSpeed('Forward', this.walkUrl ? this.walkAnimSpeed : null);
        ArrivalSpace.setPlayerAnimSpeed('Idle', this.idleUrl ? this.idleAnimSpeed : null);
    }

    async destroy() {
        ArrivalSpace.setPlayerAnimation('Forward', null);
        ArrivalSpace.setPlayerAnimation('Idle', null);
        ArrivalSpace.setPlayerAnimation('Jumping', null);
        ArrivalSpace.setPlayerAnimSpeed('Forward', null);
        ArrivalSpace.setPlayerAnimSpeed('Idle', null);
        ArrivalSpace.setPlayerAnimSpeed('Jumping', null);
        ArrivalSpace.setPlayerSpeed(1);
    }
}
