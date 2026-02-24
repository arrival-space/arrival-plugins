/**
 * Avatar Outfit Override — overrides the player's outfit with a custom look.
 * Showcase: how to customize avatar parts using setAvatarParts().
 *
 * Each property accepts a part ID from the avatar catalog. Set to empty
 * string to keep the player's current part, or "none" to remove it.
 *
 * Available categories: headwear, glasses, facewear, top, bottom, footwear, hair
 *
 * Example part IDs (male catalog):
 *
 *   Headwear:
 *     headwear-16.glb  — Silver sci-fi helmet with blue accents
 *     headwear-15.glb  — Black futuristic helmet with tinted visor
 *     headwear-5.glb   — Black racing helmet with skull emblem
 *     headwear-17.glb  — Plague doctor mask with goggles
 *     headwear-29.glb  — Brown cowboy hat
 *     headwear-19.glb  — Classic black top hat
 *
 *   Glasses:
 *     glasses-8.glb    — Aviator sunglasses, silver frame
 *     glasses-13.glb   — Split red/blue lens, geometric frame
 *     glasses-57.glb   — Teal frame, pink reflective wraparound
 *     glasses-41.glb   — Tri-circular steampunk frames
 *
 *   Facewear:
 *     mask-2.glb       — Silver hockey mask
 *     mask-10.glb      — Red fox mask
 *     mask-11.glb      — Black mesh mask with white X
 *
 *   Tops:
 *     male-shirt-2.glb  — Varsity jacket, black/gray with crown
 *     male-shirt-3.glb  — Orange puffer jacket
 *     male-shirt-26.glb — Multi-colored retro bomber
 *
 *   Bottoms:
 *     male-pants-15.glb — Green camo cargo pants
 *     male-pants-1.glb  — Black cargo pants
 *     male-pants-14.glb — Light blue jeans
 *
 *   Footwear:
 *     male-shoes-14.glb — White high-top sneakers
 *     male-shoes-12.glb — Purple/black chunky sneakers
 *     male-shoes-17.glb — Black high-top sneakers
 *
 * Full catalog: await ArrivalSpace.getAvatarCatalog()
 * See api-reference.md for documentation.
 */
export class OutfitOverride extends ArrivalScript {
    static scriptName = 'Outfit Override';

    headwear = 'headwear-16.glb';
    glasses = '';
    facewear = '';
    top = '';
    bottom = '';
    footwear = '';

    static properties = {
        headwear: { title: 'Headwear' },
        glasses: { title: 'Glasses' },
        facewear: { title: 'Facewear' },
        top: { title: 'Top' },
        bottom: { title: 'Bottom' },
        footwear: { title: 'Footwear' },
    };

    async initialize() {
        await this._syncPartOptions();
        await this._applyCostume();
    }

    async onPropertyChanged() {
        await this._applyCostume();
    }

    async _syncPartOptions() {
        const avatarConfig = await ArrivalSpace.getAvatarConfig();
        const gender = avatarConfig?.gender === 'female' ? 'female' : 'male';
        const catalog = await ArrivalSpace.getAvatarCatalog(gender);
        if (!catalog?.categories) return;
        for (const cat of Object.keys(this.constructor.properties)) {
            const ids = (catalog.categories[cat]?.parts || []).map((part) => part?.id).filter(Boolean);
            this.setParamOptions(cat, ['', 'none', ...ids], false);
        }
        this.refreshParamSchema();
    }

    async _applyCostume() {
        const parts = {};
        for (const cat of ['headwear', 'glasses', 'facewear', 'top', 'bottom', 'footwear']) {
            const val = this[cat]?.trim();
            if (!val) continue;
            parts[cat] = val === 'none' ? null : val;
        }
        if (Object.keys(parts).length > 0) {
            await ArrivalSpace.setAvatarParts(parts);
        }
    }

    async destroy() {
        await ArrivalSpace.resetAvatar();
    }
}
