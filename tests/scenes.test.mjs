import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {test} from 'node:test';
import {createScene,importLegacyScene,listScenes,readScene,saveScene} from '../_utils/editor/scenes.mjs';
import {formatObjects} from '../_utils/editor/save.mjs';
import {collectRefs} from '../tools/asset-scan.mjs';
import {loadScripts} from './browser-scripts.mjs';

const object={name:'ore',model:'assets/models/mining-ore.glb',kind:'prop',x:1,y:2,h:0,rot:[0,0,0],scale:[.5,.5,.5],tag:'ore',
  materials:[{slot:0,color:'#c9c6dd',texture:'assets/Textures/kenney_prototype-textures/PNG/Dark/texture_08.png'}]};
function temp(){return fs.mkdtempSync(path.join(os.tmpdir(),'arc-scenes-'));}

test('contact shadow settings survive scene saves and invalid curves are rejected',async()=>{
  const root=temp();try {
    const blobShadow={enabled:true,sizeX:175,sizeZ:95,opacity:0.45,curve:[1,0.8,0.5,0.1,0]};
    const created=await createScene(root,'Shadow test',[{...object,blobShadow}]);
    assert.equal(created.ok,true);assert.deepEqual(created.scene.objects[0].blobShadow,blobShadow);
    const changed={...blobShadow,enabled:false,curve:[0.9,0.7,0.4,0.2,0]};
    const saved=await saveScene(root,created.scene.id,created.revision,[{...object,blobShadow:changed}]);
    assert.equal(saved.ok,true);assert.deepEqual((await readScene(root,created.scene.id)).scene.objects[0].blobShadow,changed);
    for(const bad of [{...changed,curve:[1,0]},{...changed,curve:[1,1,1,1,2]},{...changed,sizeX:0},{...changed,opacity:NaN},{...changed,enabled:'yes'}])
      assert.equal((await saveScene(root,created.scene.id,saved.revision,[{...object,blobShadow:bad}])).ok,false);
    assert.deepEqual((await readScene(root,created.scene.id)).scene.objects[0].blobShadow,changed);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('default scene documents remain valid',()=>{
  const mining=JSON.parse(fs.readFileSync(new URL('../scenes/mining.json',import.meta.url),'utf8'));
  const main=JSON.parse(fs.readFileSync(new URL('../scenes/main.json',import.meta.url),'utf8'));
  assert.ok(Array.isArray(mining.objects));assert.equal(mining.mode,'mining');
  assert.equal(main.mode,'assembly');assert.ok(Array.isArray(main.objects));
});

test('create, clone, isolate and save scenes with conflicts safely rejected',async()=>{
  const root=temp();
  try {
    const mining=await createScene(root,'Mining Test',[object],'mining'), main=await createScene(root,'Main Scene');
    assert.equal(mining.ok,true);assert.equal(main.ok,true);assert.equal(main.scene.mode,'assembly');
    const changed=[{...object,x:42}];
    const saved=await saveScene(root,mining.scene.id,mining.revision,changed);assert.equal(saved.ok,true);
    assert.equal((await readScene(root,mining.scene.id)).scene.objects[0].x,42);
    assert.deepEqual((await readScene(root,main.scene.id)).scene.objects,[]);
    const stale=await saveScene(root,mining.scene.id,mining.revision,[object]);assert.equal(stale.code,'scene_conflict');
    assert.equal((await readScene(root,mining.scene.id)).scene.objects[0].x,42);
    assert.equal((await readScene(root,'../evil')).ok,false);
    assert.equal((await createScene(root,'Bad',[{...object,model:'assets/../evil.glb'}],'mining')).ok,false);
    const clone=await createScene(root,'Copy',changed,'mining');assert.equal(clone.scene.mode,'mining');
    assert.equal(clone.scene.objects[0].materials[0].texture,object.materials[0].texture);
    assert.equal((await listScenes(root)).scenes.length,3);
    const same=(await readScene(root,main.scene.id)).revision;
    const concurrent=await Promise.all([saveScene(root,main.scene.id,same,[object]),saveScene(root,main.scene.id,same,changed)]);
    assert.equal(concurrent.filter(x=>x.ok).length,1);assert.equal(concurrent.filter(x=>x.code==='scene_conflict').length,1);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('terrain setting is saved independently, cloned, and rejects invalid values',async()=>{
  const root=temp();try {
    const main=await createScene(root,'Main');
    const mining=await createScene(root,'Mining',[],'mining');
    assert.equal(main.scene.terrainEnabled,true);assert.equal(mining.scene.terrainEnabled,false);
    const saved=await saveScene(root,main.scene.id,main.revision,[],false);
    assert.equal(saved.ok,true);assert.equal((await readScene(root,main.scene.id)).scene.terrainEnabled,false);
    assert.equal((await readScene(root,mining.scene.id)).scene.terrainEnabled,false);
    const clone=await createScene(root,'Copy',[],'assembly',false);assert.equal(clone.scene.terrainEnabled,false);
    assert.equal((await saveScene(root,main.scene.id,saved.revision,[],'no')).ok,false);
    assert.equal((await readScene(root,main.scene.id)).scene.terrainEnabled,false);
    assert.equal((await saveScene(root,mining.scene.id,mining.revision,[],true)).ok,true);
    assert.equal((await readScene(root,mining.scene.id)).scene.terrainEnabled,true);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('terrain visibility and ground height are updated when toggled or rebuilt',()=>{
  let lastMesh;
  class Terrain {constructor(){lastMesh={enabled:true,setEnabled(v){this.enabled=v;}};this.meshes=[lastMesh];} heightAt(){return 25;} dispose(){} }
  const page=loadScripts(['js/Location3D.js'],{Terrain3D:Terrain,World3D:{createView:()=>({scene:{executeWhenReady:f=>f()}})}});
  const Location=page.get('Location3D');Location.prototype.loadGround=()=>Promise.resolve();
  const loc=new Location({objects:[],terrainEnabled:false});assert.equal(lastMesh.enabled,false);
  const pos={set(x,y,z){this.y=y;}}, rec={def:{x:0,y:0,h:3,rot:[0,0,0],scale:[1,1,1]},mesh:{position:pos,rotation:{set(){}},scaling:{set(){}}}};
  loc.objects.push(rec);loc.placeObject(rec);assert.equal(pos.y,3);
  loc.setTerrainEnabled(true);assert.equal(lastMesh.enabled,true);assert.equal(pos.y,28);
  loc.setTerrainEnabled(false);loc.buildTerrain();assert.equal(lastMesh.enabled,false);assert.equal(pos.y,3);
});

test('assets referenced only by a scene are included by the build scanner',async()=>{
  const root=temp();try {
    fs.mkdirSync(path.join(root,'scenes'),{recursive:true});fs.mkdirSync(path.join(root,'assets','models'),{recursive:true});
    fs.writeFileSync(path.join(root,'scenes','main.json'),JSON.stringify({objects:[{model:'assets/models/scene-only.glb'}]}));
    fs.writeFileSync(path.join(root,'assets','models','scene-only.glb'),'');
    const scan=await collectRefs(root);assert.ok(scan.refs.includes('assets/models/scene-only.glb'));assert.deepEqual(scan.missing,[]);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('legacy layout can be recovered into a separate scene without altering the source',async()=>{
  const root=temp();try {
    fs.mkdirSync(path.join(root,'js'),{recursive:true});
    const file=path.join(root,'js','Objects.js'), original=formatObjects([object]).src;fs.writeFileSync(file,original);
    const imported=await importLegacyScene(root,'Recovered mining');assert.equal(imported.ok,true);
    assert.equal(imported.scene.mode,'mining');assert.equal(imported.scene.objects[0].materials[0].texture,object.materials[0].texture);
    assert.equal(fs.readFileSync(file,'utf8'),original);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('game defaults to Main Scene and loads an explicitly selected scene',async()=>{
  const calls=[], scene={version:1,id:'mining',mode:'mining',objects:[object]};
  const page=loadScripts(['js/SceneData.js'],{URLSearchParams,location:{search:''},fetch:async url=>{calls.push(url);return {ok:true,json:async()=>scene};}});
  const data=page.get('SceneData');assert.equal(data.selected(),'main');
  page.ctx.location.search='?scene=mining';assert.equal(data.selected(),'mining');
  assert.equal((await data.load('mining')).id,'mining');assert.equal(calls[0],'scenes/mining.json');
  await assert.rejects(()=>data.load('../evil'));
});

test('game boots the requested scene with its own objects and gameplay mode',async()=>{
  for(const mode of ['assembly','mining']) {
    const calls={objects:null,game:0,attached:0,terrainEnabled:null,layout:null,loop:null};
    const canvas={},doc={querySelector:()=>null,getElementById:id=>id==='world3d'?canvas:null};
    class Location { constructor(options){calls.objects=options.objects;calls.terrainEnabled=options.terrainEnabled;this.objects=options.objects;this.width=2048;this.height=2048;this.terrain={};this.view={};this.ready=Promise.resolve();} update(){} }
    class Camera { constructor(){} attach(){calls.attached++;} update(){} }
    class Mining {constructor(){calls.game++;} update(){} }
    const page=loadScripts(['js/main.js'],{document:doc,SimplexNoise:{},SceneData:{selected:()=>mode,load:async()=>({mode,objects:[object]})},
      World3D:{init:()=>true,engine:{runRenderLoop:fn=>{calls.loop=fn;}},renderFrame(){},resize(){}},
      Location3D:Location,SceneLighting:{apply(){}},Surveillance:{update(){}},CameraController:Camera,Game:Mining,UI:{init:(_,layout)=>{calls.layout=layout;}},Sound3D:{update(){}},
      performance,setTimeout:()=>{},addEventListener:()=>{}});
    await page.get('startGame')();calls.loop();
    assert.equal(calls.objects.length,1);
    if(mode==='assembly') {assert.equal(calls.game,0);assert.equal(calls.attached,1);assert.equal(calls.terrainEnabled,true);assert.equal(calls.layout.length,0);}
    else {assert.equal(calls.game,1);assert.equal(calls.attached,0);assert.equal(calls.terrainEnabled,false);assert.equal(calls.layout,undefined);}
  }
});

test('editor refuses to switch or preview while there are unsaved changes',async()=>{
  let warned=0, switched=false;
  const page=loadScripts(['_utils/editor/scene-panel.js'],{
    ObjectsPanel:{isDirty:()=>true},Inspector:{dirtyList:()=>[]},UIPanel:{isDirty:()=>false},
    Toast:{show:()=>warned++},I18N:{t:x=>x},localStorage:{},URL
  });
  const panel=page.get('ScenePanel');panel.active={id:'main',name:'Main',mode:'assembly',objects:[]};
  panel.render=()=>{};panel.request=async()=>{switched=true;};
  await panel.switchTo('mining');panel.play();
  assert.equal(switched,false);assert.equal(warned,2);assert.equal(panel.active.id,'main');
});

test('scene switching does not discard edits made while the next scene is loading',async()=>{
  let dirty=false, release, switched=false, warned=0;
  const page=loadScripts(['_utils/editor/scene-panel.js'],{
    ObjectsPanel:{isDirty:()=>dirty},Inspector:{dirtyList:()=>[]},ContactShadowPanel:{isDirty:()=>false},PlayerPanel:{isDirty:()=>false},UIPanel:{isDirty:()=>false},
    Toast:{show:()=>warned++},I18N:{t:x=>x}
  });
  const panel=page.get('ScenePanel');panel.active={id:'main',name:'Main',mode:'assembly',objects:[]};
  panel.render=()=>{};panel.applyScene=()=>{switched=true;};
  panel.request=()=>new Promise(resolve=>{release=resolve;});
  const pending=panel.switchTo('mining');dirty=true;release({scene:{id:'mining'},revision:'x'});await pending;
  assert.equal(switched,false);assert.equal(warned,1);assert.equal(panel.active.id,'main');
});

test('saving a scene keeps later edits dirty and records the new revision',async()=>{
  let resolveSave;const objects=[{...object}], panelState={active:{id:'mining'},revision:'before',saving:false,busy:false,render(){}};
  const page=loadScripts(['_utils/editor/objects-panel.js'],{ScenePanel:panelState,Inspector:{saveAvailable:true,server:{api:22},errorText:x=>x.error,refreshSaveButton(){}},
    EDITOR_API_VERSION:22,LightingPanel:{copy:()=>({sun:true,sky:true,points:[]})},Toast:{show(){}},I18N:{t:x=>x}});
  const panel=page.get('ObjectsPanel'), subject={saved:'[]',isDirty:()=>true,defs:()=>objects,renderHeader(){},
    post:()=>new Promise(resolve=>{resolveSave=resolve;})};
  const pending=panel.save.call(subject);objects[0].x=999;resolveSave({ok:true,revision:'after',count:1});await pending;
  assert.equal(JSON.parse(subject.saved)[0].x,1);assert.equal(objects[0].x,999);assert.equal(panelState.revision,'after');assert.equal(panelState.saving,false);
});
