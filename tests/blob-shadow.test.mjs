import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import {loadScripts} from './browser-scripts.mjs';

test('Babylon contact shadows share textures, follow ground and clean up',()=>{
  const context={console,TextDecoder,TextEncoder,Uint8Array,ArrayBuffer,DataView,Blob,URL,setTimeout,clearTimeout,performance};
  context.globalThis=context;context.window=context;context.addEventListener=()=>{};context.removeEventListener=()=>{};vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL('../libs/babylon.js',import.meta.url),'utf8'),context);
  const B=context.BABYLON, engine=new B.NullEngine(), scene=new B.Scene(engine);
  const page=loadScripts(['js/Location3D.js'],{BABYLON:B}), Location=page.get('Location3D');
  const loc=Object.create(Location.prototype);Object.assign(loc,{view:{scene},terrainEnabled:false,terrain:null,blobTextures:new Map()});
  const ground=B.MeshBuilder.CreateGround('floor',{width:500,height:500},scene);ground.computeWorldMatrix(true);
  const root1=new B.Mesh('ore',scene),root2=new B.Mesh('ore2',scene);
  root1.position.set(10,0,20);root2.position.set(20,0,20);root1.computeWorldMatrix(true);root2.computeWorldMatrix(true);
  const a={mesh:root1,def:{tag:'ore'}},b={mesh:root2,def:{tag:'ore'}};
  loc.updateBlob(a,0.016);loc.updateBlob(b,0.016);
  assert.equal(a.blob.mesh.isPickable,false);assert.equal(a.blob.mesh.isEnabled(),true);
  assert.equal(a.blob.mesh.position.y,0.25);assert.equal(a.blob.mesh.position.x,10);
  assert.equal(a.blob.material.diffuseTexture,b.blob.material.diffuseTexture);assert.equal(loc.blobTextures.size,1);
  root1.setEnabled(false);loc.updateBlob(a,0.016);assert.equal(a.blob.mesh.isEnabled(),false);
  root1.setEnabled(true);root1.position.x=30;root1.computeWorldMatrix(true);loc.updateBlob(a,0.016);
  assert.equal(a.blob.mesh.position.x,30);assert.equal(a.blob.mesh.isEnabled(),true);
  a.def.blobShadow={enabled:true,sizeX:200,sizeZ:100,opacity:0.3,curve:[1,0.5,0.3,0.1,0]};
  loc.updateBlob(a,0.016);assert.equal(loc.blobTextures.size,2);assert.equal(a.blob.mesh.scaling.x,200);assert.equal(a.blob.mesh.scaling.z,200);
  a.def.blobShadow.enabled=false;loc.updateBlob(a,0.016);assert.equal(a.blob,undefined);assert.equal(loc.blobTextures.size,1);
  loc.removeBlob(b);assert.equal(loc.blobTextures.size,0);scene.dispose();engine.dispose();
});

test('props and actors get round shadows by default; floor and wall do not',()=>{
  const Location=loadScripts(['js/Location3D.js']).get('Location3D');
  for(const def of [{kind:'prop'},{kind:'actor',tag:'enemy'},{tag:'ore'},{tag:'player'}]) assert.equal(Location.blobSettings(def).enabled,true);
  for(const tag of ['wall','floor','ground']) assert.equal(Location.blobSettings({tag}).enabled,false);
  const s=Location.blobSettings({blobShadow:{enabled:true,sizeX:100,sizeZ:250,opacity:.5,curve:[.3,.8,.6,.2,.7]}});
  assert.equal(s.sizeX,s.sizeZ);assert.equal(s.curve[0],1);assert.equal(s.curve[4],0);
  assert.equal(Location.blobSettings({blobShadow:{enabled:false,sizeX:100,sizeZ:100,opacity:1,curve:[1,.8,.5,.2,0]}}).enabled,false);
});

test('player capsule, contact spot and point light follow the same position and dispose',()=>{
  const context={console,TextDecoder,TextEncoder,Uint8Array,ArrayBuffer,DataView,Blob,URL,setTimeout,clearTimeout,performance};
  context.globalThis=context;context.window=context;context.addEventListener=()=>{};context.removeEventListener=()=>{};vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL('../libs/babylon.js',import.meta.url),'utf8'),context);
  const B=context.BABYLON,engine=new B.NullEngine(),scene=new B.Scene(engine);
  new B.HemisphericLight('sky',new B.Vector3(0,1,0),scene);
  const sun=new B.DirectionalLight('sun',new B.Vector3(0,-1,0),scene);
  const floor=B.MeshBuilder.CreateGround('floor',{width:1000,height:1000},scene);floor.computeWorldMatrix(true);
  const page=loadScripts(['js/Location3D.js','js/PlayerAvatar.js'],{BABYLON:B});
  const loc=Object.create(page.get('Location3D').prototype);
  Object.assign(loc,{view:{scene,sun},terrainEnabled:false,terrain:null,blobTextures:new Map()});
  const avatar=new (page.get('PlayerAvatar'))(loc);avatar.update(new B.Vector3(10,160,20),.016);
  assert.equal(avatar.body.isPickable,false);assert.equal(avatar.record.blob.mesh.isEnabled(),true);
  assert.equal(avatar.record.blob.mesh.position.x,10);assert.equal(avatar.body.position.y,75);
  assert.equal(scene.lights.at(-1),sun);assert.equal(avatar.light.parent,avatar.root);
  avatar.update(new B.Vector3(60,160,80),.016);
  assert.equal(avatar.root.position.x,60);assert.equal(avatar.record.blob.mesh.position.x,60);
  assert.equal(avatar.light.computeTransformedInformation(),true);
  assert.equal(avatar.light.transformedPosition.x,60);assert.equal(avatar.light.transformedPosition.y,130);
  loc.view.applyLighting=()=>{};
  const lighting=loadScripts(['js/SceneLighting.js'],{BABYLON:B,World3D:{cfg:()=>({})}}).get('SceneLighting');
  lighting.apply(loc,{sun:true,sky:true,points:Array.from({length:4},(_,i)=>({name:'lamp'+i,x:i,y:0,h:10,color:'#ffffff',intensity:1,range:100}))});
  scene.onBeforeRenderObservable.notifyObservers(scene);
  assert.equal(avatar.material.maxSimultaneousLights,7);assert.equal(scene.lights.at(-1),sun);
  avatar.dispose();assert.equal(loc.blobTextures.size,0);assert.equal(scene.lights.includes(avatar.light),false);
  scene.dispose();engine.dispose();
});
