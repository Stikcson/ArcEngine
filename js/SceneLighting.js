// Per-scene lighting shared by the game and editor.
// @ts-nocheck
const SceneLighting = {
    defaults() { return { sun:true, sky:true, points:[] }; },
    apply(location, config, showMarkers=false) {
        const view=location.view, scene=view.scene, data=config || this.defaults();
        for (const light of location._scenePointLights || []) light.dispose();
        for (const mesh of location._sceneLightMarkers || []) { if(mesh.material) mesh.material.dispose(); mesh.dispose(); }
        location._scenePointLights=[]; location._sceneLightMarkers=[];
        view.sceneLighting=data;
        view.applyLighting(World3D.cfg());
        // Four scene lights, the player light, sky and sun. Sun must remain last.
        // Babylon announces new materials before their constructor has applied defaults.
        // Set the limit on the next frame, after model materials have finished construction.
        if (!location._lightingMaterialObserver) {
            location._lightingMaterialObserver=scene.onBeforeRenderObservable.add(()=>{
                const limit=scene.lights.some(light=>light.name==='player-light') ? Math.max(4,Math.min(7,scene.lights.length)) : 6;
                for (const m of scene.materials) if (m instanceof BABYLON.StandardMaterial && m.maxSimultaneousLights !== limit) m.maxSimultaneousLights=limit;
            });
        }
        const limit=scene.lights.some(light=>light.name==='player-light') ? Math.max(4,Math.min(7,scene.lights.length)) : 6;
        for (const m of scene.materials) if (m instanceof BABYLON.StandardMaterial) m.maxSimultaneousLights=limit;
        for (const p of data.points) {
            const pos=new BABYLON.Vector3(p.x,p.h,p.y);
            const light=new BABYLON.PointLight(p.name,pos,scene);
            light.diffuse=BABYLON.Color3.FromHexString(p.color);
            light.specular=light.diffuse.clone(); light.intensity=p.intensity; light.range=p.range;
            location._scenePointLights.push(light);
            if (showMarkers) {
                const marker=BABYLON.MeshBuilder.CreateSphere('light-marker',{diameter:30,segments:8},scene);
                marker.position.copyFrom(pos); marker.isPickable=false;
                const material=new BABYLON.StandardMaterial('light-marker-material',scene);
                material.disableLighting=true; material.emissiveColor=light.diffuse.clone(); marker.material=material;
                location._sceneLightMarkers.push(marker);
            }
        }
        scene.removeLight(view.sun); scene.addLight(view.sun);
        scene.resetCachedMaterial();
    }
};
