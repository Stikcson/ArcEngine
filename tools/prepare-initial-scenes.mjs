// One-time migration from the existing local scene. Never overwrite a scene file.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=fs.readFileSync(path.join(root,'js/Objects.js'),'utf8');
const objects=JSON.parse(JSON.stringify(vm.runInNewContext(source+'\n;LOCATION_OBJECTS',{}, {timeout:1000,contextCodeGeneration:{strings:false,wasm:false}})));
const dir=path.join(root,'scenes');fs.mkdirSync(dir,{recursive:true});
for(const scene of [
  {version:1,id:'mining',name:'Mining Test',mode:'mining',objects},
  {version:1,id:'main',name:'Main Scene',mode:'assembly',objects:[]}
]) fs.writeFileSync(path.join(dir,scene.id+'.json'),JSON.stringify(scene,null,2)+'\n',{flag:'wx'});
console.log('Saved the existing scene as Mining Test and created an empty Main Scene.');
