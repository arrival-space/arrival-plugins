/**
 * Persistent Inventory — pickup + shared HUD.
 *
 * Cross-space collectibles: everything picked up here persists into the
 * user's account and shows up in EVERY space that has a Persistent Inventory
 * plugin (with the same `inventoryId`). No per-space setup — drop it in,
 * walk near it, and it's yours across the whole platform.
 *
 * Drop the plugin on any entity. It creates a small visible collectible.
 * Walk near it → it's recorded in the user's cross-space inventory and the
 * in-world pickup turns dim gray so creators can still see where it's
 * placed.
 *
 * The first Persistent Inventory instance per `inventoryId` also renders a
 * shared HUD (top-right corner) listing everything the user has collected
 * across spaces. Additional instances in the same space reuse that HUD —
 * they do NOT build their own. If the HUD owner is destroyed, another live
 * instance takes over.
 *
 * Each pickup is identified by its entity id, so duplicating the plugin
 * entity in the editor produces a distinct collectible with zero config.
 *
 * Persistence contract (ArrivalSpace.userData):
 *   namespace : <inventoryId>            (default "inventory" — keep default
 *                                          to share the inventory with other
 *                                          creators' pickups)
 *   key       : "item/<entityId>"
 *   value     : { itemId, name, pickedUpAt, pickedUpIn }
 *
 * Fires on pickup:
 *   ArrivalSpace.fire("inventory:pickup", { inventoryId, itemId, name })
 *   ArrivalSpace.fire("inventory:change", { inventoryId })
 */

// Module-level: one HUD owner per inventoryId across all PersistentInventory
// instances in the current space. The first instance to initialise claims
// ownership and builds the HUD in its own UI container; the rest just fire
// events.
const _hudOwners = new Map();

export class PersistentInventory extends ArrivalScript {
    static scriptName = "Persistent Inventory";

    inventoryId    = "inventory";
    resetInventory = false;
    itemName       = "";
    pickupRadius   = 1.5;
    itemColor      = "#51f83f";

    static properties = {
        inventoryId:    { title: "Inventory ID (shared namespace)" },
        resetInventory: { title: "Reset inventory (toggle ON to wipe this inventoryId)" },
        itemName:       { title: "Item name (blank = use entity id)" },
        pickupRadius:   { title: "Pickup radius (m)", min: 0.3, max: 10, step: 0.1 },
        itemColor:      { title: "Item color" },
    };

    // Each pickup is identified by its server-assigned entity id (e.g.
    // "user-model-i2ljc0"), so duplicating the plugin entity in the editor
    // produces a distinct collectible with zero config.
    get _itemKey() {
        return this.entity?._vibeEntityId
            || "unknown";
    }

    _visual   = null;
    _material = null;
    _time     = 0;
    _owned    = false;
    _onChange = null;

    async initialize() {
        this._createVisual();
        await this._refreshOwned();

        // Every instance listens for changes; only the HUD owner re-renders.
        this._onChange = (e) => this._onInventoryChange(e);
        ArrivalSpace.on("inventory:change", this._onChange);

        this._claimHudIfFree();
        if (_hudOwners.get(this.inventoryId) === this) await this._renderHud();
    }

    // Reads userData and puts this pickup into the right look (gray if owned,
    // bobbing-colored if not). Called on init, inventoryId change, and on every
    // inventory:change event.
    async _refreshOwned() {
        const existing = await ArrivalSpace.userData.get(this.inventoryId, `item/${this._itemKey}`);
        const owned = !!existing;
        if (owned === this._owned) return;
        this._owned = owned;
        if (owned) this._applyOwnedLook();
        else       this._applyActiveLook();
    }

    update(dt) {
        if (this._owned || !this._visual) return;

        // Gentle bob + slow rotation so the pickup reads as interactive.
        this._time += dt;
        const bob = Math.sin(this._time * 2) * 0.1;
        this._visual.setLocalPosition(0, 0.5 + bob, 0);
        this._visual.rotate(0, 45 * dt, 0);

        const player = ArrivalSpace.getPlayer?.();
        const myPos = this.entity?.getPosition?.();
        if (!player || !myPos) return;

        if (player.getPosition().distance(myPos) <= this.pickupRadius) {
            this._pickup();
        }
    }

    async _pickup() {
        // Set the flag synchronously so we don't re-trigger while the write is in flight.
        this._owned = true;
        this._applyOwnedLook();

        const key = this._itemKey;
        const name = this.itemName?.trim() || key;
        const room = ArrivalSpace.getRoom?.();
        const record = {
            itemId: key,
            name,
            pickedUpAt: new Date().toISOString(),
            pickedUpIn: room?.roomName || room?.roomId || null,
        };

        const ok = await ArrivalSpace.userData.set(this.inventoryId, `item/${key}`, record);
        if (!ok) {
            console.warn("PersistentInventory: failed to persist pickup, will retry on re-entry");
            this._owned = false;
            this._applyActiveLook();
            return;
        }

        ArrivalSpace.fire("inventory:pickup", {
            inventoryId: this.inventoryId,
            itemId: key,
            name,
        });
        ArrivalSpace.fire("inventory:change", { inventoryId: this.inventoryId });
    }

    // ── Visual ─────────────────────────────────────────────────────────────

    _createVisual() {
        this._destroyVisual();

        const v = new pc.Entity("InventoryVisual");
        v.addComponent("render", { type: "box" });
        v.setLocalScale(0.35, 0.35, 0.35);
        v.setLocalPosition(0, 0.5, 0);

        this._material = new pc.StandardMaterial();
        v.render.material = this._material;
        this.entity.addChild(v);
        this._visual = v;

        // Colors + opacity are owned by the look functions so they stay in one place.
        this._applyActiveLook();
    }

    _applyActiveLook() {
        if (!this._visual || !this._material) return;
        const rgb = this._hexToRgb(this.itemColor);
        this._material.diffuse.set(rgb.r, rgb.g, rgb.b);
        this._material.emissive.set(rgb.r * 0.4, rgb.g * 0.4, rgb.b * 0.4);
        this._material.opacity = 1;
        this._material.blendType = pc.BLEND_NONE;
        this._material.update();
    }

    _applyOwnedLook() {
        // Keep the visual present (so creators see where the pickup is placed)
        // but mark it as already-collected: dim gray, no animation.
        if (!this._visual || !this._material) return;
        this._visual.setLocalPosition(0, 0.5, 0);
        this._visual.setLocalEulerAngles(0, 0, 0);
        this._material.diffuse.set(0.35, 0.35, 0.35);
        this._material.emissive.set(0.04, 0.04, 0.04);
        this._material.opacity = 0.45;
        this._material.blendType = pc.BLEND_NORMAL;
        this._material.update();
    }

    _destroyVisual() {
        if (this._visual) { this._visual.destroy(); this._visual = null; }
        if (this._material) { this._material.destroy(); this._material = null; }
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────

    onPropertyChanged(name) {
        if (name === "itemColor" && !this._owned) this._applyActiveLook();
        else if (name === "inventoryId")          this._refreshOwned();
        else if (name === "resetInventory" && this.resetInventory) this._resetAll();
    }

    // Toggle-as-action: no button property type exists, so the user flips
    // resetInventory ON; we wipe the namespace and flip it back OFF.
    async _resetAll() {
        const keys = (await ArrivalSpace.userData.keys(this.inventoryId, { prefix: "item/" })) || [];
        await Promise.all(keys.map(k => ArrivalSpace.userData.delete(this.inventoryId, k)));
        this.resetInventory = false;
        ArrivalSpace.fire("inventory:change", { inventoryId: this.inventoryId });
    }

    destroy() {
        if (this._onChange) {
            ArrivalSpace.off("inventory:change", this._onChange);
            this._onChange = null;
        }
        if (_hudOwners.get(this.inventoryId) === this) {
            _hudOwners.delete(this.inventoryId);
            this.removeUI?.();
            // Nudge any remaining PersistentInventory instance in the same space to claim
            // ownership and re-render.
            ArrivalSpace.fire("inventory:change", { inventoryId: this.inventoryId });
        }
        this._destroyVisual();
    }

    // ── Shared HUD ─────────────────────────────────────────────────────────

    _claimHudIfFree() {
        if (!_hudOwners.has(this.inventoryId)) {
            _hudOwners.set(this.inventoryId, this);
        }
    }

    async _onInventoryChange(e) {
        if (!e || e.inventoryId !== this.inventoryId) return;
        this._claimHudIfFree();            // in case the previous owner was destroyed
        await this._refreshOwned();        // another instance / reset may have flipped this item
        if (_hudOwners.get(this.inventoryId) === this) await this._renderHud();
    }

    async _renderHud() {
        const ui = this.getUIContainer();
        if (!ui) return;

        // Parallel read: one .keys() plus N .get() in flight at once.
        const keys = (await ArrivalSpace.userData.keys(this.inventoryId, { prefix: "item/" })) || [];
        const items = (await Promise.all(keys.map(k => ArrivalSpace.userData.get(this.inventoryId, k))))
            .filter(Boolean)
            .sort((a, b) => (b.pickedUpAt || "").localeCompare(a.pickedUpAt || ""));

        const rows = items.length === 0
            ? `<div class="inv-empty">no items yet</div>`
            : items.map(i => `
                <div class="inv-row" title="${this._esc(i.pickedUpIn || "")}">
                    <span class="inv-name">${this._esc(i.name || i.itemId)}</span>
                </div>`).join("");

        ui.innerHTML = `
            <style>
                .inv-hud {
                    position: fixed; top: 16px; right: 16px; z-index: 100;
                    pointer-events: none; user-select: none;
                    font-family: 'Segoe UI', system-ui, sans-serif; color: #fff;
                    background: rgba(0,0,0,0.55); backdrop-filter: blur(6px);
                    border: 1px solid rgba(255,255,255,0.12);
                    border-radius: 10px; padding: 10px 12px;
                    min-width: 160px; font-size: 13px;
                }
                .inv-title {
                    font-size: 11px; text-transform: uppercase; letter-spacing: 2px;
                    opacity: 0.65; margin-bottom: 8px;
                    display: flex; justify-content: space-between; align-items: baseline;
                }
                .inv-count { font-size: 14px; font-weight: 700; color: #63b3ed; letter-spacing: 0; }
                .inv-list  { display: flex; flex-direction: column; gap: 4px; }
                .inv-row   {
                    padding: 4px 8px; border-radius: 6px;
                    background: rgba(255,255,255,0.04);
                    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                }
                .inv-empty { opacity: 0.4; font-style: italic; font-size: 12px; }
            </style>
            <div class="inv-hud">
                <div class="inv-title">
                    <span>Inventory</span>
                    <span class="inv-count">${items.length}</span>
                </div>
                <div class="inv-list">${rows}</div>
            </div>`;
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    _hexToRgb(hex) {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
        if (!m) return { r: 0.96, g: 0.77, b: 0.26 };
        return {
            r: parseInt(m[1], 16) / 255,
            g: parseInt(m[2], 16) / 255,
            b: parseInt(m[3], 16) / 255,
        };
    }

    _esc(s) {
        return String(s ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }
}
