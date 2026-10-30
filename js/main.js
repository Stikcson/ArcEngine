// main.js — entry point: 3D engine -> location with objects from Objects.js -> camera ->
// UI (UILayout.js) -> game (Game.js) -> frame loop (Sound3D hears from where the camera is). window.app = { location, camera, game } —
// for the console and for game code built on top of the kit.

function updateLoadingProgress(percent) {
    const bar = /** @type {HTMLElement | null} */ (document.querySelector('.loading-progress'));
    if (bar) bar.style.width = percent + '%';
}

// The loading screen goes away when the location is ready.
function hideLoader() {
    updateLoadingProgress(100);
    setTimeout(() => {
        const screen = document.getElementById('loading-screen');
        if (screen) screen.style.display = 'none';
    }, 300);
}

function showBootError(text) {
    console.error(text);
    const el = document.querySelector('.loading-text');
    if (el) el.textContent = text;
}

async function startGame() {
    if (window.app) return;                 // guard against a repeated start
    if (typeof SimplexNoise === 'undefined') { showBootError('Нет libs/simplex-noise.js'); return; }
    let sceneData;
    try { sceneData=await SceneData.load(SceneData.selected()); }
    catch(e) { showBootError('Не удалось загрузить сцену: '+e.message);return; }
    const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('world3d'));
    updateLoadingProgress(40);
    if (!World3D.init(canvas)) { showBootError('3D недоступен: нет libs/babylon.js или WebGL'); return; }

    const terrainEnabled = typeof sceneData.terrainEnabled === 'boolean' ? sceneData.terrainEnabled : sceneData.mode !== 'mining';
    const location = new Location3D({ objects: sceneData.objects, terrainEnabled });
    SceneLighting.apply(location, sceneData.lighting);
    const camera = new CameraController(location.view, {
        terrain: terrainEnabled ? location.terrain : null,
        bounds: { w: location.width, h: location.height }
    });
    // The mining game owns first-person input; the editor retains its own camera.
    if(sceneData.mode==='assembly')camera.attach(canvas);
    UI.init(canvas,sceneData.mode==='mining'?undefined:[]);
    window.app = { location, camera, game: null };
    const game = sceneData.mode==='mining' ? window.app.game = new Game(window.app, sceneData.player) : null;
    console.log('ArcEngine: локация запущена, объектов ' + location.objects.length + '.');
    updateLoadingProgress(70);

    let last = performance.now();
    World3D.engine.runRenderLoop(() => {
        const now = performance.now(), dt = (now - last) / 1000;
        last = now;
        if(game)game.update(Math.min(0.1, dt));else camera.update(Math.min(0.1,dt));
        location.update(dt);
        Surveillance.update(location,dt,game ? [{id:"player",position:game.position}] : [],false);
        Sound3D.update(camera);
        World3D.renderFrame();
    });
    window.addEventListener('resize', () => World3D.resize());
    location.ready.then(hideLoader);
}

window.onload = () => startGame();
