"""
Variables Board - ComfyUI Custom Node Package
A floating control panel that shows live values of watched variables
and allows overriding them directly from the panel.

Uses the V1 NODE_CLASS_MAPPINGS pattern for universal ComfyUI compatibility.
"""

from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

WEB_DIRECTORY = "js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
