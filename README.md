# 🎛️ ComfyUI Variables Board

**Variables Board** is a premium, high-performance floating control center for your [ComfyUI](https://github.com/comfyanonymous/ComfyUI) workflows. It allows you to centralize every parameter—from seeds and integers to samplers and strings—into a sleek, customizable overlay that stays accessible as you navigate your workspace.

![Variables Board Header](https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/web/assets/comfy_logo.png) *(Placeholder for Banner)*

---

## ✨ Key Features

- **🚀 Performance First**: Built with an optimized DOM patching engine. Values update in-place without lag, even in the most complex workflows.
- **🖼️ Canvas-Aware Positioning**: Choose between **Canvas-Anchored** (follows a specific node), **Screen-Fixed**, or **📌 Pinned Corner** modes. The panel scales and moves seamlessly with your zoom and pan.
- **🎨 Premium Aesthetics**: Featuring a modern dark-mode design, glassmorphism, and micro-animations. Fully customizable colors, icon shapes, and fonts.
- **🧩 Intuitive Controls**:
    - **Seeds**: Segmented controls for increment/decrement/randomize with "Ice" freeze locking.
    - **Numbers**: Horizontal drag-to-adjust inputs with proportional fill-bars.
    - **Strings**: Single-line or multiline textarea support with vertical resizing.
    - **Booleans**: Sleek custom toggle switches.
    - **Selection**: Custom, searchable dropdowns for Samplers and Schedulers.
- **⚡ Rapid Workflow**: 
    - **Batch Add**: Use the built-in "Add Variable" dialog to create multiple nodes at once.
    - **Drag-to-Reorder**: Organise your rows exactly how you want them.
    - **Live Connection Dots**: Instantly see which variables are currently connected to your graph.

---

## 🛠️ Installation

1. Navigate to your ComfyUI `custom_nodes` directory:
   ```bash
   cd ComfyUI/custom_nodes/
   ```
2. Clone this repository:
   ```bash
   git clone https://github.com/comfyanonymous/ComfyUI-Variables-Board.git
   ```
3. Restart ComfyUI and refresh your browser.

---

## 🚀 How to Use

### 1. Place the Anchor
Search for `VB_Panel` in the node menu. This node acts as the "canvas anchor" for your variables board. You only need one per workflow.

### 2. Add Variables
There are two ways to add variables to your board:
- **Batch Mode**: Click the `＋ Add Variable` button in the board header to open the dialog.
- **Manual Mode**: Add individual nodes like `VB_Int`, `VB_Float`, or `VB_Seed` and they will automatically appear on the board.

### 3. Connect to Nodes
Connect the outputs of your VB nodes to the inputs of your target nodes (e.g., connect a `VB_Seed` output to the `seed` input of a KSampler).

### 4. Customize
Click the `⚙` icon on the board header to open the **Panel Settings** flyout. Here you can tweak:
- Background, Label, and Accent colors.
- Icon shapes and animations (Pulse, Flicker, Glow).
- Positioning modes and margins.
- Reordering and "Colored Nodes" behavior.

---

## 📐 Design Philosophy

Variables Board was designed to solve "canvas fatigue." Instead of hunting for nodes across a massive graph, you bring the controls to you. It respects the ComfyUI aesthetic while injecting a premium "Pro-tool" feel.

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request or open an issue for feature requests.

*Created with ❤️ for the ComfyUI Community.*
