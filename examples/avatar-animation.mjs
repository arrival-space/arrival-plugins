/**
 * Avatar Animation — override character animations with custom GLBs.
 * Showcase: setPlayerAnimation(), setPlayerAnimSpeed(), setPlayerSpeed().
 *
 * Each field accepts a URL to a GLB file containing an animation clip.
 * Leave empty to keep the default animation for that state.
 *
 * Available animation states: Idle, Forward (walk), Jumping,
 *   Signature1, Signature2, Signature3, Signature4 (emotes)
 *
 * Sample animations (hosted on CDN):
 *   https://ugc.arrival.space/avatar-parts/animations/zombie_walk.glb  — Zombie shuffle
 *   https://ugc.arrival.space/avatar-parts/animations/rifle_run.glb    — Running with rifle
 *   https://ugc.arrival.space/avatar-parts/animations/dying.glb        — Dramatic death fall
 *
 * You can use any GLB with a single animation clip. Mixamo (https://www.mixamo.com)
 * is a great source — export as GLB (binary) with skin and 30fps.
 *
 * Root bone movement is automatically stripped (in-place mode) so animations
 * with locomotion (like rifle_run) don't make the character drift.
 * To keep root motion: setPlayerAnimation('Forward', url, { inPlace: false })
 */
export class AvatarAnimation extends ArrivalScript {
    static scriptName = 'avatarAnimation';

    idleUrl = 'https://ugc.arrival.space/avatar-parts/animations/zombie_walk.glb';
    walkUrl = 'https://ugc.arrival.space/avatar-parts/animations/zombie_walk.glb';
    jumpUrl = '';
    moveSpeed = 0.2;
    walkAnimSpeed = 1.5;
    idleAnimSpeed = 0.0;

    static properties = {
        idleUrl: { title: 'Idle Animation URL' },
        walkUrl: { title: 'Walk Animation URL' },
        jumpUrl: { title: 'Jump Animation URL' },
        moveSpeed: { title: 'Move Speed', min: 0.01, max: 5, step: 0.01 },
        walkAnimSpeed: { title: 'Walk Anim Speed', min: 0, max: 10, step: 0.1 },
        idleAnimSpeed: { title: 'Idle Anim Speed', min: 0, max: 10, step: 0.1 },
    };

    async initialize() {
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
        if (this.walkUrl.trim()) await ArrivalSpace.setPlayerAnimation('Forward', this.walkUrl.trim());
        if (this.idleUrl.trim()) await ArrivalSpace.setPlayerAnimation('Idle', this.idleUrl.trim());
        if (this.jumpUrl.trim()) await ArrivalSpace.setPlayerAnimation('Jumping', this.jumpUrl.trim());
    }

    _applySpeeds() {
        ArrivalSpace.setPlayerSpeed(this.moveSpeed);
        if (this.walkUrl.trim()) ArrivalSpace.setPlayerAnimSpeed('Forward', this.walkAnimSpeed);
        if (this.idleUrl.trim()) ArrivalSpace.setPlayerAnimSpeed('Idle', this.idleAnimSpeed);
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
