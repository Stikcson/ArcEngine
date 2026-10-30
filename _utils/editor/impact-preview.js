// Transient editor-only subject. Actual strike, deformation, particles, drops and bar
// use Game methods; this object is never added to Location3D.objects or scene files.
// @ts-nocheck
class ImpactPreview {
    constructor(lab) {
        this.lab=lab;this.scene=lab.location.view.scene;this.enabled=true;this.weak=false;
        this.elapsed=0;this.nextSwing=0;this.contact=-1;this.restoreAt=-1;
        const scene=this.scene;
        this.root=new BABYLON.TransformNode('impact-preview-root',scene);
        this.rock=BABYLON.MeshBuilder.CreateBox('impact-preview-cube',{size:160},scene);
        this.rock.bakeTransformIntoVertices(BABYLON.Matrix.Translation(0,80,0));
        this.rock.parent=this.root;this.rock.isPickable=false;
        this.texture=new BABYLON.Texture('/assets/mining-textures/texture_07.png',scene,false,false,BABYLON.Texture.NEAREST_SAMPLINGMODE);
        this.material=new BABYLON.StandardMaterial('impact-preview-material',scene);this.material.diffuseTexture=this.texture;
        this.rock.material=this.material;
        this.collider=this.rock.clone('impact-preview-collider',this.root);this.collider.isVisible=false;this.collider.isPickable=false;
        this.ore={rec:{mesh:this.root},rock:this.rock,collider:this.collider,material:this.material,
            rest:this.rock.scaling.clone(),restPosition:this.root.position.clone(),restScaling:this.root.scaling.clone(),
            restRotation:this.root.rotation.clone(),restQuaternion:null,spring:10,amplitude:0,health:MINING_HEALTH,depleted:false,bar:null};
        this.game=Object.create(Game.prototype);
        Object.assign(this.game,{scene,ores:[this.ore],colliders:[],chips:[],drops:[],resources:0,elapsed:0,
            position:new BABYLON.Vector3(10000000,160,10000000),cameraShake:null,
            say(){},isWeak:()=>this.weak,groundAt:()=>this.ore.restPosition.y,
            dropSource:()=>this.lab.location.view.camera.globalPosition,
            pick:()=>({entry:{ore:this.ore},hit:{pickedPoint:this.impactPoint()}})});
        this.placeAtFocus();
        this.ore.bar=this.game.makeHealthBar(this.ore);this.game.updateHealthBar(this.ore);
    }
    impactPoint() {
        const center=new BABYLON.Vector3(this.root.position.x,this.root.position.y+100,this.root.position.z);
        const camera=this.lab.location.view.camera.globalPosition;
        const direction=new BABYLON.Vector3(camera.x-center.x,0,camera.z-center.z);
        if(direction.lengthSquared()<0.001)direction.z=-1;
        direction.normalize();return center.add(direction.scale(80));
    }
    placeAtFocus() {
        const at=this.lab.camera.groundFocus();this.game.reset();this.root.position.set(at.x,at.h,at.y);
        this.ore.restPosition.copyFrom(this.root.position);
        if(this.ore.bar) {
            this.ore.bar.root.position.set(at.x,at.h+160+MINING_BAR_OFFSET,at.y);
        }
        this.restoreAt=-1;this.nextSwing=this.elapsed;this.contact=-1;
    }
    setEnabled(enabled) {
        this.enabled=enabled;
        if(!enabled){this.game.reset();this.root.setEnabled(false);this.ore.bar.root.setEnabled(false);}
        else {this.game.reset();this.nextSwing=this.elapsed;this.contact=-1;this.restoreAt=-1;}
    }
    changed(name) {
        if(name==='MINING_FLASH_COLOR' && this.game.flashMaterial)this.game.flashMaterial.emissiveColor=Game.color(MINING_FLASH_COLOR);
        if(this.game.chipMaterials && (name==='MINING_CHIP_COLOR' || name==='MINING_CHIP_WEAK_COLOR')) {
            this.game.chipMaterials[0].emissiveColor=Game.color(MINING_CHIP_COLOR);
            this.game.chipMaterials[1].emissiveColor=Game.color(MINING_CHIP_WEAK_COLOR);
        }
        if(name.startsWith('MINING_BAR_')) {
            this.ore.bar.root.dispose(false,true);
            this.ore.bar=this.game.makeHealthBar(this.ore);
            this.game.updateHealthBar(this.ore);
            if(!this.enabled)this.ore.bar.root.setEnabled(false);
        }
        if(name==='MINING_HEALTH'){this.ore.health=Math.max(0,Math.min(this.ore.health,MINING_HEALTH));this.game.updateHealthBar(this.ore);}
    }
    update(dt) {
        if(!this.enabled)return;
        this.elapsed+=dt;this.game.elapsed=this.elapsed;
        this.game.silentImpact=!document.getElementById('opt-sound').checked;
        if(this.ore.depleted) {
            const drop=this.game.drops.find(d=>d.ore===this.ore);
            if(drop && drop.settled && this.restoreAt<0)this.restoreAt=this.elapsed+2;
            if(this.restoreAt>=0 && this.elapsed>=this.restoreAt){this.game.reset();this.restoreAt=-1;this.nextSwing=this.elapsed;this.contact=-1;}
        } else {
            if(this.elapsed>=this.nextSwing){const interval=Math.max(.12,MINING_SWING_INTERVAL);this.nextSwing=this.elapsed+interval;this.contact=this.elapsed+Math.max(0,Math.min(MINING_CONTACT_DELAY,interval*.8));}
            if(this.contact>=0 && this.elapsed>=this.contact){this.contact=-1;this.game.strike(null);}
        }
        this.game.updateImpactEffects(dt);
    }
    dispose() {
        this.game.reset();this.ore.bar.root.dispose(false,true);this.root.dispose(false,false);
        this.material.dispose();this.texture.dispose();
        if(this.game.flashMaterial)this.game.flashMaterial.dispose();
        for(const mat of this.game.chipMaterials || [])mat.dispose();
    }
}
