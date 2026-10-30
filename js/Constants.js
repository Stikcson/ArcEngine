// Constants.js — ALL the kit's numbers: location, camera, render. Loaded FIRST:
// the other modules read these globals. Edited by the editor (_utils/editor): the server
// patches only lines of the form `const NAME = <number>;` — keep values as numeric
// literals (colors — 0xRRGGBB); the editor won't touch a formula.
const GAME_VERSION = '0.1.0'; // build version: ?v= on scripts (tools/build.mjs) and the archive name

// localStorage shim: in a sandbox iframe and when site data is blocked, direct access throws SecurityError.
// All storage access goes through Store only.
/** @satisfies {Record<string, any>} */
const Store = {
    get(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    },
    set(key, value) {
        try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
    },
    remove(key) {
        try { localStorage.removeItem(key); } catch (e) { /* nothing to remove */ }
    },
    // JSON parsing that never throws: a broken value = as if there were no save.
    getJSON(key, fallback = null) {
        const raw = Store.get(key);
        if (raw === null) return fallback;
        try {
            const parsed = JSON.parse(raw);
            return (parsed && typeof parsed === 'object') ? parsed : fallback;
        } catch (e) {
            console.warn('Store: повреждённое значение "' + key + '", сбрасываю.');
            Store.remove(key);
            return fallback;
        }
    }
};

// Phone or tablet: user agent, iPad posing as a Mac, touch on a small screen.
const IS_MOBILE = (() => {
    const userAgentMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const hasTouchScreen = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    const isSmallScreen = Math.max(window.innerWidth, window.innerHeight) <= 1366 &&
        Math.min(window.innerWidth, window.innerHeight) <= 1024;
    const isiPad = /iPad/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return userAgentMobile || isiPad || (hasTouchScreen && isSmallScreen);
})();

// --- LOCATION (Location3D.js, Terrain3D.js). World units are px: x to the right, y down
// the map, height up (skill world3d, §Coordinates). ---
const LOCATION_WIDTH = 256;            // px: location width (the area the game camera stays within)
const LOCATION_HEIGHT = 256;           // px: location height
const LOCATION_GROUND = 0;              // ground texture: 0 — grass, 1 — sand, 2 — snow (Location3D.GROUNDS)
const GROUND_TILE_SIZE = 624;           // world px per one repeat of the ground texture
const TERRAIN_NOISE_AMP = 0;            // Flat test chamber.
// Initial values ported from the Unity mining prototype; world distances are cm.
const MINING_HEALTH = 120;
const MINING_DAMAGE = 20;
const MINING_WEAK_MULTIPLIER = 3;
const MINING_WEAK_RADIUS = 26;
const MINING_REACH = 320;
const MINING_YIELD = 5;
const MINING_SWING_INTERVAL = 0.6;
const MINING_CONTACT_DELAY = 0.09;
const MINING_SQUASH = 0.4;
const MINING_SQUASH_DURATION = 0.36;
const MINING_WEAK_SQUASH = 2;
const MINING_CHIPS = 7;
const MINING_CHIP_LIFETIME = 1.5;
const MINING_MOVE_SPEED = 400;
const MINING_MOUSE_SENSITIVITY = 0.00175;
const MINING_SOUND_VOLUME = 0.5;
// Mining impact tuning. Distances are centimetres and time values are seconds.
const MINING_SQUASH_DECAY = 1;
const MINING_SQUASH_OSCILLATIONS = 10.5;
const MINING_SQUASH_SPREAD = 1;
const MINING_FLASH_DURATION = 0.05;
const MINING_FLASH_COLOR = 0xffffff;
const MINING_SWING_STRENGTH = 1.05;
const MINING_SWING_RECOVERY = 0.45;
const MINING_SOUND_NORMAL = 1;
const MINING_SOUND_WEAK = 1;
const MINING_SOUND_BREAK = 1;
const MINING_CHIP_BREAK_EXTRA = 5;
const MINING_CHIP_SIZE = 5;
const MINING_CHIP_SIZE_VARIATION = 7;
const MINING_CHIP_SPEED = 90;
const MINING_CHIP_SPEED_VARIATION = 180;
const MINING_CHIP_LIFT = 130;
const MINING_CHIP_LIFT_VARIATION = 180;
const MINING_CHIP_GRAVITY = 650;
const MINING_CHIP_BOUNCE = 0.42;
const MINING_CHIP_FRICTION = 0.28;
const MINING_CHIP_FADE = 0.3;
const MINING_CHIP_COLOR = 0xd9e3ed;
const MINING_CHIP_WEAK_COLOR = 0xff9429;
const MINING_DROP_SIZE = 36;
const MINING_DROP_SCALE = 0.5;
const MINING_DROP_SHRINK_TIME = 0.35;
const MINING_DROP_LAUNCH_SPEED = 400;
const MINING_DROP_DISTANCE_FACTOR = 0.5;
const MINING_DROP_LAUNCH_LIFT = 300;
const MINING_DROP_GRAVITY = 750;
const MINING_DROP_BOUNCE = 0.25;
const MINING_DROP_FRICTION = 0.55;
const MINING_DROP_HEIGHT = 0;
const MINING_DROP_BOB = 0;
const MINING_DROP_BOB_SPEED = 3;
const MINING_DROP_SPIN = 1.6;
const MINING_DROP_PICKUP_RADIUS = 90;
const MINING_DROP_PICKUP_DELAY = 0.45;
const MINING_BAR_ENABLED = 1;
const MINING_BAR_WIDTH = 1.8;
const MINING_BAR_HEIGHT = 24;
const MINING_BAR_OFFSET = 22;
const MINING_BAR_COLOR = 0xe6f0ff;

// Camera post-processing. ColorCurves use Babylon's -100..100 grading controls.
const WORLD3D_POST_ENABLED = 1;
const WORLD3D_POST_VIGNETTE = 1;
const WORLD3D_POST_VIGNETTE_WEIGHT = 1.5;
const WORLD3D_POST_VIGNETTE_STRETCH = 0.45;
const WORLD3D_POST_EXPOSURE = 2;
const WORLD3D_POST_CONTRAST = 1;
const WORLD3D_POST_SATURATION = 42;
const WORLD3D_POST_SHADOW_SATURATION = -25;
const WORLD3D_POST_MIDTONE_SATURATION = 19;
const WORLD3D_POST_HIGHLIGHT_SATURATION = 3;
const WORLD3D_POST_SHADOW_EXPOSURE = -20;
const WORLD3D_POST_MIDTONE_EXPOSURE = 0;
const WORLD3D_POST_HIGHLIGHT_EXPOSURE = 0;
const WORLD3D_POST_TONEMAP = 1;
const WORLD3D_POST_BLOOM = 0;
const WORLD3D_POST_BLOOM_WEIGHT = 0.5;
const WORLD3D_POST_BLOOM_THRESHOLD = 0.85;
const WORLD3D_POST_GRAIN = 1;
const WORLD3D_POST_GRAIN_INTENSITY = 5;
const WORLD3D_POST_CHROMATIC = 0;
const WORLD3D_POST_CHROMATIC_AMOUNT = 8;
const WORLD3D_POST_PIXELATE = 1;
const WORLD3D_POST_PIXEL_SIZE = 8;
const TERRAIN_NOISE_SCALE = 800;        // px: hill size
const TERRAIN_NOISE_SEED = 4;           // terrain noise seed
const TERRAIN_BASE = 0;                 // px: mean ground level
const TERRAIN_CELL = 8;                 // px: terrain grid step (mobile — no finer than 12)

// --- MODELS (Gltf3D.js) and UI (UI.js) ---
const MODEL_CLIP_BLEND_SEC = 0.2;       // s: cross-fade between animation clips of a .glb model (idle -> run); 0 — instant
const UI_REF_HEIGHT = 720;              // px: the screen height the UI layout (UILayout.js) is drawn for; the UI scales with the screen height, 0 — no scaling

// --- SOUND (Sound3D.js): channel volumes; a sound with a place on the map is heard from where
// the CAMERA is — its audible region is a sphere of AUDIO_FALLOFF_MAX around it ---
const AUDIO_MASTER_VOLUME = 0.8;        // 0..1: everything (0 — silence)
const AUDIO_MUSIC_VOLUME = 0.6;         // 0..1: the 'music' channel
const AUDIO_SFX_VOLUME = 1;             // 0..1: the 'sfx' channel — effects and object sounds
const AUDIO_FALLOFF_MIN = 150;          // px: full volume while the camera is this close to a sound (0 — it fades from the source itself)
const AUDIO_FALLOFF_MAX = 1024;         // px: from here on it is silent (fades linearly in between); an object may set its own pair. The camera stands ~800 px from its look-at point at zoom 1
const AUDIO_PAN = 0.7;                  // 0..1: how far a sound at the side of the screen goes into one ear (0 — mono)

// --- SAMPLE GAME (Game.js): the "Run" button, the energy bar ---
const GAME_RUN_SEC = 8;                 // s: a full energy bar lasts this long while running
const GAME_REST_SEC = 4;                // s: an empty energy bar refills in this time while standing
const GAME_STEP_SEC = 0.35;             // s: between footstep sounds while the character runs

// --- CAMERA (CameraControl.js): target on the map, azimuth, pitch and zoom. Zoom is
// screen px per world px at the look-at point; distance is derived from it. Flight
// (WASD, Q/E) lifts the look-at point off the ground. ---
const CAMERA_FOV_DEG = 70;              // vertical field of view
const CAMERA_SHAKE_ENABLED = 1;         // 0 disables impact shake
const CAMERA_SHAKE_STRENGTH = 1.2;      // maximum rotation per axis in degrees
const CAMERA_SHAKE_DURATION = 0.35;     // seconds for full trauma to decay
const CAMERA_SHAKE_FREQUENCY = 12;      // noise sampling speed per second
const CAMERA_SHAKE_WEAK_MULTIPLIER = 1.3;
const CAMERA_SHAKE_BREAK_MULTIPLIER = 1.5;
const CAMERA_AZIMUTH_DEG = -90;         // where the camera looks on the map: −90 — north up, 0 — east up
const CAMERA_PITCH_DEG = 57;            // pitch toward the ground: 90 — straight from above, less — more perspective
const CAMERA_ZOOM = 1;                  // starting zoom: PC and tablets
const CAMERA_ZOOM_MOBILE = 0.7;         // starting zoom: phones (longer screen side < 1024)
const CAMERA_ZOOM_MIN = 0.5;            // wheel and pinch won't zoom out further (below this the ground edge gets into the frame)
const CAMERA_ZOOM_MAX = 3;              // won't zoom in closer
const CAMERA_ZOOM_WHEEL_STEP = 0.12;    // fraction of zoom per one wheel notch
const CAMERA_ZOOM_LERP = 0.18;          // zoom smoothing: fraction of the remainder per frame
const CAMERA_FOLLOW_LERP = 1;        // following an object (follow): fraction of the remainder per frame
const CAMERA_FLY_SPEED = 900;           // flight on WASD, arrows and Q/E: screen px/s (over the world — divided by zoom)
const CAMERA_LIMITS = 0;                // game camera limits: 0 — free flight, 1 — pitch within CAMERA_ORBIT_PITCH_*, target inside the location, flight ceiling; the ground edge stays out of the frame
const CAMERA_LIFT_MAX = 600;            // px, with limits: how high above the ground flight lifts the look-at point (higher — the ground edge gets into the frame)
const CAMERA_ORBIT = 1;                 // camera rotation by the player (RMB: look-around, orbit while following an object): 0 — orientation fixed, 1 — allowed
const CAMERA_ORBIT_DEG_PER_PX = 0.3;    // degrees of rotation per screen px of drag
const CAMERA_ORBIT_PITCH_MIN_DEG = 35;  // with limits: won't go lower toward the ground (the limit also rises on its own — ground edge stays out of the frame)
const CAMERA_ORBIT_PITCH_MAX_DEG = 88;  // with limits: higher — almost straight from above

// --- RENDER (World3D.js): light, shadows, sky, materials, toon and ink edges. Read by
// World3D.cfg(); the editor applies edits to the live scene. ---
// One sun for the whole world. Azimuth — WHERE the shadow falls on the map (0 — right, 90 — down).
const WORLD3D_SUN_AZIMUTH_DEG = 45;
const WORLD3D_SUN_ELEVATION_DEG = 57;   // sun elevation above the horizon
const WORLD3D_SUN_INTENSITY = 0.7;      // sun strength (with the sky it sums to ~1.0 on flat ground — texture colors unchanged)
const WORLD3D_SUN_COLOR = 0xffedc7;     // sun color
const WORLD3D_SKYLIGHT_INTENSITY = 1.25; // diffuse sky light (hemispheric light source)
const WORLD3D_SKYLIGHT_COLOR = 0xb1d8f7; // sky light color (faces looking up)
const WORLD3D_GROUNDLIGHT_COLOR = 0xc2c7ad; // fill light from below (reflection off the ground)
const WORLD3D_SKY_COLOR = 0x021622;     // sky and fog color
const WORLD3D_FOG_DENSITY = 0.00065;    // exponential fog toward the horizon (0 — off)
// Shadows: one color for all (painted by the toon plugin, Babylon only provides sun visibility)
const WORLD3D_SHADOW_COLOR = 0x0f3a4d;  // shadow color
const WORLD3D_SHADOW_STRENGTH = 0.46;    // shadow strength 0..1: a surface in shadow is multiplied by a blend of white and the shadow color
const WORLD3D_SHADOW_SOFT = 2;          // edge: 0 — hard (for toon), 1..3 — PCF low/medium/high (mobile — no higher than 1)
const WORLD3D_SHADOW_MAP = 1024;        // shadow map size (mobile — half as large); takes effect with a new scene
const WORLD3D_SHADOW_RADIUS = 840;      // px: LIMIT of the shadow ortho frustum half-size; the frustum itself shrinks to the objects in the frame
const WORLD3D_SHADOW_BIAS = 0.001;     // depth bias against shadow acne (shadow stripes on lit faces)
const WORLD3D_SHADOW_NORMAL_BIAS = 0.8; // bias along the normal against shadow acne (stripes and sawtooth on faces at an acute angle to the sun), in shadow map texels on top of the edge smoothing radius (the engine adds it)
// Materials by group (specular highlight — fraction 0..1, size — exponent: larger — smaller highlight)
const WORLD3D_GROUND_SPECULAR = 0;      // ground specular highlight (0 — matte)
const WORLD3D_GROUND_SPEC_POWER = 1;    // ground specular highlight size
const WORLD3D_OUTER_TINT = 0.88;           // ground brightness BEYOND the location edge (less than 1 — the location boundary is visible)
const WORLD3D_PROP_SPECULAR = 0.05;     // environment specular highlight (group 'prop')
const WORLD3D_PROP_SPEC_POWER = 7;     // environment specular highlight size
const WORLD3D_ACTOR_SPECULAR = 0;       // main objects specular highlight (group 'actor'); with toon — toon glint brightness
const WORLD3D_ACTOR_SPEC_POWER = 50;    // main objects specular highlight size
// Toon shader (ArcToonPlugin): light from all sources (sun + sky, with shadow) is quantized into bands
const WORLD3D_TOON = 0;                 // Smooth shading for the mining study.
const WORLD3D_TOON_BANDS = 4;           // number of light bands (2..6)
const WORLD3D_TOON_SOFT = 0.02;         // band boundary softness (0 — sharp, 0.5 — almost smooth)
const WORLD3D_TOON_LOW = 0.48;          // brightness of the darkest band (fraction of full)
const WORLD3D_TOON_GROUND = 1;          // 1 — bands on the ground too, 0 — ground is shaded smoothly
const WORLD3D_TOON_SPEC = 0.25;            // toon glint highlight strength (0 — no highlight)
const WORLD3D_TOON_SPEC_SIZE = 0.075;    // highlight threshold (smaller — larger spot)
const WORLD3D_TOON_RIM = 0.28;           // bright rim light along the objects' silhouette edge (0 — none)
const WORLD3D_TOON_RIM_WIDTH = 0.24;    // rim light width
// Ink edges (EdgesRenderer): edges creased more sharply than the threshold — on every object of
// the scene, a skinned character too (its lines follow the bones). Only when WORLD3D_TOON = 1
const WORLD3D_TOON_INK = 2;             // 0 — none, 1 — main objects, 2 — environment too (only when WORLD3D_TOON = 1)
const WORLD3D_TOON_INK_WIDTH = 20;      // line thickness (≈ world px × 100; thinner as the camera moves away)
const WORLD3D_TOON_INK_COLOR = 0x171717; // ink color: ink edges and silhouette outline
const WORLD3D_TOON_INK_ANGLE = 40;      // °: an edge is drawn if the faces are creased more sharply
// Outer silhouette outline: post-effect (HighlightLayer, isStroke), thickness — in screen px
const WORLD3D_TOON_OUTLINE = 0;         // 0 — none, 1 — main objects, 2 — environment too (only when WORLD3D_TOON = 1)
const WORLD3D_TOON_OUTLINE_ACTOR_WIDTH = 1;   // screen px: main objects outline
const WORLD3D_TOON_OUTLINE_PROP_WIDTH = 1;  // screen px: environment outline (there is a lot of it in the frame — thinner)
