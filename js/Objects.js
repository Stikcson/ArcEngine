// Objects.js — location objects: models placed in the editor (Objects tab).
// The editor rewrites the whole file (POST /api/save-objects) — keep the format.
// Model path — a string literal starting from assets/: the builder archives only assets referenced this way.
//   model — .fbx (Model3D.js) or .glb (Gltf3D.js: skeleton, clips, textures);
//   kind — 'prop' (environment) | 'actor' (main object of the frame);
//   x, y — map px; h — px above the ground; rot — [x, y, z] degrees: y — heading (0 — along +x,
//   90 — down the map), x and z — tilt; scale — [x, y, z] relative to model size (1 cm in the file = 1 px);
//   anim — spin of a model part (optional): part — an object inside the FBX (spins around
//   its origin from Blender), axis — its axis 'x' | 'y' | 'z' (with a minus — the opposite end),
//   speed — rpm, dir — 'cw' | 'ccw': clockwise/counterclockwise as seen from the end of the axis;
//   clip — looped animation clip of a .glb model (optional): 'idle', 'run'…
//   tag — a group name for game code (optional): location.findByTag(tag);
//   hidden: true — placed but not in the scene until the game calls location.setHidden(rec, false);
//   sound — a sound standing at the object (optional, Sound3D.js): src — a file from assets/sounds,
//   volume 0..1, loop: false — once instead of looped, falloffMin — px of full volume around the
//   object, falloffMax — px, silent from there on (0 or absent — the common AUDIO_FALLOFF_*).
const LOCATION_OBJECTS = [
    { name: 'Iron deposit 1', model: 'assets/models/mining-ore.glb', kind: 'prop', x: 1024, y: 1124, h: 0, rot: [0, 90, 0], scale: [0.5, 0.5, 0.5], tag: 'ore', materials: [{"slot":0,"color":"#c9c6dd","texture":"assets/Textures/kenney_prototype-textures/PNG/Dark/texture_08.png"}] },
    { name: 'Iron deposit 2', model: 'assets/models/mining-ore.glb', kind: 'prop', x: 724, y: 1374, h: 0, rot: [0, 90, 0], scale: [0.5, 0.5, 0.5], tag: 'ore', materials: [{"slot":0,"texture":"assets/Textures/kenney_prototype-textures/PNG/Dark/texture_08.png"}] },
    { name: 'Iron deposit 3', model: 'assets/models/mining-ore.glb', kind: 'prop', x: 1344, y: 1424, h: 0, rot: [0, 90, 0], scale: [0.5, 0.5, 0.5], tag: 'ore', materials: [{"slot":0,"texture":"assets/Textures/kenney_prototype-textures/PNG/Dark/texture_08.png"}] },
    { name: 'Floor', model: 'assets/models/mining-box.glb', kind: 'prop', x: 1024, y: 1174, h: -20, rot: [0, 90, 0], scale: [17, 0.4, 18], tag: 'wall', materials: [{"slot":0,"color":"#ffffff","texture":"assets/Textures/kenney_prototype-textures/PNG/Dark/texture_08.png","uScale":5,"vScale":5}] },
    { name: 'Back wall', model: 'assets/models/mining-box.glb', kind: 'prop', x: 1024, y: 2024, h: 200, rot: [0, 90, 0], scale: [0.4, 4, 18], tag: 'wall', materials: [{"slot":0,"texture":"assets/Textures/kenney_prototype-textures/PNG/Dark/texture_08.png","uScale":5}] },
    { name: 'Left wall', model: 'assets/models/mining-box.glb', kind: 'prop', x: 124, y: 1174, h: 200, rot: [0, 90, 0], scale: [17, 4, 0.4], tag: 'wall', materials: [{"slot":0,"texture":"assets/Textures/kenney_prototype-textures/PNG/Dark/texture_08.png","uScale":4}] },
    { name: 'Right wall', model: 'assets/models/mining-box.glb', kind: 'prop', x: 1924, y: 1174, h: 200, rot: [0, 90, 0], scale: [17, 4, 0.4], tag: 'wall', materials: [{"slot":0,"texture":"assets/Textures/kenney_prototype-textures/PNG/Dark/texture_08.png","uScale":4}] },
    { name: 'Rear wall', model: 'assets/models/mining-box.glb', kind: 'prop', x: 1024, y: 324, h: 200, rot: [0, 90, 0], scale: [0.4, 4, 18], tag: 'wall', materials: [{"slot":0,"texture":"assets/Textures/kenney_prototype-textures/PNG/Dark/texture_08.png","uScale":5}] },
];
