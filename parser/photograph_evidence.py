"""Photograph the fictional boarding pass with the local ComfyUI install.

Diffusion paints an empty table. The boarding pass is drawn in sharp type and
composited onto that photo, so the stage-1 OCR check can still read the claim
phrases. Juggernaut does not redraw the words.

Start ComfyUI first, from C:\\Tools\\ComfyUI::

    python main.py --listen 127.0.0.1 --port 8188

Then, from this repo::

    parser\\.venv\\Scripts\\python.exe parser\\photograph_evidence.py
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
PARSER = Path(__file__).resolve().parent
COMFY_TOOLS = Path(r"C:\Tools\DiffusionArtGen")
OUT = ROOT / "fixtures" / "samples" / "complete" / "boarding-pass-sc101.png"

if str(PARSER) not in sys.path:
    sys.path.insert(0, str(PARSER))
if str(COMFY_TOOLS) not in sys.path:
    sys.path.insert(0, str(COMFY_TOOLS))

from comfy_client import DEFAULT_SERVER, START_HINT, ComfyClient, resolve_checkpoint  # noqa: E402
from generate_samples import render_boarding_pass_card  # noqa: E402

TABLE_PROMPT = (
    "photorealistic overhead photograph of an empty pale oak table, soft daylight "
    "from a window, fine wood grain, natural color, documentary photo, no objects"
)
TABLE_NEGATIVE = (
    "text, letters, numbers, paper, document, ticket, watermark, logo, people, hands, "
    "clutter, food, cup, illustration, painting, cartoon, blurry, low resolution, frame"
)
CANVAS = (1400, 1800)


def build_text2img(checkpoint: str, seed: int) -> dict:
    width, height = 1024, 1024
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": checkpoint}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": TABLE_PROMPT, "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": TABLE_NEGATIVE, "clip": ["1", 1]}},
        "4": {"class_type": "EmptyLatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}},
        "5": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "seed": seed,
                "steps": 24,
                "cfg": 5.5,
                "sampler_name": "dpmpp_2m",
                "scheduler": "karras",
                "positive": ["2", 0],
                "negative": ["3", 0],
                "latent_image": ["4", 0],
                "denoise": 1.0,
            },
        },
        "6": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["1", 2]}},
        "7": {"class_type": "SaveImage", "inputs": {"images": ["6", 0], "filename_prefix": "claim_evidence_table"}},
    }


def cover(image: Image.Image, width: int, height: int) -> Image.Image:
    image = image.convert("RGB")
    scale = max(width / image.width, height / image.height)
    resized = image.resize(
        (round(image.width * scale), round(image.height * scale)),
        Image.Resampling.LANCZOS,
    )
    left = (resized.width - width) // 2
    top = (resized.height - height) // 2
    return resized.crop((left, top, left + width, top + height))


def grade_card(card: Image.Image, seed: int) -> Image.Image:
    """Warm the paper and add fine grain without moving the glyphs."""
    pixels = np.asarray(card.convert("RGB"), dtype=np.float32)
    pixels[:, :, 0] *= 1.03
    pixels[:, :, 1] *= 0.99
    pixels[:, :, 2] *= 0.93
    shade = np.linspace(1.04, 0.93, pixels.shape[0], dtype=np.float32)[:, None, None]
    pixels *= shade
    noise = np.random.default_rng(seed).normal(0.0, 1.5, pixels.shape)
    pixels += noise
    return Image.fromarray(np.clip(np.round(pixels), 0, 255).astype(np.uint8), mode="RGB")


def composite_pass(background: Image.Image, card: Image.Image) -> Image.Image:
    width, height = CANVAS
    scene = cover(background, width, height).convert("RGBA")
    paper = grade_card(card, seed=101).convert("RGBA")
    paper = paper.rotate(-2.4, resample=Image.Resampling.BICUBIC, expand=True)

    alpha = paper.getchannel("A")
    shadow = Image.new("RGBA", paper.size, (0, 0, 0, 150))
    shadow.putalpha(alpha)
    shadow = shadow.filter(ImageFilter.GaussianBlur(16))

    origin_x = (width - paper.width) // 2
    origin_y = (height - paper.height) // 2 + 24
    scene.paste(shadow, (origin_x + 12, origin_y + 16), shadow)
    scene.paste(paper, (origin_x, origin_y), paper)

    pixels = np.asarray(scene.convert("RGB"), dtype=np.float32)
    yy, xx = np.mgrid[0:height, 0:width]
    radius = np.sqrt(((xx - width / 2) / (width / 2)) ** 2 + ((yy - height / 2) / (height / 2)) ** 2)
    vignette = np.clip(1.04 - 0.18 * radius**2, 0.78, 1.0).astype(np.float32)
    pixels *= vignette[:, :, None]
    return Image.fromarray(np.clip(np.round(pixels), 0, 255).astype(np.uint8), mode="RGB")


def photograph(server: str, seed: int, timeout: float) -> Image.Image:
    client = ComfyClient(server)
    try:
        checkpoint = resolve_checkpoint(client, None)
    except Exception as exc:
        raise SystemExit(f"ComfyUI is not reachable at {server}.\n{START_HINT}") from exc
    print(f"checkpoint {checkpoint}")
    background = client.run(build_text2img(checkpoint, seed), timeout=timeout)
    return composite_pass(background, render_boarding_pass_card())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Photograph the fictional SC101 boarding pass.")
    parser.add_argument("--server", default=DEFAULT_SERVER)
    parser.add_argument("--seed", type=int, default=101)
    parser.add_argument("--timeout", type=float, default=300)
    parser.add_argument("--output", type=Path, default=OUT)
    args = parser.parse_args(argv)

    image = photograph(args.server, args.seed, args.timeout)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    image.save(args.output, format="PNG")
    print(args.output.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
