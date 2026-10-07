# 金枪比武 · The Gilded Tilt

A 3D medieval jousting game that runs in the browser. You ride as the Grey Falcon (灰隼骑士) and charge the Red Stag (赤鹿骑士) across the tilt barrier. You aim your lance tip, time your brace, and try to shatter your lance on his shield, or unhorse him outright.

Everything is procedural: the arena, castle, crowd, horses, knights, heraldry, textures and sound are all generated in code. The only dependency is three.js r170, which is vendored in `lib/`, so the game runs offline with no build step.

## Run

Any static file server works (ES modules need `http://`, not `file://`):

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Controls

| Input | Action |
| --- | --- |
| Mouse | Aim the lance tip. The reticle shows the zone you would hit |
| `W` / `Shift` (hold) | Spur the horse (faster = harder hit, but more lance wobble) |
| `S` | Rein in |
| `Space` (hold) | Brace in the saddle. Best pressed about 0.5 s before impact |
| `V` | Toggle chase cam / inside-the-helm visor view |
| `Esc` | Pause · `M` mute · `H` help |
| Touch | Drag to aim, on-screen buttons for spur / brace |

## Rules

- Lance broken on the **helm**: +3 (small target). On the **shield / breastplate**: +2. A glancing blow: +1.
- **Unhorsing** your opponent wins the match instantly.
- Three courses, with a sudden-death fourth course if the score is tied.
- Bracing makes your strike harder **and** keeps you in the saddle. Holding it too early drains your stamina, and a tired brace is weak.

## Features

- Golden-hour lighting with soft shadows, image-based reflections on the plate armour, bloom, and a film grade (split-tone, vignette, grain)
- Animated crowd of around 1,500 that cheers by side, waving banners, confetti bursts on unhorsing or victory
- Procedural gallop cycle, cloth caparisons, a fluttering cape, recoil on impact, and tumble physics when a knight is unhorsed
- Lance shatters into physical splinters, with a slow-motion beat and camera shake
- Full replay after every course: a director cam (tracking, impact close-up, fall shot), free orbit, follow either rider, scrubbable timeline, and automatic slow motion around the impact
- Three AI difficulty levels; the AI picks targets, aims with error, times its brace, and gets bolder when behind
- WebAudio synthesised hooves, crowd, lance crash, metal clang and fanfare

## Layout

```
index.html        HUD + screens
css/style.css     UI styling
js/main.js        render pipeline, state machine, input, cameras, HUD, replay player
js/world.js       arena, castle, stands, crowd, props, sky
js/knight.js      horse + knight rig, animation, lance, unhorse physics
js/combat.js      hit zones, strike resolution, AI
js/fx.js          splinters, dust, confetti, impact flash
js/audio.js       synthesised sound
js/replay.js      recording + interpolated playback
js/textures.js    procedural canvas textures
lib/              vendored three.js r170 + addons (MIT)
```

`?fixed=30` steps the simulation at a fixed 1/30 s per frame (used for automated screenshots).
