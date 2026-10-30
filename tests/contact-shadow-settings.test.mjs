import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {loadScripts} from './browser-scripts.mjs';
import {readContactShadows,saveContactShadows} from '../_utils/editor/contact-shadows.mjs';

test('global profile, tag and object priority, master switch and legacy scenes',()=>{
  const page=loadScripts(['js/ContactShadowConfig.js','js/Location3D.js']);
  const Location=page.get('Location3D'), config=page.ctx.CONTACT_SHADOW_CONFIG;
  config.defaults.sizeX=220;config.defaults.opacity=.6;
  config.tags.push({tag:'ore',enabled:true,sizeX:110,opacity:.7,curve:[1,.9,.7,.4,0]});
  config.tags.push({tag:'wall',enabled:true,sizeX:200,opacity:.5,curve:[1,.8,.4,.1,0]});
  assert.equal(Location.blobSettings({tag:'enemy'}).sizeX,220);
  assert.equal(Location.blobSettings({tag:'player'}).opacity,.6);
  assert.equal(Location.blobSettings({tag:'Ore'}).sizeX,110);
  assert.equal(Location.blobSettings({tag:'wall'}).enabled,true);
  const object={tag:'ore',blobShadow:{enabled:true,sizeX:45,sizeZ:200,opacity:.3,curve:[1,.8,.5,.1,0]}};
  assert.equal(Location.blobSettings(object).sizeX,45);assert.equal(Location.blobSettings(object).sizeZ,45);
  config.enabled=false;assert.equal(Location.blobSettings(object).enabled,false);assert.equal(Location.blobSettings({tag:'player'}).enabled,false);
  assert.equal(Location.blobSettings(object,null,true).enabled,true);
});

test('project-wide shadow settings persist safely and reject concurrent or invalid writes',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'arc-contact-'));
  try {
    await fs.mkdir(path.join(root,'js'));
    await fs.copyFile(new URL('../js/ContactShadowConfig.js',import.meta.url),path.join(root,'js','ContactShadowConfig.js'));
    const original=await readContactShadows(root);assert.equal(original.ok,true);
    const config=structuredClone(original.config);
    config.defaults.sizeX=180;config.tags.push({tag:'ore',enabled:false,sizeX:90,opacity:.5,curve:[1,.7,.4,.1,0]});
    const saved=await saveContactShadows(root,original.revision,config);assert.equal(saved.ok,true);
    assert.deepEqual((await readContactShadows(root)).config,config);
    const stale=await saveContactShadows(root,original.revision,original.config);assert.equal(stale.code,'contact_shadow_conflict');
    for(const bad of [{...config,defaults:{...config.defaults,curve:[0,.8,.4,.1,0]}}, {...config,tags:[...config.tags,{...config.tags[0],tag:'ORE'}]}, {...config,enabled:'yes'}])
      assert.equal((await saveContactShadows(root,saved.revision,bad)).ok,false);
    assert.deepEqual((await readContactShadows(root)).config,config);
    const concurrent=await Promise.all([saveContactShadows(root,saved.revision,{...config,defaults:{...config.defaults,sizeX:200}}),saveContactShadows(root,saved.revision,{...config,enabled:false})]);
    assert.equal(concurrent.filter(x=>x.ok).length,1);assert.equal(concurrent.filter(x=>x.code==='contact_shadow_conflict').length,1);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('global profile stays live after saving and later edits remain dirty',async()=>{
  let sent,complete;
  const config={enabled:true,defaults:{sizeX:150,opacity:1,curve:[1,.86,.48,.12,0]},tags:[]};
  const page=loadScripts(['_utils/editor/contact-shadow-panel.js'],{CONTACT_SHADOW_CONFIG:config,
    Inspector:{refreshSaveButton(){}},I18N:{lang:'en'},Toast:{show(){}},
    fetch:async(_,request)=>{sent=JSON.parse(request.body);return new Promise(resolve=>{complete=resolve;});}});
  const panel=page.get('ContactShadowPanel');panel.saved=JSON.stringify(config);panel.revision='old';
  config.defaults.sizeX=180;const pending=panel.save();config.defaults.sizeX=200;
  complete({ok:true,json:async()=>({ok:true,config:sent.config,revision:'new'})});await pending;
  assert.equal(panel.revision,'new');assert.equal(panel.isDirty(),true);assert.equal(page.ctx.CONTACT_SHADOW_CONFIG.defaults.sizeX,200);
});

test('saving scene lighting preserves unsaved object edits and keeps newer lighting edits dirty',async()=>{
  let sent,complete;
  const scene={id:'mining',lighting:{sun:true,sky:true,points:[]}};
  const scenePanel={active:scene,revision:'old',savedTerrain:false,busy:false,saving:false,render(){}};
  const objects={saved:JSON.stringify([{name:'saved object'}]),renderHeader(){},post:async(_,body)=>{sent=body;return new Promise(resolve=>{complete=resolve;});}};
  const page=loadScripts(['_utils/editor/lighting-panel.js'],{ScenePanel:scenePanel,ObjectsPanel:objects,
    Inspector:{saveAvailable:true,server:{api:26},refreshSaveButton(){}},EDITOR_API_VERSION:26,I18N:{lang:'en',t:x=>x},Toast:{show(){}}});
  const panel=page.get('LightingPanel');panel.load(scene.lighting);panel.data.sun=false;
  const pending=panel.save();panel.data.sky=false;complete({ok:true,revision:'new'});await pending;
  assert.equal(JSON.stringify(sent.objects),JSON.stringify([{name:'saved object'}]));assert.equal(sent.lighting.sun,false);assert.equal(sent.lighting.sky,true);
  assert.equal(scenePanel.revision,'new');assert.equal(panel.isDirty(),true);assert.equal(panel.data.sky,false);
});
