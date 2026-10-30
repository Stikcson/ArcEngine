// @ts-nocheck
// Project-wide shadow profile and optional overrides by tag.
const ContactShadowPanel = {
    saved: '', revision: '', saving: false,
    tr(en, ru) { return I18N.lang === 'ru' ? ru : en; },
    async load() {
        const response=await fetch('/api/contact-shadows',{cache:'no-store'}), data=await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || 'Contact shadow settings could not be loaded');
        globalThis.CONTACT_SHADOW_CONFIG=data.config;this.saved=JSON.stringify(data.config);this.revision=data.revision;
    },
    init() { window.addEventListener('lang-changed',()=>this.render());this.render(); },
    isDirty() { return !!this.saved && JSON.stringify(globalThis.CONTACT_SHADOW_CONFIG)!==this.saved; },
    changed() { Inspector.refreshSaveButton(); },
    revert() { globalThis.CONTACT_SHADOW_CONFIG=JSON.parse(this.saved);this.changed();this.render(); },
    async save() {
        if (!this.isDirty() || this.saving) return;
        const snapshot=JSON.stringify(globalThis.CONTACT_SHADOW_CONFIG);this.saving=true;
        try {
            const response=await fetch('/api/contact-shadows',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:this.revision,config:JSON.parse(snapshot)})});
            const data=await response.json();if(!response.ok || !data.ok)throw new Error(data.error || 'Save failed');
            this.saved=JSON.stringify(data.config);this.revision=data.revision;
            this.changed();Toast.show(this.tr('Contact shadows saved for all scenes','Контактные тени сохранены для всех сцен'));
        } catch(e) {Toast.show(this.tr('Contact shadow save failed: ','Не удалось сохранить тени: ')+e.message,true);}
        finally {this.saving=false;}
    },
    render() {
        const host=document.getElementById('contact-shadow-panel');if(!host || !this.saved)return;
        host.replaceChildren();const cfg=globalThis.CONTACT_SHADOW_CONFIG;
        const title=document.createElement('div');title.className='props-section';title.textContent=this.tr('Contact shadows — all scenes','Контактные тени — все сцены');host.append(title);
        const master=document.createElement('label'), on=document.createElement('input');on.type='checkbox';on.checked=cfg.enabled;
        on.addEventListener('change',()=>{cfg.enabled=on.checked;this.changed();});master.append(on,document.createTextNode(' '+this.tr('Enable contact shadows','Включить контактные тени')));host.append(master);
        const hint=document.createElement('p');hint.textContent=this.tr('Defaults apply to all objects. A tag can have its own profile; an explicit object override has priority.','Общие настройки действуют на все объекты. Для тега можно задать свои; индивидуальная настройка объекта имеет приоритет.');host.append(hint);
        this.profile(host,cfg.defaults,this.tr('Default profile','Общие настройки'),false);
        const addRow=document.createElement('div');addRow.className='contact-tag-add';
        const select=document.createElement('select'), input=document.createElement('input');input.type='text';input.maxLength=64;
        input.placeholder=this.tr('or enter a tag','или введите тег');
        const tags=new Set(['player','enemy','ore',...(Lab.location ? Lab.location.objects.map(x=>x.def.tag).filter(Boolean) : [])]);
        for(const tag of tags) {const opt=document.createElement('option');opt.value=tag;opt.textContent=tag;select.append(opt);}
        const add=document.createElement('button');add.textContent=this.tr('+ Tag override','+ Настройка тега');
        add.addEventListener('click',()=>{
            const tag=(input.value.trim() || select.value).slice(0,64);
            if(!tag || /[\x00-\x1f]/.test(tag) || cfg.tags.some(t=>t.tag.toLowerCase()===tag.toLowerCase())) {Toast.show(this.tr('Tag is empty or already has an override','Тег пустой или уже настроен'),true);return;}
            const defaults=cfg.defaults;cfg.tags.push({tag,enabled:true,sizeX:defaults.sizeX,opacity:defaults.opacity,curve:defaults.curve.slice()});this.changed();this.render();
        });
        addRow.append(select,input,add);host.append(addRow);
        cfg.tags.forEach((item,index)=>{
            const row=document.createElement('div');row.className='props-section';row.textContent=this.tr('Tag: ','Тег: ')+item.tag+' ';
            const remove=document.createElement('button');remove.textContent=this.tr('Use default','Общие настройки');
            remove.addEventListener('click',()=>{cfg.tags.splice(index,1);this.changed();this.render();});row.append(remove);host.append(row);
            this.profile(host,item,'',true);
        });
        const save=document.createElement('button');save.textContent=this.tr('Save contact shadows','Сохранить контактные тени');save.addEventListener('click',()=>this.save());host.append(save);
    },
    profile(host, profile, title, hasEnabled) {
        if(title){const head=document.createElement('div');head.className='props-section';head.textContent=title;host.append(head);}
        if(hasEnabled){const label=document.createElement('label'), checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=profile.enabled;
            checkbox.addEventListener('change',()=>{profile.enabled=checkbox.checked;this.changed();});label.append(checkbox,document.createTextNode(' '+this.tr('Enabled for tag','Включено для тега')));host.append(label);}
        for(const [key,label,min,max,step] of [['sizeX',this.tr('Diameter','Диаметр'),1,10000,10],['opacity',this.tr('Opacity','Непрозрачность'),0,1,.05]]) {
            const row=document.createElement('label');row.className='field';row.textContent=label;const input=document.createElement('input');input.type='number';
            Object.assign(input,{value:String(profile[key]),min:String(min),max:String(max),step:String(step)});
            input.addEventListener('input',()=>{const n=Number(input.value);if(input.value!=='' && Number.isFinite(n)){profile[key]=Math.round(Math.max(min,Math.min(max,n))*100)/100;this.changed();}});
            input.addEventListener('blur',()=>{input.value=String(profile[key]);});row.append(input);host.append(row);
        }
        const label=document.createElement('div');label.textContent=this.tr('Opacity curve: center → edge','Кривая прозрачности: центр → край');host.append(label);
        const box=document.createElement('div');box.className='blob-curve';const ns='http://www.w3.org/2000/svg', svg=document.createElementNS(ns,'svg');
        svg.setAttribute('viewBox','0 0 240 110');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('aria-hidden','true');
        const line=document.createElementNS(ns,'polyline');svg.append(line);
        const dots=Array.from({length:5},()=>{const c=document.createElementNS(ns,'circle');c.setAttribute('r','5');svg.append(c);return c;});
        const sliders=document.createElement('div');sliders.className='blob-sliders';
        const inputs=Array.from({length:5},(_,i)=>{const input=document.createElement('input');input.type='range';input.min='0';input.max='1';input.step='0.01';input.disabled=i===0||i===4;
            input.setAttribute('aria-label',this.tr('Curve point ','Точка кривой ')+(i+1));input.addEventListener('input',()=>setPoint(i,Number(input.value)));sliders.append(input);return input;});
        const draw=()=>{const points=profile.curve.map((v,i)=>[10+i*55,100-v*90]);line.setAttribute('points',points.map(p=>p.join(',')).join(' '));
            dots.forEach((dot,i)=>{dot.setAttribute('cx',String(points[i][0]));dot.setAttribute('cy',String(points[i][1]));inputs[i].value=String(profile.curve[i]);});};
        const setPoint=(i,v)=>{profile.curve[i]=Math.round(Math.max(0,Math.min(1,v))*100)/100;this.changed();draw();};
        let active=-1;const move=e=>{if(active<0)return;const r=svg.getBoundingClientRect();setPoint(active,(100-(e.clientY-r.top)*110/r.height)/90);};
        svg.addEventListener('pointerdown',e=>{const r=svg.getBoundingClientRect();active=Math.max(1,Math.min(3,Math.round(((e.clientX-r.left)*240/r.width-10)/55)));svg.setPointerCapture(e.pointerId);move(e);e.preventDefault();});
        svg.addEventListener('pointermove',move);svg.addEventListener('pointerup',()=>{active=-1;});svg.addEventListener('pointercancel',()=>{active=-1;});
        box.append(svg,sliders);host.append(box);draw();
    }
};
