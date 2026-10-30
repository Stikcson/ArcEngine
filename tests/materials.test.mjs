import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { formatObjects, isImagePath, saveObjects } from '../_utils/editor/save.mjs';
import { collectRefs } from '../tools/asset-scan.mjs';
import os from 'node:os';
import path from 'node:path';
import { loadScripts } from './browser-scripts.mjs';

test('object material overrides round-trip and unsafe or invalid values are rejected', () => {
  const def={name:'ore',model:'assets/models/mining-ore.glb',kind:'prop',x:1,y:2,h:0,rot:[0,0,0],scale:[1,1,1],
    materials:[{slot:0,color:'#3366FF',texture:'assets/Textures/kenney_prototype-textures/PNG/Dark/texture_07.png',uScale:2,vScale:3,alpha:.5},{slot:1,texture:''}]};
  const result=formatObjects([def]);assert.equal(result.ok,true);
  const decoded=vm.runInNewContext(result.src+';LOCATION_OBJECTS')[0];
  assert.equal(decoded.materials[0].color,'#3366ff');assert.equal(decoded.materials[0].texture,def.materials[0].texture);
  assert.equal(decoded.materials[0].uScale,2);assert.equal(decoded.materials[1].texture,'');
  assert.equal(isImagePath('assets/Textures/a.png'),true);assert.equal(isImagePath('assets/../secret.png'),false);
  for(const bad of [
    [{slot:0,texture:'assets/../secret.png'}],[{slot:0,color:'#zzzzzz'}],
    [{slot:0,alpha:2}],[{slot:0,uScale:0}],[{slot:0,uScale:.0001}],[{slot:0,color:'#ffffff'},{slot:0,color:'#000000'}]
  ]) assert.equal(formatObjects([{...def,materials:bad}]).ok,false);
});

test('saved texture references are discovered for builds',async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arc-material-'));
  try {
    fs.mkdirSync(path.join(root,'js'),{recursive:true});fs.mkdirSync(path.join(root,'assets','art'),{recursive:true});
    const def={name:'object',model:'assets/art/model.glb',kind:'prop',x:0,y:0,h:0,rot:[0,0,0],scale:[1,1,1],materials:[{slot:0,texture:'assets/art/color.png'}]};
    fs.writeFileSync(path.join(root,'js','Objects.js'),formatObjects([def]).src);
    fs.writeFileSync(path.join(root,'assets','art','model.glb'),'');fs.writeFileSync(path.join(root,'assets','art','color.png'),'');
    const assets=await collectRefs(root);assert.ok(assets.refs.includes('assets/art/color.png'));assert.equal(assets.missing.length,0);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('saving and reloading object materials keeps source texture and values',async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arc-material-save-'));
  try {
    fs.mkdirSync(path.join(root,'js'),{recursive:true});
    const file=path.join(root,'js','Objects.js');fs.writeFileSync(file,'const LOCATION_OBJECTS = [];\n');
    const def={name:'ore',model:'assets/models/mining-ore.glb',kind:'prop',x:0,y:0,h:0,rot:[0,0,0],scale:[1,1,1],
      materials:[{slot:0,texture:'assets/mining-textures/texture_07.png',color:'#00aaff',uScale:2,alpha:.7}]};
    const saved=await saveObjects(root,[def]);assert.equal(saved.ok,true);assert.ok(saved.backup);
    const data=vm.runInNewContext(fs.readFileSync(file,'utf8')+';LOCATION_OBJECTS');
    assert.equal(data[0].materials[0].texture,def.materials[0].texture);assert.equal(data[0].materials[0].color,'#00aaff');
    assert.equal(data[0].materials[0].uScale,2);assert.equal(data[0].materials[0].alpha,.7);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('an older editor server cannot silently discard material overrides',async () => {
  let called=false, message='';
  const page=loadScripts(['_utils/editor/objects-panel.js'],{
    Inspector:{saveAvailable:true,server:{api:20}},EDITOR_API_VERSION:21,
    Toast:{show:s=>{message=s;}},I18N:{t:s=>s}
  });
  const panel=page.get('ObjectsPanel'), subject={isDirty:()=>true,defs:()=>[{materials:[{slot:0,color:'#ff0000'}]}],post:()=>{called=true;}};
  await panel.save.call(subject);assert.equal(called,false);assert.equal(message,'scene.oldServer');
});

const context={console,TextDecoder,TextEncoder,Uint8Array,ArrayBuffer,DataView,Blob,URL,setTimeout,clearTimeout,performance};
context.globalThis=context;context.window=context;context.addEventListener=()=>{};context.removeEventListener=()=>{};
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../libs/babylon.js',import.meta.url),'utf8'),context);
vm.runInContext(fs.readFileSync(new URL('../libs/babylonjs.loaders.min.js',import.meta.url),'utf8'),context);
const BABYLON=context.BABYLON;

test('multi-material meshes expose each distinct material once',() => {
  const engine=new BABYLON.NullEngine(),scene=new BABYLON.Scene(engine);
  const page=loadScripts(['js/Constants.js','js/Location3D.js'],{BABYLON});
  const loc=Object.create(page.get('Location3D').prototype);loc.opts={};loc.view={scene};
  const root=new BABYLON.Mesh('root',scene), a=new BABYLON.StandardMaterial('a',scene), b=new BABYLON.StandardMaterial('b',scene);
  const multi=new BABYLON.MultiMaterial('multi',scene);multi.subMaterials=[a,b];
  const m1=BABYLON.MeshBuilder.CreateBox('one',{},scene),m2=BABYLON.MeshBuilder.CreateBox('two',{},scene);
  m1.parent=root;m1.material=multi;m2.parent=root;m2.material=a;
  const rec={mesh:root,def:{materials:[{slot:1,color:'#ff0000'}]}};
  const slots=loc.materialSlots(rec);assert.equal(slots.length,2);loc.applyMaterials(rec);
  assert.equal(b.diffuseColor.toHexString(),'#FF0000');assert.notEqual(a.diffuseColor.toHexString(),'#FF0000');
  engine.dispose();
});

test('real GLB material overrides remain local to the object and reset to original',async () => {
  const engine=new BABYLON.NullEngine(), scene=new BABYLON.Scene(engine);scene.useRightHandedSystem=true;
  const bytes=new Uint8Array(fs.readFileSync(new URL('../assets/models/mining-ore.glb',import.meta.url)));
  const container=await BABYLON.SceneLoader.LoadAssetContainerAsync('',bytes,scene,null,'.glb');
  const page=loadScripts(['js/Constants.js','js/Gltf3D.js','js/Location3D.js'],{BABYLON});
  const Gltf3D=page.get('Gltf3D'), Location3D=page.get('Location3D');
  const loc=Object.create(Location3D.prototype);loc.opts={assetBase:'/'};loc.view={scene};
  const first={mesh:Gltf3D.build({container,clips:[]},scene,{name:'first'}),def:{materials:[]}};
  const second={mesh:Gltf3D.build({container,clips:[]},scene,{name:'second'}),def:{materials:[]}};
  const slots=loc.materialSlots(first), other=loc.materialSlots(second);
  assert.equal(slots.length,2);assert.notEqual(slots[0].material,other[0].material);
  const base=slots[0].originalColor.toHexString(), original=slots[0].originalTexture;
  first.def.materials=[{slot:0,color:'#e04020',alpha:.5,texture:''}];loc.applyMaterials(first);
  assert.equal(slots[0].material.diffuseColor.toHexString(),'#E04020');
  assert.equal(slots[0].material.alpha,.5);assert.equal(slots[0].material.diffuseTexture,null);
  assert.equal(other[0].material.diffuseColor.toHexString(),base);
  first.def.materials=[{slot:0,uScale:2,vScale:3}];loc.applyMaterials(first);
  assert.notEqual(slots[0].material.diffuseTexture,original);
  assert.equal(slots[0].material.diffuseTexture.uScale,2);assert.equal(slots[0].material.diffuseTexture.vScale,3);
  assert.equal(original.uScale,1,'original texture is not changed');
  first.def.materials=[{slot:0,texture:'assets/mining-textures/texture_07.png',uScale:4}];loc.applyMaterials(first);
  assert.equal(slots[0].material.diffuseTexture.url,'/assets/mining-textures/texture_07.png');
  assert.equal(slots[0].material.diffuseTexture.uScale,4);
  first.def.materials=[];loc.applyMaterials(first);
  assert.equal(slots[0].material.diffuseTexture,original);assert.equal(slots[0].material.diffuseColor.toHexString(),base);
  assert.equal(slots[0].material.alpha,1);engine.dispose();
});
