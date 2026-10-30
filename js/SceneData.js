// Scene documents are selected by URL and loaded before the world is created.
/** @satisfies {Record<string, any>} */
const SceneData = {
    DEFAULT: 'main',
    selected() {
        const id=new URLSearchParams(window.location.search).get('scene') || this.DEFAULT;
        if (!/^[a-z][a-z0-9_-]{0,47}$/.test(id)) throw new Error('Invalid scene identifier');
        return id;
    },
    async load(id) {
        if (!/^[a-z][a-z0-9_-]{0,47}$/.test(id)) throw new Error('Invalid scene identifier');
        const response=await fetch('scenes/'+id+'.json',{cache:'no-store'});
        if (!response.ok) throw new Error('Cannot load scene '+id+' (HTTP '+response.status+')');
        const scene=await response.json();
        if (!scene || scene.version!==1 || scene.id!==id || !Array.isArray(scene.objects) || !['mining','assembly'].includes(scene.mode) || (scene.terrainEnabled !== undefined && typeof scene.terrainEnabled !== 'boolean'))
            throw new Error('Invalid scene: '+id);
        return scene;
    }
};
