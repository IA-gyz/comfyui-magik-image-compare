import os
import folder_paths
from comfy_api.latest import io, ui
from .magik_compare_shared import save_preview_frame, get_tracker

MAX_SLOTS = 10


class MagikMultiCompare(io.ComfyNode):
    """
    Magik Multi Compare - Wire up to 10 images and pick any two to compare side
    by side, using the same interactive modes as Magik Image Compare.

    Connect image1 and image2 to start; each connected input automatically
    reveals the next one, up to 10 total. Every connected input is saved as a
    single-frame preview each run (batches use frame 0 only) so switching which
    pair you're viewing in the picker is instant and never requires re-running
    the workflow. Pick the two you want to compare from the numbered grid next
    to the eye icon.
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="Magik.MultiCompare",
            display_name="Magik Multi Compare",
            category="Magik/Image/Display",
            is_output_node=True,
            inputs=[
                io.Image.Input("image1", tooltip="First image (always available)."),
                io.Image.Input("image2", tooltip="Second image (always available)."),
                *[
                    io.Image.Input(f"image{i}", tooltip=f"Optional image {i}.", optional=True)
                    for i in range(3, MAX_SLOTS + 1)
                ],
            ],
            outputs=[],
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(cls, image1, image2, **kwargs):
        unique_id = cls.hidden.unique_id
        tracker = get_tracker(unique_id)

        # Remove the frames this same node instance wrote last time before saving a new
        # set, so iterative re-runs don't silently accumulate temp PNGs all session.
        tracker.cleanup()

        slots = {1: image1, 2: image2}
        for i in range(3, MAX_SLOTS + 1):
            tensor = kwargs.get(f"image{i}")
            if tensor is not None:
                slots[i] = tensor

        batched = [i for i, t in slots.items() if t.shape[0] > 1]
        if batched:
            names = ", ".join(str(i) for i in sorted(batched))
            print(
                f"[Magik Multi Compare] slot(s) {names} have more than one frame; "
                f"only the first frame of each is used."
            )

        results = []
        output_dir = folder_paths.get_temp_directory()
        prefix = "magik_multicmp_" + unique_id
        # Width/height here are only used by get_save_image_path to pick a
        # counter-cache bucket for the output subfolder, not to size the saved
        # files themselves (matches Magik Image Compare's convention).
        first_tensor = slots[1]
        full_output_folder, filename, counter, subfolder, _ = (
            folder_paths.get_save_image_path(
                prefix, output_dir,
                first_tensor[0].shape[1], first_tensor[0].shape[0],
            )
        )

        # Every connected slot is saved every run (not just the 2 currently selected)
        # so the frontend picker can switch pairs instantly, client-side, without
        # re-queuing the workflow. Tagged with its actual slot number in the filename
        # since connected slots can have gaps (e.g. 1, 2, 3, 5 but not 4).
        for i in sorted(slots.keys()):
            tensor = slots[i]
            file = f"{filename}_{counter:05}_slot{i}.png"
            full_path = os.path.join(full_output_folder, file)
            save_preview_frame(tensor[0], full_path, 4)
            tracker.track(full_path)
            results.append(ui.SavedResult(
                filename=file,
                subfolder=subfolder,
                type=io.FolderType.temp,
            ))
            counter += 1

        return io.NodeOutput(ui=ui.SavedImages(results))
