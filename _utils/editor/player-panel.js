// @ts-nocheck
// Player settings belong to the selected mining scene, independently of object edits.
const PlayerPanel = {
    data:null, saved:'',
    tr(en,ru) { return I18N.lang==='ru' ? ru : en; },
    load(value) { this.data=PlayerAvatar.settings(value);this.saved=JSON.stringify(this.data); },
    copy() { return JSON.parse(JSON.stringify(this.data)); },
    isDirty() { return !!this.saved && JSON.stringify(this.data)!==this.saved; },
    init() {window.addEventListener('lang-changed',()=>this.render());this.render();},
    refresh() {
        const tab=document.querySelector('#pane-tabs [data-tab="player"]');if(tab)tab.classList.toggle('dirty',this.isDirty());
        const save=document.getElementById('player-save'), revert=document.getElementById('player-revert');
        if(save)save.disabled=!this.isDirty() || ScenePanel.saving;if(revert)revert.disabled=!this.isDirty() || ScenePanel.saving;
    },
    changed() {
        if(Lab.playerPreview) Lab.playerPreview.applySettings(this.data);
        this.refresh();
    },
    revert() {this.data=JSON.parse(this.saved);this.changed();this.render();},
    async save() {
        if(!this.isDirty() || ScenePanel.busy || ScenePanel.saving || !ScenePanel.active)return;
        if(!Inspector.saveAvailable || Inspector.server.api<EDITOR_API_VERSION){Toast.show(I18N.t('scene.oldServer'),true);return;}
        const scene=ScenePanel.active, player=this.copy(), snapshot=JSON.stringify(player);
        const objects=JSON.parse(ObjectsPanel.saved), terrainEnabled=ScenePanel.savedTerrain, lighting=JSON.parse(LightingPanel.saved);
        ScenePanel.saving=true;ScenePanel.render();this.refresh();
        try {
            const result=await ObjectsPanel.post('/api/scene/save',{id:scene.id,revision:ScenePanel.revision,objects,terrainEnabled,lighting,player});
            if(!result.ok)throw new Error(result.code==='scene_conflict'?I18N.t('scene.conflict'):(result.error || result.code));
            ScenePanel.revision=result.revision;scene.player=player;this.saved=snapshot;
            Toast.show(this.tr('Player settings saved','Настройки игрока сохранены'));
        } catch(e){Toast.show(this.tr('Could not save player: ','Не удалось сохранить игрока: ')+e.message,true);}
        finally {ScenePanel.saving=false;ScenePanel.render();this.refresh();}
    },
    render() {
        const host=document.getElementById('player-panel');if(!host || !this.data)return;host.replaceChildren();
        if(!ScenePanel.active || ScenePanel.active.mode!=='mining') {
            const hint=document.createElement('p');hint.textContent=this.tr('This scene has no playable character. Player settings are available in mining scenes.','В этой сцене нет игрового персонажа. Настройки игрока доступны в сценах добычи.');host.append(hint);return;
        }
        const actions=document.createElement('div');actions.className='player-actions';
        const save=document.createElement('button');save.id='player-save';save.textContent=this.tr('Save player','Сохранить игрока');save.addEventListener('click',()=>this.save());
        const revert=document.createElement('button');revert.id='player-revert';revert.textContent=this.tr('Revert','Отменить');revert.addEventListener('click',()=>this.revert());actions.append(save,revert);host.append(actions);
        const note=document.createElement('p');note.textContent=this.tr('Settings apply to this scene. The capsule is an editor marker; it does not change collision.','Настройки действуют в этой сцене. Капсула — маркер редактора и не меняет столкновения.');host.append(note);
        const bounds=document.createElement('p');bounds.textContent=this.tr('Movement in the mining prototype is limited to the existing chamber; place the spawn inside it.','Движение в прототипе добычи ограничено существующей комнатой; размещайте точку появления внутри неё.');host.append(bounds);
        const section=(en,ru)=>{const e=document.createElement('div');e.className='props-section';e.textContent=this.tr(en,ru);host.append(e);};
        const number=(key,en,ru,min,max,step,digits=2)=>{
            const label=document.createElement('label');label.className='field';label.textContent=this.tr(en,ru);
            const input=document.createElement('input');input.type='number';Object.assign(input,{value:String(this.data[key]),min:String(min),max:String(max),step:String(step)});
            input.addEventListener('input',()=>{const n=Number(input.value);if(input.value===''||!Number.isFinite(n))return;const k=10**digits;this.data[key]=Math.round(Math.max(min,Math.min(max,n))*k)/k;this.changed();});
            input.addEventListener('blur',()=>{input.value=String(this.data[key]);});label.append(input);host.append(label);
        };
        section('Starting position','Начальная позиция');
        number('spawnX','X','X',-100000,100000,10,1);number('spawnZ','Map Y','Y на карте',-100000,100000,10,1);
        number('spawnY','Height','Высота',-100000,100000,10,1);
        number('startYaw','Starting yaw (°)','Начальный поворот (°)',-360,360,5,1);
        number('startPitch','Starting pitch (°)','Начальный наклон (°)',-80,80,5,1);
        section('Camera and movement','Камера и движение');
        number('eyeHeight','Eye height','Высота глаз',1,1000,5,1);number('fov','Field of view (°)','Поле зрения (°)',10,120,1,1);
        number('moveSpeed','Movement speed','Скорость движения',1,5000,10,1);number('mouseSensitivity','Mouse sensitivity','Чувствительность мыши',.00001,.05,.0001,5);
        section('Editor capsule','Капсула в редакторе');
        number('bodyHeight','Marker height','Высота маркера',40,400,5,1);number('bodyDiameter','Marker diameter','Диаметр маркера',10,200,5,1);
        section('Player light','Свет игрока');
        const light=document.createElement('label'), check=document.createElement('input');check.type='checkbox';check.checked=this.data.lightEnabled;
        check.addEventListener('change',()=>{this.data.lightEnabled=check.checked;this.changed();});light.append(check,document.createTextNode(' '+this.tr('Enabled','Включён')));host.append(light);
        const color=document.createElement('label');color.className='field';color.textContent=this.tr('Color','Цвет');const colorInput=document.createElement('input');colorInput.type='color';colorInput.value=this.data.lightColor;
        colorInput.addEventListener('input',()=>{this.data.lightColor=colorInput.value;this.changed();});color.append(colorInput);host.append(color);
        number('lightHeight','Height above feet','Высота от ног',0,1000,5,1);number('lightIntensity','Intensity','Яркость',0,10,.05,2);number('lightRange','Range','Радиус',1,20000,10,1);
        const shadow=document.createElement('p');shadow.textContent=this.tr('Contact shadow: Global Settings → Sun and light → tag player.','Контактная тень: Global Settings → Солнце и свет → тег player.');host.append(shadow);
        this.refresh();
    }
};
