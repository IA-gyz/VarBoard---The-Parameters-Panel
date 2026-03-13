import { app } from "/scripts/app.js";
import { formatValue } from "./utils.js";

export function makeCustomSelect(optionsList, selectedValue, onChange, signal) {
    let currentValue = selectedValue;
    let isOpen = false;
    let isDisabled = false;
    let listEl = null;
    const changeListeners = [];

    // ── Root wrapper (acts as the "select" element) ───────────────────────────
    const wrapper = document.createElement("div");
    wrapper.setAttribute("role", "combobox");
    wrapper.setAttribute("tabindex", "0");
    wrapper.style.cssText = [
        "position:relative",
        "box-sizing:border-box",
        "cursor:pointer",
        "user-select:none",
        "display:flex",
        "align-items:center",
        "justify-content:space-between",
        "white-space:nowrap",
        "overflow:hidden",
    ].join(";");

    const displaySpan = document.createElement("span");
    displaySpan.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none;";

    const arrowSpan = document.createElement("span");
    arrowSpan.textContent = "▾";
    arrowSpan.style.cssText = "margin-left:4px;flex-shrink:0;pointer-events:none;opacity:0.7;";

    wrapper.appendChild(displaySpan);
    wrapper.appendChild(arrowSpan);

    // ── Helpers ───────────────────────────────────────────────────────────────
    const getLabelFor = val => {
        const entry = optionsList.find(o => o.value === val);
        return entry ? entry.label : val;
    };

    const setDisplay = val => {
        displaySpan.textContent = getLabelFor(val);
    };

    const fireChange = () => {
        changeListeners.forEach(fn => fn());
        if (onChange) onChange(currentValue);
    };

    let onAway = null; // declared here so closeList can always cancel it

    const closeList = () => {
        if (!listEl) return;
        listEl.remove();
        listEl = null;
        isOpen = false;
        wrapper.setAttribute("aria-expanded", "false");
        if (onAway) {
            document.removeEventListener("mousedown", onAway);
            onAway = null;
        }
    };

    const openList = () => {
        if (isDisabled || isOpen) return;
        isOpen = true;
        wrapper.setAttribute("aria-expanded", "true");

        // getComputedStyle gives the CSS px value (pre-scale).  The wrapper lives
        // inside this.el which has transform:scale(ds.scale), so the visually
        // rendered size is cssFs * appliedScale.  We derive appliedScale from the
        // ratio of the wrapper's getBoundingClientRect height to its offsetHeight
        // so the dropdown list matches the visual size of the closed button exactly.
        const cssFs = parseFloat(getComputedStyle(wrapper).fontSize) || 11;
        const offsetH = wrapper.offsetHeight || 1;
        const rect = wrapper.getBoundingClientRect();
        const appliedScale = rect.height / offsetH;
        const screenFs = Math.round(cssFs * appliedScale);

        listEl = document.createElement("div");
        listEl.style.cssText = [
            "position:fixed",
            "z-index:999999",
            "overflow-y:auto",
            "max-height:220px",
            `font-size:${screenFs}px`,
            "font-family:" + (getComputedStyle(wrapper).fontFamily || "monospace"),
            "background:#0a0c0e",
            "border:1px solid #484e5c",
            "border-radius:4px",
            "box-shadow:0 4px 16px rgba(0,0,0,0.7)",
            "box-sizing:border-box",
        ].join(";");

        // Position below (or above) the wrapper.
        const spaceBelow = window.innerHeight - rect.bottom;
        const approxListH = Math.min(220, optionsList.length * (screenFs + 10));
        const openUpward = spaceBelow < approxListH && rect.top > approxListH;

        listEl.style.width = Math.max(rect.width, 120) + "px";
        listEl.style.left  = rect.left + "px";
        if (openUpward) {
            listEl.style.bottom = (window.innerHeight - rect.top) + "px";
        } else {
            listEl.style.top = rect.bottom + "px";
        }

        // Populate options.
        optionsList.forEach(({ value, label }) => {
            const item = document.createElement("div");
            item.style.cssText = [
                `padding:${Math.round(screenFs * 0.4)}px ${Math.round(screenFs * 0.7)}px`,
                "cursor:pointer",
                "white-space:nowrap",
                "overflow:hidden",
                "text-overflow:ellipsis",
                value === currentValue
                    ? "background:#1f2937;color:#eaeaea;"
                    : "background:transparent;color:#cdd9e5;",
            ].join(";");
            item.textContent = label;
            item.addEventListener("mouseenter", () => {
                item.style.background = "#2d3748";
                item.style.color = "#eaeaea";
            });
            item.addEventListener("mouseleave", () => {
                item.style.background = value === currentValue ? "#1f2937" : "transparent";
                item.style.color = value === currentValue ? "#eaeaea" : "#cdd9e5";
            });
            item.addEventListener("mousedown", e => {
                e.preventDefault();
                e.stopPropagation();
                if (value !== currentValue) {
                    currentValue = value;
                    setDisplay(currentValue);
                    fireChange();
                }
                closeList();
            });
            listEl.appendChild(item);
        });

        document.body.appendChild(listEl);

        // Scroll selected item into view.
        const idx = optionsList.findIndex(o => o.value === currentValue);
        if (idx >= 0) {
            const itemH = listEl.scrollHeight / optionsList.length;
            listEl.scrollTop = Math.max(0, idx * itemH - itemH * 2);
        }

        // Close on outside click. onAway is declared in outer scope so
        // closeList() can always cancel it regardless of how the list closes.
        onAway = e => {
            if (listEl && !listEl.contains(e.target) && e.target !== wrapper) {
                closeList();
            }
        };
        setTimeout(() => document.addEventListener("mousedown", onAway, { signal }), 0);

        // Also close if the canvas is panned or zoomed
        if (app.canvas) {
            const origOnScroll = app.canvas.onScroll;
            app.canvas.onScroll = function(e) {
                if (isOpen) closeList();
                if (origOnScroll) return origOnScroll.apply(this, arguments);
            };
        }
    };

    // ── Interaction ───────────────────────────────────────────────────────────
    wrapper.addEventListener("mousedown", e => {
        e.preventDefault();
        e.stopPropagation();
        if (isDisabled) return;
        isOpen ? closeList() : openList();
    });

    wrapper.addEventListener("wheel", e => e.stopPropagation());

    wrapper.addEventListener("keydown", e => {
        if (isDisabled) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); isOpen ? closeList() : openList(); return; }
        if (e.key === "Escape") { closeList(); return; }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const idx = optionsList.findIndex(o => o.value === currentValue);
            const next = e.key === "ArrowDown"
                ? Math.min(idx + 1, optionsList.length - 1)
                : Math.max(idx - 1, 0);
            if (next !== idx) {
                currentValue = optionsList[next].value;
                setDisplay(currentValue);
                fireChange();
            }
        }
    });

    // ── Public interface ──────────────────────────────────────────────────────
    Object.defineProperty(wrapper, "value", {
        get: () => currentValue,
        set: v => {
            if (v !== currentValue && optionsList.some(o => o.value === v)) {
                currentValue = v;
                setDisplay(currentValue);
            }
        },
    });

    Object.defineProperty(wrapper, "disabled", {
        get: () => isDisabled,
        set: v => {
            isDisabled = !!v;
            wrapper.style.opacity   = isDisabled ? "0.45" : "1";
            wrapper.style.cursor    = isDisabled ? "not-allowed" : "pointer";
            wrapper.setAttribute("tabindex", isDisabled ? "-1" : "0");
            if (isDisabled) closeList();
        },
    });

    // Proxy addEventListener so 'change' is captured; everything else forwarded.
    const _origAddEventListener = wrapper.addEventListener.bind(wrapper);
    wrapper.addEventListener = (type, fn, opts) => {
        if (type === "change") { changeListeners.push(fn); return; }
        _origAddEventListener(type, fn, opts);
    };

    // close() — call when the widget is removed from the DOM.
    wrapper.closeList = closeList;

    setDisplay(currentValue);
    return wrapper;
}

// ─── DOMPanel registry ────────────────────────────────────────────────────────
// _vbPanelRegistry holds every currently-alive DOMPanel instance.  Graph-level
// event hooks installed in setup() dispatch to all registered panels so that
// structural graph changes (node add/remove, connection change) trigger a full
// re-render on every live panel, and widget value changes trigger a lightweight
// in-place update — without a per-frame polling loop.

export const _vbPanelRegistry = new Set();

// ─── DOMPanel ─────────────────────────────────────────────────────────────────
// The DOMPanel class owns the floating HTML element that overlays the canvas.
// One instance is created per VB_Panel anchor node, and destroyed when that
// node is removed.
//
// Lifecycle:
//   constructor → _build() creates the root element and the right-edge resize
//     handle, then calls _render() to populate the header and variable rows.
//   _startPositionLoop() begins a lightweight rAF loop that only repositions
//     the panel every frame (no value/structure polling).
//   _attachGraphListeners() registers this panel in _vbPanelRegistry so that
//     graph-level hooks can dispatch structural and value-change events to it.
//   destroy() cancels the loop, deregisters from _vbPanelRegistry, and removes
//     the element from the DOM.

