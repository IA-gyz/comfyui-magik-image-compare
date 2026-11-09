"""
Shared helpers for the Magik Compare node family (Magik Image Compare,
Magik Multi Compare). Keeps the GPU-downscale-for-UI PNG save logic and the
per-instance temp-file cleanup pattern in one place so both nodes stay in sync.
"""
import os
import random
import numpy as np
from PIL import Image
import torch.nn.functional as F

PREVIEW_MAX_DIM = 2048


def random_suffix(n=5):
    return "".join(random.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(n))


def save_preview_frame(frame_tensor, full_path, compress_level=4, max_dim=PREVIEW_MAX_DIM):
    """
    Saves a single [H, W, C] IMAGE frame (values in [0, 1]) as a PNG, downscaling
    on the GPU first if either dimension exceeds max_dim so large generations
    don't produce needlessly huge preview files. Returns the saved path.
    """
    h, w = frame_tensor.shape[0], frame_tensor.shape[1]

    if h > max_dim or w > max_dim:
        aspect = w / h
        if w > h:
            new_w = min(max_dim, w)
            new_h = int(new_w / aspect)
        else:
            new_h = min(max_dim, h)
            new_w = int(new_h * aspect)

        # Reshape [H, W, C] to [B, C, H, W] for PyTorch interpolation
        frame_reshaped = frame_tensor.unsqueeze(0).permute(0, 3, 1, 2)
        frame_resized = F.interpolate(
            frame_reshaped, size=(new_h, new_w), mode="bilinear", align_corners=False
        )
        # Reshape back to [H, W, C]
        frame_final = frame_resized.permute(0, 2, 3, 1).squeeze(0)
    else:
        frame_final = frame_tensor

    # Move to CPU and numpy only AFTER the resize is handled on the GPU.
    i = 255.0 * frame_final.cpu().numpy()
    img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
    img.save(full_path, compress_level=compress_level)
    return full_path


class PreviewFileTracker:
    """
    Tracks the full paths a node instance wrote on its last run and deletes
    them at the start of the next one, so iterative re-runs don't silently
    accumulate temp PNGs for the life of a ComfyUI session. Scoped to a single
    node instance (not shared across nodes, and not aware of files orphaned by
    a ComfyUI restart between runs -- that's an inherent, accepted limitation).
    """

    def __init__(self):
        self._paths = []

    def cleanup(self):
        for old_path in self._paths:
            try:
                if os.path.exists(old_path):
                    os.remove(old_path)
            except OSError:
                pass
        self._paths = []

    def track(self, path):
        self._paths.append(path)


# ============================================================================
# V3 note: under the classmethod-only execute() model there's no instance
# object surviving between runs to own a PreviewFileTracker the way V1's
# __init__-based self._tracker did. unique_id is stable for a given node
# across re-runs within a session (the same guarantee self used to provide
# for free), so it's used here as the key for a module-level tracker store --
# the closest available substitute for "this specific node instance in the
# graph". Centralized here (rather than duplicated in each node file) per
# this module's own stated job of keeping the two nodes' cleanup pattern in
# sync.
# ============================================================================

_trackers = {}


def get_tracker(unique_id):
    """Returns the PreviewFileTracker for this node instance, creating one on first use."""
    tracker = _trackers.get(unique_id)
    if tracker is None:
        tracker = PreviewFileTracker()
        _trackers[unique_id] = tracker
    return tracker
