// Lightweight first-person player representation shared by the game and editor preview.
class PlayerAvatar {
    static defaults() {
        return { spawnX:1024, spawnZ:774, spawnY:0, eyeHeight:160, bodyHeight:150, bodyDiameter:50,
            startYaw:0, startPitch:-10, fov:typeof CAMERA_FOV_DEG !== 'undefined' ? CAMERA_FOV_DEG : 70,
            moveSpeed:typeof MINING_MOVE_SPEED !== 'undefined' ? MINING_MOVE_SPEED : 400,
            mouseSensitivity:typeof MINING_MOUSE_SENSITIVITY !== 'undefined' ? MINING_MOUSE_SENSITIVITY : 0.00175,
            lightEnabled:true, lightHeight:130, lightIntensity:0.65, lightRange:650, lightColor:'#ffe8c7' };
    }

    static settings(value) { return Object.assign(PlayerAvatar.defaults(), value || {}); }

    /** @param {Location3D} location @param {{showBody?:boolean, settings?:any}} [opts] */
    constructor(location, opts = {}) {
        this.location = location;
        const scene = location.view.scene;
        this.root = new BABYLON.Mesh('player', scene);
        this.root.isPickable = false;
        this.body = BABYLON.MeshBuilder.CreateCapsule('player-capsule', { height: 150, radius: 25, tessellation: 12, subdivisions: 2 }, scene);
        this.body.parent = this.root; this.body.position.y = 75; this.body.isPickable = false;
        this.body.isVisible = opts.showBody !== false;
        this.material = new BABYLON.StandardMaterial('player-material', scene);
        this.material.diffuseColor = new BABYLON.Color3(0.37, 0.46, 0.51);
        this.material.specularColor = BABYLON.Color3.Black(); this.body.material = this.material;
        this.light = new BABYLON.PointLight('player-light', new BABYLON.Vector3(0, 130, 0), scene);
        this.light.parent = this.root;
        this.applySettings(opts.settings);
        // Keep the directional sun last: ArcEngine's colored-shadow shader relies on it.
        if (location.view.sun) { scene.removeLight(location.view.sun); scene.addLight(location.view.sun); }
        scene.resetCachedMaterial();
        /** @type {LocationObject} */
        this.record = /** @type {any} */ ({ def: { tag: 'player' }, mesh: this.root });
    }

    applySettings(value) {
        this.settings = PlayerAvatar.settings(value);
        const s = this.settings;
        this.body.scaling.set(s.bodyDiameter / 50, s.bodyHeight / 150, s.bodyDiameter / 50);
        this.body.position.y = s.bodyHeight / 2;
        this.light.position.y = s.lightHeight; this.light.intensity = s.lightIntensity; this.light.range = s.lightRange;
        this.light.diffuse = BABYLON.Color3.FromHexString(s.lightColor); this.light.specular = this.light.diffuse.clone();
        this.light.setEnabled(s.lightEnabled);
    }

    /** Eye position in world coordinates, after movement, before rendering. */
    update(eye, dt) {
        this.root.position.set(eye.x, eye.y - this.settings.eyeHeight, eye.z);
        this.root.computeWorldMatrix(true);
        this.location.updateBlob(this.record, dt);
    }

    dispose() {
        this.location.removeBlob(this.record);
        this.light.dispose(); this.root.dispose(); this.material.dispose();
        this.location.view.scene.resetCachedMaterial();
    }
}
