from typing_extensions import override
from comfy_api.latest import ComfyExtension, io

from .magik_image_compare import MagikImageCompare
from .magik_multi_compare import MagikMultiCompare

WEB_DIRECTORY = "./js"


class MagikCompareExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [MagikImageCompare, MagikMultiCompare]


async def comfy_entrypoint() -> MagikCompareExtension:
    return MagikCompareExtension()
