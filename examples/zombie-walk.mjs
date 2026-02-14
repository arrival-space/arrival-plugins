/**
 * Zombie Walk — replaces walk and idle animations with a zombie shuffle.
 * Walk uses the zombie animation at reduced speed, idle freezes the pose.
 * Showcase: setPlayerAnimation(), setPlayerAnimSpeed(), setPlayerSpeed().
 */
export class ZombieWalk extends ArrivalScript {
    static scriptName = 'zombieWalk';

    animationUrl = 'https://dzrmwng2ae8bq.cloudfront.net/avatar-parts/animations/zombie_walk.glb';
    moveSpeed = 0.2;
    walkAnimSpeed = 1.5;

    static properties = {
        moveSpeed: { title: 'Move Speed', min: 0.01, max: 5, step: 0.01 },
        walkAnimSpeed: { title: 'Walk Anim Speed', min: 0.1, max: 10, step: 0.1 },
    };

    async initialize() {
        await Promise.all([
            ArrivalSpace.setPlayerAnimation('Forward', this.animationUrl),
            ArrivalSpace.setPlayerAnimation('Idle', this.animationUrl),
        ]);
        ArrivalSpace.setPlayerAnimSpeed('Idle', 0);
        ArrivalSpace.setPlayerAnimSpeed('Forward', this.walkAnimSpeed);
        ArrivalSpace.setPlayerSpeed(this.moveSpeed);
    }

    onPropertyChanged(name) {
        if (name === 'moveSpeed') ArrivalSpace.setPlayerSpeed(this.moveSpeed);
        if (name === 'walkAnimSpeed') ArrivalSpace.setPlayerAnimSpeed('Forward', this.walkAnimSpeed);
    }

    async destroy() {
        await Promise.all([
            ArrivalSpace.setPlayerAnimation('Forward', null),
            ArrivalSpace.setPlayerAnimation('Idle', null),
        ]);
        ArrivalSpace.setPlayerAnimSpeed('Idle', null);
        ArrivalSpace.setPlayerAnimSpeed('Forward', null);
        ArrivalSpace.setPlayerSpeed(1);
    }
}
