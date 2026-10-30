// Generate editable GLB props from the Unity mining prototype's dimensions.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function box(x0, y0, z0, x1, y1, z1) {
  const p = [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
  return triangles(p, [0,2,1,0,3,2, 5,6,7,5,7,4, 4,7,3,4,3,0, 1,2,6,1,6,5, 3,7,6,3,6,2, 4,0,1,4,1,5]);
}
function triangles(p, idx) {
  const pos=[], normal=[], uv=[];
  for (let i=0;i<idx.length;i+=3) {
    const a=p[idx[i]],b=p[idx[i+1]],c=p[idx[i+2]];
    const u=b.map((v,j)=>v-a[j]), v=c.map((v,j)=>v-a[j]);
    const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    const len=Math.hypot(...n)||1; for(let j=0;j<3;j++) n[j]/=len;
    for (const k of [idx[i],idx[i+1],idx[i+2]]) { const q=p[k]; pos.push(...q);normal.push(...n);uv.push((Math.abs(n[0])>.7?q[2]:q[0])*2,(Math.abs(n[1])>.7?q[2]:q[1])*2); }
  }
  return {pos,normal,uv};
}
function write(name, parts) {
  const chunks=[], views=[], accessors=[], meshes=[], nodes=[], materials=[]; let offset=0;
  function attribute(values, type) {
    const data=Buffer.alloc(values.length*4); values.forEach((v,i)=>data.writeFloatLE(v,i*4));
    const view=views.push({buffer:0,byteOffset:offset,byteLength:data.length,target:34962})-1; chunks.push(data);offset+=data.length;
    const width=type==='VEC3'?3:2, a={bufferView:view,componentType:5126,count:values.length/width,type};
    if(type==='VEC3') { a.min=Array.from({length:3},(_,j)=>Math.min(...values.filter((_,i)=>i%3===j)));a.max=Array.from({length:3},(_,j)=>Math.max(...values.filter((_,i)=>i%3===j))); }
    return accessors.push(a)-1;
  }
  for (const part of parts) {
    const {pos,normal,uv}=part.geometry;
    const attrs={POSITION:attribute(pos,'VEC3'),NORMAL:attribute(normal,'VEC3'),TEXCOORD_0:attribute(uv,'VEC2')};
    const pbr={baseColorFactor:part.color,metallicFactor:0,roughnessFactor:0.95};
    if (part.textured) pbr.baseColorTexture={index:0};
    const material=materials.push({name:part.name,pbrMetallicRoughness:pbr,doubleSided:false})-1;
    const mesh=meshes.push({name:part.name,primitives:[{attributes:attrs,material}]})-1;
    nodes.push({name:part.name,mesh});
  }
  const doc={asset:{version:'2.0',generator:'ArcEngine mining prototype'},scene:0,scenes:[{nodes:nodes.map((_,i)=>i)}],nodes,meshes,materials,accessors,bufferViews:views,buffers:[]};
  if (parts.some(p=>p.textured)) {
    const texture=fs.readFileSync(path.join(root,'assets/mining-textures/texture_07.png'));
    const imageView=views.push({buffer:0,byteOffset:offset,byteLength:texture.length})-1;
    chunks.push(texture);offset+=texture.length;
    const padding=(4-offset%4)%4;if(padding){chunks.push(Buffer.alloc(padding));offset+=padding;}
    doc.images=[{bufferView:imageView,mimeType:'image/png'}];
    doc.samplers=[{magFilter:9728,minFilter:9728,wrapS:10497,wrapT:10497}];
    doc.textures=[{sampler:0,source:0}];
  }
  doc.buffers=[{byteLength:offset}];
  let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,0x20)]);
  const bin=Buffer.concat(chunks);const head=Buffer.alloc(12);head.write('glTF');head.writeUInt32LE(2,4);head.writeUInt32LE(12+8+json.length+8+bin.length,8);
  const j=Buffer.alloc(8);j.writeUInt32LE(json.length);j.write('JSON',4);const b=Buffer.alloc(8);b.writeUInt32LE(bin.length);b.write('BIN\0',4);
  fs.writeFileSync(path.join(root,'assets/models',name),Buffer.concat([head,j,json,b,bin]));
}
write('mining-ore.glb',[{name:'Rock',geometry:box(-.8,0,-.8,.8,1.6,.8),color:[1,1,1,1],textured:true},{name:'Seam',geometry:box(.20,.80,-.83,.48,1.12,-.80),color:[1,.42,.035,1],textured:true}]);
write('mining-box.glb',[{name:'Box',geometry:box(-.5,-.5,-.5,.5,.5,.5),color:[1,1,1,1],textured:true}]);
