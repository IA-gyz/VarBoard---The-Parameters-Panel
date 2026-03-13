"""
VarBoard - Backend Nodes (V1 API)
Lightweight pass-through nodes for INT, FLOAT, STRING, SEED, and BOOL values
that surface live values in the VarBoard frontend control panel.

Uses the V1 NODE_CLASS_MAPPINGS pattern for universal ComfyUI compatibility.
"""


# Pass-through nodes for INT, FLOAT, STRING, SEED, BOOL, SAMPLER, SCHEDULER

class VB_Int:
    CATEGORY = "VarBoard"
    FUNCTION = "execute"
    RETURN_TYPES = ("INT", "STRING")
    RETURN_NAMES = ("INT", "LABEL")
    COLOR = "#238636"
    BGCOLOR = "#0d1f0d"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": ("INT", {
                    "default": 0,
                    "min": -9999,
                    "max": 9999,
                    "step": 1,
                    "tooltip": "Integer value. Can be overridden from the VarBoard.",
                }),
                "label": ("STRING", {
                    "default": "Integer",
                    "tooltip": "Display label shown in the panel.",
                }),
            }
        }

    def execute(self, value: int, label: str) -> tuple[int, str]:
        return (value, label)


class VB_Float:
    CATEGORY = "VarBoard"
    FUNCTION = "execute"
    RETURN_TYPES = ("FLOAT", "STRING")
    RETURN_NAMES = ("FLOAT", "LABEL")
    COLOR = "#1f6feb"
    BGCOLOR = "#0a0f1f"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": ("FLOAT", {
                    "default": 0.00,
                    "min": -10.00,
                    "max": 10.00,
                    "step": 0.01,
                    "tooltip": "Float value. Can be overridden from the VarBoard.",
                }),
                "label": ("STRING", {
                    "default": "Float",
                    "tooltip": "Display label shown in the panel.",
                }),
            }
        }

    def execute(self, value: float, label: str) -> tuple[float, str]:
        return (value, label)


class VB_String:
    CATEGORY = "VarBoard"
    FUNCTION = "execute"
    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("STRING", "LABEL")
    COLOR = "#6e40c9"
    BGCOLOR = "#13092a"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "tooltip": "String value. Can be overridden from the VarBoard.",
                }),
                "label": ("STRING", {
                    "default": "String",
                    "tooltip": "Display label shown in the panel.",
                }),
            }
        }

    def execute(self, value: str, label: str) -> tuple[str, str]:
        return (value, label)


class VB_Seed:
    CATEGORY = "VarBoard"
    FUNCTION = "execute"
    RETURN_TYPES = ("INT", "STRING")
    RETURN_NAMES = ("SEED", "LABEL")
    COLOR = "#db6d28"
    BGCOLOR = "#1f0f0a"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "seed": ("INT", {
                    "default": 0,
                    "min": 0,
                    "max": 9007199254740991,
                    "tooltip": "Seed value. Can be overridden from the VarBoard.",
                }),
                "label": ("STRING", {
                    "default": "Seed",
                    "tooltip": "Display label shown in the panel.",
                }),
            }
        }

    def execute(self, seed: int, label: str) -> tuple[int, str]:
        return (seed, label)


class VB_Bool:
    CATEGORY = "VarBoard"
    FUNCTION = "execute"
    RETURN_TYPES = ("BOOLEAN", "STRING")
    RETURN_NAMES = ("BOOL", "LABEL")
    COLOR = "#2ca5a5"
    BGCOLOR = "#091a1a"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "Boolean value. Can be toggled from the VarBoard.",
                }),
                "label": ("STRING", {
                    "default": "Boolean",
                    "tooltip": "Display label shown in the panel.",
                }),
            }
        }

    def execute(self, value: bool, label: str) -> tuple[bool, str]:
        return (value, label)


try:
    import comfy.samplers
    SAMPLERS = comfy.samplers.KSampler.SAMPLERS
    SCHEDULERS = comfy.samplers.KSampler.SCHEDULERS
except (ImportError, AttributeError):
    # Fallback lists if ComfyUI internals are not available or changed
    SAMPLERS = ["euler", "euler_ancestral", "heun", "dpm_2", "dpm_2_ancestral", "lms", "dpm_fast", "dpm_adaptive", "dpmpp_2s_ancestral", "dpmpp_sde", "dpmpp_2m", "dpmpp_2m_sde", "ddpm", "lcm", "uni_pc", "uni_pc_bh2"]
    SCHEDULERS = ["normal", "karras", "exponential", "sgm_uniform", "simple", "ddim_uniform", "beta"]

class VB_Sampler:
    CATEGORY = "VarBoard"
    FUNCTION = "execute"
    RETURN_TYPES = (comfy.samplers.KSampler.SAMPLERS, "STRING")
    RETURN_NAMES = ("SAMPLER_NAME", "LABEL")
    COLOR = "#e8a027"
    BGCOLOR = "#1f1600"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": (comfy.samplers.KSampler.SAMPLERS, {
                    "default": "euler",
                    "tooltip": "Sampler name. Can be changed from the VarBoard.",
                }),
                "label": ("STRING", {
                    "default": "Sampler",
                    "tooltip": "Display label shown in the panel.",
                }),
            }
        }

    def execute(self, value: str, label: str) -> tuple[str, str]:
        return (value, label)


class VB_Scheduler:
    CATEGORY = "VarBoard"
    FUNCTION = "execute"
    RETURN_TYPES = (comfy.samplers.KSampler.SCHEDULERS, "STRING")
    RETURN_NAMES = ("SCHEDULER_NAME", "LABEL")
    COLOR = "#20a86e"
    BGCOLOR = "#001a0e"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": (comfy.samplers.KSampler.SCHEDULERS, {
                    "default": "normal",
                    "tooltip": "Scheduler name. Can be changed from the VarBoard.",
                }),
                "label": ("STRING", {
                    "default": "Scheduler",
                    "tooltip": "Display label shown in the panel.",
                }),
            }
        }

    def execute(self, value: str, label: str) -> tuple[str, str]:
        return (value, label)


class VB_Panel:
    """
    The VarBoard panel anchor node.
    Has no inputs or outputs — it exists solely as a canvas anchor
    for the floating DOM panel rendered by varBoard.js.
    The frontend attaches all panel behaviour via VBNodeMixin.
    """
    CATEGORY = "VarBoard"
    FUNCTION = "execute"
    RETURN_TYPES = ()
    RETURN_NAMES = ()
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    def execute(self) -> dict:
        return {}


NODE_CLASS_MAPPINGS = {
    "VB_Int":       VB_Int,
    "VB_Float":     VB_Float,
    "VB_String":    VB_String,
    "VB_Seed":      VB_Seed,
    "VB_Bool":      VB_Bool,
    "VB_Sampler":   VB_Sampler,
    "VB_Scheduler": VB_Scheduler,
    "VB_Panel":     VB_Panel,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "VB_Int":       "VarBoard Int",
    "VB_Float":     "VarBoard Float",
    "VB_String":    "VarBoard String",
    "VB_Seed":      "VarBoard Seed",
    "VB_Bool":      "VarBoard Bool",
    "VB_Sampler":   "VarBoard Sampler",
    "VB_Scheduler": "VarBoard Scheduler",
    "VB_Panel":     "Variables Board: Panel",
}
