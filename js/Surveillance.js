// Motion-sensitive surveillance cameras. Lengths use the engine's centimetre units.
// @ts-nocheck
const Surveillance = {
    MODEL:'assets/models/surveillance-camera.glb',
    ORIGIN:new BABYLON.Vector3(26,160,0),
    states:new WeakMap(),
    defaults() { return {distance:800,radius:350}; },
    inCone(local,settings) {
        const x=local.x-this.ORIGIN.x, y=local.y-this.ORIGIN.y, z=local.z-this.ORIGIN.z;
        return x>=0 && x<=settings.distance && Math.hypot(y,z)<=settings.radius*x/settings.distance;
    },
    context(location) {
        let state=this.states.get(location);
        if(!state) {state={targets:new Map(),records:new WeakMap(),time:0};this.states.set(location,state);}
        return state;
    },
    visible(location,rec,origin,target) {
        const delta=target.subtract(origin), distance=delta.length();
        if(distance<.001)return true;
        const ray=new BABYLON.Ray(origin,delta.scale(1/distance),distance);
        const hit=location.view.scene.pickWithRay(ray,m=>{
            if(!m.isPickable || !m.isEnabled() || !m.isVisible || m===rec.mesh || m.isDescendantOf(rec.mesh))return false;
            let node=m;while(node && !(node.metadata && node.metadata.locationObject))node=node.parent;
            return !!(node && node.metadata.locationObject && !node.metadata.locationObject.def.sensor);
        });
        return !(hit && hit.hit && hit.distance < distance-1);
    },
    cone(root,scene) {
        const lines=[], ring=[], n=40;
        for(let i=0;i<=n;i++) {const t=i*Math.PI*2/n;ring.push(new BABYLON.Vector3(1,Math.cos(t),Math.sin(t)));}
        lines.push(ring);for(let i=0;i<8;i++){const t=i*Math.PI*2/8;lines.push([BABYLON.Vector3.Zero(),new BABYLON.Vector3(1,Math.cos(t),Math.sin(t))]);}
        const mesh=BABYLON.MeshBuilder.CreateLineSystem('sensor-cone',{lines},scene);
        mesh.parent=root;mesh.position.copyFrom(this.ORIGIN);mesh.color=new BABYLON.Color3(.25,.88,.95);mesh.alpha=.8;mesh.isPickable=false;
        return mesh;
    },
    update(location,dt,targets=[],editor=false) {
        const state=this.context(location), elapsed=Math.max(0,Math.min(.1,dt || 0));state.time+=elapsed;
        const moved=[];const present=new Set();
        for(const target of targets) {
            if(!target || !target.id || !target.position)continue;
            present.add(target.id);const previous=state.targets.get(target.id);
            if(previous && BABYLON.Vector3.DistanceSquared(previous,target.position)>.01)moved.push(target.position);
            state.targets.set(target.id,target.position.clone());
        }
        for(const key of state.targets.keys())if(!present.has(key))state.targets.delete(key);
        for(const rec of location.objects) {
            if(!rec.def.sensor || !rec.mesh || rec.def.hidden || !rec.mesh.isEnabled())continue;
            let item=state.records.get(rec);
            if(!item || item.root!==rec.mesh) {
                item={root:rec.mesh,indicator:null,cone:null,alarm:0};state.records.set(rec,item);
            }
            const sensor=rec.def.sensor;
            if(editor) {
                if(!item.cone || item.cone.isDisposed()) item.cone=this.cone(rec.mesh,location.view.scene);
                item.cone.scaling.set(sensor.distance,sensor.radius,sensor.radius);
            }
            if(!item.indicator || item.indicator.isDisposed()) item.indicator=rec.mesh.getChildMeshes(false).find(m=>m.name.endsWith('/SensorIndicator')) || null;
            if(!editor && moved.length) {
                rec.mesh.computeWorldMatrix(true);
                const world=rec.mesh.getWorldMatrix(), inverse=world.clone().invert();
                const origin=BABYLON.Vector3.TransformCoordinates(this.ORIGIN,world);
                if(moved.some(p=>this.inCone(BABYLON.Vector3.TransformCoordinates(p,inverse),sensor) && this.visible(location,rec,origin,p))) item.alarm=.8;
            }
            item.alarm=Math.max(0,item.alarm-elapsed);
            const active=item.alarm>0, pulse=active ? (Math.sin(state.time*Math.PI*10)>0 ? 1 : .04) : .5+.5*Math.cos(state.time*Math.PI);
            if(item.indicator && item.indicator.material) {
                const mat=item.indicator.material;mat.disableLighting=true;
                mat.emissiveColor=active ? new BABYLON.Color3(pulse,0,0) : new BABYLON.Color3(pulse,pulse,pulse);
                mat.diffuseColor=BABYLON.Color3.Black();
            }
        }
    }
};
