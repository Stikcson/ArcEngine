import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {test} from 'node:test';
import {createScene,saveScene,readScene} from '../_utils/editor/scenes.mjs';
import {loadScripts} from './browser-scripts.mjs';
const context={console,TextDecoder,TextEncoder,Uint8Array,ArrayBuffer,DataView,Blob,URL,setTimeout,clearTimeout,performance};
context.globalThis=context;context.window=context;context.addEventListener=()=>{};context.removeEventListener=()=>{};vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../libs/babylon.js',import.meta.url),'utf8'),context);
vm.runInContext(fs.readFileSync(new URL('../libs/babylonjs.loaders.min.js',import.meta.url),'utf8'),context);
const B=context.BABYLON;
test('camera settings round-trip independently and reject invalid sensor bounds',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'surveillance-'));
 try {const camera={name:'Camera',model:'assets/models/surveillance-camera.glb',kind:'prop',x:1,y:2,h:0,rot:[0,0,0],scale:[1,1,1],sensor:{distance:800,radius:350}};
 const initial=await createScene(root,'Test',[camera]);assert.equal(initial.ok,true);
 assert.deepEqual(initial.scene.objects[0].sensor,camera.sensor);
 const changed={...camera,sensor:{distance:400,radius:120}};const save=await saveScene(root,initial.scene.id,initial.revision,[changed]);assert.equal(save.ok,true);
 assert.deepEqual((await readScene(root,initial.scene.id)).scene.objects[0].sensor,changed.sensor);
 for(const sensor of [{distance:0,radius:100},{distance:100,radius:-1},{distance:NaN,radius:3},{distance:100,radius:20000}])
 assert.equal((await saveScene(root,initial.scene.id,save.revision,[{...camera,sensor}])).ok,false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('actual model, editor cone and gameplay detection use matching geometry and respond to motion',async()=>{
 const engine=new B.NullEngine(),scene=new B.Scene(engine);scene.useRightHandedSystem=true;
 const bytes=new Uint8Array(fs.readFileSync(new URL('../assets/models/surveillance-camera.glb',import.meta.url)));
 const container=await B.SceneLoader.LoadAssetContainerAsync('',bytes,scene,null,'.glb');
 const page=loadScripts(['js/Gltf3D.js','js/Surveillance.js'],{BABYLON:B});
 const root=page.get('Gltf3D').build({container,clips:[]},scene,{name:'camera'});
 const S=page.get('Surveillance'),rec={mesh:root,def:{sensor:{distance:800,radius:350}}},loc={view:{scene},objects:[rec]};root.metadata={locationObject:rec};
 root.computeWorldMatrix(true);for(const mesh of root.getChildMeshes())mesh.computeWorldMatrix(true);
 const bounds=root.getHierarchyBoundingVectors(true);assert.ok(bounds.max.y>170 && bounds.max.y<175);assert.ok(bounds.min.y>=0 && bounds.min.y<5);
 const sensor=root.getChildMeshes().find(m=>m.name.endsWith('/SensorIndicator'));assert.ok(sensor,'indicator is a separate mesh');
 assert.equal(S.inCone(new B.Vector3(426,160,174),rec.def.sensor),true);
 assert.equal(S.inCone(new B.Vector3(426,160,176),rec.def.sensor),false);
 assert.equal(S.inCone(new B.Vector3(827,160,0),rec.def.sensor),false);
 S.update(loc,.1,[],true);const cone=root.getChildMeshes().find(m=>m.name==='sensor-cone');assert.ok(cone);assert.equal(cone.scaling.x,800);assert.equal(cone.scaling.y,350);
 const gameRoot=page.get('Gltf3D').build({container,clips:[]},scene,{name:'game camera'});
 const gameRec={mesh:gameRoot,def:{sensor:{distance:800,radius:350}}},gameLoc={view:{scene},objects:[gameRec]};gameRoot.metadata={locationObject:gameRec};
 const target=(x,z)=>[{id:'player',position:new B.Vector3(x,160,z)}];
 S.update(gameLoc,.1,target(400,0));S.update(gameLoc,.1,target(400,0));assert.equal(S.context(gameLoc).records.get(gameRec).alarm,0);
 S.update(gameLoc,.1,target(410,0));assert.ok(S.context(gameLoc).records.get(gameRec).alarm>0);
 assert.equal(gameRoot.getChildMeshes().some(m=>m.name==='sensor-cone'),false);
 const indicator=gameRoot.getChildMeshes().find(m=>m.name.endsWith('/SensorIndicator'));assert.equal(indicator.material.emissiveColor.g,0);
 const wall=B.MeshBuilder.CreateBox('wall',{width:20,height:400,depth:600},scene);wall.position.set(200,160,0);wall.metadata={locationObject:{def:{}}};wall.computeWorldMatrix(true);
 assert.equal(S.visible(gameLoc,gameRec,new B.Vector3(26,160,0),new B.Vector3(410,160,0)),false);wall.dispose();
 assert.equal(S.visible(gameLoc,gameRec,new B.Vector3(26,160,0),new B.Vector3(410,160,0)),true);
 for(let i=0;i<10;i++)S.update(gameLoc,.1,target(410,0));assert.equal(S.context(gameLoc).records.get(gameRec).alarm,0);
 S.update(gameLoc,.1,target(410,400));assert.equal(S.context(gameLoc).records.get(gameRec).alarm,0);
 gameRoot.rotation.y=Math.PI/2;gameRoot.computeWorldMatrix(true);
 const forward=B.Vector3.TransformCoordinates(new B.Vector3(400,160,0),gameRoot.getWorldMatrix());
 S.update(gameLoc,.1,[{id:'player',position:forward}]);assert.ok(S.context(gameLoc).records.get(gameRec).alarm>0);
 scene.dispose();engine.dispose();
});

test('player can place a camera facing their heading and blocked placement is rejected',()=>{
 const page=loadScripts(['js/Constants.js','js/Game.js','js/Surveillance.js'],{BABYLON:B});
 const G=page.get('Game'), game=Object.create(G.prototype), placed=[];
 game.position=new B.Vector3(500,160,500);game.yaw=0;game.placedCameras=[];
 game.app={location:{terrainEnabled:false,addObject:def=>{const rec={def};placed.push(rec);return rec;}}};
 game.pick=()=>null;game.groundAt=()=>0;game.say=()=>{};
 game.placeCamera();assert.equal(placed.length,1);assert.equal(placed[0].def.y,680);assert.equal(placed[0].def.rot[1],90);
 const root=new B.Mesh('test',new B.Scene(new B.NullEngine()));root.rotation.y=-placed[0].def.rot[1]*Math.PI/180;root.computeWorldMatrix(true);
 const direction=B.Vector3.TransformNormal(new B.Vector3(1,0,0),root.getWorldMatrix());assert.ok(direction.z>.99);
 game.pick=()=>({});game.placeCamera();assert.equal(placed.length,1);root.getScene().getEngine().dispose();
});
