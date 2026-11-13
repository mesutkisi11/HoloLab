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

- **Blueprint hologram look.** Faint glass surfaces with fresnel rims and a hex micro-pattern, crisp
  technical-drawing edge lines, MSAA, tuned bloom, a cinematic final pass (chromatic aberration,
  grain, vignette, interference band), and a faint wireframe "ghost" of the assembled model.
- **A workshop around the model.** Projector dial with ruler ticks and a radar sweep, a light cone,
  a blueprint floor grid, floating dust, gyroscope rings that orbit the model and a periodic scan
  beam. Models materialize bottom-to-top when opened and dissolve when closed.
- **Detailed procedural demos.** A foldable quadcopter (perforated carbon plates, hinge brackets,
  lathe-turned motor bells, twisted airfoil propellers, threaded screws, 3-axis gimbal, bent landing
  legs) and a 4-axis robot arm.
- **One progress value drives everything.** `progress` (0 = disassembled, 1 = assembled) can move
  forwards and backwards freely, so hands can scrub it.
- **Seven motion types** (`straight`, `arc`, `spiral`, `hinge`, `screw`, `slide`, `unfold`) with
  anticipation, overshoot/settle, seat flash and shockwave, trails, dashed leader lines from every
  detached part to its home, cascade timing and sub-assemblies.
- **Low-latency hand tracking.** MediaPipe HandLandmarker runs in a Web Worker on the GPU, frames are
  sent the moment the camera produces them (`requestVideoFrameCallback`), and a tuned One Euro filter
  plus windowed velocity keep cursors steady without lag.
- **Inspect a part.** Point at a detached part to fly the camera to it with dimension lines in mm.
- **Upload your own designs:** GLB, GLTF (+ .bin/textures), OBJ, STL, FBX, and CAD files
  **STEP / STP / IGES** read directly in the browser by OpenCascade (no conversion needed).
  Several STL/OBJ files dropped together become one assembly, one part per file.
- **Automatic choreography** for uploads, exportable to JSON, editable, and re-importable.
- **Quality tiers** (high / medium / low) detected from the GPU, with automatic step-down when
  frames get slow. Telemetry in the corner shows FPS, tier and hand-tracking latency.
- Throw-to-trash deletion with a 5-second undo ring; demo models cannot be deleted.
- Procedural Web Audio sounds, a cinematic demo mode (16:9 or 9:16) and a mouse/touch fallback.

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

## Sample assemblies

The gallery also shows four engineering assemblies from the
[Khronos glTF sample models](https://github.com/KhronosGroup/glTF-Sample-Models) (GearboxAssy,
2CylinderEngine, ReciprocatingSaw, Buggy; JT data converted by Okino Computer Graphics). They are
downloaded from that repository at runtime and are **not** part of this repository or its MIT
license.

## Hand gestures

The one rule everywhere: **closing your palm means "grab / select"**.

On first launch an interactive tutorial opens: for every gesture an animated hand shows the move,
a second panel shows what it does, and a third panel draws your own tracked hand. Do the gesture
and the tutorial moves on by itself. Reopen it any time with the **?** button (top right).

### Gallery screen

| Gesture | Effect |
| --- | --- |
| Open hand, move left / right | Browse designs (slow = drag, fast flick = skip several) |
| Tap thumb and index together twice, quickly | Open the selected design |
| Close your palm briefly (< 0.35 s) | Open the selected design |
| Close your palm and hold, fling toward the bin | Delete the design |
| Open hand, pull toward yourself (within 5 s) | Undo the delete |
| Select the **+** slot at the end of the arc and click it | Add a design (file picker) |

### Model screen

| Gesture | Effect |
| --- | --- |
| Touch both thumbs together, then move hands apart / together | Thumbs touching = assembled; the further apart, the more it comes apart |
| Snap your fingers | Step back one assembly step; at the first step, back to the gallery |
| Pinch on a part and pull | Pull the part out along its attach axis; release near home to snap it back, far away to leave it in the exploded position, flick to throw it |
| Index finger only, hold on a detached part (0.45 s) | Inspect that part: camera flies in, others fade, dimension lines in mm |
| Open hand, drag (fling and release to keep it spinning) | Rotate the model |
| Open hand, fast swipe left / right | Previous / next assembly step |
| Open hand, fast swipe up | Back to the gallery |
| Open palm pushed quickly toward the camera | Explode to the exploded view |
| Two hands pinching, move apart / together | Zoom in / out |
| Bunch all five fingertips together, then open the hand (bunch again to reverse) | Zoom in (zoom out) |
| Two fists brought together | Full assembly with the complete choreography |
| One fist held still in empty space + other hand | Slow motion modifier |
| Fist held on the model, fling toward the bin | Delete (demo models bounce back) |

### Keyboard / mouse fallback

`U` upload a design · `Esc` gallery · `Enter` open · `← →` browse / step · `Space` play ·
`E` disassemble · `A` assemble · `S` sound · `B` cycle quality (high → medium → low) · `C` cinematic ·
`V` portrait/landscape · `J` download choreography JSON · `Del` delete · `F` leave inspection · `?` gesture list. Mouse: drag to rotate, wheel to zoom, drag a part to pull it out,
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

## Adding your own designs

1. In the gallery, swipe to the **+** slot at the end of the arc and click it (or press `U`), or simply
   drag files onto the window.
2. Supported: `.glb`, `.gltf` (drop its `.bin` and textures together with it), `.obj`, `.stl`, `.fbx`,
   `.step` / `.stp`, `.iges` / `.igs`.
3. CAD files are parsed in a background thread by [occt-import-js](https://github.com/kovacsv/occt-import-js)
   (OpenCascade compiled to WebAssembly, loaded from a CDN only when you first open a CAD file). The
   result is cached in IndexedDB, so the next time the design opens instantly.
4. Each body / mesh becomes a part. Very large assemblies are grouped by their top-level
   sub-assemblies (at most 180 parts) to stay fluid.
5. Press `J` on the model screen to download the generated choreography, edit it, and drop the JSON
   back onto the page.

Tip: hand gestures can select the **+** slot, but browsers only open a file picker from a real click
or key press, so confirm with a click, `Enter` or `U`.

## Performance

- Hand detection runs in a Web Worker so the 3D scene never waits for it. Append `?mainthread` to the
  URL to compare with the old main-thread mode.
- The quality tier is chosen from the GPU name (software renderers → low, integrated GPUs → medium,
  discrete GPUs → high) and drops automatically if the average frame takes longer than 24 ms.
  `B` cycles tiers manually; the choice is remembered. `?tier=high|medium|low` forces one for a session.
- Good, even lighting on your hands makes detection faster and steadier.

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
are bundled. Loaded at runtime from CDNs, not bundled: MediaPipe Tasks Vision and the hand landmark
model (Apache 2.0), occt-import-js / OpenCascade for STEP and IGES (LGPL-2.1). Fonts: Rajdhani and
Share Tech Mono (SIL Open Font License) from Google Fonts.

## Stack

Vite · Three.js · three-mesh-bvh · MediaPipe Tasks Vision (HandLandmarker, Web Worker) · occt-import-js · IndexedDB · Web Audio API · plain JavaScript.
