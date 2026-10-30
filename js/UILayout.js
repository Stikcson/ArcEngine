// UILayout.js — the game's UI layout: every HUD element, placed and styled in the editor (UI tab).
// The editor rewrites the whole file (POST /api/save-ui) — keep the format. Drawn by js/UI.js;
// game code takes an element by id: UI.get('score').setText('10') — and never positions HUD itself.
//   kind — 'text' | 'panel' | 'bar' | 'button'; anchor — one of 9 screen points ('top-left' …
//   'bottom-right'): x, y go from it to the same point of the element (inward from an edge,
//   signed from the center); w, h — px; numbers are px of a screen UI_REF_HEIGHT tall;
//   parent (optional) — id of the element this one sits in: anchor, x, y then count from the
//   parent's box, the parent clips it and hides it together with itself;
//   stretch (optional) — 'h' | 'v' | 'both': fills the container on that axis, x (y) — the inset
//   from both edges, w (h) is ignored;
//   colors — '#rrggbb', '' — none; visible: 0 — hidden until the game calls show().
//   Records go in drawing order: later — on top.
const UI_LAYOUT = [
    { id: 'panel', kind: 'panel', anchor: 'top-left', x: 18, y: 18, w: 260, h: 70, fill: '#10151c', border: '', radius: 4, alpha: 0.86, visible: 1 },
    { id: 'title', kind: 'text', anchor: 'top-left', parent: 'panel', x: 12, y: 10, text: "ORE / IMPACT STUDY", fontSize: 19, color: '#ffffff', shadow: '', alpha: 1, visible: 1 },
    { id: 'resources', kind: 'text', anchor: 'bottom-left', parent: 'panel', x: 12, y: 10, text: "IRON  0", fontSize: 15, color: '#d9e0e8', shadow: '', alpha: 1, visible: 1 },
    { id: 'crosshair', kind: 'text', anchor: 'middle-center', x: 0, y: 0, text: "+", fontSize: 24, color: '#ffffff', shadow: '#000000', alpha: 1, visible: 1 },
    { id: 'target', kind: 'text', anchor: 'middle-center', x: 0, y: 100, text: "", fontSize: 18, color: '#ffffff', shadow: '#000000', alpha: 1, visible: 0 },
    { id: 'health', kind: 'bar', anchor: 'middle-center', x: 0, y: 128, w: 260, h: 8, value: 1, color: '#dce3ea', fill: '#20252a', border: '', radius: 1, alpha: 1, visible: 0 },
    { id: 'feedback', kind: 'text', anchor: 'bottom-center', x: 0, y: 78, text: "Click to capture mouse", fontSize: 18, color: '#ffffff', shadow: '#000000', alpha: 1, visible: 1 },
    { id: 'hint', kind: 'text', anchor: 'bottom-center', x: 0, y: 30, text: "WASD move  |  Mouse look  |  Hold LMB mine  |  R reset  |  Esc release", fontSize: 13, color: '#dce3ea', shadow: '#000000', alpha: 1, visible: 1 },
];
