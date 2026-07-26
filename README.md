# EzDepth

Generate a depth map for the current frame of your composition — locally, with
[Depth Anything V2](https://github.com/DepthAnything/Depth-Anything-V2) — and
drop it straight into After Effects as a guide layer.

## Features

- 🖼️ One click on the current playhead frame: no exporting, no round-tripping through another app
- 🎞️ **Full-range mode**: converts every frame in the comp's work area and imports it as one depth PNG sequence layer
- 🌓 Grayscale output, near = white — matches AE's own depth-based effects (Camera Lens Blur, Turbulent Displace, Depth Matte)
- 👻 Imports as a **guide layer** — visible in the viewer, excluded from renders
- 🔁 Re-running replaces the previous depth layer for that comp instead of stacking duplicates
- 📁 Configurable output folder (defaults to an `EzDepth` folder next to your `.aep`)
- ⚡ GPU accelerated (CUDA) with automatic CPU fallback
- 🔒 Fully local — your footage never leaves your machine

## Installation

**Requirements:** Windows 10/11, After Effects 2022 or newer.

1. Download this repo (green **Code** button → *Download ZIP* → extract), or:
   ```
   git clone https://github.com/mickeyperry/ezdepth.git
   ```
2. Double-click **`install.bat`**

That's it. The installer:
- enables unsigned CEP extensions (`PlayerDebugMode`, current user only)
- copies the extension to `%APPDATA%\Adobe\CEP\extensions\EzDepth`
- creates a self-contained Python environment (uses [uv](https://github.com/astral-sh/uv) or system Python — if you have neither: `winget install astral-sh.uv`, then re-run)
- installs the CUDA build of PyTorch if an NVIDIA GPU is detected, otherwise the CPU build

Then restart After Effects and open **Window → Extensions → EzDepth**.

To remove it later: run `uninstall.bat`, or delete `%APPDATA%\Adobe\CEP\extensions\EzDepth\`.

## Usage

1. Open a comp and move the playhead to the frame you want a depth map for
2. (Optional) set the output folder with the **…** browse button
3. Click **Generate Depth**

A `<CompName>_Depth` guide layer appears above everything else, sized to the
comp. First run downloads the Depth Anything V2 Small model (~100 MB, once,
cached under `%USERPROFILE%\.cache\huggingface`).

Capture is always taken at full comp resolution regardless of your current
viewer Resolution/Down Sample Factor (Full/Half/Third/Quarter).

### Full-range mode

Click **Generate Depth (Full Range)** instead to process every frame in the
comp's **work area** (which is the whole comp duration unless you've narrowed
it). AE renders the range natively through its own Render Queue as a PNG
sequence (you'll see AE's own render progress/cancel window), then every
frame is converted through the depth engine in the background — AE is free
again as soon as rendering finishes. The result imports as a single
`<CompName>_DepthSeq` guide layer spanning the range.

**One-time setup required:** the render needs an Output Module Template
named exactly `EzDepth PNG Sequence` (AE's scripting API can't set the
output format directly, only apply a saved template). In After Effects:
**Edit > Templates > Output Module... > New...**, set **Format** to
**PNG Sequence**, click OK, name the template `EzDepth PNG Sequence`, click
OK again. You only need to do this once per machine.

This runs Depth Anything V2 per frame with no temporal awareness, so expect
some frame-to-frame flicker on moving footage — that's a model limitation (a
video-specific model would fix it, at the cost of a heavier engine), not a
bug. Budget roughly a second or two per frame for the conversion pass on a
modern NVIDIA GPU, on top of however long AE's own render takes.

## GPU acceleration

An NVIDIA GPU makes this feel closer to real-time (well under a second per
frame once the engine is warm). Without one, it falls back to CPU — still
correct, just noticeably slower. The installer picks the right PyTorch build
automatically based on whether it detects `nvidia-smi`.

## Troubleshooting

- **Panel doesn't appear** — restart AE fully; verify `HKCU\Software\Adobe\CSXS.11\PlayerDebugMode = 1` (installer sets CSXS 9–12).
- **"No Python found"** — `winget install astral-sh.uv`, then run `install.bat` again.
- **Engine stuck on "starting"** — the first launch loads the model into the venv; give it up to a minute. If it still fails, run `python\.venv\Scripts\python.exe python\server.py` from the installed folder directly to see the error.
- **Depth looks wrong / flat** — very low-texture or heavily stylized frames (flat graphics, gradients) give the monocular model less to work with; this is a model limitation, not a bug.

## How it works

A small local HTTP server (`python/server.py`) loads
[`depth-anything/Depth-Anything-V2-Small-hf`](https://huggingface.co/depth-anything/Depth-Anything-V2-Small-hf)
once and keeps it warm. The panel captures the current frame via AE's
`CompItem.saveFrameToPng`, posts it to the local server, and imports the
result back into the comp via ExtendScript.

## License

MIT — see [LICENSE](LICENSE).
