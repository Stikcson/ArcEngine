// Location3D.js — the location: a 3D view (light, sky, fog, shadows), ground (Terrain3D)
// of size LOCATION_WIDTH × LOCATION_HEIGHT with the LOCATION_GROUND texture, and
// objects — models from Objects.js (LOCATION_OBJECTS), placed by the editor.
// Shared by the game (main.js) and the editor (_utils/editor/lab.js): both call
// update(dt) every frame — part spin (def.anim), the looped clip (def.clip) and the sound
// (def.sound) of the models. Game code finds what the editor placed by name or by tag
// (findByTag) and shows hidden objects with setHidden. The game creates its own
// objects in location.view.scene and registers them with World3D.addObject(location.view,
// mesh, 'actor' | 'prop'); put them on the ground via location.terrain.heightAt(x, y).

class Location3D {
    // opts: { assetBase?: '' — game (paths from index.html) | '/' — editor (from the server root),
    //         objects?: LOCATION_OBJECTS records }
    constructor(opts) {
        this.opts = opts || {};
        this.view = World3D.createView({});
        this.terrain = null;
        this.terrainEnabled = this.opts.terrainEnabled !== false;
        /** @type {LocationObject[]} */
        this.objects = [];   // { def, mesh, error, loaded } — see addObject
        /** @type {Map<string, { texture: BABYLON.RawTexture, refs: number }>} */
        this.blobTextures = new Map();
        this._groundImage = null;
        this._groundIndex = -1;
        this.buildTerrain();
        const models = (this.opts.objects || []).map(def => this.addObject(def).loaded);
        // Ready — the ground texture and object models have arrived (or were not found) and the scene shaders are built.
        this.ready = Promise.all([this.loadGround()].concat(models))
            .then(() => new Promise(resolve => this.view.scene.executeWhenReady(() => resolve(undefined))));
    }

    get width() { return Math.max(64, (typeof LOCATION_WIDTH !== 'undefined') ? LOCATION_WIDTH : 2048); }
    get height() { return Math.max(64, (typeof LOCATION_HEIGHT !== 'undefined') ? LOCATION_HEIGHT : 2048); }

    // (Re)build the ground from the location size and TERRAIN_* (editor — live).
    // Location objects settle onto the new ground; the game's own objects are the owner's concern.
    buildTerrain() {
        if (this.terrain) this.terrain.dispose();
        this.terrain = new Terrain3D(this.view, {
            worldW: this.width,
            worldH: this.height,
            groundImage: this._groundImage
        });
        for (const mesh of this.terrain.meshes) mesh.setEnabled(this.terrainEnabled);
        this.placeObjects();
        return this.terrain;
    }

    setTerrainEnabled(enabled) {
        this.terrainEnabled = !!enabled;
        if (this.terrain) for (const mesh of this.terrain.meshes) mesh.setEnabled(this.terrainEnabled);
        this.placeObjects();
    }

    // --- Location objects -----------------------------------------------------------

    // LOCATION_OBJECTS record -> object: { def, mesh, error, loaded }. The record
    // is returned immediately; the mesh appears once the model finishes loading (loaded —
    // a promise). No file — an object without a mesh (error), the scene doesn't crash.
    // def: { name, model, kind, x, y, h, rot, scale, anim?, clip?, tag?, hidden?, sound? } — the
    // fields are live: edit + placeObject; anim, clip and sound are read every frame (spinPart,
    // playClip, updateSound); hidden — through setHidden.
    /** @param {LocationObjectDef} def @returns {LocationObject} */
    addObject(def) {
        /** @type {LocationObject} */
        const rec = { def, mesh: null, error: null, loaded: null };
        this.objects.push(rec);
        rec.loaded = Model3D.load((this.opts.assetBase || '') + def.model, this.view.scene).then((model) => {
            if (this.objects.indexOf(rec) < 0 || !this.view) return rec;   // removed while loading
            rec.mesh = Model3D.build(model, this.view.scene, { name: def.name || 'object' });
            rec.mesh.metadata = { locationObject: rec };
            World3D.addObject(this.view, rec.mesh, def.kind);
            this.placeObject(rec);
            this.applyHidden(rec);
            this.applyMaterials(rec);
            return rec;
        }).catch((e) => {
            rec.error = (e && e.message) || String(e);
            console.warn('Location3D: не загрузилась модель ' + def.model + ' — ' + rec.error);
            return rec;
        });
        return rec;
    }

    // Mesh — from the def fields: position on the ground + h; rot — [x, y, z] degrees (y — heading
    // on the map, like heading: rotation.y = −y; x, z — tilt); scale — [x, y, z]. An old
    // record with numbers (rot — heading only, scale — uniform) is also read.
    /** @param {LocationObject} rec */
    placeObject(rec) {
        const m = rec.mesh, d = rec.def;
        if (!m) return;
        const x = Number(d.x) || 0, y = Number(d.y) || 0, D = Math.PI / 180;
        const r = Array.isArray(d.rot) ? d.rot : [0, d.rot, 0];
        const s = Array.isArray(d.scale) ? d.scale : [d.scale, d.scale, d.scale];
        const k = (v) => (Number(v) > 0 ? Number(v) : 1);
        m.position.set(x, (this.terrainEnabled && this.terrain ? this.terrain.heightAt(x, y) : 0) + (Number(d.h) || 0), y);
        m.rotationQuaternion = null;   // a quaternion (the gizmo may set one) would override rotation
        m.rotation.set((Number(r[0]) || 0) * D, -(Number(r[1]) || 0) * D, (Number(r[2]) || 0) * D);
        m.scaling.set(k(s[0]), k(s[1]), k(s[2]));
    }

    placeObjects() {
        for (const rec of this.objects) this.placeObject(rec);
    }

    // Objects with def.tag === tag, in list order: what the editor placed and game code picks
    // up as a group — findByTag('coin'). None — an empty array.
    /** @param {string} tag @returns {LocationObject[]} */
    findByTag(tag) {
        return tag ? this.objects.filter(rec => rec.def.tag === tag) : [];
    }

    // def.hidden: the object is placed but not in the scene — no mesh in the frame, no sound —
    // until the game shows it: setHidden(rec, false). Works before the model has loaded too.
    /** @param {LocationObject} rec @param {boolean} hidden */
    setHidden(rec, hidden) {
        if (hidden) rec.def.hidden = true;
        else delete rec.def.hidden;
        this.applyHidden(rec);
    }

    // opts.showHidden (the editor): a hidden object stays in the frame as a ghost — otherwise
    // there is nothing to click and drag.
    /** @param {LocationObject} rec */
    applyHidden(rec) {
        if (!rec.mesh) return;
        const hidden = !!rec.def.hidden, ghost = hidden && !!this.opts.showHidden;
        rec.mesh.setEnabled(!hidden || ghost);
        for (const m of rec.mesh.getChildMeshes()) m.visibility = ghost ? Location3D.GHOST_ALPHA : 1;
    }

    // One editable slot per distinct StandardMaterial, including FBX sub-materials.
    // Every built model owns its materials, so an override never changes a neighbour.
    /** @param {LocationObject} rec @returns {MaterialSlotState[]} */
    materialSlots(rec) {
        if (rec.materialSlots) return rec.materialSlots;
        if (!rec.mesh) return [];
        const slots = [], seen = new Set();
        const collect = (mat) => {
            if (!mat) return;
            if (mat instanceof BABYLON.MultiMaterial) { for (const sub of mat.subMaterials) collect(sub); return; }
            if (!(mat instanceof BABYLON.StandardMaterial) || seen.has(mat)) return;
            seen.add(mat);
            slots.push({ material:mat, originalColor:mat.diffuseColor.clone(), originalTexture:mat.diffuseTexture,
                originalAlpha:mat.alpha, runtimeTexture:null, textureKey:'' });
        };
        collect(rec.mesh.material);
        for (const mesh of rec.mesh.getChildMeshes(false)) collect(mesh.material);
        return rec.materialSlots = slots;
    }

    /** @param {LocationObject} rec */
    applyMaterials(rec) {
        const slots = this.materialSlots(rec);
        for (let i=0;i<slots.length;i++) {
            const slot=slots[i], change=(rec.def.materials || []).find(x=>x.slot===i), mat=slot.material;
            mat.diffuseColor = change && change.color ? BABYLON.Color3.FromHexString(change.color) : slot.originalColor.clone();
            mat.alpha = change && change.alpha != null ? change.alpha : slot.originalAlpha;
            const path=change && change.texture != null ? change.texture : null;
            const original=/** @type {BABYLON.Texture | null} */ (slot.originalTexture);
            const u=change && change.uScale != null ? change.uScale : (original ? original.uScale : 1);
            const v=change && change.vScale != null ? change.vScale : (original ? original.vScale : 1);
            const changedScale=!!original && (u!==original.uScale || v!==original.vScale);
            const key=JSON.stringify([path,u,v]);
            if (slot.textureKey === key) continue;
            let next=slot.originalTexture, owned=null;
            if (path === '') next=null;
            else if (path != null) {
                owned=new BABYLON.Texture((this.opts.assetBase || '')+path,this.view.scene);
                next=owned;
            } else if (changedScale) { owned=original.clone(); next=owned; }
            if (owned) { const tex=/** @type {BABYLON.Texture} */ (owned);tex.uScale=u;tex.vScale=v; }
            mat.diffuseTexture=next;
            if (slot.runtimeTexture) slot.runtimeTexture.dispose();
            slot.runtimeTexture=owned;slot.textureKey=key;
        }
    }

    // Object animation frame — before World3D.renderFrame().
    update(dt) {
        dt = Math.min(0.1, Math.max(0, dt || 0));
        for (const rec of this.objects) {
            this.spinPart(rec, dt);
            this.playClip(rec);
            this.updateSound(rec);
            this.updateBlob(rec, dt);
        }
    }

    // Props and actors get contact shadows unless explicitly disabled. Structural surfaces do not.
    static blobSettings(def, config = null, ignoreMaster = false) {
        const cfg = config || globalThis.CONTACT_SHADOW_CONFIG || { enabled: true, defaults: { sizeX: 150, opacity: 1, curve: [1, 0.86, 0.48, 0.12, 0] }, tags: [] };
        const tag = String(def.tag || '').trim().toLowerCase();
        const tagged = cfg.tags.find(item => item.tag.toLowerCase() === tag);
        const base = Object.assign({ enabled: !['wall', 'floor', 'ground'].includes(tag) }, cfg.defaults, tagged || {}, def.blobShadow || {});
        // Old scenes can contain an ellipse and non-zero curve endpoints. Preserve their
        // editable settings while rendering a circle with an opaque center and clear edge.
        return Object.assign({}, base, { enabled: !!base.enabled && (ignoreMaster || cfg.enabled), sizeZ: base.sizeX, curve: [1, base.curve[1], base.curve[2], base.curve[3], 0] });
    }

    // A tiny radial alpha texture, shared by every object with the same curve.
    blobTexture(curve) {
        const key = JSON.stringify(curve), cached = this.blobTextures.get(key);
        if (cached) { cached.refs++; return { key, texture: cached.texture }; }
        const size = 64, pixels = new Uint8Array(size * size * 4);
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
            const radius = Math.hypot((x + 0.5) * 2 / size - 1, (y + 0.5) * 2 / size - 1);
            const t = Math.min(1, radius) * 4, i = Math.min(3, Math.floor(t)), f = t - i;
            const alpha = radius >= 1 ? 0 : curve[i] * (1 - f) + curve[i + 1] * f;
            pixels[(y * size + x) * 4 + 3] = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
        }
        const texture = BABYLON.RawTexture.CreateRGBATexture(pixels, size, size, this.view.scene, false, false, BABYLON.Texture.BILINEAR_SAMPLINGMODE);
        texture.hasAlpha = true;
        this.blobTextures.set(key, { texture, refs: 1 });
        return { key, texture };
    }

    releaseBlobTexture(key) {
        const entry = this.blobTextures.get(key);
        if (entry && --entry.refs === 0) { entry.texture.dispose(); this.blobTextures.delete(key); }
    }

    removeBlob(rec) {
        const b = rec.blob;
        if (!b) return;
        b.mesh.dispose(); b.material.dispose(); this.releaseBlobTexture(b.textureKey); delete rec.blob;
    }

    updateBlob(rec, dt) {
        const settings = Location3D.blobSettings(rec.def), root = rec.mesh;
        if (!settings.enabled || !root) { this.removeBlob(rec); return; }
        let b = rec.blob;
        if (!b) {
            const mesh = BABYLON.MeshBuilder.CreateGround('contact-shadow', { width: 1, height: 1 }, this.view.scene);
            const material = new BABYLON.StandardMaterial('contact-shadow', this.view.scene);
            material.disableLighting = true; material.diffuseColor = BABYLON.Color3.Black();
            material.specularColor = BABYLON.Color3.Black(); material.backFaceCulling = false;
            material.disableDepthWrite = true; material.useAlphaFromDiffuseTexture = true;
            mesh.material = material; mesh.isPickable = false; mesh.receiveShadows = false;
            b = rec.blob = { mesh, material, textureKey: '', groundY: null, groundKey: '', groundTimer: 0 };
        }
        const key = JSON.stringify(settings.curve);
        if (key !== b.textureKey) {
            const next = this.blobTexture(settings.curve);
            b.material.diffuseTexture = next.texture;
            if (b.textureKey) this.releaseBlobTexture(b.textureKey);
            b.textureKey = next.key;
        }
        b.material.alpha = settings.opacity;
        b.mesh.scaling.set(settings.sizeX, 1, settings.sizeX);
        const p = root.getAbsolutePosition(), groundKey = [p.x, p.y, p.z, this.terrainEnabled].join(',');
        b.groundTimer -= dt;
        if (groundKey !== b.groundKey || b.groundTimer <= 0) {
            b.groundKey = groundKey; b.groundTimer = 0.75;
            if (this.terrainEnabled && this.terrain) b.groundY = this.terrain.heightAt(p.x, p.z);
            else {
                const ray = new BABYLON.Ray(new BABYLON.Vector3(p.x, p.y + 5, p.z), new BABYLON.Vector3(0, -1, 0), 10000);
                const hit = this.view.scene.pickWithRay(ray, m => m.isPickable && m.isEnabled() && m !== root && !m.isDescendantOf(root));
                b.groundY = hit && hit.hit && hit.pickedPoint ? hit.pickedPoint.y : null;
            }
        }
        b.mesh.setEnabled(root.isEnabled() && !rec.def.hidden && b.groundY != null);
        if (b.groundY != null) b.mesh.position.set(p.x, b.groundY + 0.25, p.z);
    }

    // def.sound = { src, volume?, loop?, falloffMin?, falloffMax? }: a sound standing at the object
    // (Sound3D, follows def.x, def.y), looped unless loop is false. Restarted when the file or
    // loop changes, volume and distances apply on the fly (the editor); a hidden object is silent.
    /** @param {LocationObject} rec */
    updateSound(rec) {
        const s = rec.def.sound, on = !!(s && s.src) && !rec.def.hidden;
        const key = on ? s.src + (s.loop === false ? '|once' : '|loop') : '';
        if (key !== (rec.soundKey || '')) {
            if (rec.sound) rec.sound.stop();
            rec.sound = on ? Sound3D.play((this.opts.assetBase || '') + s.src, { at: rec.def, node: rec.mesh,
                loop: s.loop !== false, volume: s.volume, falloffMin: s.falloffMin, falloffMax: s.falloffMax }) : null;
            rec.soundKey = key;
        } else if (rec.sound && rec.sound.playing) {
            rec.sound.setVolume(s.volume == null ? 1 : s.volume);
            rec.sound.falloffMin = Number(s.falloffMin) > 0 ? Number(s.falloffMin) : 0;
            rec.sound.falloffMax = Number(s.falloffMax) > 0 ? Number(s.falloffMax) : 0;
            rec.sound.node = rec.mesh;   // the model may have arrived after the sound started
        }
    }

    // def.clip — the name of a looped animation clip of a glTF model ('idle'); none — the rest
    // pose. The location acts only when def.clip CHANGES (the editor), so game code is free to
    // drive the same model: Model3D.clips(rec.mesh).play('run').
    /** @param {LocationObject} rec */
    playClip(rec) {
        const want = rec.mesh ? String(rec.def.clip || '') : '';
        if (rec.clip === want && rec.clipRoot === rec.mesh) return;
        const clips = rec.mesh ? Model3D.clips(rec.mesh) : null;
        if (clips) {
            if (want && clips.has(want)) clips.play(want);
            else if (rec.clip) clips.stop();
        }
        rec.clip = want;
        rec.clipRoot = rec.mesh;
    }

    // def.anim = { part, axis, speed, dir }: a model part (an FBX object) spins around its
    // center (origin from Blender) about its own axis, axis — 'x' | 'y' | 'z', with a minus — the
    // opposite end; speed — rpm; dir — 'cw' | 'ccw', clockwise/counterclockwise when viewed from
    // the axis end. Animation removed or part changed — the previous part returns to its place.
    /** @param {LocationObject} rec @param {number} dt */
    spinPart(rec, dt) {
        const a = rec.def.anim;
        const name = a && rec.mesh ? String(a.part || '') : '';
        let s = rec.spin;
        if (s && (s.name !== name || s.root !== rec.mesh)) {
            if (s.mesh && !s.mesh.isDisposed()) {
                s.mesh.rotationQuaternion = null;
                s.mesh.setPivotPoint(BABYLON.Vector3.Zero());
            }
            s = rec.spin = null;
        }
        if (!name) return;
        if (!s) {
            const mesh = rec.mesh.getChildMeshes(true).find(m => m.metadata && m.metadata.part === name) || null;
            s = rec.spin = { name, root: rec.mesh, mesh, angle: 0, axis: new BABYLON.Vector3(), q: new BABYLON.Quaternion() };
            if (mesh) mesh.setPivotPoint(BABYLON.Vector3.FromArray(mesh.metadata.pivot));
        }
        if (!s.mesh) return;
        const axis = String(a.axis || 'y'), dirs = s.mesh.metadata.axes;
        const v = dirs[axis.slice(-1)] || dirs.y, sign = axis[0] === '-' ? -1 : 1;
        s.axis.set(v[0] * sign, v[1] * sign, v[2] * sign);
        // The scene is right-handed: a positive angle is counterclockwise from the axis end.
        const turn = Math.max(0, Number(a.speed) || 0) * Math.PI / 30 * (a.dir === 'ccw' ? 1 : -1);
        s.angle = (s.angle + turn * dt) % (2 * Math.PI);
        BABYLON.Quaternion.RotationAxisToRef(s.axis, s.angle, s.q);
        s.mesh.rotationQuaternion = s.q;
    }

    /** @param {LocationObject} rec */
    removeObject(rec) {
        const i = this.objects.indexOf(rec);
        if (i >= 0) this.objects.splice(i, 1);
        if (rec.blob) this.removeBlob(rec);
        if (rec.sound) rec.sound.stop();
        rec.sound = null;
        rec.soundKey = '';
        if (rec.materialSlots) for (const slot of rec.materialSlots) if (slot.runtimeTexture) slot.runtimeTexture.dispose();
        rec.materialSlots = null;
        if (rec.mesh && this.view) Model3D.dispose(this.view, rec.mesh);
        rec.mesh = null;
    }

    // Ground texture by LOCATION_GROUND. Paths — as LITERALS in GROUNDS: the builder's
    // asset scanner (tools/asset-scan.mjs) finds assets only that way. No file —
    // the ground stays a flat color, the scene doesn't crash.
    loadGround() {
        const list = Location3D.GROUNDS;
        const n = (typeof LOCATION_GROUND !== 'undefined') ? LOCATION_GROUND : 0;
        const idx = Math.max(0, Math.min(list.length - 1, Math.round(n) || 0));
        if (idx === this._groundIndex && this._groundImage) return Promise.resolve(this._groundImage);
        this._groundIndex = idx;
        const url = (this.opts.assetBase || '') + list[idx];
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                if (this._groundIndex === idx) {
                    this._groundImage = img;
                    if (this.terrain) this.terrain.setGroundImage(img);
                }
                resolve(img);
            };
            img.onerror = () => {
                console.warn('Location3D: не загрузилась текстура земли ' + url);
                resolve(null);
            };
            img.src = url;
        });
    }

    applyRenderConstants() {
        World3D.applyRenderConstants(this.view);
    }

    dispose() {
        for (const rec of this.objects) if (rec.sound) rec.sound.stop();
        this.objects = [];   // meshes and materials die with the scene
        if (this.terrain) this.terrain.dispose();
        this.terrain = null;
        if (this.view) this.view.dispose();
        this.view = null;
    }
}

Location3D.GHOST_ALPHA = 0.35;   // a hidden object in the editor (opts.showHidden)

// Ground textures by LOCATION_GROUND: 0 — grass, 1 — sand, 2 — snow.
Location3D.GROUNDS = [
    'assets/ground_texture_g.jpg',
    'assets/ground_texture_d.jpg',
    'assets/ground_texture_s.jpg'
];
