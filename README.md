# VarBoard — ComfyUI Live Variable Dashboard

**A floating, real-time control panel that sits on top of your ComfyUI canvas and lets you inspect and edit key workflow values without hunting through a tangle of nodes.**

---

## Table of Contents

1. [What is VarBoard?](#what-is-varboard)
2. [Features at a Glance](#features-at-a-glance)
3. [Screenshots & Visual Guide](#screenshots--visual-guide)
4. [Installation](#installation)
5. [Quick Start](#quick-start)
6. [Variable Types](#variable-types)
7. [Panel Controls](#panel-controls)
8. [Seed Controls In Depth](#seed-controls-in-depth)
9. [Panel Settings](#panel-settings)
10. [Scaling & Zoom](#scaling--zoom)
11. [Positioning Modes](#positioning-modes)
12. [Keyboard & Mouse Reference](#keyboard--mouse-reference)
13. [FAQ](#faq)
14. [Known Limitations](#known-limitations)
15. [Contributing](#contributing)

---

## What is VarBoard?

When you build a complex Stable Diffusion workflow in ComfyUI, the nodes you actually care about — steps, CFG, seed, sampler, positive prompt — end up buried in a sprawling graph. Every tweak requires panning, zooming, locating the right node, and carefully clicking the right widget.

VarBoard solves this by giving you a **single floating overlay panel** that displays all the parameters you care about in one place, all live, all directly editable. Change any value in the panel and it instantly reflects in the underlying graph node — no copy-paste, no hunting.

> **In short:** VarBoard is your workflow's control surface. It's what you keep open while generating; your node graph is what you open when you need to rewire something.

---

## Features at a Glance

- **Real-time bidirectional sync** — edit in the panel, the graph node updates. Edit in the node widget, the panel updates on the next tick.
- **All major variable types** — Integer, Float, String, Boolean, Seed, Sampler, Scheduler.
- **Drag-to-adjust numerics** — click-drag horizontally on any INT or FLOAT row to increment/decrement, just like ComfyUI's native sliders.
- **Range fill bar** — a subtle proportional fill behind numeric values visualises where the value sits within the min/max range at a glance.
- **Custom DOM dropdowns** — Sampler and Scheduler dropdowns are fully DOM-based, so they scale correctly with canvas zoom.
- **Seed controls** — four post-queue modes: `+1`, `-1`, `rand`, `fix`. Dice button for instant re-roll. Padlock to freeze the seed.
- **Boolean toggles** — live CSS toggle switches with instant feedback.
- **String / prompt display** — shows the current prompt text in a compact row with click-to-edit inline expansion.
- **Resizable panel** — drag any corner to resize. The panel scales all internal elements proportionally.
- **Moveable panel** — drag the header bar, or configure optional left/right/bottom drag strips.
- **Per-variable settings** — click the ⚙ icon on any row to override the label, set min/max/step for numerics, or disconnect the row.
- **Fully themeable** — accent colour, background colour, label colour, value colour, font family, row height, and icon shape/animation are all configurable per panel.
- **Anchor-node persistence** — settings are stored on the VB_Panel LiteGraph node, so they survive save/load and workflow sharing.
- **Dynamic sampler/scheduler lists** — reads ComfyUI's live registered sampler and scheduler lists, so custom nodes that register new samplers appear automatically.

---

## Screenshots & Visual Guide

### Screenshot 1 — Overview: VarBoard panel open on a typical img2img workflow

> **What to show:** A moderately complex ComfyUI workflow visible in the background — KSampler node, a few conditioning nodes, a ControlNet stack. The VarBoard panel floats in the top-right area of the screen, showing 6–8 variables: steps (INT), cfg (FLOAT), sampler (SAMPLER), scheduler (SCHEDULER), seed (SEED), denoise (FLOAT), and a prompt (STRING). The panel is positioned so the user can clearly see both the panel and part of the node graph behind it.
>
> **Caption:** The VarBoard panel floats above the canvas. Every value shown here is live — editing any row instantly updates the corresponding graph node.

---

### Screenshot 2 — Drag-to-adjust numeric input

> **What to show:** A close-up of the `steps` row in the panel with the cursor showing an east-west resize icon (⟺) mid-drag. The value should read something like `28` to show it's been changed from a default. The fill bar behind the value should be visibly partial, showing the value's position in the range. The corresponding KSampler node in the background should show `28` in its steps widget with a subtle yellow highlight indicating the value was just changed.
>
> **Caption:** Click and drag horizontally on any INT or FLOAT value to increment or decrement it. A proportional fill bar shows where the value sits within its configured range. The change syncs to the graph node immediately.

---

### Screenshot 3 — Sampler dropdown open

> **What to show:** The `sampler` row in the panel with its custom dropdown list open below it. The list should show 6–8 sampler names (euler, euler_ancestral, dpmpp_2m, dpmpp_sde, ddim, lcm...) with the currently selected one highlighted in a slightly lighter background. The font size and overall sizing of the dropdown list should visibly match the size of the selected value in the closed row above it, demonstrating the zoom-correct scaling.
>
> **Caption:** The fully custom DOM dropdown for Sampler and Scheduler types scales correctly with canvas zoom, unlike native `<select>` elements. The list font size matches the panel's current scale.

---

### Screenshot 4 — Seed controls

> **What to show:** The `seed` row expanded, showing the numeric input field with a long seed value, the dice (⚄) button on the right, the padlock button (unlocked state), and below the row the four control badges: `+1`, `-1`, `rand` (active, highlighted in blue), `fix`. The padlock button should be in a visibly locked state (icon changed) to show both states exist.
>
> **Caption:** Seed row with its four post-queue step modes. `rand` is active here — after each queue, the seed randomises automatically. The dice button re-rolls immediately. The padlock freezes the seed regardless of the step mode.

---

### Screenshot 5 — Boolean toggle

> **What to show:** Two BOOL rows side by side (or stacked) — one in the `true` state (toggle switch on the right, green track colour) and one in the `false` state (toggle switch on the left, dark track). The label text `true` / `false` next to each toggle should be visible and coloured accordingly (green for true, muted grey for false).
>
> **Caption:** Boolean variables use CSS toggle switches that scale with the panel's row height. The label text updates immediately on toggle and the change syncs to the graph node.

---

### Screenshot 6 — Resizing the panel

> **What to show:** The VarBoard panel in mid-resize, with the resize handle visible at one corner (a small triangular grip). The panel should be noticeably wider or narrower than its default state, and all internal elements — label text, value inputs, fill bars, type colour bars — should be proportionally scaled with it. Optionally show the panel at two different widths side by side to illustrate scalability.
>
> **Caption:** Drag any corner grip to resize the panel. All internal elements — fonts, padding, controls, the header icon — scale proportionally. Nothing clips or overflows at any width.

---

### Screenshot 7 — Settings flyout

> **What to show:** The settings flyout panel open, appearing to the left of the main panel. It should show several rows: accent colour (with a colour swatch and a hex input showing e.g. `#3b82f6`), background colour, label colour, value colour, the icon shape dropdown, the icon animation dropdown, the font family dropdown, the row height slider, the optional drag areas checkboxes (left, right, bottom). The main panel in the background should show a different accent colour, demonstrating the setting is active.
>
> **Caption:** The per-panel settings flyout. Accent colour, background, font, row height, icon shape and animation, and drag area configuration are all available here. All settings persist with the workflow.

---

### Screenshot 8 — Add variable dialog

> **What to show:** The "Add variable" modal dialog open on screen. It should show two or three rows, each with a type selector (showing a coloured label like `▾ Sampler`, `INT`, `FLOAT`) and a label text input. One row should have a label partially typed. The `+` button at the end of the first row should be visible for adding another row. A confirm button is visible at the bottom.
>
> **Caption:** The Add Variable dialog lets you create multiple variables in one step. Each row picks a type and sets the label. VarBoard creates the corresponding backend nodes and links them automatically.

---

### Screenshot 9 — Per-variable settings popup

> **What to show:** The small settings popup that appears when you click the ⚙ icon on a specific variable row. It should show: a label override text input, min/max/step inputs for a numeric type, and a disconnect button. The popup should appear as a small floating panel anchored near the right side of that variable row.
>
> **Caption:** Each variable row has its own settings popup for overriding the display label and setting min/max/step range overrides for numeric types. Range overrides control both the fill bar proportions and drag-to-adjust behaviour.

---

### Screenshot 10 — Multi-panel setup

> **What to show:** Two separate VarBoard panels open simultaneously on the same canvas — one for a "quality" cluster of parameters (steps, cfg, sampler, scheduler) and one for a "creative" cluster (seed, prompt, style lora strength, denoise). Each panel has a different accent colour, demonstrating that each panel stores its own independent settings.
>
> **Caption:** You can have multiple VarBoard panels open at once, each showing a different subset of your workflow's variables. Each panel stores its settings independently.

---

## Installation

### Method 1 — ComfyUI Manager (recommended)

1. Open ComfyUI Manager from the sidebar.
2. Click **Install Custom Nodes**.
3. Search for `VarBoard`.
4. Click Install and restart ComfyUI.

### Method 2 — Manual

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/your-username/ComfyUi-Variables-Board.git
```

Restart ComfyUI after cloning.

### Requirements

- ComfyUI (any recent version)
- No additional Python dependencies

---

## Quick Start

1. **Right-click** on an empty area of the canvas → **Add Node** → **VarBoard** → **VarBoard Panel**.
   > This places the anchor node. A floating panel appears immediately.

2. **Right-click** on the canvas again → **VarBoard** → choose a variable type (e.g. **VarBoard Int**).
   > A small backend node appears. Connect its output to whichever KSampler (or other node) widget you want to control.

3. The new variable appears in the panel automatically.

4. **Edit the label** by double-clicking it in the panel.

5. **Edit the value** by clicking the value field or dragging horizontally.

That's it. The panel is live.

---

## Variable Types

VarBoard provides one node type per variable type. Each appears as a small node in the graph and outputs its value to be connected to any compatible widget.

| Type | Node | Output | Description |
|---|---|---|---|
| `INT` | VarBoard Int | INTEGER | Whole numbers. Drag-adjustable with fill bar. |
| `FLOAT` | VarBoard Float | FLOAT | Decimal numbers. Drag-adjustable with fill bar. |
| `SEED` | VarBoard Seed | INT | Seed with dice, padlock, and post-queue step controls. |
| `STRING` | VarBoard String | STRING | Text. Single-line with click-to-expand editing. |
| `BOOL` | VarBoard Bool | BOOLEAN | True/false with a CSS toggle switch. |
| `SAMPLER` | VarBoard Sampler | SAMPLER_NAME | Dropdown populated from ComfyUI's live sampler registry. |
| `SCHEDULER` | VarBoard Scheduler | SCHEDULER_NAME | Dropdown populated from ComfyUI's live scheduler registry. |

All types display their variable type as a left-side colour bar in the panel, making it easy to scan the panel at a glance.

### Type colour reference

| Type | Colour |
|---|---|
| INT | Green `#1a6329` |
| FLOAT | Blue `#175ab8` |
| SEED | Amber `#b55820` |
| SAMPLER | Amber `#b55820` |
| SCHEDULER | Teal `#198758` |
| STRING | Purple `#5a33a3` |
| BOOL | Cyan `#228282` |

---

## Panel Controls

### Header bar

The header bar runs across the top of the panel and contains:

- **Icon** — the panel's visual identifier. Shape and animation are configurable in settings. Click the icon to toggle a compact/expanded view (if enabled).
- **Title** — defaults to "VarBoard". Not currently user-editable (the title is the panel, not a label for it).
- **+ Add button** — opens the Add Variable dialog.
- **⚙ button** — opens the per-panel Settings flyout.

### Separator bar

The thin horizontal strip between the header and the variable rows contains a small draggable nub. Drag it left or right to adjust the width of the label column for all rows simultaneously. This is the "master label width" control.

Alternatively, you can drag the separator that appears between the label and value areas on any individual row to set that row's label width independently.

### Variable rows

Each row consists of:

1. **Type colour bar** (4px left strip) — encodes the variable type at a glance.
2. **Label** — the display name. Double-click to rename inline.
3. **Vertical divider** — drag left/right to adjust label width for this row.
4. **Value area** — type-specific control: drag input, dropdown, toggle, or text field.
5. **⚙ icon** (hover to reveal) — opens per-variable settings.

---

## Seed Controls In Depth

The Seed row is the most feature-rich row type. In addition to the numeric value field, it includes:

### Dice button (⚄)

Click to immediately roll a new random seed. The new value is written to the VB_Seed node's widget and syncs to any connected KSampler (or equivalent) in the same tick.

### Padlock button

Toggles between locked and unlocked. When locked:
- The value field is highlighted in light blue.
- The seed will not be changed by any post-queue step mode.
- The lock state is stored on the node and persists across sessions.

When unlocked (default), the seed value changes according to the active step mode on each queue.

### Step mode badges (`+1`, `-1`, `rand`, `fix`)

These four small buttons below the seed row control what happens to the seed **after** each queue prompt. Only one is active at a time.

| Mode | Behaviour |
|---|---|
| `+1` | After each queue, the seed increments by 1. Good for producing a deterministic sequence of variations. |
| `-1` | After each queue, the seed decrements by 1. |
| `rand` | After each queue, the seed is replaced with a new random value. Equivalent to ComfyUI's "randomise" control mode. |
| `fix` | The seed never changes after a queue. Equivalent to ComfyUI's "fixed" control mode. |

The step mode applies to all currently unlocked seeds across all VarBoard panels when a queue fires.

---

## Panel Settings

Click the ⚙ button in the panel header to open the Settings flyout. All settings are stored on the VB_Panel anchor node and persist with the workflow.

### Appearance

| Setting | Description |
|---|---|
| Accent colour | The panel's theme colour. Used for the header icon, border highlights, and focus rings. |
| Background colour | The panel body background. Defaults to GitHub Dark `#0d1117`. |
| Label colour | Text colour for variable labels. |
| Value colour | Text colour for variable values. |
| Icon shape | Shape of the header icon. Options: Panel rows, Grid, Waveform, Bolt, Layers, Circle, Dots, Lines. |
| Icon animation | Idle animation for the header icon. Options: None, Pulse, Flicker, Glow. |
| Font family | Font used for all text in the panel. Options: monospace, sans-serif, serif, system-ui, Courier New, Consolas. |

### Row height

A slider controlling the height of all variable rows. Larger row heights increase font size, padding, and control sizes proportionally. Range: 24px–56px, default 34px.

### Optional drag areas

Checkboxes for Left, Right, and Bottom. When enabled, the corresponding edge of the panel becomes a drag handle for moving the panel. Useful if you want to move the panel without grabbing the header bar.

### Position mode (coming soon)

Currently disabled. Will allow pinning the panel to a corner of the screen (top-left, top-right, bottom-left, bottom-right) so it stays in place when the canvas is panned or zoomed.

---

## Scaling & Zoom

VarBoard scales in two dimensions:

**Horizontal (panel width):** When you drag a corner to resize the panel, all internal elements scale horizontally in proportion to the panel width. This includes padding, font sizes, control widths, and the header icon.

**Vertical (row height):** The row height setting in the Settings flyout controls the vertical scale of all rows. Larger row heights give more visual breathing room and are useful on high-DPI displays or when working at arm's length from the screen.

**Canvas zoom:** VarBoard panels are DOM elements floating above the ComfyUI canvas. The panel's absolute screen size does not change when you zoom the canvas. If you prefer the panel to feel larger or smaller relative to the canvas, resize it manually or adjust the row height.

The custom dropdown lists (Sampler, Scheduler) are built entirely in DOM and read their font size from the panel's current computed style, so they match the panel's current scale when opened.

---

## Positioning Modes

By default, the panel is in **free canvas** mode: it is anchored to a position on the canvas and moves with it as you pan. The panel's position is stored relative to the anchor node.

Drag the panel by its header bar to reposition it. If you have enabled optional drag areas in Settings (left, right, or bottom edges), those edges also act as drag handles.

---

## Keyboard & Mouse Reference

| Action | Input |
|---|---|
| Adjust numeric value | Click and drag horizontally on the value field |
| Type a numeric value directly | Click the value field when in text-editing mode (after a slow double-click) |
| Rename a label | Double-click the label text |
| Roll a new seed | Click the ⚄ dice button |
| Lock/unlock a seed | Click the padlock button |
| Open variable settings | Hover over a row, then click the ⚙ icon that appears |
| Move the panel | Drag the header bar (or enabled edge drag areas) |
| Resize the panel | Drag any corner grip |
| Open settings flyout | Click the ⚙ button in the header |
| Close settings flyout | Click outside it, or click ⚙ again |
| Add variables | Click the + Add button in the header |
| Navigate dropdown | Arrow keys (up/down), Enter to select, Escape to close |

---

## FAQ

**Q: Does VarBoard work with custom nodes?**

Yes. Any node that accepts a ComfyUI widget value as an input can be connected to a VarBoard variable node. The panel displays and syncs whatever value the widget currently holds.

**Q: Will custom samplers and schedulers appear in the dropdowns?**

Yes. The Sampler and Scheduler dropdowns are populated at runtime from `comfy.samplers.KSampler.SAMPLERS` and `.SCHEDULERS`, which is the same live registry ComfyUI itself uses. Any custom node that registers a new sampler or scheduler will appear automatically.

**Q: Can I have more than one VarBoard panel?**

Yes. Add as many VB_Panel nodes as you like. Each panel is independent, stores its own settings, and can show a different subset of variables. You might use one panel for generation parameters and a second for post-processing parameters.

**Q: Do VarBoard settings survive saving and reloading the workflow?**

Yes. All panel settings and variable order are stored on the VB_Panel anchor node in the standard ComfyUI JSON format. Save your workflow normally and the panel will restore to its previous state on load.

**Q: Can I delete a variable node without breaking things?**

Yes. Deleting a VB variable node from the canvas removes it from the panel automatically. No errors are thrown.

**Q: Why is the panel a bit blurry on high-DPI displays?**

The panel is a DOM element positioned above the ComfyUI canvas. It should render at full native resolution on any display. If you're seeing blurriness, it may be a browser zoom level issue — try setting your browser zoom to 100% and using the panel's built-in row height and width controls instead.

**Q: The panel disappeared. Where did it go?**

The panel is hidden when its anchor node (VB_Panel) is collapsed. Select the VB_Panel node and un-collapse it (right-click → Toggle collapse, or press `C` with it selected). The panel will reappear.

---

## Known Limitations

- **Position mode pinning** is not yet implemented. The panel always follows the canvas in free mode.
- **Multiline string editing** expands a textarea inline in the row. On very long prompts, this can push adjacent rows out of view temporarily.
- **The panel cannot be hidden without hiding its anchor node.** A dedicated show/hide toggle is planned.
- **Variable reordering** is done via drag-and-drop on the variable nodes in the graph, not in the panel itself. The panel order always reflects the order of nodes in the graph.

---

## Contributing

Pull requests, bug reports, and feature suggestions are welcome. When filing a bug report, please include:

- Your ComfyUI version
- Your browser and version
- A description of what you expected vs. what happened
- The workflow JSON (if the bug is reproducible with a specific workflow)

For feature requests, please describe the use case rather than the specific implementation — it helps us understand what problem you're solving.

---

*VarBoard is not affiliated with Stability AI, Automatic1111, or the ComfyUI project.*
