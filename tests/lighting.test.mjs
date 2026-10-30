import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {test} from 'node:test';
import {createScene,readScene,saveScene} from '../_utils/editor/scenes.mjs';
import {loadScripts} from './browser-scripts.mjs';
const point={name:'Lamp',x:10,y:20,h:30,color:'#ff8040',intensity:2,range:600};
const lighting={sun:false,sky:false,points:[point]};
test('lighting is per-scene, survives saving and cloning, and rejects malformed sources',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arc-lights-'));
 try {
  const a=await createScene(root,'Cave',[],'mining',false,lighting),b=await createScene(root,'Other');
  assert.deepEqual(a.scene.lighting,lighting);assert.equal(b.scene.lighting.sun,true);
  const updated={...lighting,points:[{...point,range:900}]};
  const result=await saveScene(root,a.scene.id,a.revision,[],false,updated);
  assert.deepEqual((await readScene(root,a.scene.id)).scene.lighting,updated);
  assert.equal((await readScene(root,b.scene.id)).scene.lighting.sun,true);
  assert.equal((await createScene(root,'Copy',[],'mining',false,updated)).scene.lighting.points[0].range,900);
  for(const bad of [{...lighting,points:[{...point,range:0}]},{...lighting,points:[{...point,color:'bad'}]},{...lighting,points:Array(5).fill(point)},{...lighting,sun:'no'}])
    assert.equal((await saveScene(root,a.scene.id,result.revision,[],false,bad)).ok,false);
  assert.deepEqual((await readScene(root,a.scene.id)).scene.lighting,updated);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('real Babylon point lights update, retain sun order and dispose without affecting other scenes',()=>{
 const context={console,TextDecoder,TextEncoder,Uint8Array,ArrayBuffer,DataView,Blob,URL,setTimeout,clearTimeout,performance};context.globalThis=context;context.window=context;context.addEventListener=()=>{};context.removeEventListener=()=>{};vm.createContext(context);
 vm.runInContext(fs.readFileSync(new URL('../libs/babylon.js',import.meta.url),'utf8'),context);
 const B=context.BABYLON, engine=new B.NullEngine(),scene=new B.Scene(engine);
 new B.HemisphericLight('hemi',new B.Vector3(0,1,0),scene);const sun=new B.DirectionalLight('sun',new B.Vector3(0,-1,0),scene);
 const view={scene,sun,applyLighting(){}};const location={view};
 const page=loadScripts(['js/SceneLighting.js'],{BABYLON:B,World3D:{cfg:()=>({})}}), S=page.get('SceneLighting');
 const before=new B.StandardMaterial('before',scene);
 S.apply(location,lighting,true);assert.equal(scene.lights.length,3);assert.equal(scene.lights[2],sun);assert.equal(before.maxSimultaneousLights,6);
 assert.equal(scene.lights[1].position.y,30);assert.equal(scene.lights[1].range,600);assert.equal(location._sceneLightMarkers.length,1);
 const after=new B.StandardMaterial('after',scene);scene.onBeforeRenderObservable.notifyObservers(scene);assert.equal(after.maxSimultaneousLights,6);
 S.apply(location,{sun:true,sky:true,points:[]},false);assert.equal(scene.lights.length,2);assert.equal(location._sceneLightMarkers.length,0);
 scene.dispose();engine.dispose();
});
