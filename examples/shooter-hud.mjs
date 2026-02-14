/**
 * Shooter HUD — cinematic game-style overlay UI.
 * Showcase: getUIContainer(), setAppUIVisible(), HTML overlay, net.getPlayers(),
 *           getPlayer(), getCamera(), click handling, update loop.
 *
 * NOTE: This is a 3rd-person game.
 *   - Use getPlayer() for POSITION (where the character is)
 *   - Use getCamera() for HEADING (where the player is looking)
 *   The camera orbits the player, so its position ≠ the character's position.
 *
 * Features:
 *   - Crosshair (center)
 *   - Health bar (bottom left, starts at 100%)
 *   - Ammo counter (bottom right, decrements on click)
 *   - Live mini-map with player dots + names (top right, rotates with camera)
 *
 * Press H in-game to toggle the app UI back if needed.
 */
export class ShooterHud extends ArrivalScript {
    static scriptName = 'shooterHud';

    health = 100;
    maxHealth = 100;
    ammo = 30;
    maxAmmo = 30;
    mapRange = 30;

    static properties = {
        health: { title: 'Health', min: 0, max: 200, step: 1 },
        maxHealth: { title: 'Max Health', min: 1, max: 200, step: 1 },
        ammo: { title: 'Ammo', min: 0, max: 999, step: 1 },
        maxAmmo: { title: 'Max Ammo', min: 1, max: 999, step: 1 },
        mapRange: { title: 'Map Range (m)', min: 5, max: 200, step: 5 },
    };

    initialize() {
        ArrivalSpace.setAppUIVisible(false);

        const ui = this.getUIContainer();
        ui.innerHTML = `
        <style>
            #shooter-hud * { box-sizing: border-box; margin: 0; }
            #shooter-hud {
                position: fixed; inset: 0;
                font-family: 'Rajdhani', 'Segoe UI', sans-serif;
                color: #fff; pointer-events: none;
                text-shadow: 0 0 4px rgba(0,0,0,0.8);
                user-select: none;
            }

            /* ── Crosshair ── */
            .sh-crosshair {
                position: absolute; top: 50%; left: 50%;
                transform: translate(-50%, calc(-50% - 48px));
            }
            .sh-crosshair .dot {
                width: 4px; height: 4px; background: rgba(255,255,255,0.9);
                border-radius: 50%; position: absolute; top: 50%; left: 50%;
                transform: translate(-50%, -50%);
            }
            .sh-crosshair .arm {
                position: absolute; background: rgba(255,255,255,0.7);
            }
            .sh-crosshair .arm.top    { width: 2px; height: 12px; top: -18px; left: 50%; transform: translateX(-50%); }
            .sh-crosshair .arm.bottom { width: 2px; height: 12px; bottom: -18px; left: 50%; transform: translateX(-50%); }
            .sh-crosshair .arm.left   { height: 2px; width: 12px; left: -18px; top: 50%; transform: translateY(-50%); }
            .sh-crosshair .arm.right  { height: 2px; width: 12px; right: -18px; top: 50%; transform: translateY(-50%); }

            /* ── Bottom bar ── */
            .sh-bottom {
                position: absolute; bottom: 0; left: 0; right: 0;
                display: flex; justify-content: space-between; align-items: flex-end;
                padding: 32px 36px;
            }

            /* ── Health ── */
            .sh-health { display: flex; align-items: center; gap: 12px; }
            .sh-health-icon {
                font-size: 28px; filter: drop-shadow(0 0 6px rgba(255,60,60,0.5));
            }
            .sh-health-bar-wrap {
                width: 200px; height: 8px;
                background: rgba(255,255,255,0.1); border-radius: 4px;
                overflow: hidden; backdrop-filter: blur(4px);
                border: 1px solid rgba(255,255,255,0.15);
            }
            .sh-health-bar {
                height: 100%; border-radius: 4px;
                transition: width 0.4s ease, background 0.4s ease;
            }
            .sh-health-text {
                font-size: 22px; font-weight: 700; letter-spacing: 1px;
                min-width: 44px;
            }

            /* ── Ammo ── */
            .sh-ammo { text-align: right; }
            .sh-ammo-count {
                font-size: 42px; font-weight: 700; letter-spacing: 2px; line-height: 1;
            }
            .sh-ammo-count span { font-size: 22px; opacity: 0.5; font-weight: 400; }
            .sh-ammo-label {
                font-size: 11px; text-transform: uppercase; letter-spacing: 3px;
                opacity: 0.5; margin-top: 2px;
            }

            /* ── Mini-map ── */
            .sh-minimap {
                position: absolute; top: 16px; right: 24px;
                width: 160px; height: 160px; border-radius: 50%;
                background: rgba(0,0,0,0.4); backdrop-filter: blur(6px);
                border: 2px solid rgba(255,255,255,0.15);
                overflow: hidden;
            }
            .sh-minimap-inner {
                position: absolute; inset: 0;
            }
            .sh-minimap-self {
                position: absolute; top: 50%; left: 50%;
                width: 8px; height: 8px;
                transform: translate(-50%, -50%);
                background: rgba(100,200,255,0.9); border-radius: 50%;
                box-shadow: 0 0 6px rgba(100,200,255,0.6);
                z-index: 2;
            }
            .sh-minimap-fov {
                position: absolute; top: 50%; left: 50%;
                width: 0; height: 0;
                border-left: 20px solid transparent; border-right: 20px solid transparent;
                border-bottom: 40px solid rgba(100,200,255,0.08);
                transform-origin: bottom center;
                transform: translate(-50%, -100%);
                z-index: 1;
            }
            .sh-minimap-dot {
                position: absolute; width: 6px; height: 6px;
                transform: translate(-50%, -50%);
                border-radius: 50%;
                background: #f44; box-shadow: 0 0 4px rgba(255,68,68,0.5);
            }
            .sh-minimap-ring {
                position: absolute; inset: 4px; border-radius: 50%;
                border: 1px solid rgba(255,255,255,0.06);
            }
            .sh-minimap-ring2 {
                position: absolute; inset: 25%; border-radius: 50%;
                border: 1px solid rgba(255,255,255,0.04);
            }
            .sh-minimap-n {
                position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
                font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.4);
                z-index: 3;
            }

            /* ── Player list ── */
            .sh-players {
                position: absolute; top: 182px; right: 24px;
                width: 160px; display: flex; flex-direction: column; gap: 3px;
                font-size: 11px; letter-spacing: 1px; text-transform: uppercase;
            }
            .sh-players-item {
                display: flex; align-items: center; gap: 6px;
                opacity: 0.6; font-weight: 600;
            }
            .sh-players-item.self { opacity: 0.9; }
            .sh-players-dot {
                width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0;
            }
            .sh-players-dot.self { background: rgba(100,200,255,0.9); }
            .sh-players-dot.other { background: #f44; }

            /* ── Muzzle flash ── */
            .sh-flash {
                position: absolute; inset: 0;
                background: radial-gradient(circle at 50% 50%, rgba(255,200,50,0.08) 0%, transparent 60%);
                opacity: 0; transition: opacity 0.05s;
                pointer-events: none;
            }
            .sh-flash.active { opacity: 1; }
        </style>

        <div id="shooter-hud">
            <div class="sh-flash js-flash"></div>

            <!-- Crosshair -->
            <div class="sh-crosshair">
                <div class="dot"></div>
                <div class="arm top"></div>
                <div class="arm bottom"></div>
                <div class="arm left"></div>
                <div class="arm right"></div>
            </div>

            <!-- Mini-map -->
            <div class="sh-minimap">
                <div class="sh-minimap-ring"></div>
                <div class="sh-minimap-ring2"></div>
                <div class="sh-minimap-inner js-minimap-inner">
                    <div class="sh-minimap-n js-minimap-n">N</div>
                </div>
                <div class="sh-minimap-fov"></div>
                <div class="sh-minimap-self"></div>
            </div>

            <!-- Player list -->
            <div class="sh-players js-players"></div>

            <!-- Bottom bar -->
            <div class="sh-bottom">
                <div class="sh-health">
                    <div class="sh-health-icon">+</div>
                    <div class="sh-health-bar-wrap">
                        <div class="sh-health-bar js-health-bar"></div>
                    </div>
                    <div class="sh-health-text js-health-text"></div>
                </div>
                <div class="sh-ammo">
                    <div class="sh-ammo-count js-ammo-count"></div>
                    <div class="sh-ammo-label">rifle</div>
                </div>
            </div>
        </div>`;

        // Click to shoot
        this._onClick = (e) => {
            if (e.button !== 0) return;
            if (this.ammo <= 0) return;
            this.ammo--;
            this._updateAmmo();
            this._flashMuzzle();
        };
        window.addEventListener('mousedown', this._onClick);

        this._updateHUD();
        this._updateMinimap();
    }

    update(dt) {
        this._updateMinimap();
    }

    onPropertyChanged() {
        this._updateHUD();
    }

    _updateHUD() {
        const ui = this._uiContainer;
        if (!ui) return;

        // Health bar
        const pct = Math.max(0, Math.min(100, (this.health / this.maxHealth) * 100));
        const bar = ui.querySelector('.js-health-bar');
        if (bar) {
            bar.style.width = pct + '%';
            bar.style.background = pct > 50
                ? 'linear-gradient(90deg, #4ade80, #22c55e)'
                : pct > 25
                    ? 'linear-gradient(90deg, #facc15, #f59e0b)'
                    : 'linear-gradient(90deg, #f87171, #ef4444)';
        }
        const txt = ui.querySelector('.js-health-text');
        if (txt) txt.textContent = Math.round(this.health);

        this._updateAmmo();
    }

    _updateAmmo() {
        const ammo = this._uiContainer?.querySelector('.js-ammo-count');
        if (ammo) ammo.innerHTML = `${this.ammo} <span>/ ${this.maxAmmo}</span>`;
    }

    _flashMuzzle() {
        const flash = this._uiContainer?.querySelector('.js-flash');
        if (!flash) return;
        flash.classList.add('active');
        setTimeout(() => flash.classList.remove('active'), 80);
    }

    _getCameraYaw() {
        const cam = ArrivalSpace.getCamera();
        if (!cam) return 0;
        const fwd = cam.forward;
        return (Math.atan2(fwd.x, fwd.z) * 180 / Math.PI + 360) % 360;
    }

    _updateMinimap() {
        const inner = this._uiContainer?.querySelector('.js-minimap-inner');
        if (!inner) return;

        const yaw = this._getCameraYaw();
        // Rotate the inner map so north stays correct relative to camera
        inner.style.transform = `rotate(${yaw}deg)`;

        const player = ArrivalSpace.getPlayer();
        if (!player) return;
        const myPos = player.getPosition();

        const players = ArrivalSpace.net.getPlayers();
        const mapRadius = 76;

        // Remove old dots
        inner.querySelectorAll('.sh-minimap-dot').forEach(d => d.remove());

        for (const p of players) {
            if (!p.entity) continue;
            const pos = p.entity.getPosition();
            const dx = pos.x - myPos.x;
            const dz = pos.z - myPos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist > this.mapRange) continue;

            const px = (-dx / this.mapRange) * mapRadius;
            const py = (-dz / this.mapRange) * mapRadius;

            const dot = document.createElement('div');
            dot.className = 'sh-minimap-dot';
            dot.style.left = `calc(50% + ${px}px)`;
            dot.style.top = `calc(50% + ${py}px)`;
            dot.title = p.userName || '';
            inner.appendChild(dot);
        }

        // Player list below minimap
        const list = this._uiContainer?.querySelector('.js-players');
        if (list) {
            const user = ArrivalSpace.getUser();
            let html = `<div class="sh-players-item self"><span class="sh-players-dot self"></span>${user?.userName || 'You'}</div>`;
            for (const p of players) {
                html += `<div class="sh-players-item"><span class="sh-players-dot other"></span>${p.userName || 'Unknown'}</div>`;
            }
            list.innerHTML = html;
        }
    }

    destroy() {
        if (this._onClick) window.removeEventListener('mousedown', this._onClick);
        ArrivalSpace.setAppUIVisible(true);
    }
}
