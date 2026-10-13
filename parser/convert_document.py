"""Convert one PDF or image into the stage-1 page-text contract.

Docling's standard pipeline reads the file. This script does not classify
documents or apply policy. Full-page OCR is enabled only for images.
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

_converters: dict[bool, Any] = {}


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


def pdf_has_embedded_text(path: Path) -> bool:
    import pypdfium2 as pdfium

    document = pdfium.PdfDocument(str(path))
    try:
        for index in range(len(document)):
            text_page = document[index].get_textpage()
            text = text_page.get_text_bounded() or ""
            if text.strip():
                return True
    finally:
        document.close()
    return False


def json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, Path):
        return str(value)
    nested = getattr(value, "value", None)
    if isinstance(nested, (str, int, float, bool)):
        return nested
    return str(value)


def bbox_dict(bbox: Any) -> dict[str, Any] | None:
    if bbox is None:
        return None
    if hasattr(bbox, "model_dump"):
        dumped = bbox.model_dump()
    elif all(hasattr(bbox, name) for name in ("l", "t", "r", "b")):
        dumped = {"l": bbox.l, "t": bbox.t, "r": bbox.r, "b": bbox.b}
        origin = getattr(bbox, "coord_origin", None)
        if origin is not None:
            dumped["coord_origin"] = getattr(origin, "value", str(origin))
    else:
        return None
    kept = {
        key: json_safe(dumped[key])
        for key in ("l", "t", "r", "b", "coord_origin")
        if key in dumped and dumped[key] is not None
    }
    return kept or None


def item_label(item: Any) -> str:
    label = getattr(item, "label", None)
    if label is None:
        return type(item).__name__
    return str(getattr(label, "value", label))


def first_page(item: Any) -> int | None:
    provenance = getattr(item, "prov", None) or []
    if not provenance:
        return None
    return int(provenance[0].page_no)


def first_bbox(item: Any) -> dict[str, Any] | None:
    provenance = getattr(item, "prov", None) or []
    if not provenance:
        return None
    return bbox_dict(getattr(provenance[0], "bbox", None))


def table_cells(item: Any) -> list[Any]:
    data = getattr(item, "data", None)
    if data is None:
        return []
    return list(getattr(data, "table_cells", []) or [])


def is_table(item: Any) -> bool:
    if table_cells(item):
        return True
    return item_label(item) == "table"


def page_numbers(doc: Any) -> list[int]:
    numbers: list[int] = []
    pages = getattr(doc, "pages", {}) or {}
    for key, page in pages.items():
        page_no = getattr(page, "page_no", None)
        if page_no is None:
            try:
                page_no = int(key)
            except (TypeError, ValueError):
                continue
        numbers.append(int(page_no))
    return sorted(set(numbers)) or [1]


def markdown_for_page(doc: Any, page_number: int, only_page: bool) -> str:
    try:
        text = doc.export_to_markdown(page_no=page_number) or ""
    except TypeError:
        text = doc.export_to_markdown() or "" if only_page else ""
    return str(text).strip()


def items_from_document(doc: Any, fallback_page: int | None) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for item, _level in doc.iterate_items():
        page_number = first_page(item)
        if page_number is None:
            page_number = fallback_page
        if is_table(item):
            for cell in table_cells(item):
                text = str(getattr(cell, "text", "") or "").strip()
                if not text:
                    continue
                record: dict[str, Any] = {
                    "text": text,
                    "label": "table_cell",
                    "page_number": page_number,
                }
                cell_bbox = bbox_dict(getattr(cell, "bbox", None)) or first_bbox(item)
                if cell_bbox is not None:
                    record["bbox"] = cell_bbox
                items.append(record)
            continue
        text = str(getattr(item, "text", "") or "").strip()
        if not text:
            continue
        record = {
            "text": text,
            "label": item_label(item),
            "page_number": page_number,
        }
        item_bbox = first_bbox(item)
        if item_bbox is not None:
            record["bbox"] = item_bbox
        items.append(record)
    return items


def pages_from_document(doc: Any) -> list[dict[str, Any]]:
    numbers = page_numbers(doc)
    pages = [
        {"page_number": number, "text": markdown_for_page(doc, number, len(numbers) == 1)}
        for number in numbers
    ]
    if len(pages) == 1 and not pages[0]["text"]:
        pages[0]["text"] = str(doc.export_to_markdown() or "").strip()
    return pages


def text_source_for(path: Path, pages: list[dict[str, Any]]) -> str:
    joined = "\n".join(page["text"] for page in pages).strip()
    if not joined:
        return "empty"
    if path.suffix.lower() in IMAGE_SUFFIXES:
        return "ocr"
    if pdf_has_embedded_text(path):
        return "embedded"
    return "ocr"


def convert_path(path: Path) -> dict[str, Any]:
    source = path.resolve()
    suffix = source.suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise ValueError(f"Unsupported file type: {source.name}")
    if not source.is_file():
        raise FileNotFoundError(source)

    force_ocr = suffix in IMAGE_SUFFIXES
    result = converter_for(force_ocr).convert(str(source))
    status = getattr(getattr(result, "status", ""), "value", str(getattr(result, "status", "")))
    if "fail" in str(status).lower() or "error" in str(status).lower():
        raise RuntimeError(f"Docling conversion failed for {source.name}: {status} {getattr(result, 'errors', '')}")

    document = result.document
    pages = pages_from_document(document)
    fallback_page = pages[0]["page_number"] if len(pages) == 1 else None
    items = items_from_document(document, fallback_page)
    return {
        "parser": "docling",
        "parser_version": version("docling"),
        "source_file": source.name,
        "text_source": text_source_for(source, pages),
        "pages": pages,
        "items": items,
        "document": json_safe(document.export_to_dict()),
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
