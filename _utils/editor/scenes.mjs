// Scene storage: independent JSON documents and optimistic concurrency checks.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createHash, randomBytes } from 'node:crypto';
import { formatObjects } from './save.mjs';
const validId=id=>typeof id==='string' && /^[a-z][a-z0-9_-]{0,47}$/.test(id);
const fileFor=(root,id)=>path.join(root,'scenes',id+'.json');
const revision=bytes=>createHash('sha256').update(bytes).digest('hex');
const problem=(code,error)=>({ok:false,code,error});
const validName=name=>typeof name==='string' && name.trim().length>0 && name.length<=80 && !/[\x00-\x1f]/.test(name);
const modes=new Set(['mining','assembly']);
const validLighting = x => x === undefined || (x && typeof x === 'object' && typeof x.sun === 'boolean' && typeof x.sky === 'boolean' && Array.isArray(x.points) && x.points.length <= 4 && x.points.every(p => p && typeof p.name === 'string' && p.name.length <= 80 && /^#[0-9a-f]{6}$/i.test(p.color) && ['x','y','h','intensity','range'].every(k => typeof p[k] === 'number' && Number.isFinite(p[k])) && Math.abs(p.x)<=100000 && Math.abs(p.y)<=100000 && Math.abs(p.h)<=100000 && p.intensity>=0 && p.intensity<=10 && p.range>=1 && p.range<=20000));
const playerRanges={spawnX:[-100000,100000],spawnZ:[-100000,100000],spawnY:[-100000,100000],eyeHeight:[1,1000],bodyHeight:[40,400],bodyDiameter:[10,200],startYaw:[-360,360],startPitch:[-80,80],fov:[10,120],moveSpeed:[1,5000],mouseSensitivity:[0.00001,0.05],lightHeight:[0,1000],lightIntensity:[0,10],lightRange:[1,20000]};
const validPlayer = p => p === undefined || (p && typeof p === 'object' && !Array.isArray(p) && typeof p.lightEnabled === 'boolean' && typeof p.lightColor === 'string' && /^#[0-9a-f]{6}$/i.test(p.lightColor) && Object.entries(playerRanges).every(([key,[min,max]])=>typeof p[key]==='number' && Number.isFinite(p[key]) && p[key]>=min && p[key]<=max));

export async function readScene(root,id) {
  if(!validId(id)) return problem('bad_scene','Invalid scene identifier');
  try {
    const file=fileFor(root,id), stat=await fs.lstat(file);
    if(!stat.isFile() || stat.isSymbolicLink())return problem('bad_scene','Invalid scene file');
    const bytes=await fs.readFile(file), data=JSON.parse(bytes.toString('utf8'));
    if(data.version!==1 || data.id!==id || !validName(data.name) || !modes.has(data.mode) || !Array.isArray(data.objects) || (data.terrainEnabled!==undefined && typeof data.terrainEnabled!=='boolean') || !validLighting(data.lighting) || !validPlayer(data.player) || !formatObjects(data.objects).ok)
      return problem('bad_scene','Invalid scene content');
    return {ok:true,scene:data,revision:revision(bytes)};
  } catch(e) { return problem(e.code==='ENOENT'?'scene_not_found':'bad_scene','Scene could not be read'); }
}

export async function listScenes(root) {
  const names=await fs.readdir(path.join(root,'scenes')).catch(()=>[]), list=[];
  for(const name of names.sort()) {
    if(!name.endsWith('.json'))continue;
    const item=await readScene(root,name.slice(0,-5));
    if(item.ok)list.push({id:item.scene.id,name:item.scene.name,mode:item.scene.mode});
  }
  return {ok:true,scenes:list};
}

function normalizedObjects(objects) {
  const formatted=formatObjects(objects);if(!formatted.ok)return formatted;
  return {ok:true,objects:JSON.parse(JSON.stringify(vm.runInNewContext(formatted.src+'\n;LOCATION_OBJECTS',{}, {timeout:1000,contextCodeGeneration:{strings:false,wasm:false}})))};
}

export async function createScene(root,name,objects=[],mode='assembly',terrainEnabled=undefined,lighting=undefined,player=undefined) {
  if(!validLighting(lighting))return problem('bad_scene','Invalid lighting');
  if(!validPlayer(player))return problem('bad_scene','Invalid player settings');
  if(!validName(name))return problem('bad_scene','Enter a name of up to 80 characters');
  if(!modes.has(mode))return problem('bad_scene','Invalid scene mode');
  if(terrainEnabled!==undefined && typeof terrainEnabled!=='boolean')return problem('bad_scene','Invalid terrain setting');
  const normalized=normalizedObjects(objects);if(!normalized.ok)return normalized;
  await fs.mkdir(path.join(root,'scenes'),{recursive:true});
  const id='scene-'+randomBytes(8).toString('hex'), data={version:1,id,name:name.trim(),mode,terrainEnabled:terrainEnabled ?? mode!=='mining',lighting:lighting ?? {sun:true,sky:true,points:[]},objects:normalized.objects,...(player===undefined?{}:{player})};
  const bytes=Buffer.from(JSON.stringify(data,null,2)+'\n');
  try { await fs.writeFile(fileFor(root,id),bytes,{flag:'wx'});return {ok:true,scene:data,revision:revision(bytes)}; }
  catch(e) { return problem('scene_create_failed','Scene could not be created'); }
}

// Recover the legacy editor layout into a new scene; never overwrite either file.
export async function importLegacyScene(root,name) {
  try {
    const source=await fs.readFile(path.join(root,'js','Objects.js'),'utf8');
    const objects=JSON.parse(JSON.stringify(vm.runInNewContext(source+'\n;LOCATION_OBJECTS',{}, {timeout:1000,contextCodeGeneration:{strings:false,wasm:false}})));
    return await createScene(root,name,objects,'mining');
  } catch(e) { return problem('bad_scene','The previous object layout could not be imported'); }
}

const sceneLocks=new Map();
export async function saveScene(root,id,expected,objects,terrainEnabled=undefined,lighting=undefined,player=undefined) {
  const key=root+'\0'+id, previous=sceneLocks.get(key) || Promise.resolve();
  let release;const next=new Promise(resolve=>{release=resolve;});sceneLocks.set(key,next);
  await previous;
  try { return await saveSceneLocked(root,id,expected,objects,terrainEnabled,lighting,player); }
  finally { release();if(sceneLocks.get(key)===next)sceneLocks.delete(key); }
}

async function saveSceneLocked(root,id,expected,objects,terrainEnabled,lighting,player) {
  if(!validLighting(lighting))return problem('bad_scene','Invalid lighting');
  if(!validPlayer(player))return problem('bad_scene','Invalid player settings');
  if(terrainEnabled!==undefined && typeof terrainEnabled!=='boolean')return problem('bad_scene','Invalid terrain setting');
  if(typeof expected!=='string' || !/^[0-9a-f]{64}$/.test(expected))return problem('scene_conflict','Scene revision is missing');
  const current=await readScene(root,id);if(!current.ok)return current;
  if(current.revision!==expected)return problem('scene_conflict','Scene changed on disk; reload before saving');
  const normalized=normalizedObjects(objects);if(!normalized.ok)return normalized;
  const data={...current.scene,terrainEnabled:terrainEnabled ?? current.scene.terrainEnabled ?? current.scene.mode!=='mining',lighting:lighting ?? current.scene.lighting ?? {sun:true,sky:true,points:[]},objects:normalized.objects,...(player===undefined?{}:{player})}, bytes=Buffer.from(JSON.stringify(data,null,2)+'\n');
  const backupDir=path.join(root,'_utils','.backups');await fs.mkdir(backupDir,{recursive:true});
  const suffix=Date.now()+'-'+randomBytes(4).toString('hex');
  const backup=path.join(backupDir,'Scene-'+id+'-'+suffix+'.json');
  await fs.copyFile(fileFor(root,id),backup);
  const temp=path.join(root,'scenes','.'+id+'-'+suffix+'.tmp');
  try {
    await fs.writeFile(temp,bytes,{flag:'wx'});
    const latest=await readScene(root,id);
    if(!latest.ok || latest.revision!==expected) { await fs.unlink(temp);return problem('scene_conflict','Scene changed on disk; reload before saving'); }
    await fs.rename(temp,fileFor(root,id));
  }
  catch(e) { await fs.unlink(temp).catch(()=>{});throw e; }
  return {ok:true,count:normalized.objects.length,revision:revision(bytes),backup:path.relative(root,backup).split(path.sep).join('/')};
}
