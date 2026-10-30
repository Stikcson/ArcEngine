// Integration checks use the bundled Babylon runtime and the actual generated ore GLB.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';
import { patchScalar } from '../_utils/editor/save.mjs';
const context = { console, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, DataView, Blob, URL, setTimeout, clearTimeout, performance };
context.globalThis = context;
context.window = context;
context.addEventListener = () => {};
context.removeEventListener = () => {};
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../libs/babylon.js', import.meta.url), 'utf8'), context);
vm.runInContext(fs.readFileSync(new URL('../libs/babylonjs.loaders.min.js', import.meta.url), 'utf8'), context);
const BABYLON = context.BABYLON;

test('models embed the selected prototype texture and ore has equal cube dimensions', () => {
  const png=fs.readFileSync(new URL('../assets/mining-textures/texture_07.png',import.meta.url));
  for(const file of ['mining-ore.glb','mining-box.glb']) {
    const bytes=fs.readFileSync(new URL('../assets/models/'+file,import.meta.url));
    const jsonLength=bytes.readUInt32LE(12), doc=JSON.parse(bytes.toString('utf8',20,20+jsonLength));
    const binary=bytes.subarray(20+jsonLength+8), view=doc.bufferViews[doc.images[0].bufferView];
    assert.ok(binary.subarray(view.byteOffset,view.byteOffset+view.byteLength).equals(png),file+' embeds the selected PNG');
    for(const material of doc.materials) assert.equal(material.pbrMetallicRoughness.baseColorTexture.index,0,material.name+' uses the texture');
    if(file==='mining-ore.glb') {
      const mesh=doc.meshes.find(m=>m.name==='Rock'), position=doc.accessors[mesh.primitives[0].attributes.POSITION];
      const dimensions=position.max.map((n,i)=>n-position.min[i]);
      assert.ok(dimensions.every(n=>Math.abs(n-1.6)<1e-6),'ore visual is a cube');
    }
  }
});

test('mouse capture requests raw movement and safely falls back when unsupported', async () => {
  const page=loadScripts(['js/Constants.js','js/Game.js'],{BABYLON});
  const Game=page.get('Game'), calls=[];
  const game=Object.create(Game.prototype);
  game.say=()=>assert.fail('successful capture must not show an error');
  game.canvas={requestPointerLock: options=>{calls.push(options);return Promise.resolve();}};
  await game.captureMouse();assert.equal(calls.length,1);assert.equal(calls[0].unadjustedMovement,true);
  calls.length=0;
  game.canvas.requestPointerLock=options=>{calls.push(options);return options?Promise.reject({name:'NotSupportedError'}):Promise.resolve();};
  await game.captureMouse();assert.equal(calls.length,2);assert.equal(calls[0].unadjustedMovement,true);assert.equal(calls[1],undefined);
  calls.length=0;
  game.canvas.requestPointerLock=options=>{calls.push(options);return undefined;};
  await game.captureMouse();assert.equal(calls.length,1,'legacy void return is accepted');
});

test('chamber walls form a perimeter and leave the spawn unobstructed', async () => {
  const engine=new BABYLON.NullEngine(), scene=new BABYLON.Scene(engine);scene.useRightHandedSystem=true;
  const bytes=new Uint8Array(fs.readFileSync(new URL('../assets/models/mining-box.glb',import.meta.url)));
  const container=await BABYLON.SceneLoader.LoadAssetContainerAsync('',bytes,scene,null,'.glb');
  const page=loadScripts(['js/Constants.js','js/Objects.js','js/Gltf3D.js','js/Location3D.js'],{BABYLON});
  const Gltf3D=page.get('Gltf3D'), Location3D=page.get('Location3D'), defs=page.get('LOCATION_OBJECTS');
  const bounds={};
  for(const def of defs.filter(d=>d.tag==='wall')) {
    const root=Gltf3D.build({container,clips:[]},scene,{name:def.name});
    const rec={mesh:root,def};Location3D.prototype.placeObject.call({terrain:{heightAt:()=>0}},rec);
    root.computeWorldMatrix(true);for(const mesh of root.getChildMeshes())mesh.computeWorldMatrix(true);
    const b=root.getHierarchyBoundingVectors(true);bounds[def.name]={min:b.min.asArray(),max:b.max.asArray()};
  }
  assert.ok(bounds['Back wall'].max[0]-bounds['Back wall'].min[0]>1700, 'back wall spans chamber width');
  assert.ok(bounds['Back wall'].max[2]-bounds['Back wall'].min[2]<50, 'back wall is thin in depth');
  assert.ok(bounds['Left wall'].max[2]-bounds['Left wall'].min[2]>1699, 'side wall spans chamber depth');
  assert.ok(bounds['Left wall'].max[0]-bounds['Left wall'].min[0]<50, 'side wall is thin in width');
  const close=(actual,expected)=>Math.abs(actual-expected)<.01;
  assert.ok(close(bounds['Floor'].min[0],124) && close(bounds['Floor'].max[0],1924));
  assert.ok(close(bounds['Floor'].min[2],324) && close(bounds['Floor'].max[2],2024));
  assert.ok(close(bounds['Back wall'].min[2],2004) && close(bounds['Rear wall'].max[2],344));
  assert.ok(close(bounds['Left wall'].max[0],144) && close(bounds['Right wall'].min[0],1904));
  const spawn=[1024,160,774];
  for(const name of ['Back wall','Rear wall','Left wall','Right wall']) {
    const b=bounds[name];
    assert.ok(!spawn.every((n,i)=>n>=b.min[i] && n<=b.max[i]), name+' must not overlap the spawn');
  }
  engine.dispose();
});

test('movement and mouse directions follow the right-handed player camera', () => {
  const engine = new BABYLON.NullEngine(), scene = new BABYLON.Scene(engine);
  scene.useRightHandedSystem = true;
  const canvas = {}, document = { pointerLockElement: canvas };
  const page = loadScripts(['js/Constants.js','js/Game.js'], { BABYLON, document });
  const game = Object.create(page.get('Game').prototype);
  Object.assign(game, { cam: new BABYLON.TargetCamera('camera', BABYLON.Vector3.Zero(), scene),
    canvas, position: new BABYLON.Vector3(1024,160,774), pitch: 0, yaw: 0, ores: [], keys: new Set() });
  for (const yaw of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
    game.yaw=yaw;game.position.set(1024,160,774);game.updateCamera();
    const right=game.cam.getDirection(BABYLON.Axis.X), forward=game.cam.getForwardRay().direction;
    const start=game.position.clone();game.keys=new Set(['KeyD']);game.move(.1);
    const movement=game.position.subtract(start);
    assert.ok(BABYLON.Vector3.Dot(movement,right)>39, 'D moves right on screen');
    assert.ok(Math.abs(BABYLON.Vector3.Dot(movement,forward))<.1, 'strafing has no meaningful forward component');
    game.position.copyFrom(start);game.keys=new Set(['KeyA']);game.move(.1);
    assert.ok(BABYLON.Vector3.Dot(game.position.subtract(start),right)<-39, 'A moves left on screen');
    game.position.copyFrom(start);game.keys=new Set(['KeyW']);game.move(.1);
    assert.ok(BABYLON.Vector3.Dot(game.position.subtract(start),forward)>39, 'W moves forward');
    game.position.copyFrom(start);game.yaw=yaw;game.pitch=0;game.updateCamera();
    const before=game.cam.getForwardRay().direction.clone(), screenRight=game.cam.getDirection(BABYLON.Axis.X);
    game.look(20,0);game.updateCamera();
    assert.ok(BABYLON.Vector3.Dot(game.cam.getForwardRay().direction.subtract(before),screenRight)>0, 'mouse right turns right');
  }
  game.yaw=0;game.pitch=0;game.updateCamera();game.look(0,20);game.updateCamera();
  assert.ok(game.cam.getForwardRay().direction.y<0, 'mouse down looks down');
  game.look(0,-40);game.updateCamera();
  assert.ok(game.cam.getForwardRay().direction.y>0, 'mouse up looks up');
  game.yaw=0;game.pitch=0;game.look(1800,0);const fastYaw=game.yaw;game.updateCamera();
  const fastDirection=game.cam.getForwardRay().direction.clone();game.yaw=0;
  for(let i=0;i<180;i++)game.look(10,0);
  game.updateCamera();
  assert.ok(Math.abs(game.yaw-fastYaw)<1e-10,'rapid and subdivided deltas have the same yaw');
  assert.ok(BABYLON.Vector3.Distance(game.cam.getForwardRay().direction,fastDirection)<1e-6,'fast motion preserves total rotation');
  for (const yaw of [0, Math.PI/2, -Math.PI/2, Math.PI]) {
    game.position.set(1024,160,774);game.yaw=yaw;game.pitch=-.1745;game.updateCamera();
    const initialDirection=game.cam.getForwardRay().direction.clone();
    game.keys=new Set(['KeyW']);
    for(let i=0;i<30;i++) {
      game.move(1/60);game.updateCamera();
      assert.ok(BABYLON.Vector3.Distance(game.cam.position,game.position)<1e-9, 'camera stays at the player position');
      scene.activeCamera=game.cam;scene.render();
      assert.ok(BABYLON.Vector3.Distance(game.cam.getForwardRay().direction,initialDirection)<1e-6, 'moving does not rotate the camera');
    }
  }
  engine.dispose();
});

test('unchanged HUD state is not reapplied every frame', () => {
  const calls = [];
  const elements = Object.fromEntries(['target','health','crosshair','resources'].map(id=>[id,{
    show(value){calls.push([id,'show',value]);},setText(value){calls.push([id,'setText',value]);},setValue(value){calls.push([id,'setValue',value]);}
  }]));
  const page=loadScripts(['js/Constants.js','js/Game.js'],{BABYLON,UI:{get:id=>elements[id]||null},document:{pointerLockElement:null}});
  const game=Object.create(page.get('Game').prototype);
  Object.assign(game,{hudCache:{},elapsed:0,nextSwing:0,contact:-1,swingTime:-10,held:false,
    position:new BABYLON.Vector3(),canvas:{},keys:new Set(),ores:[],chips:[],resources:0,
    tool:{rotation:new BABYLON.Vector3()},cam:{position:new BABYLON.Vector3(),rotation:new BABYLON.Vector3(),getForwardRay:()=>null},pick:()=>null});
  game.drops=[];
  game.update(1/60); const first=calls.length; assert.equal(first,4);
  for(let i=0;i<60;i++)game.update(1/60);
  assert.equal(calls.length,first,'steady frames do not rewrite the HUD');
  game.resources=5;game.update(1/60);assert.deepEqual(calls.at(-1),['resources','setText','IRON  5']);
  assert.equal(calls.length,first+1,'a changed value updates once');
});

test('generated ore imports and gameplay detects hits using the unsquashed collider', async () => {
  const engine = new BABYLON.NullEngine();
  const scene = new BABYLON.Scene(engine); scene.useRightHandedSystem = true;
  const bytes = new Uint8Array(fs.readFileSync(new URL('../assets/models/mining-ore.glb', import.meta.url)));
  const container = await BABYLON.SceneLoader.LoadAssetContainerAsync('', bytes, scene, null, '.glb');
  const page = loadScripts(['js/Constants.js','js/Gltf3D.js','js/Game.js'], { BABYLON, UI: { get: () => null }, Sound3D: { play() {} }, document: {}, setTimeout });
  const Gltf3D = page.get('Gltf3D'), Game = page.get('Game');
  const root = Gltf3D.build({container, clips:[]}, scene, {name:'Iron deposit 1'});
  root.position.set(1024, 0, 1124); root.rotation.y = -Math.PI/2;
  const rec = {mesh:root, def:{name:'Iron deposit 1'}};
  const game = Object.create(Game.prototype);
  Object.assign(game, { scene, ores:[], colliders:[], chips:[], drops:[], resources:0, elapsed:0,
    app:{location:{findByTag: tag => tag === 'ore' ? [rec] : []}} });
  game.prepareScene();
  assert.equal(game.ores.length, 1, 'loaded Rock node is found after ArcEngine renames it');
  const ore = game.ores[0]; ore.collider.computeWorldMatrix(true);
  assert.equal(ore.bar.textValue,'120/120');
  assert.ok(ore.bar.text.getTotalVertices()>0,'health numbers have drawable geometry');
  const solid = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(-.35,.9,-.7), ore.collider.getWorldMatrix());
  const solidFrom = solid.add(new BABYLON.Vector3(0,0,-200));
  const solidRay = new BABYLON.Ray(solidFrom, solid.subtract(solidFrom).normalize(), 320);
  assert.equal(game.strike(solidRay), true);
  assert.equal(game.lastDamage, 20);
  assert.equal(ore.health, 100);
  assert.equal(ore.bar.textValue,'100/120','numbers follow damage');
  game.reset();
  const blocker = BABYLON.MeshBuilder.CreateBox('blocker', {size:40}, scene);
  blocker.position.copyFrom(solidFrom.add(new BABYLON.Vector3(0,0,100)));
  game.colliders.push({mesh:blocker,ore:null});
  assert.equal(game.strike(solidRay), false, 'a nearer wall blocks the strike');
  assert.equal(ore.health, 120);
  game.colliders.pop(); blocker.dispose();
  const miss = new BABYLON.Ray(solidFrom, new BABYLON.Vector3(0,1,0), 320);
  assert.equal(game.strike(miss), false);
  const camera = new BABYLON.TargetCamera('test-camera',new BABYLON.Vector3(),scene);
  game.cam=camera;game.position=new BABYLON.Vector3(1024,160,774);game.yaw=0;game.pitch=-.1745;
  game.updateCamera();const direction=camera.getForwardRay().direction;
  assert.ok(direction.z > .9 && direction.y < 0, 'the player initially faces the deposit');
  const point = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(.35,.95,-.7), ore.collider.getWorldMatrix());
  const from = point.add(new BABYLON.Vector3(0, 0, -200));
  const ray = new BABYLON.Ray(from, point.subtract(from).normalize(), 320);
  assert.equal(game.strike(ray), true, 'weak point can be hit');
  assert.equal(game.lastDamage, 60);
  assert.equal(ore.health, 60);
  ore.rock.scaling.y *= .8;
  assert.equal(game.strike(ray), true, 'visual squash does not move the collider');
  assert.equal(ore.health, 0);
  assert.equal(game.resources, 0, 'resource is waiting to be picked up');
  assert.equal(game.drops.length,1,'the original ore launches on the final hit without waiting');
  assert.equal(root.isEnabled(),true);
  assert.ok(ore.rock.scaling.y<ore.rest.y,'the final hit compresses the ore immediately');
  const drop=game.drops[0], start=drop.center.clone(), away=start.subtract(game.position);
  assert.equal(drop.mesh,root,'the drop is the original ore object');
  assert.ok(!scene.getMeshByName('iron drop'),'no replacement mesh is created');
  assert.ok(drop.velocity.x*away.x+drop.velocity.z*away.z>0,'drop launches away from the player');
  assert.ok(Math.abs(drop.velocity.x*away.z-drop.velocity.z*away.x)<.001,'launch direction tracks the player, not the hit offset');
  assert.ok(drop.velocity.y>0,'drop launches upward');
  game.updateImpactEffects(.04);
  assert.ok(Math.hypot(drop.center.x-start.x,drop.center.z-start.z)>0,'ore begins moving on the first frame');
  assert.equal(game.strike(ray), false, 'depleted deposit cannot grant resources twice');
  game.updateImpactEffects(.14);
  assert.ok(root.scaling.x<ore.restScaling.x && root.scaling.x>ore.restScaling.x*.5,'ore shrinks progressively during flight');
  let peak=drop.center.y;
  for(let i=0;i<240;i++){game.updateImpactEffects(1/60);peak=Math.max(peak,drop.center.y);}
  assert.equal(game.drops.length,1);assert.equal(drop.settled,true,'drop lands and settles');
  assert.ok(peak-start.y>45,'default launch has a visibly higher arc');
  assert.ok(Math.abs(root.scaling.x-ore.restScaling.x*.5)<1e-8,'ore reaches half its original scale');
  const distance=Math.hypot(drop.center.x-start.x,drop.center.z-start.z);
  assert.ok(distance>190 && distance<220,'default drop travels roughly half the previous 410 cm');
  assert.ok(BABYLON.Vector3.Distance(ore.rock.scaling,ore.rest)<1e-8,'compression settles during flight');
  root.computeWorldMatrix(true);ore.collider.computeWorldMatrix(true);
  assert.ok(BABYLON.Vector3.Distance(ore.collider.getBoundingInfo().boundingBox.centerWorld,drop.center)<.001,'visual center follows the trajectory while shrinking and rotating');
  assert.ok(ore.collider.getBoundingInfo().boundingBox.minimumWorld.y>=drop.ground-.001,'the ore does not sink through the floor');
  const landed=drop.center.clone(), rotation=root.rotation.y;
  for(let i=0;i<60;i++)game.updateImpactEffects(1/60);
  assert.ok(BABYLON.Vector3.Distance(landed,drop.center)<.001,'the ore stays still after landing');
  assert.equal(root.rotation.y,rotation,'the ore stops spinning after landing');
  assert.ok(Math.abs(drop.center.y-drop.ground-drop.half)<.001,'the ore rests on the floor');
  game.reset(); assert.equal(ore.health, 120); assert.equal(ore.bar.textValue,'120/120'); assert.equal(game.resources, 0);
  assert.ok(BABYLON.Vector3.Distance(root.position,ore.restPosition)<1e-8 && BABYLON.Vector3.Distance(root.scaling,ore.restScaling)<1e-8,'reset restores the original transform');
  game.strike(ray);game.strike(ray);assert.equal(game.drops.length,1);
  game.reset();game.updateImpactEffects(.5);
  assert.equal(game.drops.length,0,'reset removes the launched drop');
  assert.equal(root.isEnabled(),true);
  engine.dispose();
});

test('real ore hits while moving do not leave the rendered camera tilted', async () => {
  const engine = new BABYLON.NullEngine(), scene = new BABYLON.Scene(engine); scene.useRightHandedSystem = true;
  const bytes = new Uint8Array(fs.readFileSync(new URL('../assets/models/mining-ore.glb', import.meta.url)));
  const container = await BABYLON.SceneLoader.LoadAssetContainerAsync('', bytes, scene, null, '.glb');
  const canvas = {}, document = {pointerLockElement: canvas};
  const page = loadScripts(['libs/simplex-noise.js','js/Constants.js','js/Gltf3D.js','js/Game.js'],
    { BABYLON, document, UI:{get:()=>null}, Sound3D:{play(){}}, setTimeout });
  const root = page.get('Gltf3D').build({container, clips:[]}, scene, {name:'Iron deposit 1'});
  root.position.set(1024, 0, 1124); root.rotation.y=-Math.PI/2; root.scaling.setAll(0.5);
  const rec = {mesh:root, def:{name:'Iron deposit 1'}};
  const game = Object.create(page.get('Game').prototype);
  Object.assign(game, { scene, ores:[], colliders:[], chips:[], drops:[], resources:0, elapsed:0, hudCache:{},
    app:{location:{findByTag:tag=>tag==='ore'?[rec]:[]}},
    canvas, keys:new Set(['KeyW']), held:true, nextSwing:0, contact:-1, swingTime:-10,
    position:new BABYLON.Vector3(1024,160,850), pitch:-0.42, yaw:0,
    cam:new BABYLON.TargetCamera('test-player',BABYLON.Vector3.Zero(),scene),
    cameraShake:new (page.get('ImpactCameraShake'))(), tool:{rotation:new BABYLON.Vector3()},
    burst(){}, say(){} });
  scene.activeCamera=game.cam; game.prepareScene(); game.updateCamera(); scene.render();
  const original=game.cam.getForwardRay().direction.clone();
  let successfulHits=0;
  const strike=game.strike.bind(game);
  game.strike=ray=>{ const hit=strike(ray); if(hit) successfulHits++; return hit; };
  for(let i=0;i<75;i++){game.update(1/60);scene.render();}
  assert.ok(successfulHits>0,'real ray hits the loaded ore while moving');
  assert.ok(game.position.z>850,'player moved during the hits');
  game.held=false; game.keys.clear();
  for(let i=0;i<60;i++){game.update(1/60);scene.render();}
  assert.ok(BABYLON.Vector3.Distance(game.cam.getForwardRay().direction,original)<1e-6, 'rendered view returns to the original direction');
  assert.ok(Math.abs(game.cam.rotation.z)<1e-12,'no tilt remains');
  scene.dispose(); engine.dispose();
});

test('impact visuals settle, chips scatter and bounce, and dropped iron is collected once', async () => {
  const engine=new BABYLON.NullEngine(),scene=new BABYLON.Scene(engine);scene.useRightHandedSystem=true;
  const bytes=new Uint8Array(fs.readFileSync(new URL('../assets/models/mining-ore.glb',import.meta.url)));
  const container=await BABYLON.SceneLoader.LoadAssetContainerAsync('',bytes,scene,null,'.glb');
  const page=loadScripts(['js/Constants.js','js/Gltf3D.js','js/Game.js'],{BABYLON,document:{},UI:{get:()=>null},Sound3D:{play(){}},setTimeout});
  const root=page.get('Gltf3D').build({container,clips:[]},scene,{name:'Ore'});
  root.position.set(0,0,0);root.scaling.setAll(.5);
  const rec={mesh:root,def:{name:'Ore'}},game=Object.create(page.get('Game').prototype);
  Object.assign(game,{scene,ores:[],colliders:[],chips:[],drops:[],resources:0,elapsed:0,hudCache:{},
    app:{location:{findByTag:tag=>tag==='ore'?[rec]:[]}},position:new BABYLON.Vector3(400,160,0),
    cam:new BABYLON.TargetCamera('camera',new BABYLON.Vector3(400,160,0),scene),
    tool:{rotation:new BABYLON.Vector3()},held:false,swingTime:-10,contact:-1,
    move(){},updateCamera(){},pick(){return null;},say(){} });
  game.prepareScene();
  const ore=game.ores[0],original=ore.material;
  game.flashOre(ore);ore.spring=0;ore.amplitude=.2;ore.health=60;game.updateHealthBar(ore);
  assert.equal(ore.rock.material,game.flashMaterial);
  assert.equal(ore.bar.fill.scaling.x,.5);
  game.burst(new BABYLON.Vector3(0,30,0),false,false);
  assert.ok(game.chips.some(c=>c.velocity.x>0)&&game.chips.some(c=>c.velocity.x<0));
  assert.ok(game.chips.some(c=>c.velocity.z>0)&&game.chips.some(c=>c.velocity.z<0));
  assert.ok(game.chips.every(c=>c.mesh.getTotalVertices()===4),'chips are 2D planes');
  game.update(.005);
  assert.ok(ore.rock.scaling.y<ore.rest.y*.85,'impact produces pronounced compression');
  let bounced=false;
  for(let i=0;i<80;i++){game.update(1/60);if(game.chips.some(c=>c.mesh.position.y<=3.1 && c.velocity.y>0))bounced=true;}
  assert.ok(bounced,'at least one chip rebounds from the floor');
  assert.equal(ore.rock.material,original,'flash restores the original per-object material');
  assert.ok(BABYLON.Vector3.Distance(ore.rock.scaling,ore.rest)<1e-8,'visual returns exactly to rest');
  game.update(.3);assert.equal(game.chips.length,0,'expired particles are removed');
  game.spawnDrop(ore);assert.equal(game.drops.length,1);game.update(.01);game.update(.5);
  assert.equal(game.resources,0,'distant player does not collect');
  game.position.set(0,160,0);game.update(.01);
  assert.equal(game.resources,5);assert.equal(game.drops.length,0);
  assert.equal(root.isDisposed(),false,'pickup hides the existing ore instead of destroying it');
  game.update(.1);assert.equal(game.resources,5,'pickup awards only once');
  game.reset();assert.equal(root.isEnabled(),true,'reset restores the collected ore');
  game.spawnDrop(ore);game.reset();assert.equal(game.drops.length,0);assert.equal(game.resources,0);
  scene.dispose();engine.dispose();
});

test('impact controls are unique, translated, and saveable as numeric constants', () => {
  const schema=loadScripts(['_utils/editor/schema.js']).get('KIT_SCHEMA');
  const groups=schema.filter(g=>g.id.startsWith('mining-impact-'));
  assert.equal(groups.length,3);
  const fields=groups.flatMap(g=>g.fields), all=schema.flatMap(g=>g.fields.map(f=>f.name));
  assert.equal(new Set(all).size,all.length,'each setting is exposed only once');
  const src=fs.readFileSync(new URL('../js/Constants.js',import.meta.url),'utf8');
  for(const f of fields){
    assert.ok(f.label.en && f.label.ru,`${f.name} has both labels`);
    assert.ok(patchScalar(src,f.name,f.kind==='color'?0x123456:f.kind==='select'?1:0.5).src,`${f.name} can be saved`);
  }
});

test('saved impact settings change particles, flash, deformation, bar and pickup', async () => {
  let constants=fs.readFileSync(new URL('../js/Constants.js',import.meta.url),'utf8');
  const settings={MINING_FLASH_DURATION:0,MINING_SQUASH:0.4,MINING_SQUASH_SPREAD:0,
    MINING_CHIPS:3,MINING_CHIP_BREAK_EXTRA:0,MINING_CHIP_SPEED:20,MINING_CHIP_SPEED_VARIATION:0,
    MINING_CHIP_LIFT:40,MINING_CHIP_LIFT_VARIATION:0,MINING_CHIP_GRAVITY:0,
    MINING_CHIP_COLOR:0x123456,MINING_BAR_ENABLED:0,MINING_DROP_SCALE:0.25,MINING_DROP_SHRINK_TIME:0.1,
    MINING_DROP_HEIGHT:80,MINING_DROP_BOB:0,MINING_DROP_LAUNCH_SPEED:0,MINING_DROP_LAUNCH_LIFT:0,
    MINING_DROP_PICKUP_RADIUS:10,MINING_DROP_PICKUP_DELAY:0};
  for(const [name,value] of Object.entries(settings)){const p=patchScalar(constants,name,value);assert.ok(p.src,name);constants=p.src;}
  const engine=new BABYLON.NullEngine(),scene=new BABYLON.Scene(engine);scene.useRightHandedSystem=true;
  const bytes=new Uint8Array(fs.readFileSync(new URL('../assets/models/mining-ore.glb',import.meta.url)));
  const container=await BABYLON.SceneLoader.LoadAssetContainerAsync('',bytes,scene,null,'.glb');
  const page=loadScripts([],{BABYLON,document:{},UI:{get:()=>null},Sound3D:{play(){}},setTimeout});
  vm.runInContext(constants,page.ctx);vm.runInContext(fs.readFileSync(new URL('../js/Gltf3D.js',import.meta.url),'utf8'),page.ctx);
  vm.runInContext(fs.readFileSync(new URL('../js/Game.js',import.meta.url),'utf8'),page.ctx);
  const root=page.get('Gltf3D').build({container,clips:[]},scene,{name:'Ore'});root.scaling.setAll(.5);
  const game=Object.create(page.get('Game').prototype),rec={mesh:root,def:{name:'Ore'}};
  Object.assign(game,{scene,ores:[],colliders:[],chips:[],drops:[],resources:0,elapsed:0,hudCache:{},
    app:{location:{findByTag:tag=>tag==='ore'?[rec]:[]}},position:new BABYLON.Vector3(15,160,0),
    cam:new BABYLON.TargetCamera('camera',BABYLON.Vector3.Zero(),scene),tool:{rotation:new BABYLON.Vector3()},
    held:false,swingTime:-10,contact:-1,move(){},updateCamera(){},pick(){return null;},say(){} });
  game.prepareScene();const ore=game.ores[0];assert.equal(ore.bar.root.isEnabled(),false);
  game.flashOre(ore);assert.equal(ore.rock.material,ore.material,'zero flash duration disables flash');
  ore.spring=0;ore.amplitude=.4;game.update(.005);
  assert.ok(ore.rock.scaling.y<ore.rest.y*.7);assert.equal(ore.rock.scaling.x,ore.rest.x,'zero stretch preserves width');
  game.burst(new BABYLON.Vector3(0,30,0),false,false);
  assert.equal(game.chips.length,3);assert.ok(game.chips.every(c=>Math.abs(Math.hypot(c.velocity.x,c.velocity.z)-20)<1e-8 && c.velocity.y===40));
  assert.ok(Math.abs(game.chipMaterials[0].emissiveColor.r-0x12/255)<1e-8);
  game.spawnDrop(ore);const drop=game.drops[0];assert.equal(drop.mesh,root);
  game.update(.1);game.update(.2);
  assert.ok(Math.abs(root.scaling.x-ore.restScaling.x*.25)<1e-8,'saved size controls the actual ore');
  assert.equal(game.resources,0,'outside configured pickup radius');
  game.position.x=0;game.update(.01);assert.equal(game.resources,5,'inside configured pickup radius');
  scene.dispose();engine.dispose();
});

test('editor preview uses real strike effects and reacts to unsaved values without changing scene objects', () => {
  const engine=new BABYLON.NullEngine(),scene=new BABYLON.Scene(engine);scene.useRightHandedSystem=true;
  const camera=new BABYLON.TargetCamera('editor camera',new BABYLON.Vector3(100,200,-300),scene);scene.activeCamera=camera;
  camera.getViewMatrix(true);
  const page=loadScripts([],{BABYLON,document:{getElementById:()=>({checked:false})},UI:{get:()=>null},Sound3D:{play(){assert.fail('muted preview must not queue sounds');}},setTimeout});
  const constants=fs.readFileSync(new URL('../js/Constants.js',import.meta.url),'utf8').replace(/^const\s+/gm,'var ');
  vm.runInContext(constants,page.ctx);vm.runInContext(fs.readFileSync(new URL('../js/Game.js',import.meta.url),'utf8'),page.ctx);
  vm.runInContext(fs.readFileSync(new URL('../_utils/editor/impact-preview.js',import.meta.url),'utf8'),page.ctx);
  const objects=[{name:'existing scene object'}];
  const lab={location:{view:{scene,camera},objects},camera:{groundFocus:()=>({x:20,y:30,h:0})}};
  const preview=new (page.get('ImpactPreview'))(lab);
  assert.equal(objects.length,1);assert.equal(preview.root.position.x,20);assert.equal(preview.root.position.z,30);
  page.ctx.MINING_HEALTH=40;page.ctx.MINING_FLASH_DURATION=.5;preview.changed('MINING_HEALTH');
  preview.update(.1);preview.update(.1);
  assert.equal(preview.ore.health,20,'the gameplay strike caused damage');
  assert.equal(preview.ore.bar.textValue,'20/40','preview displays the unsaved health value');
  assert.equal(preview.game.chips.length,7);assert.equal(preview.rock.material,preview.game.flashMaterial);
  page.ctx.MINING_CHIPS=2;page.ctx.MINING_CHIP_COLOR=0x123456;preview.changed('MINING_CHIP_COLOR');
  assert.ok(Math.abs(preview.game.chipMaterials[0].emissiveColor.r-0x12/255)<1e-8,'color updates before saving');
  page.ctx.MINING_SQUASH=.5;page.ctx.MINING_DROP_DISTANCE_FACTOR=.25;preview.update(.5);preview.update(.1);
  assert.equal(preview.ore.depleted,true);assert.equal(preview.game.drops.length,1,'preview launches immediately');
  assert.equal(preview.ore.amplitude,.5,'the next hit uses unsaved compression');
  const drop=preview.game.drops[0], away=drop.center.subtract(camera.globalPosition);
  assert.ok(drop.velocity.x*away.x+drop.velocity.z*away.z>0,'preview launches away from the editor camera');
  assert.ok(Math.abs(Math.hypot(drop.velocity.x,drop.velocity.z)-page.ctx.MINING_DROP_LAUNCH_SPEED*.25)<1e-6,'unsaved distance controls the next preview flight');
  for(let i=0;i<100 && !drop.settled;i++)preview.update(.05);
  assert.equal(drop.settled,true,'preview ore lands before restoring');
  const landed=drop.center.clone();for(let i=0;i<10;i++)preview.update(.1);
  assert.equal(preview.ore.depleted,true);assert.ok(BABYLON.Vector3.Distance(drop.center,landed)<.001,'preview holds the landed ore for inspection');
  for(let i=0;i<30 && preview.ore.depleted;i++)preview.update(.1);
  assert.equal(preview.ore.depleted,false,'cube automatically reappears');
  preview.game.spawnDrop(preview.ore,preview.impactPoint());preview.update(.1);preview.update(.1);
  lab.camera.groundFocus=()=>({x:220,y:130,h:0});preview.placeAtFocus();
  assert.equal(preview.root.isDisposed(),false,'moving a preview in flight does not dispose the ore');
  assert.equal(preview.root.position.x,220);assert.equal(preview.root.position.z,130);assert.equal(preview.game.drops.length,0);
  preview.setEnabled(false);assert.equal(preview.root.isEnabled(),false);assert.equal(preview.game.chips.length,0);
  preview.setEnabled(true);assert.equal(preview.root.isEnabled(),true);
  preview.dispose();assert.equal(objects.length,1,'preview was never registered with the scene');
  scene.dispose();engine.dispose();
});

test('health numbers fit inside the wider bar and face the camera above its fill', () => {
  const engine=new BABYLON.NullEngine(),scene=new BABYLON.Scene(engine);scene.useRightHandedSystem=true;
  const page=loadScripts(['js/Constants.js','js/Game.js'],{BABYLON});
  const camera=new BABYLON.TargetCamera('health-test-camera',new BABYLON.Vector3(0,150,-400),scene);scene.activeCamera=camera;
  const cube=BABYLON.MeshBuilder.CreateBox('ore',{size:160},scene);cube.position.y=80;
  const game=Object.create(page.get('Game').prototype);game.scene=scene;
  const ore={collider:cube,health:120,depleted:false},bar=game.makeHealthBar(ore);ore.bar=bar;game.updateHealthBar(ore);
  assert.ok(bar.width>160,'bar is wider than the ore');
  assert.ok(bar.labelBack.scaling.x<=bar.width && bar.labelBack.scaling.y<=bar.height);
  for(const p of [new BABYLON.Vector3(0,150,-400),new BABYLON.Vector3(400,150,0),new BABYLON.Vector3(0,150,400)]) {
    camera.position.copyFrom(p);camera.setTarget(bar.root.position);scene.render();
    const distance=mesh=>BABYLON.Vector3.Distance(mesh.getAbsolutePosition(),camera.globalPosition);
    assert.ok(distance(bar.text)<distance(bar.labelBack),'numerals face the camera in front of their background');
    assert.ok(distance(bar.labelBack)<distance(bar.fill),'number background is in front of the fill');
  }
  scene.dispose();engine.dispose();
});
