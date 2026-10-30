// objects-panel.js — the Objects tab: location objects (Objects.js) — the list,
// properties of the selected one (and the "Animation" section — model part spin), the move
// gizmo in the view, FBX import and saving.
//
// Records live in Location3D (location.objects: { def, mesh }): the panel edits the def
// fields and calls location.placeObject(rec); Location3D reads def.anim itself every frame.
// Changing the object kind (kind) — rebuilding the object: the material group, ink edges
// and outline are assigned by World3D.addObject on adding.
//
// Gizmo — BABYLON.GizmoManager (a utility layer on top of the scene). It listens to the
// SCENE pointer, and View3D turns it off (detachControl) — the editor turns it back on.
// The camera skips a press on the gizmo (camera.ignorePointer); a click without movement on
// an object selects it. A move along X/Z keeps the height above the ground (the object
// follows the terrain), a move along Y changes h.
//
// The sound of the selected object draws two faint yellow spheres — the volume it fills
// (§Sound spheres in the view).
//
// The layout is dirty when the JSON of the records differs from the saved one (saved).
// Field precision — as the server writes: position and heading to 0.1, scale to 0.001.

/** @satisfies {Record<string, any>} */
const ObjectsPanel = {
    /** @type {typeof Lab | null} */
    lab: null,
    /** @type {LocationObject | null} */
    selected: null,     // a location.objects record
    saved: '[]',        // layout JSON as of load or save
    /** @type {BABYLON.GizmoManager | null} */
    gizmo: null,
    propEls: null,      // property fields of the selected one: { pos: { x, y, h }, rot, scale }
    _down: null,        // LMB press point: a click without movement selects an object
    _importing: false,
    /** @type {string[]} */
    textureFiles: [],

    // A copy of LOCATION_OBJECTS — the starting records of the editor's Location3D and the base
    // of the dirty layout. Old records (rot — a heading number, scale — a number) become triples.
    initialObjects() {
        const defs=this.normalizeObjects(ScenePanel.active ? ScenePanel.active.objects : []);
        this.saved = JSON.stringify(defs);
        return defs;
    },
    normalizeObjects(list) {
        return JSON.parse(JSON.stringify(list)).map((d) => Object.assign(d, {
            rot: Array.isArray(d.rot) ? d.rot : [0, Number(d.rot) || 0, 0],
            scale: Array.isArray(d.scale) ? d.scale : [1, 1, 1].map(() => (Number(d.scale) > 0 ? Number(d.scale) : 1)),
        }));
    },

    init(lab) {
        this.lab = lab;
        const scene = lab.location.view.scene;
        scene.attachControl(true, true, true);
        this.gizmo = new BABYLON.GizmoManager(scene);
        this.gizmo.usePointerToAttachGizmos = false;
        this.setupGizmos();
        this.setGizmoMode('move');
        this.gizmo.attachToMesh(null);
        lab.camera.ignorePointer = (e) => this.gizmoHit(e);
        for (const btn of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#gizmo-modes [data-gizmo]'))) {
            btn.addEventListener('click', () => this.setGizmoMode(btn.dataset.gizmo));
        }

        lab.canvas.addEventListener('pointerdown', (e) => {
            this._down = (e.button === 0 && !this.gizmoHit(e)) ? { x: e.clientX, y: e.clientY } : null;
        });
        lab.canvas.addEventListener('pointerup', (e) => this.onClick(e));

        document.getElementById('btn-add-camera').addEventListener('click', () => this.addCamera());
        document.getElementById('btn-import').addEventListener('click', () => this.importModel());
        document.getElementById('btn-objects-save').addEventListener('click', () => this.save());
        document.getElementById('btn-objects-revert').addEventListener('click', () => this.revert());
        window.addEventListener('keydown', (e) => this.onKey(e));
        window.addEventListener('lang-changed', () => this.render());
        window.addEventListener('focus', () => this.loadTextures());
        this.loadTextures();

        for (const rec of lab.location.objects) this.watch(rec);
        this.render();
    },

    // SoundPanel found other files in assets/sounds (it owns the list): redraw the "Sound"
    // section — unless the user is typing in this panel right now.
    onSoundsChanged() {
        const host = document.getElementById('object-props');
        if (!host || !host.contains(document.activeElement)) this.renderProps();
    },

    // --- Selection --------------------------------------------------------------

    select(rec, fromView) {
        this.selected = rec && this.lab.location.objects.includes(rec) ? rec : null;
        this.gizmo.attachToMesh(this.selected && this.selected.mesh ? this.selected.mesh : null);
        if (fromView && this.selected) PaneTabs.show('objects');
        this.render();
    },

    // A click without movement: the object under the cursor or nothing (deselect).
    onClick(e) {
        const d = this._down;
        this._down = null;
        if (!d || e.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
        const r = this.lab.canvas.getBoundingClientRect();
        const hit = this.lab.location.view.scene.pick(e.clientX - r.left, e.clientY - r.top, (m) => !!this.recOf(m));
        this.select(hit && hit.hit ? this.recOf(hit.pickedMesh) : null, true);
    },

    recOf(mesh) {
        for (let n = mesh; n; n = n.parent) {
            if (n.metadata && n.metadata.locationObject) return n.metadata.locationObject;
        }
        return null;
    },

    // The model finished loading (or failed): gizmo onto the selected one, error mark in the list.
    watch(rec) {
        rec.loaded.then(() => {
            if (rec === this.selected) {
                this.gizmo.attachToMesh(rec.mesh);
                this.renderProps();   // model parts for the "Animation" section
            }
            if (rec.error) Toast.show(I18N.t('toast.modelFailed', { url: rec.def.model, msg: rec.error }), true);
            this.renderList();
        });
    },

    // --- Gizmo ------------------------------------------------------------------
    //
    // Lines of standard thickness, flat colors, no lighting: otherwise the gizmo materials
    // get quantized by the kit's toon plugin (it attaches to every StandardMaterial).
    // Move — axes and a square along the ground, rotate — X/Y/Z rings, scale — along the
    // axes, the center — uniform. World axes: X — right on the map, Z — down, Y — up.
    setupGizmos() {
        const gm = this.gizmo, C = (hex) => BABYLON.Color3.FromHexString(hex);
        const colors = { x: C('#f0525f'), y: C('#62d26f'), z: C('#4a90f0') }, hover = C('#ffd24a');
        const paint = (g, color) => {
            for (const [mat, c] of [[g.coloredMaterial, color], [g.hoverMaterial, hover]]) {
                if (!mat) continue;
                mat.disableLighting = true;
                mat.emissiveColor = c;
                mat.diffuseColor = BABYLON.Color3.Black();
                mat.specularColor = BABYLON.Color3.Black();
            }
        };
        gm.positionGizmoEnabled = true;
        gm.rotationGizmoEnabled = true;
        gm.scaleGizmoEnabled = true;
        const pg = gm.gizmos.positionGizmo, rg = gm.gizmos.rotationGizmo, sg = gm.gizmos.scaleGizmo;
        pg.planarGizmoEnabled = true;
        pg.xPlaneGizmo.isEnabled = false;
        pg.zPlaneGizmo.isEnabled = false;
        for (const g of [pg, rg, sg]) g.updateGizmoRotationToMatchAttachedMesh = false;
        for (const axis of ['x', 'y', 'z']) {
            paint(pg[axis + 'Gizmo'], colors[axis]);
            paint(rg[axis + 'Gizmo'], colors[axis]);
            paint(sg[axis + 'Gizmo'], colors[axis]);
        }
        paint(pg.yPlaneGizmo, colors.y);
        paint(sg.uniformScaleGizmo, C('#e8ecf1'));

        const track = (g, onDrag) => {
            g.dragBehavior.onDragStartObservable.add(() => { this._dragBefore = this.snapshot(); });
            g.dragBehavior.onDragObservable.add(onDrag);
            g.dragBehavior.onDragEndObservable.add(() => this.onGizmoDragEnd());
        };
        for (const g of [pg.xGizmo, pg.zGizmo, pg.yPlaneGizmo]) track(g, () => this.onMoveDrag(false));
        track(pg.yGizmo, () => this.onMoveDrag(true));
        for (const g of [rg.xGizmo, rg.yGizmo, rg.zGizmo]) track(g, () => this.onRotateDrag());
        for (const g of [sg.xGizmo, sg.yGizmo, sg.zGizmo, sg.uniformScaleGizmo]) track(g, () => this.onScaleDrag());
    },

    // Is a gizmo handle under the pointer? isHovered is updated only by mouse movement —
    // a touch and a quick click arrive without it, hence also a direct pick of the utility layer.
    gizmoHit(e) {
        if (this.gizmo.isHovered) return true;
        const layer = this.gizmo.utilityLayer;
        if (!layer || !this.gizmo.attachedMesh) return false;
        const r = this.lab.canvas.getBoundingClientRect();
        const hit = layer.utilityLayerScene.pick(e.clientX - r.left, e.clientY - r.top,
            (m) => m.isPickable && m.isEnabled(), false, this.lab.location.view.camera);
        return !!(hit && hit.hit);
    },

    setGizmoMode(mode) {
        this.gizmoMode = ['move', 'rotate', 'scale'].includes(mode) ? mode : 'move';
        this.gizmo.positionGizmoEnabled = this.gizmoMode === 'move';
        this.gizmo.rotationGizmoEnabled = this.gizmoMode === 'rotate';
        this.gizmo.scaleGizmoEnabled = this.gizmoMode === 'scale';
        for (const btn of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#gizmo-modes [data-gizmo]'))) {
            btn.classList.toggle('active', btn.dataset.gizmo === this.gizmoMode);
        }
    },

    // Move: along X/Z and along the ground the height above the ground stays (the object follows the terrain); along Y — h changes.
    onMoveDrag(vertical) {
        const rec = this.selected;
        if (!rec || !rec.mesh) return;
        const p = rec.mesh.position, d = rec.def, t = this.lab.location.terrainEnabled ? this.lab.location.terrain : null;
        const ground = t ? t.heightAt(p.x, p.z) : 0;
        d.x = this.round(p.x, 1);
        d.y = this.round(p.z, 1);
        if (vertical) d.h = this.round(p.y - ground, 1);
        else p.y = ground + (Number(d.h) || 0);
        this.syncProps();
        this.renderHeader();
    },

    // The rings rotate the mesh (rotation, or rotationQuaternion if it is set); the angles go
    // into rot [x, y, z] in degrees, y with the heading sign (rotation.y = −y).
    onRotateDrag() {
        const rec = this.selected, m = rec && rec.mesh;
        if (!m) return;
        const e = m.rotationQuaternion ? m.rotationQuaternion.toEulerAngles() : m.rotation;
        const deg = (v) => this.round(((v * 180 / Math.PI + 180) % 360 + 360) % 360 - 180, 1);
        rec.def.rot = [deg(e.x), deg(-e.y), deg(e.z)];
        this.syncProps();
        this.renderHeader();
    },

    onScaleDrag() {
        const rec = this.selected, m = rec && rec.mesh;
        if (!m) return;
        rec.def.scale = [m.scaling.x, m.scaling.y, m.scaling.z].map(v => Math.max(0.001, this.round(v, 3)));
        this.syncProps();
        this.renderHeader();
    },

    // Released: the mesh — strictly per def (rounded numbers, Euler instead of the gizmo quaternion), the step — into history.
    onGizmoDragEnd() {
        if (this.selected) this.lab.location.placeObject(this.selected);
        this.syncProps();
        if (this._dragBefore) this.commit(null, this._dragBefore);
        this._dragBefore = null;
    },

    // --- History (history.js) ------------------------------------------------------
    //
    // A step — a pair of layout snapshots before and after: { defs: records JSON, selected: index }.
    // The same set of models and kinds — record fields are edited in place (without rebuilding
    // the meshes), otherwise the objects are rebuilt.

    snapshot() {
        return { defs: JSON.stringify(this.defs()), selected: this.lab.location.objects.indexOf(this.selected) };
    },

    commit(key, before) {
        const after = this.snapshot();
        if (after.defs !== before.defs) EditHistory.record(key, () => this.restore(before), () => this.restore(after));
        this.renderHeader();
    },

    restore(snap) {
        const loc = this.lab.location, defs = JSON.parse(snap.defs);
        const same = defs.length === loc.objects.length &&
            defs.every((d, i) => d.model === loc.objects[i].def.model && d.kind === loc.objects[i].def.kind);
        if (same) {
            defs.forEach((d, i) => {
                const rec = loc.objects[i];
                for (const k of Object.keys(rec.def)) delete rec.def[k];
                Object.assign(rec.def, d);
                loc.placeObject(rec);
                loc.applyHidden(rec);
                loc.applyMaterials(rec);
            });
        } else {
            this.gizmo.attachToMesh(null);
            for (const rec of loc.objects.slice()) loc.removeObject(rec);
            for (const d of defs) this.watch(loc.addObject(d));
        }
        this.select(loc.objects[snap.selected] || null);
    },

    // --- Editing ----------------------------------------------------------------

    addCamera() {
        const at=this.lab.camera.groundFocus();
        this.addObject({name:this.uniqueName(I18N.t('sensor.camera')),model:Surveillance.MODEL,kind:'prop',x:this.round(at.x,1),y:this.round(at.y,1),h:0,rot:[0,0,0],scale:[1,1,1],sensor:Surveillance.defaults()});
    },

    addObject(def) {
        const before = this.snapshot();
        const rec = this.lab.location.addObject(def);
        this.watch(rec);
        this.select(rec);
        this.commit(null, before);
        return rec;
    },

    removeSelected() {
        const rec = this.selected;
        if (!rec) return;
        const before = this.snapshot();
        this.gizmo.attachToMesh(null);
        this.lab.location.removeObject(rec);
        this.select(null);
        this.commit(null, before);
    },

    duplicateSelected() {
        const d = this.selected && this.selected.def;
        if (!d) return;
        const copy = JSON.parse(JSON.stringify(d));   // rot and scale are arrays: a copy, not a reference
        this.addObject(Object.assign(copy, { name: this.uniqueName(d.name), x: this.round(d.x + 40, 1), y: this.round(d.y + 40, 1) }));
    },

    focusSelected() {
        const d = this.selected && this.selected.def;
        if (!d) return;
        this.lab.camera.followObj = null;
        this.lab.camera.lookAt(Number(d.x) || 0, Number(d.y) || 0);
    },

    // The object kind is assigned on adding to the scene — the object is rebuilt at its own place in the list.
    setKind(kind) {
        const rec = this.selected;
        if (!rec || rec.def.kind === kind) return;
        const loc = this.lab.location, at = loc.objects.indexOf(rec), before = this.snapshot();
        this.gizmo.attachToMesh(null);
        loc.removeObject(rec);
        const fresh = loc.addObject(Object.assign(JSON.parse(JSON.stringify(rec.def)), { kind }));
        loc.objects.splice(loc.objects.indexOf(fresh), 1);
        loc.objects.splice(at, 0, fresh);
        this.watch(fresh);
        this.select(fresh);
        this.commit(null, before);
    },

    // A field of the selected one; consecutive edits of one field are merged into a single history step.
    setField(key, value) {
        const rec = this.selected;
        if (!rec) return;
        const before = this.snapshot();
        rec.def[key] = value;
        this.lab.location.placeObject(rec);
        this.commit('field:' + before.selected + ':' + key, before);
    },

    // The whole animation of the selected one ({ part, axis, speed, dir }); null — remove.
    setAnim(anim) {
        const rec = this.selected;
        if (!rec) return;
        const before = this.snapshot();
        if (anim) rec.def.anim = anim;
        else delete rec.def.anim;
        this.commit('field:' + before.selected + ':anim', before);
    },

    // An optional field of the selected one (tag, hidden): an empty value removes it from the record.
    setOptional(key, value) {
        const rec = this.selected;
        if (!rec) return;
        const before = this.snapshot();
        if (value) rec.def[key] = value;
        else delete rec.def[key];
        if (key === 'hidden') this.lab.location.applyHidden(rec);
        this.commit('field:' + before.selected + ':' + key, before);
    },

    // The whole sound of the selected one ({ src, volume?, loop?, falloffMin?, falloffMax? });
    // null — remove. Location3D.updateSound picks the change up on the next frame.
    setSound(sound) {
        const rec = this.selected;
        if (!rec) return;
        const before = this.snapshot();
        if (sound) rec.def.sound = sound;
        else delete rec.def.sound;
        this.commit('field:' + before.selected + ':sound', before);
    },

    async loadTextures() {
        try {
            const response=await fetch('/api/textures',{cache:'no-store'}), data=await response.json();
            if (!data.ok || !Array.isArray(data.textures)) return;
            this.textureFiles=data.textures;
            const host=document.getElementById('object-props');
            if (!host || !host.contains(document.activeElement)) this.renderProps();
        } catch (e) { /* The server version indicator reports unavailable or old servers. */ }
    },

    setMaterial(index, field, value) {
        const rec=this.selected;if(!rec) return;
        const before=this.snapshot(), list=(rec.def.materials || []).map(x=>Object.assign({},x));
        let entry=list.find(x=>x.slot===index);
        if (!entry) { entry={slot:index};list.push(entry); }
        if (value === undefined) delete entry[field]; else entry[field]=value;
        const filtered=list.filter(x=>Object.keys(x).length>1).sort((a,b)=>a.slot-b.slot);
        if (filtered.length) rec.def.materials=filtered;else delete rec.def.materials;
        this.lab.location.applyMaterials(rec);
        this.commit('field:'+before.selected+':material:'+index+':'+field,before);
    },

    resetMaterial(index) {
        const rec=this.selected;if(!rec) return;
        const before=this.snapshot(), list=(rec.def.materials || []).filter(x=>x.slot!==index);
        if(list.length)rec.def.materials=list;else delete rec.def.materials;
        this.lab.location.applyMaterials(rec);this.commit(null,before);this.renderProps();
    },

    // The looped clip of the selected .glb model; '' — remove (the rest pose).
    setClip(name) {
        const rec = this.selected;
        if (!rec) return;
        const before = this.snapshot();
        if (name) rec.def.clip = name;
        else delete rec.def.clip;
        this.commit('field:' + before.selected + ':clip', before);
    },

    // Default axis: the thinnest side of the part (blades, wheel, propeller), the axis end —
    // outward from the model center, so that "clockwise" is what is seen from outside.
    // Coordinates — of the model file: part vertices, pivot and axes (Model3D) are in them.
    guessAxis(rec, name) {
        const parts = rec.mesh ? rec.mesh.getChildMeshes(true) : [];
        const mesh = parts.find(m => m.metadata && m.metadata.part === name);
        const md = mesh && mesh.metadata, pos = mesh && mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        if (!md || !md.axes || !pos) return 'y';
        const p = md.pivot, along = (v, x, y, z) => (x - p[0]) * v[0] + (y - p[1]) * v[1] + (z - p[2]) * v[2];
        let best = 'y', span = Infinity;
        for (const k of ['x', 'y', 'z']) {
            let lo = Infinity, hi = -Infinity;
            for (let i = 0; i < pos.length; i += 3) {
                const t = along(md.axes[k], pos[i], pos[i + 1], pos[i + 2]);
                if (t < lo) lo = t;
                if (t > hi) hi = t;
            }
            if (hi - lo < span) { span = hi - lo; best = k; }
        }
        const lo = new BABYLON.Vector3(Infinity, Infinity, Infinity), hi = lo.negate();
        for (const m of parts) {
            const b = m.getBoundingInfo().boundingBox;
            lo.minimizeInPlace(b.minimum);
            hi.maximizeInPlace(b.maximum);
        }
        const c = lo.add(hi).scale(0.5);
        return (along(md.axes[best], c.x, c.y, c.z) > 0 ? '-' : '') + best;
    },

    uniqueName(base) {
        const names = new Set(this.lab.location.objects.map(r => r.def.name));
        const stem = String(base || 'model').replace(/-\d+$/, '');
        if (!names.has(stem)) return stem;
        for (let i = 2; ; i++) if (!names.has(stem + '-' + i)) return stem + '-' + i;
    },

    onKey(e) {
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') { if (PaneTabs.current !== 'player') this.save(); return; }   // the default is suppressed by the inspector
        if (PaneTabs.current === 'ui') return;   // Del, Esc, Ctrl+D belong to the UI tab's element
        const t = e.target;
        if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
        const mode = { Digit1: 'move', Digit2: 'rotate', Digit3: 'scale' }[e.code];
        if (mode && !e.ctrlKey && !e.metaKey && !e.altKey) { this.setGizmoMode(mode); return; }
        if (!this.selected) return;
        if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); this.removeSelected(); }
        else if (e.code === 'Escape') this.select(null);
        else if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey) this.focusSelected();
        else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') { e.preventDefault(); this.duplicateSelected(); }
    },

    // --- File: import, save, revert ------------------------------------------------

    defs() {
        return this.lab.location.objects.map(r => r.def);
    },

    isDirty() {
        return JSON.stringify(this.defs()) !== this.saved || ScenePanel.terrainEnabled !== ScenePanel.savedTerrain || LightingPanel.isDirty();
    },

    async post(url, body) {
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return r.json();
    },

    // The server's system dialog opens in assets/models; where there is none — a browser file picker.
    async importModel() {
        if (this._importing) return;
        if (!Inspector.saveAvailable) { Toast.show(I18N.t('toast.noSave'), true); return; }
        this._importing = true;
        this.renderHeader();
        try {
            let res = await this.post('/api/pick-model', { title: I18N.t('obj.dialogTitle') });
            if (res.code === 'unsupported') res = await this.uploadModel();
            if (!res || res.code === 'cancelled') return;
            if (!res.ok) throw new Error(Inspector.errorText(res));
            const t = this.lab.camera.groundFocus();   // frame center on the ground: in flight the target hangs in the air
            this.addObject({ name: this.uniqueName(res.name), model: res.path, kind: 'prop',
                x: this.round(t.x, 1), y: this.round(t.y, 1), h: 0, rot: [0, 0, 0], scale: [1, 1, 1] });
            PaneTabs.show('objects');
            Toast.show(I18N.t(res.copied ? 'toast.importCopied' : 'toast.imported', { path: res.path }));
        } catch (e) {
            Toast.show(I18N.t('toast.importError', { msg: e.message }), true);
        } finally {
            this._importing = false;
            this.renderHeader();
        }
    },

    uploadModel() {
        return new Promise((resolve, reject) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.fbx,.glb';
            input.addEventListener('cancel', () => resolve({ ok: false, code: 'cancelled' }));
            input.addEventListener('change', () => {
                const file = input.files && input.files[0];
                if (!file) { resolve({ ok: false, code: 'cancelled' }); return; }
                fetch('/api/import-model?name=' + encodeURIComponent(file.name), { method: 'POST', body: file })
                    .then(r => r.json()).then(resolve, reject);
            });
            input.click();
        });
    },

    async save() {
        if (!this.isDirty()) return;
        if (!Inspector.saveAvailable) { Toast.show(I18N.t('toast.noSave'), true); return; }
        if (Inspector.server.api < EDITOR_API_VERSION) { Toast.show(I18N.t('scene.oldServer'),true); return; }
        if (ScenePanel.busy || ScenePanel.saving || !ScenePanel.active) return;
        const objects = JSON.parse(JSON.stringify(this.defs())), saved=JSON.stringify(objects), terrainEnabled=ScenePanel.terrainEnabled, lighting=LightingPanel.copy(), lightingSaved=JSON.stringify(lighting);
        ScenePanel.saving=true;ScenePanel.render();
        try {
            const j = await this.post('/api/scene/save', { id:ScenePanel.active.id, revision:ScenePanel.revision, objects, terrainEnabled, lighting });
            if (!j.ok) throw new Error(j.code==='scene_conflict' ? I18N.t('scene.conflict') : Inspector.errorText(j) + (j.index != null ? ' — #' + (j.index + 1) : ''));
            ScenePanel.revision=j.revision;ScenePanel.active.objects=objects;ScenePanel.active.terrainEnabled=terrainEnabled;ScenePanel.savedTerrain=terrainEnabled;
            LightingPanel.saved=lightingSaved;ScenePanel.active.lighting=lighting;
            this.saved = saved;
            this.renderHeader();
            Toast.show(I18N.t('toast.objSaved', { n: j.count, backup: j.backup || '—' }));
        } catch (e) {
            Toast.show(I18N.t('toast.objSaveError', { msg: e.message }), true);
        } finally { ScenePanel.saving=false;ScenePanel.render();Inspector.refreshSaveButton(); }
    },

    revert() {
        const before = this.snapshot();
        this.restore({ defs: this.saved, selected: -1 });
        ScenePanel.setTerrain(ScenePanel.savedTerrain);
        LightingPanel.revert();
        this.commit(null, before);
        Toast.show(I18N.t('toast.objReverted'));
    },

    // --- DOM ----------------------------------------------------------------------

    render() {
        this.renderHeader();
        this.renderList();
        this.renderProps();
    },

    renderHeader() {
        const dirty = this.isDirty();
        /** @type {HTMLButtonElement} */ (document.getElementById('btn-objects-save')).disabled = !dirty;
        /** @type {HTMLButtonElement} */ (document.getElementById('btn-objects-revert')).disabled = !dirty;
        const imp = /** @type {HTMLButtonElement} */ (document.getElementById('btn-import'));
        imp.disabled = this._importing;
        imp.textContent = I18N.t(this._importing ? 'obj.importing' : 'obj.import');
        const tab = document.querySelector('#pane-tabs [data-tab="objects"]');
        if (tab) tab.classList.toggle('dirty', dirty);
    },

    renderList() {
        const host = document.getElementById('objects-list');
        host.innerHTML = '';
        const list = this.lab.location.objects;
        if (!list.length) {
            host.appendChild(this.el('div', 'objects-empty', I18N.t('obj.empty')));
            return;
        }
        for (const rec of list) {
            const row = this.el('div', 'object-row' + (rec === this.selected ? ' selected' : '') + (rec.error ? ' broken' : '') +
                (rec.def.hidden ? ' ghost' : ''));
            row.append(
                this.el('span', 'object-name', rec.def.name || '—'),
                this.el('span', 'object-file', rec.error ? '⚠ ' + I18N.t('obj.missing') : rec.def.model.split('/').pop()));
            row.title = rec.error ? rec.def.model + ' — ' + rec.error : rec.def.model;
            // Clicking the selected row again clears the selection: the property list below
            // folds away and the gizmo leaves the view.
            row.addEventListener('click', () => this.select(this.selected === rec ? null : rec));
            // The two clicks of a double click have just toggled it off — select it again.
            row.addEventListener('dblclick', () => { this.select(rec); this.focusSelected(); });
            host.appendChild(row);
        }
    },

    renderProps() {
        const host = document.getElementById('object-props');
        host.innerHTML = '';
        this.propEls = null;
        const rec = this.selected;
        if (!rec) {
            if (this.lab.location.objects.length) host.appendChild(this.el('div', 'objects-empty', I18N.t('obj.noSelection')));
            return;
        }
        const d = rec.def, els = this.propEls = { pos: null, rot: null, scale: null, sound: null };

        const name = this.input('text', d.name);
        name.maxLength = 64;
        name.addEventListener('input', () => { this.setField('name', name.value); this.renderList(); });
        host.appendChild(this.row('obj.name', null, name));

        host.appendChild(this.row('obj.model', null, this.el('code', 'object-model', d.model)));

        const kind = this.choice([['prop', I18N.t('obj.kindProp')], ['actor', I18N.t('obj.kindActor')]], d.kind === 'actor' ? 'actor' : 'prop');
        kind.addEventListener('change', () => this.setKind(kind.value));
        host.appendChild(this.row('obj.kind', 'obj.kindHint', kind));

        const tag = this.input('text', d.tag || '');
        tag.maxLength = 64;
        tag.addEventListener('input', () => this.setOptional('tag', tag.value.trim()));
        host.appendChild(this.row('obj.tag', 'obj.tagHint', tag));

        const hidden = this.input('checkbox', '');
        hidden.checked = !!d.hidden;
        hidden.addEventListener('change', () => { this.setOptional('hidden', hidden.checked); this.renderList(); });
        host.appendChild(this.row('obj.hidden', 'obj.hiddenHint', hidden));

        const posKeys = ['x', 'y', 'h'];
        els.pos = this.vector(['X', 'Y', 'H'], 10, (i) => d[posKeys[i]], (i, v) => this.setField(posKeys[i], this.round(v, 1)));
        host.appendChild(this.row('obj.position', 'obj.positionHint', ...els.pos.parts));

        const setTriple = (key, i, v) => { const t = d[key].slice(); t[i] = v; this.setField(key, t); };
        els.rot = this.vector(['X', 'Y', 'Z'], 5, (i) => d.rot[i], (i, v) => setTriple('rot', i, this.round(v, 1)));
        host.appendChild(this.row('obj.rot', 'obj.rotHint', ...els.rot.parts));

        els.scale = this.vector(['X', 'Y', 'Z'], 0.1, (i) => d.scale[i], (i, v) => { if (v > 0) setTriple('scale', i, this.round(v, 3)); });
        host.appendChild(this.row('obj.scale', 'obj.scaleHint', ...els.scale.parts));

        if (rec.def.sensor) this.renderSensor(host, rec);
        this.renderBlobShadow(host, rec);
        this.renderMaterials(host, rec);
        this.renderAnim(host, rec);
        this.renderSound(host, rec);

        const actions = this.el('div', 'object-actions');
        for (const [key, fn, cls] of [['obj.focus', () => this.focusSelected()], ['obj.duplicate', () => this.duplicateSelected()],
            ['obj.delete', () => this.removeSelected(), 'danger']]) {
            const btn = this.el('button', cls || '', I18N.t(key));
            btn.addEventListener('click', fn);
            actions.appendChild(btn);
        }
        host.appendChild(actions);
    },

    renderSensor(host, rec) {
        host.appendChild(this.el('div', 'props-section', I18N.t('sensor.title')));
        for (const key of ['distance','radius']) {
            const min=key==='distance'?10:1;
            const num=this.input('number',this.fmt(rec.def.sensor[key]));
            num.min=String(min);num.max='10000';num.step='10';
            num.addEventListener('input',()=>{
                if(num.value==='')return;const n=Number(num.value);if(!Number.isFinite(n))return;
                const before=this.snapshot();rec.def.sensor=Object.assign({},rec.def.sensor,{[key]:this.round(Math.max(min,Math.min(10000,n)),1)});
                this.commit('field:'+before.selected+':sensor:'+key,before);
            });
            num.addEventListener('blur',()=>{num.value=this.fmt(rec.def.sensor[key]);});
            host.appendChild(this.row('sensor.'+key,'sensor.'+key+'Hint',num));
        }
    },

    renderBlobShadow(host, rec) {
        host.appendChild(this.el('div', 'props-section', I18N.t('blob.title')));
        const get = () => Location3D.blobSettings(rec.def, null, true);
        const custom = this.input('checkbox', ''); custom.checked = !!rec.def.blobShadow;
        custom.addEventListener('change', () => {
            const before = this.snapshot();
            if (custom.checked) {
                const s=get();rec.def.blobShadow={enabled:s.enabled,sizeX:s.sizeX,sizeZ:s.sizeX,opacity:s.opacity,curve:s.curve.slice()};
            } else delete rec.def.blobShadow;
            this.commit(null,before);this.renderProps();
        });
        host.appendChild(this.row('blob.custom', 'blob.customHint', custom));
        if (!custom.checked) return;
        const edit = (key, value) => {
            const before = this.snapshot(), current = get();
            rec.def.blobShadow = Object.assign({}, rec.def.blobShadow, { curve: current.curve.slice(), [key]: value });
            if (key === 'sizeX') rec.def.blobShadow.sizeZ = value;
            this.commit('field:' + before.selected + ':blob:' + key, before);
        };
        const enabled = this.input('checkbox', ''); enabled.checked = get().enabled;
        enabled.addEventListener('change', () => { edit('enabled', enabled.checked); this.renderProps(); });
        host.appendChild(this.row('blob.enabled', 'blob.hint', enabled));
        if (!get().enabled) return;
        for (const [key, label, min, max, step] of [
            ['sizeX', 'blob.size', 1, 10000, 10],
            ['opacity', 'blob.opacity', 0, 1, 0.05]]) {
            const num = this.input('number', get()[key]);
            Object.assign(num, { min: String(min), max: String(max), step: String(step) });
            num.addEventListener('input', () => {
                const n = Number(num.value); if (num.value !== '' && Number.isFinite(n)) edit(key, this.round(Math.max(Number(min), Math.min(Number(max), n)), 2));
            });
            num.addEventListener('blur', () => { num.value = String(get()[key]); });
            host.appendChild(this.row(label, null, num));
        }
        const box = this.el('div', 'blob-curve');
        const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 240 110'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
        const line = document.createElementNS(ns, 'polyline'); svg.appendChild(line);
        const dots = Array.from({ length: 5 }, () => { const c = document.createElementNS(ns, 'circle'); c.setAttribute('r', '5'); svg.appendChild(c); return c; });
        const sliders = this.el('div', 'blob-sliders');
        const inputs = Array.from({ length: 5 }, (_, i) => {
            const input = this.input('range', get().curve[i]);
            Object.assign(input, { min: '0', max: '1', step: '0.01' });
            input.setAttribute('aria-label', I18N.t('blob.point') + ' ' + (i + 1));
            input.disabled = i === 0 || i === 4;
            input.addEventListener('input', () => setPoint(i, Number(input.value)));
            sliders.appendChild(input); return input;
        });
        const draw = () => {
            const curve = get().curve, points = curve.map((v, i) => [10 + i * 55, 100 - v * 90]);
            line.setAttribute('points', points.map(p => p.join(',')).join(' '));
            dots.forEach((dot, i) => { dot.setAttribute('cx', String(points[i][0])); dot.setAttribute('cy', String(points[i][1])); inputs[i].value = String(curve[i]); });
        };
        const setPoint = (i, value) => { const curve = get().curve.slice(); curve[i] = this.round(Math.max(0, Math.min(1, value)), 2); edit('curve', curve); draw(); };
        let active = -1;
        const move = e => {
            if (active < 0) return;
            const r = svg.getBoundingClientRect(), y = (e.clientY - r.top) * 110 / r.height;
            setPoint(active, (100 - y) / 90);
        };
        svg.addEventListener('pointerdown', e => {
            const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) * 240 / r.width;
            active = Math.max(1, Math.min(3, Math.round((x - 10) / 55))); svg.setPointerCapture(e.pointerId); move(e); e.preventDefault();
        });
        svg.addEventListener('pointermove', move);
        svg.addEventListener('pointerup', () => { active = -1; });
        svg.addEventListener('pointercancel', () => { active = -1; });
        box.append(svg, sliders); draw();
        host.appendChild(this.row('blob.curve', 'blob.curveHint', box));
    },

    renderMaterials(host, rec) {
        host.appendChild(this.el('div','props-section',I18N.t('mat.title')));
        const slots=this.lab.location.materialSlots(rec);
        if (!slots.length) { host.appendChild(this.el('div','objects-empty',I18N.t('mat.empty')));return; }
        for (let i=0;i<slots.length;i++) {
            const slot=slots[i], entry=(rec.def.materials || []).find(x=>x.slot===i) || {slot:i};
            const title=this.el('div','material-title',slot.material.name.replace(/^.*\//,'') || (I18N.t('mat.slot')+' '+(i+1)));
            const reset=this.el('button','',I18N.t('mat.reset'));
            reset.title=I18N.t('mat.resetHint');reset.addEventListener('click',()=>this.resetMaterial(i));title.appendChild(reset);host.appendChild(title);
            const color=this.input('color',entry.color || slot.originalColor.toHexString());
            color.addEventListener('input',()=>this.setMaterial(i,'color',color.value));
            host.appendChild(this.row('mat.color','mat.colorHint',color));
            const textures=this.textureFiles.slice();
            if(entry.texture && !textures.includes(entry.texture))textures.push(entry.texture);
            const mode=entry.texture == null ? '__model' : entry.texture === '' ? '__none' : entry.texture;
            const file=this.choice([['__model',I18N.t('mat.modelTexture')],['__none',I18N.t('mat.noTexture')]]
                .concat(textures.map(p=>[p,p.replace(/^assets\//,'')])),mode);
            file.addEventListener('change',()=>{this.setMaterial(i,'texture',file.value==='__model'?undefined:file.value==='__none'?'':file.value);this.renderProps();});
            host.appendChild(this.row('mat.texture','mat.textureHint',file));
            if(entry.texture) {
                const preview=/** @type {HTMLImageElement} */ (this.el('img','material-preview'));
                preview.src='/'+entry.texture;preview.alt=entry.texture;host.appendChild(preview);
            }
            const original=/** @type {BABYLON.Texture | null} */ (slot.originalTexture);
            for(const [key,label,fallback] of [['uScale','mat.uScale',original?original.uScale:1],['vScale','mat.vScale',original?original.vScale:1],['alpha','mat.alpha',slot.originalAlpha]]) {
                const input=this.input('number',this.fmt(entry[key] == null ? fallback : entry[key]));
                input.min=key==='alpha'?'0':'0.001';input.max=key==='alpha'?'1':'100';input.step=key==='alpha'?'0.05':'0.1';
                input.addEventListener('input',()=>{if(input.value==='')return;const n=Number(input.value);if(!Number.isFinite(n))return;
                    const v=key==='alpha'?Math.max(0,Math.min(1,n)):Math.max(.001,Math.min(100,n));this.setMaterial(i,key,this.round(v,3));});
                host.appendChild(this.row(label,key==='alpha'?'mat.alphaHint':'mat.tilingHint',input));
            }
        }
        host.appendChild(this.el('div','material-note',I18N.t('mat.hint')));
    },

    // The "Animation" section. A .glb model — its looped clip (Location3D.playClip reads def.clip
    // every frame). An FBX model — a part (an FBX object) and its spin: axis, rpm, direction.
    // The model has not loaded — no parts or clips in the list, but the saved one stays selected.
    renderAnim(host, rec) {
        const a = rec.def.anim;
        host.appendChild(this.el('div', 'props-section', I18N.t('obj.anim')));
        const clips = rec.mesh ? Model3D.clips(rec.mesh) : null;
        if (clips || rec.def.clip) {
            const list = clips ? clips.names() : [];
            if (rec.def.clip && !list.includes(rec.def.clip)) list.push(rec.def.clip);
            const clip = this.choice([['', I18N.t('obj.animNone')]].concat(list.map(n => [n, n])), rec.def.clip || '');
            clip.addEventListener('change', () => this.setClip(clip.value));
            host.appendChild(this.row('obj.animClip', 'obj.animClipHint', clip));
            return;
        }
        const names = rec.mesh ? rec.mesh.getChildMeshes(true).map(m => m.metadata && m.metadata.part).filter(Boolean) : [];
        if (a && !names.includes(a.part)) names.push(a.part);
        const part = this.choice([['', I18N.t('obj.animNone')]].concat(names.map(n => [n, n])), a ? a.part : '');
        part.addEventListener('change', () => {
            const cur = rec.def.anim;
            this.setAnim(part.value ? { part: part.value, axis: this.guessAxis(rec, part.value),
                speed: cur ? cur.speed : 10, dir: cur ? cur.dir : 'cw' } : null);
            this.renderProps();
        });
        host.appendChild(this.row('obj.animPart', 'obj.animPartHint', part));
        if (!a) return;

        const edit = (key, value) => this.setAnim(Object.assign({}, rec.def.anim, { [key]: value }));
        const axis = this.choice(['x', '-x', 'y', '-y', 'z', '-z'].map(k => [k, (k[0] === '-' ? '−' : '+') + k.slice(-1).toUpperCase()]), a.axis);
        axis.addEventListener('change', () => edit('axis', axis.value));
        host.appendChild(this.row('obj.animAxis', 'obj.animAxisHint', axis));

        const speed = this.input('number', this.fmt(a.speed));
        speed.min = '0';
        speed.step = '1';
        speed.addEventListener('input', () => {
            const v = Number(speed.value);
            if (speed.value !== '' && Number.isFinite(v) && v >= 0) edit('speed', this.round(v, 1));
        });
        speed.addEventListener('blur', () => { if (rec.def.anim) speed.value = this.fmt(rec.def.anim.speed); });
        host.appendChild(this.row('obj.animSpeed', 'obj.animSpeedHint', speed));

        const dir = this.choice([['cw', I18N.t('obj.animCw')], ['ccw', I18N.t('obj.animCcw')]], a.dir === 'ccw' ? 'ccw' : 'cw');
        dir.addEventListener('change', () => edit('dir', dir.value));
        host.appendChild(this.row('obj.animDir', 'obj.animDirHint', dir));
    },

    // The "Sound" section: a file of assets/sounds playing at the object. Location3D.updateSound
    // reads def.sound every frame — an edit is heard at once (the toolbar's "sound" checkbox).
    // The file list is SoundPanel's, already fetched: nothing here waits, so rows never land in
    // a stale panel.
    renderSound(host, rec) {
        const s = rec.def.sound;
        host.appendChild(this.el('div', 'props-section', I18N.t('obj.sound')));
        const files = SoundPanel.files.slice();
        if (s && !files.includes(s.src)) files.push(s.src);
        if (!files.length) {
            host.appendChild(this.el('div', 'objects-empty', I18N.t('obj.soundEmpty')));
            return;
        }
        const file = this.choice([['', I18N.t('obj.soundNone')]].concat(files.map(p => [p, p.split('/').pop()])), s ? s.src : '');
        file.addEventListener('change', () => {
            this.setSound(file.value ? Object.assign({}, rec.def.sound, { src: file.value }) : null);
            this.renderProps();
        });
        host.appendChild(this.row('obj.soundFile', 'obj.soundFileHint', file));
        if (!s) return;

        // A default (volume 1, looped, the common radii) is not kept in the record.
        const edit = (key, value, isDefault) => {
            const next = Object.assign({}, rec.def.sound);
            if (isDefault) delete next[key];
            else next[key] = value;
            this.setSound(next);
        };
        const number = (key, fallback, min, max, step, digits) => {
            const num = this.input('number', this.fmt(s[key] == null ? fallback : s[key]));
            Object.assign(num, { min: String(min), max: String(max), step: String(step) });
            num.addEventListener('input', () => {
                const v = Number(num.value);
                if (num.value === '' || !Number.isFinite(v)) return;
                const value = Math.max(min, Math.min(max, this.round(v, digits)));
                edit(key, value, value === fallback);
            });
            num.addEventListener('blur', () => { const cur = rec.def.sound; if (cur) num.value = this.fmt(cur[key] == null ? fallback : cur[key]); });
            return num;
        };
        host.appendChild(this.row('obj.soundVolume', null, number('volume', 1, 0, 1, 0.05, 2)));
        // The two radii the spheres in the view show; els keeps them in sync.
        const els = this.propEls.sound = {};
        for (const key of ['falloffMin', 'falloffMax']) {
            els[key] = number(key, 0, 0, 20000, 10, 0);
            host.appendChild(this.row('obj.' + key, 'obj.' + key + 'Hint', els[key]));
        }
        const loop = this.choice([['1', I18N.t('obj.soundLooped')], ['0', I18N.t('obj.soundOnce')]], s.loop === false ? '0' : '1');
        loop.addEventListener('change', () => edit('loop', false, loop.value === '1'));
        host.appendChild(this.row('obj.soundLoop', 'obj.soundLoopHint', loop));
    },

    // --- Sound spheres in the view --------------------------------------------------
    //
    // Two barely visible yellow SPHERES around the selected object — the volume its sound fills:
    // falloffMin (full volume) and falloffMax (silence beyond). Sound3D measures the straight 3D
    // distance from the camera, so a sphere is exactly the audible region: inside it is heard,
    // outside it is not. The radii drawn are the EFFECTIVE ones — the object's own value, or the
    // AUDIO_FALLOFF_* constant when it is 0; the numbers are edited in the panel.
    //
    // Each sphere is drawn the way a gizmo is — as LINES: three great circles (one flat on the
    // map, two upright), so the shape reads as a volume and hides nothing behind it. A line mesh
    // keeps its 1 px width at any scale, so one unit wireframe scaled to the radius is enough —
    // no geometry is rebuilt while a radius changes.
    //
    // They live in the gizmo's utility layer (the toon plugin does not quantize them and they
    // draw over the world) and are NOT pickable: a sphere covers most of the screen, and a
    // pickable one would swallow every camera drag through it.

    SPHERE: { color: '#ffd24a', minAlpha: 0.55, maxAlpha: 0.32, segments: 64 },

    // The pair actually heard, in px (never min > max — that is not a ring, it is a knot).
    soundRadii(sound) {
        const global = (name, dflt) => {
            const v = Number(/** @type {any} */ (window)[name]);
            return Number.isFinite(v) ? v : dflt;
        };
        const min = Number(sound.falloffMin) > 0 ? Number(sound.falloffMin) : global('AUDIO_FALLOFF_MIN', 150);
        const max = Number(sound.falloffMax) > 0 ? Number(sound.falloffMax) : global('AUDIO_FALLOFF_MAX', 1024);
        return { min: Math.max(0, Math.min(min, max)), max: Math.max(0, max) };
    },

    // A unit wireframe sphere: three closed great circles of radius 1.
    sphereLines() {
        const n = this.SPHERE.segments, flat = [], upX = [], upZ = [];
        for (let i = 0; i <= n; i++) {
            const t = (i / n) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
            flat.push(new BABYLON.Vector3(c, 0, s));   // on the map
            upX.push(new BABYLON.Vector3(c, s, 0));    // upright, along x
            upZ.push(new BABYLON.Vector3(0, s, c));    // upright, along y of the map
        }
        return [flat, upX, upZ];
    },

    spheres() {
        if (this._spheres) return this._spheres;
        const scene = this.gizmo.utilityLayer.utilityLayerScene;
        const lines = this.sphereLines();
        const make = (key, alpha) => {
            const mesh = BABYLON.MeshBuilder.CreateLineSystem('sound-' + key, { lines }, scene);
            mesh.color = BABYLON.Color3.FromHexString(this.SPHERE.color);
            mesh.alpha = alpha;
            mesh.isPickable = false;      // never swallow a camera drag or a click on the object
            return mesh;
        };
        this._spheres = { falloffMin: make('falloffMin', this.SPHERE.minAlpha), falloffMax: make('falloffMax', this.SPHERE.maxAlpha) };
        return this._spheres;
    },

    // Every frame (Lab.tick): the object may have been moved by the gizmo, the terrain rebuilt,
    // the radii changed in a field or on the Sound tab. The spheres sit on the SAME world point
    // Sound3D measures from — the model's own position, so what is drawn is what is heard.
    syncSpheres() {
        const rec = this.selected, s = rec && rec.def.sound;
        // Sound off on the view toolbar — no sound, so nothing to show either.
        const on = !!s && PaneTabs.current === 'objects' && !Sound3D.muted;
        if (!on && !this._spheres) return;
        const spheres = this.spheres();
        for (const key of ['falloffMin', 'falloffMax']) spheres[key].setEnabled(on);
        if (!on) return;
        const x = Number(rec.def.x) || 0, y = Number(rec.def.y) || 0;
        const t = this.lab.location.terrainEnabled ? this.lab.location.terrain : null;
        const at = rec.mesh ? rec.mesh.position : new BABYLON.Vector3(x, (t ? t.heightAt(x, y) : 0) + (Number(rec.def.h) || 0), y);
        const eff = this.soundRadii(s);
        for (const key of ['falloffMin', 'falloffMax']) {
            spheres[key].position.copyFrom(at);
            spheres[key].scaling.setAll(Math.max(1, eff[key === 'falloffMin' ? 'min' : 'max']));
        }
    },

    // Fields of the selected one catch up with def (the gizmo moves the object); the focused field is left alone.
    syncProps() {
        const els = this.propEls, rec = this.selected;
        if (!els || !rec) return;
        const d = rec.def, values = { pos: [d.x, d.y, d.h], rot: d.rot, scale: d.scale };
        for (const key of ['pos', 'rot', 'scale']) {
            els[key].inputs.forEach((num, i) => { if (document.activeElement !== num) num.value = this.fmt(values[key][i]); });
        }
        // The sound radii follow the spheres in the view.
        for (const key of Object.keys(els.sound || {})) {
            const num = els.sound[key];
            if (document.activeElement !== num) num.value = this.fmt(d.sound && d.sound[key] != null ? d.sound[key] : 0);
        }
    },

    // Three numeric fields with axis labels: get(i) — the value, set(i, v) — an edit.
    vector(labels, step, get, set) {
        const inputs = [], parts = [];
        labels.forEach((label, i) => {
            const num = this.input('number', this.fmt(get(i)));
            num.step = step;
            num.addEventListener('input', () => {
                const v = Number(num.value);
                if (num.value !== '' && Number.isFinite(v)) set(i, v);
            });
            num.addEventListener('blur', () => { num.value = this.fmt(get(i)); });
            inputs.push(num);
            parts.push(this.el('span', 'axis-label', label), num);
        });
        return { inputs, parts };
    },

    // A property row in the inspector style: a label (+ hint) and controls.
    row(labelKey, hintKey, ...controls) {
        const row = this.el('div', 'field');
        if (hintKey) row.title = I18N.t(hintKey);
        const head = this.el('div', 'field-head');
        head.appendChild(this.el('label', '', I18N.t(labelKey)));
        const box = this.el('div', 'field-controls');
        box.append(...controls);
        row.append(head, box);
        return row;
    },

    input(type, value) {
        const el = document.createElement('input');
        el.type = type;
        el.value = value == null ? '' : value;
        return el;
    },

    // A <select> from [value, label] pairs.
    choice(options, value) {
        const sel = document.createElement('select');
        for (const [v, label] of options) {
            const opt = this.el('option', '', label);
            opt.value = v;
            sel.appendChild(opt);
        }
        sel.value = value;
        return sel;
    },

    el(tag, className, text) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text != null) el.textContent = text;
        return el;
    },

    round(v, digits) {
        const k = Math.pow(10, digits);
        return Math.round(Number(v) * k) / k;
    },

    fmt(v) {
        return Number.isFinite(Number(v)) ? String(Number(v)) : '';
    },
};

// Right pane tabs: Global Settings and Sound (Constants.js), Objects (Objects.js), UI (UILayout.js).
// The open tab is remembered in localStorage; a switch — the window 'pane-tab' event.
/** @satisfies {Record<string, any>} */
const PaneTabs = {
    KEY: 'arcengine.editor.tab',
    TABS: ['settings', 'objects', 'player', 'ui', 'sound'],
    current: 'settings',

    init() {
        for (const btn of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#pane-tabs [data-tab]'))) {
            btn.addEventListener('click', () => this.show(btn.dataset.tab));
        }
        let saved = null;
        try { saved = localStorage.getItem(this.KEY); } catch (e) { /* storage is unavailable */ }
        this.show(this.TABS.includes(saved) ? saved : 'settings');
    },

    show(tab) {
        this.current = tab;
        for (const btn of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#pane-tabs [data-tab]'))) btn.classList.toggle('active', btn.dataset.tab === tab);
        for (const panel of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.pane-panel'))) panel.hidden = panel.dataset.tab !== tab;
        try { localStorage.setItem(this.KEY, tab); } catch (e) { /* the choice will last until F5 */ }
        window.dispatchEvent(new CustomEvent('pane-tab', { detail: tab }));
    },
};
