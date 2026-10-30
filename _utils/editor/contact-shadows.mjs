import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomBytes} from 'node:crypto';

const prefix = '// Project-wide contact-shadow defaults and tag overrides, saved by the editor.\nglobalThis.CONTACT_SHADOW_CONFIG = ';
const revision = bytes => createHash('sha256').update(bytes).digest('hex');
const fileFor = root => path.join(root, 'js', 'ContactShadowConfig.js');
const profile = p => p && typeof p === 'object' && Number.isFinite(p.sizeX) && p.sizeX >= 1 && p.sizeX <= 10000 &&
  Number.isFinite(p.opacity) && p.opacity >= 0 && p.opacity <= 1 && Array.isArray(p.curve) && p.curve.length === 5 &&
  p.curve.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1) && p.curve[0] === 1 && p.curve[4] === 0;
export function validContactShadowConfig(config) {
  if (!config || typeof config.enabled !== 'boolean' || !profile(config.defaults) || !Array.isArray(config.tags) || config.tags.length > 128) return false;
  const seen = new Set();
  for (const item of config.tags) {
    if (!profile(item) || typeof item.enabled !== 'boolean' || typeof item.tag !== 'string' || !item.tag.trim() || item.tag !== item.tag.trim() || item.tag.length > 64 || /[\x00-\x1f]/.test(item.tag)) return false;
    const key=item.tag.toLowerCase(); if (seen.has(key)) return false; seen.add(key);
  }
  return true;
}
const sanitizedProfile = p => ({sizeX:p.sizeX,opacity:p.opacity,curve:p.curve.slice()});
export async function readContactShadows(root) {
  try {
    const bytes=await fs.readFile(fileFor(root)), text=bytes.toString('utf8');
    const match=/^\/\/ Project-wide contact-shadow defaults and tag overrides, saved by the editor\.\r?\nglobalThis\.CONTACT_SHADOW_CONFIG = ([\s\S]*);\r?\n?$/.exec(text);
    if (!match) throw new Error('bad config');
    const config=JSON.parse(match[1]);
    if (!validContactShadowConfig(config)) throw new Error('bad config');
    return {ok:true,config,revision:revision(bytes)};
  } catch {return {ok:false,code:'bad_contact_shadow_config',error:'Contact shadow settings could not be read'};}
}
const locks=new Map();
export async function saveContactShadows(root, expected, config) {
  if (!validContactShadowConfig(config)) return {ok:false,code:'bad_contact_shadow_config',error:'Invalid contact shadow settings'};
  const previous=locks.get(root) || Promise.resolve(); let release;
  const next=new Promise(resolve=>{release=resolve;}); locks.set(root,next); await previous;
  try {
    const current=await readContactShadows(root); if (!current.ok) return current;
    if (typeof expected !== 'string' || current.revision !== expected) return {ok:false,code:'contact_shadow_conflict',error:'Contact shadow settings changed on disk; reload first'};
    const clean={enabled:config.enabled,defaults:sanitizedProfile(config.defaults),tags:config.tags.map(t=>({tag:t.tag,enabled:t.enabled,...sanitizedProfile(t)}))};
    const bytes=Buffer.from(prefix+JSON.stringify(clean)+';\n');
    const backupDir=path.join(root,'_utils','.backups');await fs.mkdir(backupDir,{recursive:true});
    const suffix=Date.now()+'-'+randomBytes(4).toString('hex');
    const backup=path.join(backupDir,'ContactShadow-'+suffix+'.js');await fs.copyFile(fileFor(root),backup);
    const temp=fileFor(root)+'.'+suffix+'.tmp';
    try {
      await fs.writeFile(temp,bytes,{flag:'wx'});
      if ((await readContactShadows(root)).revision !== expected) {await fs.unlink(temp);return {ok:false,code:'contact_shadow_conflict',error:'Contact shadow settings changed on disk; reload first'};}
      await fs.rename(temp,fileFor(root));
    } catch(e) {await fs.unlink(temp).catch(()=>{});throw e;}
    return {ok:true,config:clean,revision:revision(bytes),backup:path.relative(root,backup).split(path.sep).join('/')};
  } finally {release();if(locks.get(root)===next)locks.delete(root);}
}
