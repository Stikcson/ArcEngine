import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';

function fixture() {
    return loadScripts(['libs/simplex-noise.js', 'js/Game.js'], {
        CAMERA_SHAKE_ENABLED: 1, CAMERA_SHAKE_STRENGTH: 1.2, CAMERA_SHAKE_DURATION: 0.4,
        CAMERA_SHAKE_FREQUENCY: 12, CAMERA_SHAKE_WEAK_MULTIPLIER: 1.3,
        CAMERA_SHAKE_BREAK_MULTIPLIER: 1.5, MINING_DAMAGE: 20, MINING_WEAK_MULTIPLIER: 3,
        MINING_SQUASH: 0.08, MINING_WEAK_SQUASH: 1.5, MINING_YIELD: 5,
        MINING_MOUSE_SENSITIVITY: 0.00175, MINING_SOUND_VOLUME: 0.5,
        MINING_SOUND_NORMAL: 1, MINING_SOUND_WEAK: 1, MINING_SOUND_BREAK: 1, Sound3D: { play() {} }
    });
}

test('impact shake decays in seconds, is bounded, repeatable and returns to rest', () => {
    const page = fixture(), Shake = page.get('ImpactCameraShake');
    const a = new Shake(), b = new Shake();
    a.add(0.65); b.add(0.65);
    let x, y;
    for (let i = 0; i < 6; i++) x = a.sample(1 / 60);
    for (let i = 0; i < 12; i++) y = b.sample(1 / 120);
    for (const axis of ['x', 'y', 'z']) {
        assert.ok(Math.abs(x[axis] - y[axis]) < 1e-10, 'sampling does not depend on frame rate');
        assert.ok(Math.abs(x[axis]) <= 1.2 * Math.PI / 180, 'angular offset is bounded');
    }
    a.add(10); assert.equal(a.trauma, 1, 'overlapping impacts are capped');
    a.sample(0.4); const rest = a.sample(0);
    assert.equal(a.trauma, 0);
    for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(rest[axis]) < 1e-12);
    a.add(1); page.ctx.CAMERA_SHAKE_ENABLED = 0;
    const disabled = a.sample(0.01);
    assert.equal(a.trauma, 0);
    for (const axis of ['x', 'y', 'z']) assert.equal(disabled[axis], 0);
});

test('only a real ore hit triggers shake, with separate weak and break strengths', () => {
    const page = fixture(), game = Object.create(page.get('Game').prototype), amounts = [];
    Object.assign(game, { cameraShake: { add: n => amounts.push(n) }, resources: 0,
        burst() {}, say() {}, flashOre() {}, beginBreak(ore) { ore.depleted=true; }, isWeak: () => false });
    game.pick = () => null;
    assert.equal(game.strike({}), false);
    game.pick = () => ({ entry: { ore: null } });
    assert.equal(game.strike({}), false);
    assert.deepEqual(amounts, []);
    const ore = { health: 120, rec: { mesh: { setEnabled() {} } } };
    game.pick = () => ({ entry: { ore }, hit: { pickedPoint: {} } });
    assert.equal(game.strike({}), true);
    game.isWeak = () => true;
    assert.equal(game.strike({}), true);
    ore.health = 20;
    assert.equal(game.strike({}), true);
    assert.equal(amounts.length, 3);
    assert.ok(Math.abs(amounts[0] - 0.65) < 1e-9);
    assert.ok(Math.abs(amounts[1] - 0.65 * 1.3) < 1e-9);
    assert.ok(Math.abs(amounts[2] - 0.65 * 1.5) < 1e-9);
    assert.equal(game.resources, 0, 'resources are awarded on pickup');
});

test('Babylon player camera preserves base pose and restores the aim after an impact', () => {
    const context = { console, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, DataView, Blob, URL, setTimeout, clearTimeout, performance };
    context.globalThis = context; context.window = context;
    context.addEventListener = () => {}; context.removeEventListener = () => {};
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(new URL('../libs/babylon.js', import.meta.url), 'utf8'), context);
    const B = context.BABYLON, page = fixture();
    const engine = new B.NullEngine(), scene = new B.Scene(engine);
    const game = Object.create(page.get('Game').prototype);
    Object.assign(game, { cam: new B.TargetCamera('player', B.Vector3.Zero(), scene),
        position: new B.Vector3(10, 20, 30), pitch: 0.2, yaw: 0.4,
        cameraShake: new (page.get('ImpactCameraShake'))() });
    game.cameraShake.add(1); game.updateCamera(1 / 60);
    assert.ok(Math.abs(game.cam.rotation.x - 0.2) + Math.abs(game.cam.rotation.y - (0.4 + Math.PI)) > 1e-8);
    game.yaw += 0.3; game.pitch -= 0.1;
    for (let i = 0; i < 60; i++) game.updateCamera(1 / 60);
    assert.ok(Math.abs(game.cam.rotation.x - game.pitch) < 1e-12);
    assert.ok(Math.abs(game.cam.rotation.y - (game.yaw + Math.PI)) < 1e-12);
    assert.ok(Math.abs(game.cam.rotation.z) < 1e-12);
    assert.deepEqual(Array.from(game.cam.position.asArray()), [10, 20, 30]);
    scene.dispose(); engine.dispose();
});

test('view matrix and world up recover after rendered recoil with no mouse input', () => {
    const context = { console, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, DataView, Blob, URL, setTimeout, clearTimeout, performance };
    context.globalThis = context; context.window = context;
    context.addEventListener = () => {}; context.removeEventListener = () => {};
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(new URL('../libs/babylon.js', import.meta.url), 'utf8'), context);
    const B = context.BABYLON, page = fixture();
    const engine = new B.NullEngine(), scene = new B.Scene(engine);
    scene.useRightHandedSystem = true;
    const game = Object.create(page.get('Game').prototype);
    Object.assign(game, { cam: new B.TargetCamera('player', B.Vector3.Zero(), scene),
        position: new B.Vector3(10, 20, 30), pitch: -0.55, yaw: 0.6,
        cameraShake: new (page.get('ImpactCameraShake'))() });
    scene.activeCamera = game.cam;
    game.updateCamera(0); scene.render();
    const before = Array.from(game.cam.getViewMatrix().m);
    game.cameraShake.add(1);
    for (let i = 0; i < 90; i++) { game.updateCamera(1 / 60); game.cam.getForwardRay(); scene.render(); }
    const after = Array.from(game.cam.getViewMatrix().m);
    for (let i = 0; i < before.length; i++) assert.ok(Math.abs(before[i] - after[i]) < 1e-6, `view matrix differs at ${i}: ${before[i]} -> ${after[i]}`);
    scene.dispose(); engine.dispose();
});

test('movement and repeated swings retain the Babylon camera heading after shake', () => {
    const context = { console, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, DataView, Blob, URL, setTimeout, clearTimeout, performance };
    context.globalThis = context; context.window = context;
    context.addEventListener = () => {}; context.removeEventListener = () => {};
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(new URL('../libs/babylon.js', import.meta.url), 'utf8'), context);
    const B = context.BABYLON, canvas = {}, document = { pointerLockElement: canvas };
    const page = loadScripts(['libs/simplex-noise.js', 'js/Constants.js', 'js/Game.js'], { BABYLON: B, document, UI: { get: () => null } });
    const engine = new B.NullEngine(), scene = new B.Scene(engine); scene.useRightHandedSystem = true;
    const game = Object.create(page.get('Game').prototype);
    Object.assign(game, { scene, cam: new B.TargetCamera('player', B.Vector3.Zero(), scene),
        position: new B.Vector3(1024, 160, 774), pitch: -0.1745, yaw: 0,
        cameraShake: new (page.get('ImpactCameraShake'))(),
        keys: new Set(['KeyW']), canvas, ores: [], chips: [], drops: [], colliders: [], hudCache: {},
        elapsed: 0, nextSwing: 0, contact: -1, swingTime: -10, held: true,
        tool: { rotation: new B.Vector3() }, pick: () => null,
        strike: () => { game.cameraShake.add(0.65); return true; } });
    scene.activeCamera = game.cam;
    game.updateCamera(); scene.render();
    const initialDirection = game.cam.getForwardRay().direction.clone();
    for (let i = 0; i < 90; i++) { game.update(1 / 60); scene.render(); }
    assert.ok(game.position.z > 1000, 'player moves while holding the swing');
    game.held = false; game.keys.clear();
    for (let i = 0; i < 60; i++) { game.update(1 / 60); scene.render(); }
    const finalDirection = game.cam.getForwardRay().direction;
    assert.ok(B.Vector3.Distance(initialDirection, finalDirection) < 1e-6, 'camera returns to original direction');
    assert.ok(Math.abs(game.cam.rotation.z) < 1e-12, 'no roll remains');
    assert.ok(B.Vector3.Distance(game.position, game.cam.position) < 1e-9, 'camera stays with player');
    scene.dispose(); engine.dispose();
});

test('look orientation stays upright after recoil and subsequent mouse movements', () => {
    const context = { console, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, DataView, Blob, URL, setTimeout, clearTimeout, performance };
    context.globalThis=context; context.window=context; context.addEventListener=()=>{}; context.removeEventListener=()=>{};
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(new URL('../libs/babylon.js', import.meta.url), 'utf8'), context);
    const B=context.BABYLON, page=fixture(), engine=new B.NullEngine(), scene=new B.Scene(engine);
    scene.useRightHandedSystem=true;
    const cam=new B.TargetCamera('player',B.Vector3.Zero(),scene), reference=new B.TargetCamera('reference',B.Vector3.Zero(),scene);
    const game=Object.create(page.get('Game').prototype);
    Object.assign(game,{cam,position:new B.Vector3(10,20,30),pitch:-0.9,yaw:0.4,cameraShake:new (page.get('ImpactCameraShake'))()});
    scene.activeCamera=cam;game.cameraShake.add(1);
    for(let i=0;i<90;i++){game.updateCamera(1/60);scene.render();}
    for(const [pitch,yaw] of [[-1.3,0.4],[-1.3,2.2],[-1.3,3.5],[1.2,3.5],[0,5.0]]) {
        game.pitch=pitch;game.yaw=yaw;game.updateCamera(1/60);scene.render();
        reference.position.copyFrom(game.position);reference.rotation.set(pitch,yaw+Math.PI,0);
        const actual=cam.getDirection(B.Axis.Y), expected=reference.getDirection(B.Axis.Y);
        assert.ok(B.Vector3.Dot(actual,expected)>0.999, `up vectors diverged at ${pitch}, ${yaw}: ${B.Vector3.Dot(actual,expected)}`);
        const forward=cam.getForwardRay().direction.clone(), right=cam.getDirection(B.Axis.X);
        game.look(4,0);game.updateCamera(1/60);scene.render();
        assert.ok(B.Vector3.Dot(cam.getForwardRay().direction.subtract(forward),right)>0,'mouse right looks right');
        const forwardBeforeUp=cam.getForwardRay().direction.clone(), up=cam.getDirection(B.Axis.Y);
        game.look(0,-4);game.updateCamera(1/60);scene.render();
        assert.ok(B.Vector3.Dot(cam.getForwardRay().direction.subtract(forwardBeforeUp),up)>0,'mouse up looks up');
    }
    scene.dispose();engine.dispose();
});
