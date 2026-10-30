// Scene selection, creation and preview. Object edits are saved per scene.
/** @satisfies {Record<string, any>} */
const ScenePanel = {
    KEY:'arcengine.editor.scene',
    /** @type {{id:string,name:string,mode:string,objects:LocationObjectDef[],terrainEnabled?:boolean,lighting?:any}|null} */
    active:null,
    revision:'', list:[], busy:false, saving:false, terrainEnabled:true, savedTerrain:true,
    sceneTerrain(scene) { return typeof scene.terrainEnabled==='boolean' ? scene.terrainEnabled : scene.mode!=='mining'; },
    setTerrain(enabled) {
        this.terrainEnabled=!!enabled;
        if(Lab.location) {
            Lab.location.setTerrainEnabled(this.terrainEnabled);
            Lab.camera.setTerrain(this.terrainEnabled ? Lab.location.terrain : null, {w:Lab.location.width,h:Lab.location.height});
        }
        ObjectsPanel.renderHeader();this.render();
    },
    async request(url,opts) {
        const response=await fetch(url,opts), data=await response.json();
        if(!response.ok || !data.ok)throw new Error(data.error || 'Scene request failed');
        return data;
    },
    async init() {
        const status=await this.request('/api/status');
        if(Number(status.api)<EDITOR_API_VERSION)throw new Error(I18N.t('scene.oldServer'));
        const list=await this.request('/api/scenes');this.list=list.scenes;
        if(!this.list.length)throw new Error(I18N.t('scene.none'));
        let id='main';try { id=localStorage.getItem(this.KEY) || id; } catch(e) { /* no storage */ }
        if(!this.list.some(s=>s.id===id))id=this.list[0].id;
        const loaded=await this.request('/api/scene?id='+encodeURIComponent(id));
        this.active=loaded.scene;this.revision=loaded.revision;
        this.terrainEnabled=this.savedTerrain=this.sceneTerrain(loaded.scene);
        LightingPanel.load(loaded.scene.lighting);
        PlayerPanel.load(loaded.scene.player);
        document.getElementById('scene-select').addEventListener('change',e=>this.switchTo(/** @type {HTMLSelectElement} */ (e.target).value));
        document.getElementById('scene-create').addEventListener('click',()=>this.create());
        document.getElementById('scene-duplicate').addEventListener('click',()=>this.duplicate());
        document.getElementById('scene-import').addEventListener('click',()=>this.importLegacy());
        document.getElementById('scene-play').addEventListener('click',()=>this.play());
        document.getElementById('scene-terrain').addEventListener('change',e=>this.setTerrain(/** @type {HTMLInputElement} */ (e.target).checked));
        window.addEventListener('lang-changed',()=>this.render());this.render();
    },
    render() {
        const select=/** @type {HTMLSelectElement} */ (document.getElementById('scene-select'));
        select.innerHTML='';
        for(const scene of this.list) { const opt=document.createElement('option');opt.value=scene.id;opt.textContent=scene.name;select.appendChild(opt); }
        if(this.active)select.value=this.active.id;
        select.disabled=this.busy || this.saving;
        const terrain=/** @type {HTMLInputElement} */ (document.getElementById('scene-terrain'));
        terrain.checked=this.terrainEnabled;terrain.disabled=this.busy || this.saving;
        /** @type {HTMLButtonElement} */ (document.getElementById('scene-create')).disabled=this.busy || this.saving;
        /** @type {HTMLButtonElement} */ (document.getElementById('scene-duplicate')).disabled=this.busy || this.saving;
        /** @type {HTMLButtonElement} */ (document.getElementById('scene-import')).disabled=this.busy || this.saving;
        /** @type {HTMLButtonElement} */ (document.getElementById('scene-play')).disabled=this.busy || this.saving;
    },
    hasUnsaved() {
        return ObjectsPanel.isDirty() || Inspector.dirtyList().length>0 || ContactShadowPanel.isDirty() || PlayerPanel.isDirty() || UIPanel.isDirty();
    },
    async switchTo(id) {
        if(this.busy || this.saving || !this.active || id===this.active.id){this.render();return;}
        if(this.hasUnsaved()){Toast.show(I18N.t('scene.unsaved'),true);this.render();return;}
        this.busy=true;this.render();
        try {
            const loaded=await this.request('/api/scene?id='+encodeURIComponent(id));
            if(this.hasUnsaved()){Toast.show(I18N.t('scene.unsaved'),true);return;}
            this.applyScene(loaded.scene,loaded.revision);
        } catch(e) { Toast.show(I18N.t('scene.error',{msg:e.message}),true); }
        finally { this.busy=false;this.render(); }
    },
    applyScene(scene,revision) {
        this.active=scene;this.revision=revision;
        this.savedTerrain=this.sceneTerrain(scene);this.setTerrain(this.savedTerrain);
        LightingPanel.load(scene.lighting);LightingPanel.apply();LightingPanel.render();
        PlayerPanel.load(scene.player);
        const defs=ObjectsPanel.normalizeObjects(scene.objects);
        ObjectsPanel.saved=JSON.stringify(defs);
        ObjectsPanel.restore({defs:ObjectsPanel.saved,selected:-1});
        Lab.setPlayerPreview(scene.mode==='mining');
        PlayerPanel.render();
        EditHistory.undoStack=[];EditHistory.redoStack=[];
        try { localStorage.setItem(this.KEY,scene.id); } catch(e) { /* no storage */ }
        ObjectsPanel.render();
    },
    async create() {
        if(this.busy || this.saving)return;
        if(this.hasUnsaved()){Toast.show(I18N.t('scene.unsaved'),true);return;}
        const name=window.prompt(I18N.t('scene.namePrompt'));if(name==null || !name.trim())return;
        this.busy=true;this.render();
        try {
            const created=await this.request('/api/scene/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name.trim()})});
            const list=await this.request('/api/scenes');this.list=list.scenes;
            if(this.hasUnsaved())Toast.show(I18N.t('scene.createdUnsaved'),true);
            else this.applyScene(created.scene,created.revision);
        } catch(e) { Toast.show(I18N.t('scene.error',{msg:e.message}),true); }
        finally { this.busy=false;this.render(); }
    },
    async duplicate() {
        if(!this.active || this.busy || this.saving)return;
        const name=window.prompt(I18N.t('scene.copyPrompt'),this.active.name+' Copy');if(name==null || !name.trim())return;
        const objects=JSON.parse(JSON.stringify(ObjectsPanel.defs())), snapshot=JSON.stringify(objects), mode=this.active.mode, terrainEnabled=this.terrainEnabled, lighting=LightingPanel.copy(), lightingSnapshot=JSON.stringify(lighting), player=PlayerPanel.copy(), playerSnapshot=JSON.stringify(player);
        this.busy=true;this.render();
        try {
            const created=await this.request('/api/scene/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name.trim(),objects,mode,terrainEnabled,lighting,player})});
            const list=await this.request('/api/scenes');this.list=list.scenes;
            if(JSON.stringify(ObjectsPanel.defs())!==snapshot || this.terrainEnabled!==terrainEnabled || JSON.stringify(LightingPanel.data)!==lightingSnapshot || JSON.stringify(PlayerPanel.data)!==playerSnapshot || Inspector.dirtyList().length || UIPanel.isDirty())
                Toast.show(I18N.t('scene.createdUnsaved'),true);
            else this.applyScene(created.scene,created.revision);
        } catch(e) { Toast.show(I18N.t('scene.error',{msg:e.message}),true); }
        finally { this.busy=false;this.render(); }
    },
    async importLegacy() {
        if(this.busy || this.saving)return;
        const name=window.prompt(I18N.t('scene.importPrompt'),I18N.t('scene.importDefault'));if(name==null || !name.trim())return;
        this.busy=true;this.render();
        try {
            const created=await this.request('/api/scene/import-legacy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name.trim()})});
            const list=await this.request('/api/scenes');this.list=list.scenes;
            if(this.hasUnsaved())Toast.show(I18N.t('scene.createdUnsaved'),true);
            else this.applyScene(created.scene,created.revision);
        } catch(e) { Toast.show(I18N.t('scene.error',{msg:e.message}),true); }
        finally { this.busy=false;this.render(); }
    },
    play() {
        if(!this.active || this.busy || this.saving)return;
        if(this.hasUnsaved()){Toast.show(I18N.t('scene.unsaved'),true);return;}
        const url=new URL('../../index.html',window.location.href);url.searchParams.set('scene',this.active.id);
        window.open(url.toString(),'_blank');
    }
};
