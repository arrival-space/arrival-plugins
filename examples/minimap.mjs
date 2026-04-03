/**
 * Minimap — circular minimap overlay with optional background image.
 * Showcase: getUIContainer(), net.getPlayers(), getPlayer(), getCamera(),
 *           update loop, asset property (image upload).
 *
 * NOTE: This is a 3rd-person game.
 *   - Use getPlayer() for POSITION (where the character is)
 *   - Use getCamera() for HEADING (where the player is looking)
 *
 * Features:
 *   - Circular minimap (top right) that rotates with camera heading
 *   - Optional background image that pans & zooms with the player
 *   - Other players shown as red dots
 *   - Player list below the minimap
 *   - Configurable zoom, image size, and image offset
 */
export class Minimap extends ArrivalScript {
    static scriptName = 'minimap';

    mapZoom = 12;
    squareMap = false;
    northUp = false;
    scrollMap = true;
    minimapImage = '';
    mapImageSize = 100;
    mapOffsetX = 0;
    mapOffsetZ = 0;
    mapRotation = 0;
    selfColor = '#64c8ff';
    otherColor = '#ff4444';
    fovColor = '#64c8ff';

    static properties = {
        mapZoom: { title: 'Map Zoom (m)', min: 0.1, max: 100, step: 0.1 },
        squareMap: { title: 'Square Map' },
        northUp: { title: 'North Up' },
        scrollMap: { title: 'Scroll Map' },
        minimapImage: { title: 'Minimap Image', editor: 'asset' },
        mapImageSize: { title: 'Map Image Size (m)', min: 1, max: 1000, step: 1 },
        mapOffsetX: { title: 'Map Offset X (m)', min: -200, max: 200, step: 1 },
        mapOffsetZ: { title: 'Map Offset Z (m)', min: -200, max: 200, step: 1 },
        mapRotation: { title: 'Map Rotation', min: 0, max: 360, step: 1 },
        selfColor: { title: 'Self Color' },
        otherColor: { title: 'Other Player Color' },
        fovColor: { title: 'FOV Color' },
    };

    initialize() {
        const ui = this.getUIContainer();
        ui.innerHTML = `
        <style>
            #minimap-plugin * { box-sizing: border-box; margin: 0; }
            #minimap-plugin {
                position: fixed; top: 0; right: 0;
                font-family: 'Rajdhani', 'Segoe UI', sans-serif;
                color: #fff; pointer-events: none;
                text-shadow: 0 0 4px rgba(0,0,0,0.8);
                user-select: none;
                --mm-self: #64c8ff;
                --mm-other: #ff4444;
                --mm-fov: #64c8ff;
            }

            .mm-map {
                position: absolute; top: 10px; right: 58px;
                width: 160px; height: 160px; border-radius: 50%;
                background: rgba(0,0,0,0.4); backdrop-filter: blur(6px);
                border: 2px solid rgba(255,255,255,0.15);
                overflow: hidden;
                transition: border-radius 0.3s ease;
            }
            .mm-map.square { border-radius: 8px; }
            .mm-inner {
                position: absolute; inset: 0;
            }
            .mm-grid {
                position: absolute;
                pointer-events: none;
                background-image:
                    linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px);
            }
            .mm-bg {
                position: absolute;
                pointer-events: none;
            }
            .mm-self {
                position: absolute; top: 50%; left: 50%;
                width: 8px; height: 8px;
                transform: translate(-50%, -50%);
                background: var(--mm-self); border-radius: 50%;
                box-shadow: 0 0 6px var(--mm-self);
                z-index: 2;
            }
            .mm-fov {
                position: absolute; top: 50%; left: 50%;
                width: 60px; height: 40px;
                transform: translate(-50%, -100%);
                background: linear-gradient(to top, var(--mm-fov), transparent);
                clip-path: polygon(50% 100%, 0% 0%, 100% 0%);
                z-index: 1;
            }
            .mm-dot {
                position: absolute; width: 6px; height: 6px;
                transform: translate(-50%, -50%);
                border-radius: 50%;
                background: var(--mm-other); box-shadow: 0 0 4px var(--mm-other);
            }
            .mm-ring {
                position: absolute; inset: 4px; border-radius: 50%;
                border: 1px solid rgba(255,255,255,0.06);
            }
            .mm-ring2 {
                position: absolute; inset: 25%; border-radius: 50%;
                border: 1px solid rgba(255,255,255,0.04);
            }
            .mm-n {
                position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
                font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.8);
                z-index: 3;
            }

            .mm-players {
                position: absolute; top: 182px; right: 24px;
                width: 160px; display: flex; flex-direction: column; gap: 3px;
                font-size: 11px; letter-spacing: 1px; text-transform: uppercase;
            }
            .mm-players-item {
                display: flex; align-items: center; gap: 6px;
                opacity: 0.6; font-weight: 600;
            }
            .mm-players-item.self { opacity: 0.9; }
            .mm-players-dot {
                width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0;
            }
            .mm-players-dot.self { background: var(--mm-self); }
            .mm-players-dot.other { background: var(--mm-other); }
        </style>

        <div id="minimap-plugin">
            <div class="mm-map">
                <div class="mm-ring"></div>
                <div class="mm-ring2"></div>
                <div class="mm-inner js-mm-inner">
                    <div class="mm-grid js-mm-grid"></div>
                    <div class="mm-bg js-mm-bg"></div>
                    <div class="mm-n js-mm-n">N</div>
                </div>
                <div class="mm-fov"></div>
                <div class="mm-self"></div>
            </div>
            <div class="mm-players js-mm-players"></div>
        </div>`;

        this._updateMapShape();
        this._updateColors();
        this._updateMinimapImage();
        this._updateMinimap();
    }

    update() {
        this._updateMinimap();
    }

    onPropertyChanged(name) {
        if (name === 'minimapImage') {
            this._updateMinimapImage();
        }
        if (name === 'squareMap') {
            this._updateMapShape();
        }
        if (name === 'selfColor' || name === 'otherColor' || name === 'fovColor') {
            this._updateColors();
        }
    }

    _updateMapShape() {
        const map = this._uiContainer?.querySelector('.mm-map');
        if (map) map.classList.toggle('square', this.squareMap);
    }

    _updateColors() {
        const root = this._uiContainer?.querySelector('#minimap-plugin');
        if (!root) return;
        root.style.setProperty('--mm-self', this.selfColor);
        root.style.setProperty('--mm-other', this.otherColor);
        root.style.setProperty('--mm-fov', this.fovColor);
    }

    _getCameraYaw() {
        const cam = ArrivalSpace.getCamera();
        if (!cam) return 0;
        const fwd = cam.forward;
        return (Math.atan2(fwd.x, fwd.z) * 180 / Math.PI + 360) % 360;
    }

    _updateMinimapImage() {
        const bg = this._uiContainer?.querySelector('.js-mm-bg');
        if (!bg) return;
        if (this.minimapImage) {
            bg.style.backgroundImage = `url(${this.minimapImage})`;
            bg.style.backgroundSize = 'cover';
            bg.style.display = '';
        } else {
            bg.style.backgroundImage = '';
            bg.style.display = 'none';
        }
    }

    _updateMinimap() {
        const inner = this._uiContainer?.querySelector('.js-mm-inner');
        if (!inner) return;

        const yaw = this._getCameraYaw();
        const scroll = this.scrollMap;
        const northUp = this.northUp;

        // Rotate map with camera unless northUp
        inner.style.transform = northUp ? 'none' : `rotate(${yaw}deg)`;

        // Fixed center dot & FOV: visible when scrollMap (player stays centered)
        const selfEl = this._uiContainer?.querySelector('.mm-self');
        const fovEl = this._uiContainer?.querySelector('.mm-fov');
        if (selfEl) selfEl.style.display = scroll ? '' : 'none';
        if (fovEl) {
            fovEl.style.display = scroll ? '' : 'none';
            if (scroll && northUp) {
                fovEl.style.transform = `translate(-50%, -100%) rotate(${-yaw}deg)`;
                fovEl.style.transformOrigin = '50% 100%';
            } else {
                fovEl.style.transform = 'translate(-50%, -100%)';
                fovEl.style.transformOrigin = '';
            }
        }

        const player = ArrivalSpace.getPlayer();
        if (!player) return;
        const myPos = player.getPosition();
        const mapRadius = 76;
        const pxPerMeter = mapRadius / this.mapZoom;

        // Grid
        const grid = inner.querySelector('.js-mm-grid');
        if (grid) {
            const gridCellPx = 10 * pxPerMeter;
            grid.style.backgroundSize = `${gridCellPx}px ${gridCellPx}px`;
            const gridSize = mapRadius * 6;
            if (scroll) {
                const gx = (myPos.x % 10) * pxPerMeter;
                const gz = (myPos.z % 10) * pxPerMeter;
                grid.style.width = gridSize + 'px';
                grid.style.height = gridSize + 'px';
                grid.style.left = `calc(50% - ${gridSize / 2}px + ${gx}px)`;
                grid.style.top = `calc(50% - ${gridSize / 2}px + ${gz}px)`;
            } else {
                grid.style.width = gridSize + 'px';
                grid.style.height = gridSize + 'px';
                grid.style.left = `calc(50% - ${gridSize / 2}px)`;
                grid.style.top = `calc(50% - ${gridSize / 2}px)`;
            }
        }

        // Background image
        const bg = inner.querySelector('.js-mm-bg');
        if (bg && this.minimapImage) {
            const imgSize = this.mapImageSize * pxPerMeter;
            bg.style.width = imgSize + 'px';
            bg.style.height = imgSize + 'px';
            bg.style.transform = this.mapRotation ? `rotate(${this.mapRotation}deg)` : '';
            if (scroll) {
                const px = (myPos.x - this.mapOffsetX) * pxPerMeter;
                const pz = (myPos.z - this.mapOffsetZ) * pxPerMeter;
                bg.style.left = `calc(50% - ${imgSize / 2}px + ${px}px)`;
                bg.style.top = `calc(50% - ${imgSize / 2}px + ${pz}px)`;
            } else {
                bg.style.left = `calc(50% - ${imgSize / 2}px)`;
                bg.style.top = `calc(50% - ${imgSize / 2}px)`;
            }
        }

        const players = ArrivalSpace.net.getPlayers();

        // Remove old dots
        inner.querySelectorAll('.mm-dot').forEach(d => d.remove());

        // Moving self dot + FOV (only when map doesn't scroll — player moves on map)
        if (!scroll) {
            const sx = -(myPos.x - this.mapOffsetX) * pxPerMeter;
            const sz = -(myPos.z - this.mapOffsetZ) * pxPerMeter;

            const selfGroup = document.createElement('div');
            selfGroup.className = 'mm-dot';
            selfGroup.style.cssText = `
                left: calc(50% + ${sx}px); top: calc(50% + ${sz}px);
                width: 8px; height: 8px;
                background: ${this.selfColor};
                box-shadow: 0 0 6px ${this.selfColor};
                z-index: 2;
            `;

            const fov = document.createElement('div');
            fov.style.cssText = `
                position: absolute; left: 50%; top: 50%;
                width: 60px; height: 40px;
                transform: translate(-50%, -100%) rotate(${-yaw}deg);
                transform-origin: 50% 100%;
                background: linear-gradient(to top, ${this.fovColor}, transparent);
                clip-path: polygon(50% 100%, 0% 0%, 100% 0%);
                pointer-events: none;
            `;
            selfGroup.appendChild(fov);
            inner.appendChild(selfGroup);
        }

        for (const p of players) {
            if (!p.entity) continue;
            const pos = p.entity.getPosition();

            let px, py;
            if (scroll) {
                const dx = pos.x - myPos.x;
                const dz = pos.z - myPos.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist > this.mapZoom) continue;
                px = (-dx / this.mapZoom) * mapRadius;
                py = (-dz / this.mapZoom) * mapRadius;
            } else {
                px = -(pos.x - this.mapOffsetX) * pxPerMeter;
                py = -(pos.z - this.mapOffsetZ) * pxPerMeter;
            }

            const dot = document.createElement('div');
            dot.className = 'mm-dot';
            dot.style.left = `calc(50% + ${px}px)`;
            dot.style.top = `calc(50% + ${py}px)`;
            dot.title = p.userName || '';
            inner.appendChild(dot);
        }

        // Player list below minimap
        const list = this._uiContainer?.querySelector('.js-mm-players');
        if (list) {
            const user = ArrivalSpace.getUser();
            let html = `<div class="mm-players-item self"><span class="mm-players-dot self"></span>${user?.userName || 'You'}</div>`;
            for (const p of players) {
                html += `<div class="mm-players-item"><span class="mm-players-dot other"></span>${p.userName || 'Unknown'}</div>`;
            }
            list.innerHTML = html;
        }
    }
}
