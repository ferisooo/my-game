# Meadow

A small dreamy meadow built with [three.js](https://threejs.org). Walk around a field of ~1.6 million wind-blown grass blades.

## Run

```bash
npm install
npm run dev
```

Then open the URL it prints (usually http://localhost:5173) and click to play.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Move |
| Shift | Run |
| Space | Jump |
| Mouse | Look around (click first) |
| Scroll | Zoom camera |
| Esc | Release the mouse |

## Code map

- `src/main.js`: renderer, lighting and mood, post-processing (bloom and vignette), game loop
- `src/grass.js`: instanced grass blades with a custom shader (wind, bending around the player, backlit glow, distance LOD)
- `src/player.js`: loads the animated character model, keyboard/mouse input, third-person camera
- `public/models/character.glb`: the player model (Mixamo character from the three.js examples). Swap this file to change the character; it needs `Idle`, `Walk` and `Run` animations.
- `src/terrain.js`: rolling hills (`terrainHeight` is shared by the grass and the player)
- `src/sky.js`: pastel gradient sky with a low sun
- `src/particles.js`: floating pollen
