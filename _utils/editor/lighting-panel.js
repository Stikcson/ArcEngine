// @ts-nocheck
// Scene lighting edits are saved and reverted with the Objects tab.
const LightingPanel = {
    data:null, saved:'',
    copy() { return JSON.parse(JSON.stringify(this.data)); },
    load(value) { this.data=JSON.parse(JSON.stringify(value || SceneLighting.defaults())); this.saved=JSON.stringify(this.data); },
    isDirty() { return JSON.stringify(this.data)!==this.saved; },
    init() { window.addEventListener('lang-changed',()=>this.render());this.render(); },
    apply() { if(Lab.location) SceneLighting.apply(Lab.location,this.data,true); },
    changed() { this.apply();ObjectsPanel.renderHeader();Inspector.refreshSaveButton(); },
    revert() { this.data=JSON.parse(this.saved);this.apply();this.render();Inspector.refreshSaveButton(); },
    async save() {
        if (!this.isDirty() || ScenePanel.busy || ScenePanel.saving || !ScenePanel.active) return;
        if (!Inspector.saveAvailable || Inspector.server.api < EDITOR_API_VERSION) {Toast.show(I18N.t('scene.oldServer'),true);return;}
        const lighting=this.copy(), snapshot=JSON.stringify(lighting), scene=ScenePanel.active;
        const objects=JSON.parse(ObjectsPanel.saved), terrainEnabled=ScenePanel.savedTerrain;
        ScenePanel.saving=true;ScenePanel.render();
        try {
            const result=await ObjectsPanel.post('/api/scene/save',{id:scene.id,revision:ScenePanel.revision,objects,terrainEnabled,lighting});
            if(!result.ok)throw new Error(result.code==='scene_conflict'?I18N.t('scene.conflict'):(result.error || result.code));
            ScenePanel.revision=result.revision;scene.lighting=lighting;this.saved=snapshot;
            ObjectsPanel.renderHeader();Inspector.refreshSaveButton();
            Toast.show(I18N.lang==='ru'?'Освещение сцены сохранено':'Scene lighting saved');
        } catch(e) {Toast.show((I18N.lang==='ru'?'Не удалось сохранить освещение: ':'Scene lighting save failed: ')+e.message,true);}
        finally {ScenePanel.saving=false;ScenePanel.render();}
    },
    render() {
        const host=document.getElementById('lighting-panel');host.replaceChildren();
        const ru=I18N.lang==='ru', tr=(a,b)=>ru?b:a;
        const title=document.createElement('div');title.className='props-section';title.textContent=tr('Scene lighting','Освещение сцены');host.append(title);
        for(const [key,en,rus] of [['sun','Sun','Солнце'],['sky','Sky light','Свет неба']]) {
            const label=document.createElement('label'), input=document.createElement('input');input.type='checkbox';input.checked=this.data[key];
            input.addEventListener('change',()=>{
                this.data[key]=input.checked;
                if(key==='sun' && input.checked && Number(Inspector.get('WORLD3D_SUN_INTENSITY'))===0)
                    Inspector.apply(Inspector.fieldByName.WORLD3D_SUN_INTENSITY,0.7);
                this.changed();
            });
            label.append(input,document.createTextNode(' '+tr(en,rus)+'  '));host.append(label);
        }
        const hint=document.createElement('p');hint.textContent=tr('Turn off both for a dark cave. Save the scene below.','Для тёмной пещеры выключите оба источника. Сохраните сцену ниже.');host.append(hint);
        const saveScene=document.createElement('button');saveScene.textContent=tr('Save scene lighting','Сохранить освещение сцены');
        saveScene.addEventListener('click',()=>this.save());host.append(saveScene);
        const add=document.createElement('button');add.textContent=tr('+ Point light','+ Точечный свет');add.disabled=this.data.points.length>=4;
        add.title=tr('Up to 4 point lights per scene','До 4 точечных источников в сцене');
        add.addEventListener('click',()=>{const at=Lab.camera.groundFocus();this.data.points.push({name:tr('Point light','Точечный свет')+' '+(this.data.points.length+1),x:Math.round(at.x),y:Math.round(at.y),h:200,color:'#ffd69b',intensity:1,range:700});this.changed();this.render();});host.append(add);
        this.data.points.forEach((p,i)=>{
            const box=document.createElement('div');box.className='props-section';
            const head=document.createElement('strong');head.textContent=p.name;box.append(head);
            const remove=document.createElement('button');remove.textContent=tr('Remove','Удалить');remove.addEventListener('click',()=>{this.data.points.splice(i,1);this.changed();this.render();});box.append(' ',remove);host.append(box);
            const field=(label,key,type,min,max,step)=>{
                const row=document.createElement('label');row.className='field';row.textContent=label;
                const input=document.createElement('input');input.type=type;input.value=String(p[key]);
                if(type==='number') {input.min=String(min);input.max=String(max);input.step=String(step);}
                input.addEventListener('input',()=>{
                    if(type==='number') {if(input.value==='')return;const n=Number(input.value);if(!Number.isFinite(n))return;p[key]=Math.max(min,Math.min(max,n));}
                    else {p[key]=input.value.slice(0,80);if(key==='name')head.textContent=p.name;}
                    this.changed();
                });
                input.addEventListener('blur',()=>{input.value=String(p[key]);});row.append(input);host.append(row);
            };
            field(tr('Name','Название'),'name','text');
            field('X','x','number',-100000,100000,10);field(tr('Map Y','Y на карте'),'y','number',-100000,100000,10);field(tr('Height','Высота'),'h','number',-100000,100000,10);
            field(tr('Color','Цвет'),'color','color');field(tr('Intensity','Яркость'),'intensity','number',0,10,0.1);field(tr('Range','Радиус'),'range','number',1,20000,10);
        });
    }
};
