"""Convert one PDF or image into the stage-1 page-text contract.

Docling still reads the file for its raw document. Provenance items come from
the embedded text layer, one line or table cell at a time, or from OCR line
boxes when that layer is missing. Every box is stored in BOTTOMLEFT coordinates.
"""

from __future__ import annotations

import argparse
import json
import sys
from importlib.metadata import version
from pathlib import Path
from typing import Any

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"}
PDF_SUFFIXES = {".pdf"}
ALLOWED_SUFFIXES = IMAGE_SUFFIXES | PDF_SUFFIXES
MEDIA_TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".bmp": "image/bmp",
    ".webp": "image/webp",
}
MAX_SAFE_INTEGER = 2**53 - 1

_converters: dict[bool, Any] = {}
_ocr_engine: Any = None


def pipeline_options(force_ocr: bool) -> Any:
    from docling.datamodel.accelerator_options import AcceleratorDevice, AcceleratorOptions
    from docling.datamodel.pipeline_options import OcrMode, PdfPipelineOptions

    options = PdfPipelineOptions()
    options.do_ocr = True
    options.do_table_structure = True
    if hasattr(options, "generate_page_images"):
        options.generate_page_images = False
    for name in (
        "do_picture_description",
        "do_picture_classification",
        "do_code_enrichment",
        "do_formula_enrichment",
        "generate_picture_images",
    ):
        if hasattr(options, name):
            setattr(options, name, False)
    ocr = options.ocr_options
    if hasattr(ocr, "lang"):
        ocr.lang = ["iso:en"]
    if hasattr(ocr, "mode"):
        ocr.mode = OcrMode.FULL_PAGE if force_ocr else OcrMode.DEFAULT
    if hasattr(ocr, "use_gpu"):
        ocr.use_gpu = False
    options.accelerator_options = AcceleratorOptions(device=AcceleratorDevice.CPU)
    return options


def converter_for(force_ocr: bool) -> Any:
    if force_ocr in _converters:
        return _converters[force_ocr]
    from docling.datamodel.base_models import InputFormat
    from docling.document_converter import (
        DocumentConverter,
        ImageFormatOption,
        PdfFormatOption,
    )

    options = pipeline_options(force_ocr)
    converter = DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=options),
            InputFormat.IMAGE: ImageFormatOption(pipeline_options=options),
        }
    )
    _converters[force_ocr] = converter
    return converter


def ocr_engine() -> Any:
    global _ocr_engine
    if _ocr_engine is None:
        from rapidocr import EngineType, RapidOCR

        _ocr_engine = RapidOCR(
            params={
                "Det.engine_type": EngineType.TORCH,
                "Cls.engine_type": EngineType.TORCH,
                "Rec.engine_type": EngineType.TORCH,
            }
        )
    return _ocr_engine


def json_safe(value: Any) -> Any:
    if isinstance(value, bool) or value is None or isinstance(value, (str, float)):
        return value
    if isinstance(value, int):
        if abs(value) > MAX_SAFE_INTEGER:
            return str(value)
        return value
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    if isinstance(value, Path):
        return str(value)
    nested = getattr(value, "value", None)
    if isinstance(nested, (str, int, float, bool)):
        return json_safe(nested)
    return str(value)


def bottom_left_box(left: float, top: float, right: float, bottom: float) -> dict[str, Any]:
    return {
        "l": left,
        "t": top,
        "r": right,
        "b": bottom,
        "coord_origin": "BOTTOMLEFT",
    }


def line_item(text: str, page_number: int, box: dict[str, Any]) -> dict[str, Any]:
    return {
        "text": text,
        "label": "text_line",
        "page_number": page_number,
        "bbox": box,
    }


def quad_to_bottom_left(box: Any, page_height: float, scale: float) -> dict[str, Any]:
    points = box.tolist() if hasattr(box, "tolist") else box
    xs = [float(point[0]) / scale for point in points]
    ys = [float(point[1]) / scale for point in points]
    left, right = min(xs), max(xs)
    top_from_top, bottom_from_top = min(ys), max(ys)
    return bottom_left_box(left, page_height - top_from_top, right, page_height - bottom_from_top)


def ocr_image(image: Any, page_number: int, page_height: float, scale: float) -> list[dict[str, Any]]:
    result = ocr_engine()(image)
    texts = getattr(result, "txts", None) or []
    boxes = getattr(result, "boxes", None)
    if boxes is None or len(texts) == 0:
        return []
    items: list[dict[str, Any]] = []
    for text, box in zip(texts, boxes):
        cleaned = " ".join(str(text).split())
        if not cleaned:
            continue
        items.append(line_item(cleaned, page_number, quad_to_bottom_left(box, page_height, scale)))
    return items


def embedded_pdf_lines(path: Path) -> tuple[list[dict[str, Any]], int]:
    import pypdfium2 as pdfium

    document = pdfium.PdfDocument(str(path))
    items: list[dict[str, Any]] = []
    try:
        page_count = len(document)
        for index in range(page_count):
            text_page = document[index].get_textpage()
            for rect_index in range(text_page.count_rects()):
                left, bottom, right, top = text_page.get_rect(rect_index)
                text = " ".join(text_page.get_text_bounded(left, bottom, right, top).split())
                if not text:
                    continue
                items.append(
                    line_item(text, index + 1, bottom_left_box(left, top, right, bottom))
                )
    finally:
        document.close()
    return items, page_count


def ocr_pdf_pages(path: Path) -> tuple[list[dict[str, Any]], int]:
    import pypdfium2 as pdfium

    document = pdfium.PdfDocument(str(path))
    items: list[dict[str, Any]] = []
    scale = 2.0
    try:
        page_count = len(document)
        for index in range(page_count):
            page = document[index]
            _width, height = page.get_size()
            bitmap = page.render(scale=scale)
            try:
                image = bitmap.to_pil()
            finally:
                close = getattr(bitmap, "close", None)
                if close is not None:
                    close()
            items.extend(ocr_image(image, index + 1, height, scale))
    finally:
        document.close()
    return items, page_count


def image_size(path: Path) -> tuple[int, int]:
    from PIL import Image

    with Image.open(path) as image:
        return image.size


def sort_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_page: dict[int, list[dict[str, Any]]] = {}
    for item in items:
        by_page.setdefault(item["page_number"], []).append(item)
    ordered: list[dict[str, Any]] = []
    for page_number in sorted(by_page):
        rows: list[list[dict[str, Any]]] = []
        for item in sorted(by_page[page_number], key=lambda entry: -entry["bbox"]["t"]):
            placed = False
            for row in rows:
                if abs(row[0]["bbox"]["t"] - item["bbox"]["t"]) <= 2.0:
                    row.append(item)
                    placed = True
                    break
            if not placed:
                rows.append([item])
        for row in rows:
            ordered.extend(sorted(row, key=lambda entry: entry["bbox"]["l"]))
    return ordered


def pages_from_items(items: list[dict[str, Any]], page_count: int) -> list[dict[str, Any]]:
    pages = []
    for number in range(1, max(page_count, 1) + 1):
        text = "\n".join(item["text"] for item in items if item["page_number"] == number)
        pages.append({"page_number": number, "text": text})
    return pages


def provenance_for(path: Path) -> tuple[str, list[dict[str, Any]], list[dict[str, Any]]]:
    suffix = path.suffix.lower()
    if suffix in IMAGE_SUFFIXES:
        _width, height = image_size(path)
        items = sort_items(ocr_image(path, 1, float(height), 1.0))
        source = "ocr" if items else "empty"
        return source, items, pages_from_items(items, 1)

    items, page_count = embedded_pdf_lines(path)
    source = "embedded"
    if not items:
        items, page_count = ocr_pdf_pages(path)
        source = "ocr" if items else "empty"
    items = sort_items(items)
    return source, items, pages_from_items(items, page_count)


def convert_path(path: Path) -> dict[str, Any]:
    source = path.resolve()
    suffix = source.suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise ValueError(f"Unsupported file type: {source.name}")
    if not source.is_file():
        raise FileNotFoundError(source)

    text_source, items, pages = provenance_for(source)
    if text_source == "empty":
        items = []
        for page in pages:
            page["text"] = ""

    force_ocr = suffix in IMAGE_SUFFIXES or text_source == "ocr"
    result = converter_for(force_ocr).convert(str(source))
    status = getattr(getattr(result, "status", ""), "value", str(getattr(result, "status", "")))
    if "fail" in str(status).lower() or "error" in str(status).lower():
        raise RuntimeError(
            f"Docling conversion failed for {source.name}: {status} {getattr(result, 'errors', '')}"
        )

    return {
        "parser": "docling",
        "parser_version": version("docling"),
        "source_file": source.name,
        "media_type": MEDIA_TYPES[suffix],
        "text_source": text_source,
        "pages": pages,
        "items": items,
        "document": json_safe(result.document.export_to_dict()),
    }


def write_parse(path: Path, output: Path) -> dict[str, Any]:
    payload = convert_path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return payload


def convert_directory(sample_dir: Path, output_dir: Path) -> list[Path]:
    files = sorted(
        path for path in sample_dir.iterdir() if path.is_file() and path.suffix.lower() in ALLOWED_SUFFIXES
    )
    written: list[Path] = []
    for path in files:
        destination = output_dir / f"{path.name}.json"
        write_parse(path, destination)
        written.append(destination)
        print(f"{path.name} -> {destination.name}", file=sys.stderr)
    return written


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Convert a PDF or image with local Docling.")
    parser.add_argument("--input", type=Path, help="One PDF or image to convert.")
    parser.add_argument("--output", type=Path, help="JSON path for --input.")
    parser.add_argument("--samples", type=Path, help="Directory of PDF and image samples.")
    parser.add_argument("--output-dir", type=Path, help="Directory for --samples JSON output.")
    args = parser.parse_args(argv)

    if args.samples or args.output_dir:
        if not args.samples or not args.output_dir:
            parser.error("--samples and --output-dir are used together")
        convert_directory(args.samples, args.output_dir)
        return 0
    if not args.input or not args.output:
        parser.error("--input and --output are required")
    write_parse(args.input, args.output)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from exc
