import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {test} from 'node:test';
import {loadScripts} from './browser-scripts.mjs';
import {createScene,readScene,saveScene} from '../_utils/editor/scenes.mjs';

const defaults=()=>JSON.parse(JSON.stringify(loadScripts(['js/PlayerAvatar.js']).get('PlayerAvatar').defaults()));

test('player settings survive saves and scene copies while invalid values are rejected',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arc-player-'));
  try {
    const player={...defaults(),spawnX:900,spawnZ:800,eyeHeight:145,fov:85,lightEnabled:false,lightColor:'#aa8844'};
    const created=await createScene(root,'Player',[],'mining',false,undefined,player);assert.equal(created.ok,true);
    const changed={...player,moveSpeed:260,lightRange:900};
    const saved=await saveScene(root,created.scene.id,created.revision,[],false,undefined,changed);assert.equal(saved.ok,true);
    assert.deepEqual((await readScene(root,created.scene.id)).scene.player,changed);
    const lighting={sun:false,sky:true,points:[]};
    const lightingSaved=await saveScene(root,created.scene.id,saved.revision,[],false,lighting);assert.equal(lightingSaved.ok,true);
    assert.deepEqual((await readScene(root,created.scene.id)).scene.player,changed);
    const clone=await createScene(root,'Copy',[],'mining',false,lighting,changed);assert.deepEqual(clone.scene.player,changed);
    for(const bad of [{...changed,fov:400},{...changed,mouseSensitivity:0},{...changed,lightColor:'bad'},{...changed,lightEnabled:'yes'}])
      assert.equal((await saveScene(root,created.scene.id,lightingSaved.revision,[],false,lighting,bad)).ok,false);
    assert.deepEqual((await readScene(root,created.scene.id)).scene.player,changed);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('the first-person body is hidden while player settings, light and contact shadow follow movement',()=>{
  const context={console,TextDecoder,TextEncoder,Uint8Array,ArrayBuffer,DataView,Blob,URL,setTimeout,clearTimeout,performance};
  context.globalThis=context;context.window=context;context.addEventListener=()=>{};context.removeEventListener=()=>{};vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL('../libs/babylon.js',import.meta.url),'utf8'),context);
  const B=context.BABYLON,engine=new B.NullEngine(),scene=new B.Scene(engine);scene.useRightHandedSystem=true;
  const camera=new B.TargetCamera('player-camera',B.Vector3.Zero(),scene);scene.activeCamera=camera;
  const floor=B.MeshBuilder.CreateGround('floor',{width:4000,height:4000},scene);floor.position.set(1024,0,1000);floor.computeWorldMatrix(true);
  const canvas={addEventListener(){}},document={getElementById:()=>canvas,addEventListener(){},pointerLockElement:canvas};
  const page=loadScripts(['libs/simplex-noise.js','js/Constants.js','js/Location3D.js','js/PlayerAvatar.js','js/Game.js'],{BABYLON:B,document,addEventListener(){}});
  const Location=page.get('Location3D'),Game=page.get('Game');
  const loc=Object.create(Location.prototype);Object.assign(loc,{view:{scene,camera},terrainEnabled:false,terrain:null,blobTextures:new Map(),ready:new Promise(()=>{})});
  Game.prototype.makeTool=function(){this.tool=new B.TransformNode('tool',scene);};
  const player={...defaults(),spawnX:1000,spawnZ:800,eyeHeight:140,moveSpeed:200,fov:80,lightHeight:110,lightRange:450};
  const game=new Game({location:loc,camera:{}},player);
  assert.equal(game.avatar.body.isVisible,false);assert.equal(game.position.y,140);assert.ok(Math.abs(camera.fov-80*Math.PI/180)<1e-8);
  assert.equal(game.avatar.light.range,450);assert.equal(game.avatar.record.blob.mesh.isEnabled(),true);
  game.keys.add('KeyW');game.move(.25);game.avatar.update(game.position,.25);
  assert.ok(Math.abs(game.position.z-850)<1e-8);assert.ok(Math.abs(game.avatar.record.blob.mesh.position.z-850)<1e-8);
  game.avatar.light.computeTransformedInformation();assert.ok(Math.abs(game.avatar.light.transformedPosition.z-850)<1e-8);
  const preview=new (page.get('PlayerAvatar'))(loc,{showBody:true,settings:player});assert.equal(preview.body.isVisible,true);
  preview.dispose();game.avatar.dispose();scene.dispose();engine.dispose();
});

test('saving player preserves unsaved scene edits and later player edits remain dirty',async()=>{
  let sent,complete;
  const scene={id:'mining',mode:'mining'};
  const scenePanel={active:scene,revision:'old',savedTerrain:false,busy:false,saving:false,render(){}};
  const objects={saved:JSON.stringify([{name:'saved object'}]),post:async(_,body)=>{sent=body;return new Promise(resolve=>{complete=resolve;});}};
  const page=loadScripts(['_utils/editor/player-panel.js'],{PlayerAvatar:{settings:()=>defaults()},ScenePanel:scenePanel,ObjectsPanel:objects,
    LightingPanel:{saved:JSON.stringify({sun:false,sky:true,points:[]})},document:{querySelector:()=>null,getElementById:()=>null},
    Inspector:{saveAvailable:true,server:{api:27}},EDITOR_API_VERSION:27,I18N:{lang:'en',t:x=>x},Toast:{show(){}}});
  const panel=page.get('PlayerPanel');panel.load();panel.data.spawnX=800;
  const pending=panel.save();panel.data.spawnX=850;complete({ok:true,revision:'new'});await pending;
  assert.equal(sent.objects[0].name,'saved object');assert.equal(sent.player.spawnX,800);assert.equal(sent.lighting.sun,false);
  assert.equal(scenePanel.revision,'new');assert.equal(panel.data.spawnX,850);assert.equal(panel.isDirty(),true);
});
