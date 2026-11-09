import os
import folder_paths
from comfy_api.latest import io, ui
from .magik_compare_shared import save_preview_frame, get_tracker


class MagikImageCompare(io.ComfyNode):
    """
    Magik Image Compare - Compare two images (or batches of images) side by side
    with interactive modes and editable text labels overlaid on the comparison view.

    Wire any two IMAGE outputs into image1 and image2, then run the workflow.
    If either input is a batch, the shorter batch length is used and you can step
    through paired frames in the widget, or switch to "Mosaic" to compare both
    full batches at once as a single contact-sheet image per side.
    Click the label boxes below the mode buttons to edit the overlay text.
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="Magik.ImageCompare",
            display_name="Magik Image Compare",
            category="Magik/Image/Display",
            is_output_node=True,
            inputs=[
                io.Image.Input("image1", tooltip="First image to compare."),
                io.Image.Input("image2", tooltip="Second image to compare."),
            ],
            outputs=[],
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(cls, image1, image2):
        unique_id = cls.hidden.unique_id
        tracker = get_tracker(unique_id)

        # Remove the frames this same node instance wrote last time before saving a new
        # batch, so iterative re-runs don't silently accumulate temp PNGs all session.
        tracker.cleanup()

        n1, n2 = image1.shape[0], image2.shape[0]
        n = min(n1, n2)
        if n1 != n2:
            print(
                f"[Magik Image Compare] image1 has {n1} frame(s) and image2 has {n2} frame(s); "
                f"comparing the first {n} paired frame(s), the rest are ignored."
            )

        results = []
        output_dir = folder_paths.get_temp_directory()
        prefix = "magik_compare_" + unique_id
        # Width/height here are only used by get_save_image_path to pick a
        # counter-cache bucket for the output subfolder, not to size the saved
        # files themselves, so sourcing them from image1 alone is intentional
        # even when image2 has different dimensions.
        full_output_folder, filename, counter, subfolder, _ = (
            folder_paths.get_save_image_path(
                prefix, output_dir,
                image1[0].shape[1], image1[0].shape[0],
            )
        )

        # Saved as one contiguous block per side (side1's n frames, then side2's n
        # frames) rather than interleaved, so the frontend can split the returned
        # list in half with no extra metadata: images[:n] is side 1, images[n:] is
        # side 2, and it can page through matching indices or composite the whole
        # block into a batch mosaic for the "compare full batches" view.
        for side, tensor in (("1", image1), ("2", image2)):
            for batch_number in range(n):
                file = f"{filename}_{counter:05}_side{side}_{batch_number}.png"
                full_path = os.path.join(full_output_folder, file)
                save_preview_frame(tensor[batch_number], full_path, 4)
                tracker.track(full_path)
                results.append(ui.SavedResult(
                    filename=file,
                    subfolder=subfolder,
                    type=io.FolderType.temp,
                ))
                counter += 1

        return io.NodeOutput(ui=ui.SavedImages(results))
