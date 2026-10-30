/*
 * Camera shake adapted from screen-shake by Simon Lagos (MIT),
 * github.com/sajmoni/screen-shake. Uses ArcEngine's bundled simplex-noise;
 * the decay is measured in seconds and output is an absolute 3D rotation offset.
 *
 * MIT License
 * Copyright (c) 2020 Simon Lagos
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
class ImpactCameraShake {
    constructor() {
        this.noiseX = new SimplexNoise('impact-shake-x');
        this.noiseY = new SimplexNoise('impact-shake-y');
        this.noiseZ = new SimplexNoise('impact-shake-z');
        this.trauma = 0;
        this.time = 0;
    }
    add(amount) { this.trauma = Math.min(1, this.trauma + Math.max(0, amount)); }
    clear() { this.trauma = 0; }
    sample(dt) {
        if (!CAMERA_SHAKE_ENABLED) { this.clear(); return { x: 0, y: 0, z: 0 }; }
        const elapsed = Math.max(0, dt);
        this.time += elapsed * Math.max(0, CAMERA_SHAKE_FREQUENCY);
        this.trauma = Math.max(0, this.trauma - elapsed / Math.max(0.05, CAMERA_SHAKE_DURATION));
        const strength = this.trauma * this.trauma * Math.max(0, CAMERA_SHAKE_STRENGTH) * Math.PI / 180;
        const result = {
            x: strength * this.noiseX.noise2D(this.time, 1),
            y: strength * this.noiseY.noise2D(this.time, 1),
            z: strength * 0.25 * this.noiseZ.noise2D(this.time, 1)
        };
        return result;
    }
}

// Mining prototype: state and picking are independent of the animated visual mesh.
class Game {
    static color(value) { return new BABYLON.Color3(((value >> 16)&255)/255,((value >> 8)&255)/255,(value&255)/255); }
    /** @param {{ location: Location3D, camera: CameraController }} app @param {any} [player] */
    constructor(app, player) {
        this.app = app; this.scene = app.location.view.scene; this.cam = app.location.view.camera;
        this.playerSettings = PlayerAvatar.settings(player);
        const s = this.playerSettings;
        this.cam.minZ = 6; this.cam.fov = s.fov * Math.PI / 180;
        this.position = new BABYLON.Vector3(s.spawnX,s.spawnY+s.eyeHeight,s.spawnZ);
        this.yaw = s.startYaw * Math.PI / 180; this.pitch = s.startPitch * Math.PI / 180; this.keys = new Set(); this.held = false;
        this.elapsed = 0; this.nextSwing = 0; this.contact = -1; this.swingTime = -10;
        this.placedCameras = [];
        this.resources = 0; this.lastDamage = 0; this.lastWeak = false; this.feedbackUntil = 0;
        this.silentImpact = false;
        /** @type {(() => BABYLON.Vector3) | null} */ this.dropSource = null;
        this.hudCache = {};
        this.cameraShake = new ImpactCameraShake();
        /** @type {any[]} */ this.ores = []; /** @type {any[]} */ this.colliders = []; /** @type {any[]} */ this.chips = []; /** @type {any[]} */ this.drops = [];
        this.canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('world3d'));
        this.avatar = new PlayerAvatar(app.location, {showBody:false,settings:s});
        this.avatar.update(this.position, 0);
        this.makeTool(); this.updateCamera();
        this.canvas.addEventListener('mousedown', e => { if (e.button !== 0) return; if (document.pointerLockElement !== this.canvas) this.captureMouse(); else this.held = true; });
        window.addEventListener('mouseup', e => { if (e.button === 0) this.held = false; });
        document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== this.canvas) { this.held = false; this.keys.clear(); } });
        window.addEventListener('blur', () => { this.held = false; this.keys.clear(); });
        window.addEventListener('mousemove', e => { if (document.pointerLockElement === this.canvas) this.look(e.movementX, e.movementY); });
        window.addEventListener('keydown', e => { if (e.code === 'KeyR' && !e.repeat) this.reset(); if (e.code === 'KeyC' && !e.repeat && document.pointerLockElement === this.canvas) this.placeCamera(); this.keys.add(e.code); });
        window.addEventListener('keyup', e => this.keys.delete(e.code));
        app.location.ready.then(() => this.prepareScene());
    }
    prepareScene() {
        for (const rec of this.app.location.findByTag('ore')) {
            if (!rec.mesh) continue;
            const rock = rec.mesh.getChildMeshes(false).find(m => m.name === 'Rock' || m.name.endsWith('/Rock'));
            if (!rock) { console.error('Mining: missing Rock mesh', rec.def.name); continue; }
            const seam = rec.mesh.getChildMeshes(false).find(m => m.name === 'Seam' || m.name.endsWith('/Seam'));
            if (seam && seam.material) {
                const marker = /** @type {BABYLON.StandardMaterial} */ (seam.material);
                marker.emissiveColor = new BABYLON.Color3(.35,.09,0);
            }
            const collider = rock.clone('ore-collider', rock.parent); collider.isVisible = false; collider.isPickable = false;
            const ore = { rec, rock, collider, health: MINING_HEALTH, spring: 10, amplitude: 0, rest: rock.scaling.clone(),
                restPosition:rec.mesh.position.clone(), restScaling:rec.mesh.scaling.clone(), restRotation:rec.mesh.rotation.clone(),
                restQuaternion:rec.mesh.rotationQuaternion ? rec.mesh.rotationQuaternion.clone() : null,
                depleted: false, material: rock.material, bar: null };
            ore.bar = this.makeHealthBar(ore);
            this.ores.push(ore); this.colliders.push({ mesh: collider, ore });
        }
        for (const rec of this.app.location.findByTag('wall')) if (rec.mesh) {
            for (const mesh of rec.mesh.getChildMeshes(false)) if (mesh.getTotalVertices()) this.colliders.push({ mesh, ore: null });
        }
        this.reset();
    }
    makeHealthBar(ore) {
        ore.collider.computeWorldMatrix(true);
        const b=ore.collider.getBoundingInfo().boundingBox;
        const center=b.centerWorld, width=Math.max(20,Math.max(50,Math.min(180,b.maximumWorld.x-b.minimumWorld.x))*Math.max(.1,MINING_BAR_WIDTH));
        const height=Math.max(4,MINING_BAR_HEIGHT), border=Math.min(2,height*.2);
        const root=new BABYLON.TransformNode('ore health',this.scene);
        root.position.set(center.x,b.maximumWorld.y+MINING_BAR_OFFSET,center.z);
        root.billboardMode=BABYLON.Mesh.BILLBOARDMODE_ALL;
        const material=(name,color)=>{const m=new BABYLON.StandardMaterial(name,this.scene);m.disableLighting=true;m.emissiveColor=color;m.backFaceCulling=false;return m;};
        const back=BABYLON.MeshBuilder.CreatePlane('ore health background',{width,height},this.scene);
        back.parent=root;back.material=material('ore health dark',new BABYLON.Color3(.05,.06,.07));back.isPickable=false;
        const fill=BABYLON.MeshBuilder.CreatePlane('ore health fill',{width:width-border*2,height:height-border*2},this.scene);
        fill.parent=root;fill.position.z=-.15;fill.material=material('ore health light',Game.color(MINING_BAR_COLOR));fill.isPickable=false;
        const labelBack=BABYLON.MeshBuilder.CreatePlane('ore health number background',{size:1},this.scene);
        labelBack.parent=root;labelBack.position.z=-.3;labelBack.material=material('ore health number dark',new BABYLON.Color3(.04,.05,.06));labelBack.isPickable=false;
        const text=new BABYLON.Mesh('ore health numbers',this.scene);
        text.parent=root;text.position.z=-.45;text.material=material('ore health number white',BABYLON.Color3.White());text.isPickable=false;
        return {root,fill,labelBack,text,width:width-border*2,height,textValue:null};
    }
    // Small 3D pixel glyphs stay crisp without a canvas texture or a font dependency.
    updateHealthNumbers(bar, current, maximum) {
        const value=Math.max(0,Math.ceil(current))+'/'+Math.max(0,Math.ceil(maximum));
        if(bar.textValue===value)return;
        const glyphs={
            '0':['111','101','101','101','111'], '1':['010','110','010','010','111'],
            '2':['111','001','111','100','111'], '3':['111','001','111','001','111'],
            '4':['101','101','111','001','001'], '5':['111','100','111','001','111'],
            '6':['111','100','111','101','111'], '7':['111','001','001','001','001'],
            '8':['111','101','111','101','111'], '9':['111','101','111','001','111'],
            '/':['001','001','010','100','100']
        };
        const columns=value.length*4-1;
        const cell=Math.max(.01,Math.min(Math.max(.1,bar.height-6)/5,Math.max(.1,bar.width-8)/columns));
        const textWidth=columns*cell, positions=[], indices=[], normals=[];
        for(let i=0;i<value.length;i++) {
            const glyph=glyphs[value[i]];
            if(!glyph)continue;
            for(let row=0;row<5;row++)for(let col=0;col<3;col++)if(glyph[row][col]==='1') {
                const x=-textWidth/2+(i*4+col)*cell, y=(2.5-row)*cell;
                const base=positions.length/3;
                positions.push(x,y,0,x+cell,y,0,x+cell,y-cell,0,x,y-cell,0);
                indices.push(base,base+1,base+2,base,base+2,base+3);
                for(let j=0;j<4;j++)normals.push(0,0,-1);
            }
        }
        const data=new BABYLON.VertexData();data.positions=positions;data.indices=indices;data.normals=normals;data.applyToMesh(bar.text,true);
        bar.labelBack.scaling.set(Math.min(bar.width,textWidth+cell*2),Math.min(bar.height,cell*6),1);
        bar.textValue=value;
    }
    updateHealthBar(ore) {
        if (!ore.bar) return;
        const ratio=Math.max(0,Math.min(1,ore.health/Math.max(1,MINING_HEALTH)));
        ore.bar.fill.scaling.x=ratio;
        ore.bar.fill.position.x=-(1-ratio)*ore.bar.width/2;
        this.updateHealthNumbers(ore.bar,ore.health,MINING_HEALTH);
        ore.bar.root.setEnabled(!!MINING_BAR_ENABLED && !ore.depleted);
    }
    flashOre(ore) {
        if (MINING_FLASH_DURATION<=0) { ore.rock.material=ore.material;return; }
        if (!this.flashMaterial) { this.flashMaterial=new BABYLON.StandardMaterial('ore impact flash',this.scene);this.flashMaterial.disableLighting=true;this.flashMaterial.emissiveColor=Game.color(MINING_FLASH_COLOR); }
        ore.rock.material=this.flashMaterial;
    }
    groundAt(point) {
        const ray=new BABYLON.Ray(new BABYLON.Vector3(point.x,point.y+100,point.z),new BABYLON.Vector3(0,-1,0),3000);
        let ground=null;
        for (const entry of this.colliders) if (!entry.ore) {
            entry.mesh.computeWorldMatrix(true);
            const hit=ray.intersectsMesh(entry.mesh,false);
            if (hit && hit.hit && hit.pickedPoint && (ground===null || hit.pickedPoint.y>ground)) ground=hit.pickedPoint.y;
        }
        return ground===null ? 0 : ground;
    }
    spawnDrop(ore, hitPoint) {
        ore.collider.computeWorldMatrix(true);
        const b=ore.collider.getBoundingInfo().boundingBox, pos=b.centerWorld.clone();
        const ground=this.groundAt(pos), half=Math.max(.01,(b.maximumWorld.y-b.minimumWorld.y)/2);
        const mesh=ore.rec.mesh;
        const origin=(this.dropSource && this.dropSource()) || this.position || hitPoint || pos;
        const direction=new BABYLON.Vector3(pos.x-origin.x,0,pos.z-origin.z);
        if(direction.lengthSquared()<0.0001 && hitPoint)direction.set(pos.x-hitPoint.x,0,pos.z-hitPoint.z);
        if(direction.lengthSquared()<0.0001)direction.z=1;
        direction.normalize();
        const distanceFactor=Math.max(0,Math.min(3,MINING_DROP_DISTANCE_FACTOR));
        const velocity=direction.scale(Math.max(0,MINING_DROP_LAUNCH_SPEED)*distanceFactor);velocity.y=Math.max(0,MINING_DROP_LAUNCH_LIFT);
        this.drops.push({mesh,ore,center:pos,ground,half,baseHalf:half,velocity,age:0,compression:ore.depleted?ore.amplitude:0,settled:false,settleAge:0});
    }
    setOreSquash(ore, amount) {
        const sy=1-amount, side=1+(1/Math.sqrt(sy)-1)*Math.max(0,MINING_SQUASH_SPREAD);
        ore.rock.scaling.set(ore.rest.x*side,ore.rest.y*sy,ore.rest.z*side);
    }
    beginBreak(ore, point) {
        ore.depleted=true;
        this.setOreSquash(ore,ore.amplitude);
        this.spawnDrop(ore,point);
    }
    makeTool() {
        const scene = this.scene;
        this.tool = new BABYLON.TransformNode('pickaxe pivot', scene); this.tool.parent = this.cam;
        this.tool.position.set(45,-34,-78); this.tool.rotation.set(-.31,0,-.35);
        this.prototypeTexture = new BABYLON.Texture('assets/mining-textures/texture_07.png',scene,false,false,BABYLON.Texture.NEAREST_SAMPLINGMODE);
        const surface = new BABYLON.StandardMaterial('pick prototype surface',scene);
        surface.diffuseTexture = this.prototypeTexture;
        const piece = (name, w,h,d,x,y,angle,mat) => { const m=BABYLON.MeshBuilder.CreateBox(name,{width:w,height:h,depth:d},scene); m.parent=this.tool; m.position.set(x,y,0);m.rotation.z=angle;m.material=mat;m.isPickable=false; };
        piece('handle',5,58,5,0,0,0,surface); piece('head',48,7,9,-7,23,.17,surface);piece('tip',14,5,7,-34,18,.7,surface);
    }
    updateCamera(dt = 0) {
        // The right-handed camera looks along local -Z. Set the pose directly:
        // setTarget() reconstructs Euler angles and can alter camera.position.
        // Babylon otherwise retains the rotated up vector after roll shake stops,
        // so a later mouse turn can tilt or invert the view.
        this.cam.updateUpVectorFromRotation = true;
        this.cam.position.copyFrom(this.position);
        const shake = this.cameraShake ? this.cameraShake.sample(dt) : { x: 0, y: 0, z: 0 };
        this.cam.rotation.set(this.pitch + shake.x, this.yaw + Math.PI + shake.y, shake.z);
    }
    async captureMouse() {
        try {
            // Prefer unaccelerated deltas; old browsers may ignore the option.
            await this.canvas.requestPointerLock({unadjustedMovement:true});
        } catch (error) {
            if (error && (error.name === 'NotSupportedError' || error.name === 'TypeError')) {
                try { await this.canvas.requestPointerLock(); return; }
                catch (fallbackError) { console.warn('Mouse capture failed', fallbackError); }
            } else console.warn('Mouse capture failed', error);
            this.say('Mouse capture failed. Click the game again to retry.');
        }
    }
    look(dx, dy) {
        const sensitivity = this.playerSettings ? this.playerSettings.mouseSensitivity : MINING_MOUSE_SENSITIVITY;
        this.yaw -= dx * sensitivity;
        this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch - dy * sensitivity));
    }
    move(dt) {
        if (document.pointerLockElement !== this.canvas) return;
        let x=(this.keys.has('KeyD')?1:0)-(this.keys.has('KeyA')?1:0), z=(this.keys.has('KeyW')?1:0)-(this.keys.has('KeyS')?1:0);
        const n=Math.hypot(x,z); if (!n) return; x/=n;z/=n;
        const speed=this.playerSettings ? this.playerSettings.moveSpeed : MINING_MOVE_SPEED;
        const nx=this.position.x+(-x*Math.cos(this.yaw)+z*Math.sin(this.yaw))*speed*dt;
        const nz=this.position.z+(x*Math.sin(this.yaw)+z*Math.cos(this.yaw))*speed*dt;
        // Keep the player in the chamber and prevent walking through a live deposit.
        const clear=(xx,zz)=>xx>154 && xx<1894 && zz>354 && zz<1994 && !this.ores.some(o=>!o.depleted && Math.hypot(xx-o.rec.mesh.position.x,zz-o.rec.mesh.position.z)<100);
        if (clear(nx,this.position.z)) this.position.x=nx; if (clear(this.position.x,nz)) this.position.z=nz;
    }
    // A prototype camera is placed on the floor in front of the player, facing their heading.
    placeCamera() {
        if(this.placedCameras.length>=32) { this.say('CAMERA LIMIT REACHED'); return; }
        const forward=new BABYLON.Vector3(Math.sin(this.yaw),0,Math.cos(this.yaw));
        const at=this.position.add(forward.scale(180));
        // A wall or an ore deposit must not allow placement through it.
        const ray=new BABYLON.Ray(this.position,forward,180);
        if(this.pick(ray)) { this.say('NO ROOM FOR CAMERA'); return; }
        if(at.x<=154 || at.x>=1894 || at.z<=354 || at.z>=1994) { this.say('NO ROOM FOR CAMERA'); return; }
        const ground=this.groundAt(at), terrain=this.app.location.terrainEnabled && this.app.location.terrain ? this.app.location.terrain.heightAt(at.x,at.z) : 0;
        const rec=this.app.location.addObject({name:'Surveillance camera',model:Surveillance.MODEL,kind:'prop',x:at.x,y:at.z,h:ground-terrain,
            rot:[0,Math.atan2(forward.z,forward.x)*180/Math.PI,0],scale:[1,1,1],sensor:Surveillance.defaults()});
        this.placedCameras.push(rec);this.say('CAMERA PLACED');
    }
    pick(ray) {
        let best=null;
        for (const entry of this.colliders) {
            if (entry.ore && entry.ore.depleted) continue;
            entry.mesh.computeWorldMatrix(true);
            const hit=ray.intersectsMesh(entry.mesh,false);
            if (hit && hit.hit && hit.distance <= MINING_REACH && (!best || hit.distance<best.hit.distance)) best={entry,hit};
        }
        return best;
    }
    isWeak(ore, point) {
        // Anchor remains fixed while only the visual rock squashes.
        const local = new BABYLON.Vector3(.35,.95,-.815);
        ore.collider.computeWorldMatrix(true);
        const anchor=BABYLON.Vector3.TransformCoordinates(local,ore.collider.getWorldMatrix());
        return BABYLON.Vector3.Distance(point,anchor)<=MINING_WEAK_RADIUS;
    }
    strike(ray) {
        const picked=this.pick(ray); this.lastDamage=0;this.lastWeak=false;
        if (!picked || !picked.entry.ore) { this.say(picked?'Blocked - no ore hit':'Miss - get closer and aim at the rock'); return false; }
        const ore=picked.entry.ore, point=picked.hit.pickedPoint, weak=this.isWeak(ore,point);
        const damage=MINING_DAMAGE*(weak?MINING_WEAK_MULTIPLIER:1); ore.health=Math.max(0,ore.health-damage);
        ore.spring=0;ore.amplitude=Math.max(0,Math.min(.8,MINING_SQUASH*(weak?MINING_WEAK_SQUASH:1)));
        this.flashOre(ore);
        this.lastDamage=damage;this.lastWeak=weak;
        const broken=ore.health<=0;
        if (broken) this.beginBreak(ore,point);
        this.updateHealthBar(ore);
        if (this.cameraShake && CAMERA_SHAKE_ENABLED) {
            const multiplier = broken ? CAMERA_SHAKE_BREAK_MULTIPLIER : weak ? CAMERA_SHAKE_WEAK_MULTIPLIER : 1;
            this.cameraShake.add(0.65 * Math.max(0, multiplier));
        }
        this.say(broken?'DEPOSIT BROKEN  —  PICK UP IRON':weak?'WEAK POINT  -'+damage:'SOLID HIT  -'+damage);
        this.burst(point, weak, broken);
        const soundScale=broken?MINING_SOUND_BREAK:weak?MINING_SOUND_WEAK:MINING_SOUND_NORMAL;
        if (!this.silentImpact) Sound3D.play(broken?'assets/sounds/mining-break.wav':weak?'assets/sounds/mining-weak.wav':'assets/sounds/mining-normal.wav',{volume:Math.max(0,Math.min(1,MINING_SOUND_VOLUME*Math.max(0,soundScale)))});
        return true;
    }
    burst(point, weak, broken) {
        if (!this.chipMaterials) {
            this.chipMaterials=[new BABYLON.StandardMaterial('chip pale',this.scene),new BABYLON.StandardMaterial('chip amber',this.scene)];
            for(const mat of this.chipMaterials){mat.disableLighting=true;mat.backFaceCulling=false;}
            this.chipMaterials[0].emissiveColor=Game.color(MINING_CHIP_COLOR);this.chipMaterials[1].emissiveColor=Game.color(MINING_CHIP_WEAK_COLOR);
        }
        const mat=this.chipMaterials[weak?1:0], ground=this.groundAt(point);
        const count=Math.max(0,Math.min(120,Math.round(MINING_CHIPS+(broken?MINING_CHIP_BREAK_EXTRA:0))));
        for(let i=0;i<count;i++) {
            if(this.chips.length>=120){const old=this.chips.shift();old.mesh.dispose();}
            const mesh=BABYLON.MeshBuilder.CreatePlane('chip',{size:Math.max(.1,MINING_CHIP_SIZE+Math.random()*Math.max(0,MINING_CHIP_SIZE_VARIATION))},this.scene);mesh.material=mat;mesh.position.copyFrom(point);mesh.isPickable=false;mesh.billboardMode=BABYLON.Mesh.BILLBOARDMODE_ALL;
            const angle=(i+Math.random())*Math.PI*2/count, speed=Math.max(0,MINING_CHIP_SPEED)+Math.random()*Math.max(0,MINING_CHIP_SPEED_VARIATION);
            this.chips.push({mesh,velocity:new BABYLON.Vector3(Math.cos(angle)*speed,Math.max(0,MINING_CHIP_LIFT)+Math.random()*Math.max(0,MINING_CHIP_LIFT_VARIATION),Math.sin(angle)*speed),ground,age:0});
        }
    }
    say(s) { const el=UI.get('feedback');if(el)el.setText(s);this.feedbackUntil=this.elapsed+1.1; }
    hud(id, method, value) {
        const el=UI.get(id); if(!el) return;
        const key=id+':'+method, old=this.hudCache[key];
        if(old && old.el===el && old.value===value) return;
        el[method](value); this.hudCache[key]={el,value};
    }
    reset() {
        this.resources=0;this.lastDamage=0;this.lastWeak=false;this.contact=-1;this.nextSwing=0;
        if (this.cameraShake) this.cameraShake.clear();
        for (const c of this.chips) c.mesh.dispose(); this.chips=[];
        this.drops=[];
        for (const o of this.ores) {
            o.health=MINING_HEALTH;o.depleted=false;o.spring=10;
            o.rock.scaling.copyFrom(o.rest);o.rock.material=o.material;
            o.rec.mesh.position.copyFrom(o.restPosition);o.rec.mesh.scaling.copyFrom(o.restScaling);o.rec.mesh.rotation.copyFrom(o.restRotation);
            o.rec.mesh.rotationQuaternion=o.restQuaternion ? o.restQuaternion.clone() : null;
            o.rec.mesh.setEnabled(true);this.updateHealthBar(o);
        }
        for (const rec of this.placedCameras || []) this.app.location.removeObject(rec); this.placedCameras=[];
        this.say('Deposits restored. Aim at the amber seam for bonus damage.');
    }
    update(dt) {
        this.elapsed+=dt;this.move(dt);this.updateCamera(dt);if(this.avatar)this.avatar.update(this.position, dt);
        if (this.held && this.elapsed>=this.nextSwing) {
            const interval=Math.max(.12,MINING_SWING_INTERVAL);
            this.swingTime=this.elapsed;this.nextSwing=this.elapsed+interval;
            this.contact=this.elapsed+Math.max(0,Math.min(MINING_CONTACT_DELAY,interval*.8));
        }
        if (this.contact>=0 && this.elapsed>=this.contact) { this.contact=-1;this.strike(this.cam.getForwardRay(MINING_REACH)); }
        const t=this.elapsed-this.swingTime, motion=(t<.09?-.3*Math.sin(Math.max(0,t)/.09*Math.PI*.5):Math.pow(Math.max(0,1-(t-.09)/Math.max(.01,MINING_SWING_RECOVERY)),2))*Math.max(0,MINING_SWING_STRENGTH);
        this.tool.rotation.x=-.31+1.13*motion;this.tool.rotation.y=-.38*motion;this.tool.rotation.z=-.35-.26*motion;
        this.updateImpactEffects(dt);
        const hit=this.pick(this.cam.getForwardRay(MINING_REACH)), ore=hit && hit.entry.ore;
        this.hud('target','show',false);this.hud('health','show',false);
        this.hud('crosshair','setText',ore && this.isWeak(ore,hit.hit.pickedPoint)?'◇':'+');
        this.hud('resources','setText','IRON  '+this.resources);
    }
    // Shared by gameplay and the editor's transient impact preview.
    updateImpactEffects(dt) {
        for (const o of this.ores) {
            o.spring+=dt;const u=Math.min(1,o.spring/Math.max(.01,MINING_SQUASH_DURATION));
            if(!o.depleted) {
                const a=o.amplitude*Math.exp(-Math.max(0,MINING_SQUASH_DECAY)*u)*Math.cos(Math.max(0,MINING_SQUASH_OSCILLATIONS)*u)*(1-u);
                this.setOreSquash(o,a);
            }
            if(o.spring>=Math.max(0,MINING_FLASH_DURATION) && o.rock.material===this.flashMaterial)o.rock.material=o.material;
        }
        for (const c of this.chips) {
            c.age+=dt;
            let remaining=Math.min(dt,.2);
            while(remaining>0){const step=Math.min(remaining,1/60);remaining-=step;c.velocity.y-=Math.max(0,MINING_CHIP_GRAVITY)*step;c.mesh.position.addInPlace(c.velocity.scale(step));
                if(c.mesh.position.y<c.ground+3){c.mesh.position.y=c.ground+3;if(c.velocity.y<0)c.velocity.y=-c.velocity.y*Math.max(0,Math.min(1,MINING_CHIP_BOUNCE));const friction=1-Math.max(0,Math.min(1,MINING_CHIP_FRICTION));c.velocity.x*=friction;c.velocity.z*=friction;}}
            c.mesh.visibility=MINING_CHIP_FADE<=0?1:Math.min(1,Math.max(0,(MINING_CHIP_LIFETIME-c.age)/MINING_CHIP_FADE));
        }
        const expired=this.chips.filter(c=>c.age>=MINING_CHIP_LIFETIME);for(const c of expired)c.mesh.dispose();
        this.chips=this.chips.filter(c=>c.age<MINING_CHIP_LIFETIME);
        for(const d of this.drops){
            d.age+=dt;if(!d.settled)d.mesh.rotation.y+=dt*MINING_DROP_SPIN;
            const duration=Math.max(0,MINING_DROP_SHRINK_TIME), t=duration===0?1:Math.min(1,d.age/duration);
            const ease=t*t*(3-2*t), factor=1+(Math.max(.1,Math.min(1,MINING_DROP_SCALE))-1)*ease;
            d.mesh.scaling.copyFrom(d.ore.restScaling).scaleInPlace(factor);d.half=d.baseHalf*factor;
            this.setOreSquash(d.ore,d.compression*(1-ease));
            if(!d.settled){
                let remaining=Math.min(Math.max(0,dt),.2);
                while(remaining>0 && !d.settled){
                    const step=Math.min(remaining,1/60);remaining-=step;
                    d.velocity.y-=Math.max(1,MINING_DROP_GRAVITY)*step;d.center.addInPlace(d.velocity.scale(step));
                    if(d.center.y<=d.ground+d.half){
                        d.center.y=d.ground+d.half;
                        if(d.velocity.y<0)d.velocity.y=-d.velocity.y*Math.max(0,Math.min(.9,MINING_DROP_BOUNCE));
                        const friction=1-Math.max(0,Math.min(1,MINING_DROP_FRICTION));d.velocity.x*=friction;d.velocity.z*=friction;
                        if(d.velocity.y<40){d.settled=true;d.settleAge=0;}
                    }
                }
            } else {
                d.settleAge+=dt;const u=Math.min(1,d.settleAge/.25), ease=u*u*(3-2*u);
                const hover=Math.max(d.half,MINING_DROP_HEIGHT+Math.sin(d.age*MINING_DROP_BOB_SPEED)*MINING_DROP_BOB);
                d.center.y=d.ground+d.half+(hover-d.half)*ease;
            }
            d.mesh.computeWorldMatrix(true);d.ore.collider.computeWorldMatrix(true);
            const actualCenter=d.ore.collider.getBoundingInfo().boundingBox.centerWorld;
            d.mesh.position.addInPlace(d.center.subtract(actualCenter));
            if(d.age>Math.max(0,MINING_DROP_PICKUP_DELAY) && Math.hypot(this.position.x-d.center.x,this.position.z-d.center.z)<Math.max(0,MINING_DROP_PICKUP_RADIUS) && Math.abs((this.position.y-(this.playerSettings?this.playerSettings.eyeHeight:160))-d.ground)<100){d.collected=true;d.mesh.setEnabled(false);this.resources+=MINING_YIELD;this.say('PICKED UP  +'+MINING_YIELD+' IRON');}}
        this.drops=this.drops.filter(d=>!d.collected);
    }
}
