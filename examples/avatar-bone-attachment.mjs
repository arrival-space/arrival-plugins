/**
 * Avatar Bone Attachment
 *
 * Loads a GLB model and attaches it to a specific bone on the local
 * player's avatar skeleton. Configurable bone selection, offset,
 * rotation, and scale allow positioning props, weapons, or accessories
 * on any avatar bone.
 */
export class AvatarBoneAttachment extends ArrivalScript {
    static scriptName = "Avatar Bone Attachment";

    modelUrl = "";
    boneName = "RightHand";
    boneRotationX = 0;
    boneRotationY = 0;
    boneRotationZ = 0;
    targetBoneName = "Spine";
    targetBonePitch = 0;
    modelScale = 1;
    offsetX = 0.12;
    offsetY = 0.175;
    offsetZ = 0.02;
    rotationX = -90;
    rotationY = -90;
    rotationZ = 0;

    static properties = {
        modelUrl: { title: "Model (GLB)", editor: "asset" },
        boneName: { title: "Gun Bone" },
        boneRotationX: { title: "Bone Rotation X", min: -180, max: 180, step: 1 },
        boneRotationY: { title: "Bone Rotation Y", min: -180, max: 180, step: 1 },
        boneRotationZ: { title: "Bone Rotation Z", min: -180, max: 180, step: 1 },
        targetBoneName: { title: "Target Bone" },
        targetBonePitch: { title: "Target Pitch", min: -180, max: 180, step: 1 },
        modelScale: { title: "Model Scale", min: 0.01, max: 10, step: 0.01 },
        offsetX: { title: "Offset X", min: -2, max: 2, step: 0.01 },
        offsetY: { title: "Offset Y", min: -2, max: 3, step: 0.01 },
        offsetZ: { title: "Offset Z", min: -2, max: 2, step: 0.01 },
        rotationX: { title: "Rotation X", min: -180, max: 180, step: 1 },
        rotationY: { title: "Rotation Y", min: -180, max: 180, step: 1 },
        rotationZ: { title: "Rotation Z", min: -180, max: 180, step: 1 },
    };

    _attachmentEntity = null;
    _anchorEntity = null;
    _attachVersion = 0;
    _boneOptionsRoot = null;
    _printedBoneRoot = null;

    async initialize() {
        this._maybePrintBoneNames();
        this._syncBoneOptions();
        await this._refreshAttachment();
    }

    update() {
        this._maybePrintBoneNames();
        this._syncBoneOptions();

        const anchorEntity = this._getAnchorEntity();
        if (anchorEntity !== this._anchorEntity || this._anchorEntity?._destroyed) {
            this._refreshAttachment();
            return;
        }

        this._applyTransform();
    }

    postUpdate() {
        this._applyBoneRotation();
        this._applyTargetBoneRotation();
    }

    async onPropertyChanged(name) {
        if (name === "modelUrl" || name === "boneName") {
            await this._refreshAttachment();
            return;
        }

        this._applyBoneRotation();
        this._applyTargetBoneRotation();
        this._applyTransform();
    }

    _getAnchorEntity() {
        return this._getSelectedBone();
    }

    _maybePrintBoneNames() {
        const root = ArrivalSpace.getPlayerMesh() || ArrivalSpace.getPlayer() || null;
        if (!root || root === this._printedBoneRoot || root._destroyed) return;

        this._printedBoneRoot = root;
        console.log(`[AvatarBoneAttachment] Bone hierarchy under ${root.name}:`);
        this._printBoneTree(root, 0);
    }

    _printBoneTree(entity, depth) {
        const indent = "  ".repeat(depth);
        console.log(`${indent}${entity.name || "unnamed"}`);

        for (const child of entity.children) {
            this._printBoneTree(child, depth + 1);
        }
    }

    _syncBoneOptions() {
        const root = ArrivalSpace.getPlayer();
        if (!root || root === this._boneOptionsRoot || root._destroyed) return;

        this._boneOptionsRoot = root;
        const options = ["", ...this._collectBoneNames(root)];
        this.setParamOptions("boneName", options, false);
        this.setParamOptions("targetBoneName", options, false);
        this.refreshParamSchema();
    }

    _collectBoneNames(root) {
        const names = [];
        const visit = (entity) => {
            if (entity?.name) names.push(entity.name);
            for (const child of entity.children) visit(child);
        };
        visit(root);
        return names;
    }

    _getSelectedBone() {
        if (!this.boneName) return null;
        const player = ArrivalSpace.getPlayer();
        if (!player) return null;
        return player.findByName(this.boneName) || null;
    }

    _applyBoneRotation() {
        const bone = this._getSelectedBone();
        if (!bone || bone._destroyed) return;
        bone.setLocalEulerAngles(this.boneRotationX, this.boneRotationY, this.boneRotationZ);
    }

    _getTargetBone() {
        if (!this.targetBoneName) return null;
        const player = ArrivalSpace.getPlayer();
        if (!player) return null;
        return player.findByName(this.targetBoneName) || null;
    }

    _applyTargetBoneRotation() {
        const bone = this._getTargetBone();
        if (!bone || bone._destroyed) return;
        const angles = bone.getLocalEulerAngles();
        bone.setLocalEulerAngles(angles.x + ((-this._getCameraPitch()) + this.targetBonePitch), angles.y, angles.z + this._getCameraPitch()*0.5);
    }

    _getCameraPitch() {
        const player = ArrivalSpace.getPlayer();
        const elevation = player?.script?.firstPersonView?.elevation;
        return Number.isFinite(elevation) ? elevation : 0;
    }

    async _refreshAttachment() {
        const attachVersion = ++this._attachVersion;
        const anchorEntity = this._getAnchorEntity();

        this._disposeAttachment();
        this._anchorEntity = anchorEntity;

        if (!anchorEntity || !this.modelUrl) return;

        try {
            const { entity } = await this.createModel(this.modelUrl, {
                parent: anchorEntity,
                name: "AvatarBoneAttachmentModel",
                scale: this.modelScale,
            });

            if (attachVersion !== this._attachVersion) {
                ArrivalSpace.disposeEntity(entity);
                return;
            }

            this._attachmentEntity = entity;
            this._applyTransform();
        } catch (err) {
            if (attachVersion !== this._attachVersion) return;
            console.error("[AvatarBoneAttachment] Failed to attach model:", err);
        }
    }

    _applyTransform() {
        if (!this._attachmentEntity || this._attachmentEntity._destroyed) return;

        this._attachmentEntity.setLocalPosition(this.offsetX, this.offsetY, this.offsetZ);
        this._attachmentEntity.setLocalEulerAngles(this.rotationX, this.rotationY, this.rotationZ);
        this._attachmentEntity.setLocalScale(this.modelScale, this.modelScale, this.modelScale);
    }

    _disposeAttachment() {
        if (!this._attachmentEntity || this._attachmentEntity._destroyed) {
            this._attachmentEntity = null;
            return;
        }

        ArrivalSpace.disposeEntity(this._attachmentEntity);
        this._attachmentEntity = null;
    }

    destroy() {
        this._attachVersion++;
        this._disposeAttachment();
        this._anchorEntity = null;
    }
}
