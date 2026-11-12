# HoloLab

A browser-based, hand-controlled 3D assembly hologram inspired by Tony Stark's workshop.
Pick a hardware design (a foldable quadcopter drone ships as the demo), then pull it apart and put
it back together with your bare hands in front of a webcam. Parts move the way they really attach:
screws spin in, the battery slides along its rail, arms unfold on their hinges, propellers drop onto
motor shafts. There are no text panels or lessons; the motion itself is the explanation.

Everything runs in the browser. There is no server and nothing is uploaded anywhere.

> **Screenshots / GIF**
>
> _Add your screenshots or a short GIF here (for example `docs/demo.gif`)._

## Features

- Hologram look: dark scene, cyan translucent parts with fresnel edge glow, bloom, scanlines, a
  rotating holo ring, and a faint wireframe "ghost" of the assembled model that always shows where
  parts are going.
- A single `progress` value (0 = fully disassembled, 1 = fully assembled) drives the whole
  choreography, forwards and backwards, so hands can scrub it freely.
- Seven motion types (`straight`, `arc`, `spiral`, `hinge`, `screw`, `slide`, `unfold`) with
  anticipation, overshoot/settle, a flash and shake on seating, trails behind moving parts, cascade
  timing and sub-assemblies (propeller onto motor, motor onto arm, arm onto body).
- Two-hand tracking with MediaPipe HandLandmarker, One Euro filtering, glowing fingertip cursors,
  a hand skeleton in the scene, targeting rings, and an energy arc while scrubbing.
- Design gallery with hologram previews, drag-and-drop GLB/GLTF import stored in IndexedDB,
  automatic choreography for imported models, JSON export/import of choreographies.
- Throw-to-trash deletion with a 5-second undo ring; demo models cannot be deleted.
- Procedural Web Audio sounds (hum, click, screw ticks, whoosh, scatter), toggleable.
- Cinematic demo mode (hidden UI, orbiting camera, disassemble → assemble loop, 16:9 or 9:16).
- Mouse/touch fallback when no camera is available.

## Running it

Requirements: Node.js 18+ (tested on Node 24) and a webcam.

```bash
npm install
npm run dev
```

Open the printed URL (usually `http://localhost:5173`), allow camera access, and show your hand.
The guide screen explains the gestures; press `?` any time to reopen it.

```bash
npm run build     # production build in dist/
npm run preview   # serve the build locally
npm run lint      # ESLint
```

The camera requires a secure context: `localhost` or HTTPS.

## Hand gestures

The one rule everywhere: **closing your palm means "grab / select"**.

### Gallery screen

| Gesture | Effect |
| --- | --- |
| Open hand, move left / right | Browse designs (slow = drag, fast flick = skip several) |
| Close your palm briefly (< 0.4 s) | Open the selected design |
| Close your palm and hold, fling toward the bin | Delete the design |
| Open hand, pull toward yourself (within 5 s) | Undo the delete |

### Model screen

| Gesture | Effect |
| --- | --- |
| Thumb + index together, then open / close | Disassemble / assemble one layer (group) at a time |
| Thumb + index + middle together, then open / close | Disassemble / assemble the whole model |
| Pinch on a part and pull | Pull the part out along its attach axis; release near home to snap it back, far away to leave it in the exploded position, flick to throw it |
| Index finger only, hold on a detached part (0.6 s) | Focus on that part (camera moves in, others fade) |
| Open hand, slow drag | Rotate the model |
| Open hand, fast swipe left / right | Previous / next assembly step |
| Open hand, fast swipe up | Back to the gallery |
| Open palm pushed quickly toward the camera | Explode to the exploded view |
| Two hands pinching, move apart / together | Zoom |
| Two fists brought together | Full assembly with the complete choreography |
| One fist held still in empty space + other hand | Slow motion modifier |
| Fist held on the model, fling toward the bin | Delete (demo models bounce back) |

### Keyboard / mouse fallback

`Esc` gallery · `Enter` open · `← →` browse / step · `Space` play · `E` disassemble · `A` assemble ·
`S` sound · `B` bloom on/off (performance mode) · `C` cinematic · `V` portrait/landscape · `J` download choreography JSON · `Del` delete ·
`F` leave focus · `?` guide. Mouse: drag to rotate, wheel to zoom, drag a part to pull it out,
double-click a detached part to focus, bottom slider to scrub progress.

## Choreography JSON

Every model can ship a JSON file that describes how it assembles. The demo drone's file is
`public/choreo/drone.json`. Positions are offsets in the **parent part's local space** relative to
the part's assembled ("home") transform. Times are in seconds.

```json
{
  "model": "demo-drone",
  "final": {
    "spin": { "parts": ["prop_fr", "prop_fl"], "axis": [0, 1, 0], "duration": 2.5 }
  },
  "steps": [
    {
      "part": "battery",
      "group": "body",
      "motion": "slide",
      "from": [0.65, -0.12, 0],
      "axis": [-1, 0, 0],
      "insert": 0.32,
      "start": 3.5,
      "duration": 1.3
    },
    {
      "parts": ["screw_motor_fr", "screw_motor_fl"],
      "group": "motor",
      "motion": "screw",
      "from": [0.1, -0.25, 0],
      "axis": [0, 1, 0],
      "insert": 0.05,
      "screwTurns": 4,
      "start": 2.2,
      "duration": 1.0
    },
    {
      "part": "arm_fr",
      "group": "arms",
      "motion": "hinge",
      "from": [0.3, 0.35, -0.25],
      "axis": [0, -1, 0],
      "insert": 0.04,
      "hinge": { "axis": [0, 1, 0], "angle": -123 },
      "spin": { "axis": [0, 1, 0], "turns": 0.5 },
      "start": 5.6,
      "duration": 1.3
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `part` / `parts` | Part id (mesh name) or a list of ids sharing the same step |
| `group` | Sub-assembly / layer name; used by the one-layer gesture and for grouping |
| `motion` | `straight`, `arc`, `spiral`, `hinge`, `screw`, `slide`, `unfold` |
| `from` | Exploded offset from home (parent local space) |
| `axis` | Attach axis: direction the part travels during the final insertion |
| `insert` | Insertion distance along `axis` (the straight final approach) |
| `hinge` | `{ axis, angle }`: pivot axis in the part's own space and fold angle in degrees (the part's origin is the hinge point) |
| `screwTurns` | Rotations while screwing in |
| `spin` | `{ axis, turns }` rotation on the way, aligned before seating |
| `lift` | Optional control-point offset for `arc` paths |
| `start`, `duration` | Timeline start (seconds) and length; overlap steps for a cascade |
| `final.spin` | Optional parts to spin when the model completes (propellers) |

When a model has no JSON, HoloLab generates a choreography automatically: big central parts first,
outer parts next, small cylindrical parts (screws) last; the attach axis is the principal axis closest
to the part's outward direction. Press `J` on the model screen to download the generated JSON, edit
it, then drop the file onto the page to attach it to that design.

## Deleting designs

Throwing a design into the bin removes it **only from HoloLab's library in your browser
(IndexedDB)**. The original file on your computer is never touched.

## Deploying to GitHub Pages

The repo includes `.github/workflows/deploy.yml`. Push to `main`, enable **Settings → Pages →
Source: GitHub Actions**, and the site is served over HTTPS (required for camera access) at
`https://<user>.github.io/<repo>/`.

## Models and licensing

The two demo models (foldable quadcopter, robot arm) are generated procedurally in
`src/models/` and are released with this project under the MIT license. No third-party model files
are bundled. MediaPipe hand tracking models are loaded at runtime from Google's CDN
(Apache 2.0).

## Stack

Vite · Three.js · MediaPipe Tasks Vision (HandLandmarker) · IndexedDB · Web Audio API · plain JavaScript.
