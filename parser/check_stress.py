"""Challenge the parser with incomplete, degraded, awkward, and invalid evidence.

Stock boarding-pass images stay out of the complete-claim golden set. Files
listed as exploratory are parsed only to confirm they do not crash; their text
is not treated as a passing result. Those files look like Adobe Stock previews
and are not licensed for a public push. Generated degradations and bad files
are built in a temporary directory.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "parser"))

from check_parses import check_image_locations, normalize, require
from convert_document import convert_path, provenance_for, write_parse

EXPECTED_PATH = ROOT / "fixtures" / "expected" / "stress-images.json"
PHOTO_PATH = ROOT / "fixtures" / "samples" / "complete" / "boarding-pass-sc101.png"
PASS_PHRASES = ["Jamie Lee", "SC101", "1 August 2026", "SIN", "NRT"]


def item_texts(parse: dict) -> list[str]:
    return [normalize(item.get("text", "")) for item in parse.get("items", [])]


def joined_text(parse: dict) -> str:
    return " ".join(item_texts(parse)).upper()


def items_named(parse: dict, phrase: str) -> list[dict]:
    target = normalize(phrase)
    return [item for item in parse.get("items", []) if normalize(item.get("text", "")) == target]


def check_whole_items(name: str, parse: dict, phrases: list[str]) -> None:
    found = set(item_texts(parse))
    for phrase in phrases:
        require(normalize(phrase) in found, f"{name}: missing whole item {phrase!r}")


def check_absent(name: str, parse: dict, phrases: list[str]) -> None:
    blob = joined_text(parse)
    for phrase in phrases:
        require(phrase.upper() not in blob, f"{name}: invented {phrase!r} in {blob!r}")


def check_repeated(name: str, parse: dict, phrase: str) -> None:
    found = items_named(parse, phrase)
    require(len(found) >= 2, f"{name}: {phrase!r} appears {len(found)} times")
    ordered = sorted(found, key=lambda item: item["bbox"]["l"])
    left, right = ordered[0], ordered[-1]
    require(
        left["bbox"]["l"] + 20 < right["bbox"]["l"],
        f"{name}: copies of {phrase!r} are not in separate columns",
    )


def check_order(name: str, parse: dict, phrases: list[str]) -> None:
    indexes = []
    texts = item_texts(parse)
    for phrase in phrases:
        require(normalize(phrase) in texts, f"{name}: missing ordered item {phrase!r}")
        indexes.append(texts.index(normalize(phrase)))
    require(indexes == sorted(indexes), f"{name}: reading order is {indexes} for {phrases}")


def check_stock(expected: dict) -> None:
    directory = ROOT / expected["directory"]
    files = sorted(path for path in directory.glob("*.jpg") if path.is_file())
    by_entry = {entry["file"]: entry for entry in expected["images"]}
    exploratory = set(expected.get("exploratory", []))
    names = {path.name for path in files}
    missing = sorted((set(by_entry) | exploratory) - names)
    require(not missing, f"stock: missing {missing}")
    unlisted = sorted(names - set(by_entry) - exploratory)
    require(not unlisted, f"stock: unlisted images {unlisted}")
    overlap = sorted(set(by_entry) & exploratory)
    require(not overlap, f"stock: listed as both checked and exploratory {overlap}")
    for path in files:
        if path.name in exploratory:
            provenance_for(path)
            print(f"exploratory {path.name}")
            continue
        source, items, pages = provenance_for(path)
        parse = {"text_source": source, "items": items, "pages": pages}
        require(source == "ocr", f"{path.name}: text_source is {source}")
        require(bool(items), f"{path.name}: produced no items")
        require(pages[0]["text_source"] == "ocr", f"{path.name}: page text_source is {pages[0]['text_source']}")
        for item in items:
            require("confidence" in item and isinstance(item.get("review"), bool), f"{path.name}: OCR item has no review signal")
        entry = by_entry.get(path.name)
        if entry is not None:
            label = f"{entry.get('role', path.name)} {path.name}"
            require(source == entry["text_source"], f"{label}: text_source is {source}")
            check_whole_items(label, parse, entry.get("whole_items", []))
            check_absent(label, parse, entry.get("absent", []))
            for phrase in entry.get("repeated", []):
                check_repeated(label, parse, phrase)
            if entry.get("order"):
                check_order(label, parse, entry["order"])
            if entry.get("digits_only"):
                for text in item_texts(parse):
                    require(text.isdigit(), f"{label}: non-digit item {text!r}")
        print(f"stock {path.name}")


def save_variants(folder: Path) -> dict[str, Path]:
    photo = Image.open(PHOTO_PATH).convert("RGB")
    variants = {
        "mild_blur": photo.filter(ImageFilter.GaussianBlur(radius=1.2)),
        "mild_downscale": photo.resize(
            (int(photo.width * 0.55), int(photo.height * 0.55)),
            Image.Resampling.LANCZOS,
        ),
        "mild_rotate": photo.rotate(12, expand=True, fillcolor="white", resample=Image.Resampling.BICUBIC),
        "mild_contrast": ImageEnhance.Contrast(photo).enhance(0.55),
        "rotate_90": photo.rotate(90, expand=True, fillcolor="white"),
        "low_contrast": ImageEnhance.Contrast(photo).enhance(0.08),
        "crop_right": photo.crop((0, 0, int(photo.width * 0.42), photo.height)),
        "pixelated": photo.resize((90, 116), Image.Resampling.BILINEAR).resize(
            photo.size,
            Image.Resampling.NEAREST,
        ),
        "heavy_blur": photo.filter(ImageFilter.GaussianBlur(radius=18)),
    }
    written = {}
    for name, image in variants.items():
        path = folder / f"{name}.png"
        image.save(path)
        written[name] = path
    return written


def check_phrase_set(name: str, parse: dict, present: list[str], absent: list[str]) -> None:
    check_whole_items(name, parse, present)
    check_absent(name, parse, absent)


def check_degraded(folder: Path) -> None:
    paths = save_variants(folder)
    # Degraded crops pick up a neighboring speck or a tilted label, so the box
    # check requires the phrase words inside a box that is still a small part of the page.
    for name in ("mild_blur", "mild_downscale", "mild_contrast", "mild_rotate", "rotate_90"):
        source, items, pages = provenance_for(paths[name])
        parse = {"text_source": source, "items": items, "pages": pages}
        require(source == "ocr", f"{name}: text_source is {source}")
        check_phrase_set(name, parse, PASS_PHRASES, [])
        # A 90-degree crop is sideways, so a second OCR of that crop is not a stable read.
        if name != "rotate_90":
            check_image_locations(paths[name], parse, PASS_PHRASES, exact=False)
        print(f"degraded {name}")

    source, items, pages = provenance_for(paths["low_contrast"])
    parse = {"text_source": source, "items": items, "pages": pages}
    require(source == "ocr", f"low_contrast: text_source is {source}")
    check_phrase_set("low_contrast", parse, ["Jamie Lee", "SC101", "1 August 2026", "NRT"], ["SIN"])
    print("degraded low_contrast")

    source, items, pages = provenance_for(paths["crop_right"])
    parse = {"text_source": source, "items": items, "pages": pages}
    require(source == "ocr", f"crop_right: text_source is {source}")
    check_phrase_set("crop_right", parse, ["Jamie Lee", "SC101", "SIN"], ["NRT", "1 August 2026"])
    check_image_locations(paths["crop_right"], parse, ["Jamie Lee", "SC101", "SIN"], exact=False)
    print("degraded crop_right")

    source, items, pages = provenance_for(paths["pixelated"])
    parse = {"text_source": source, "items": items, "pages": pages}
    require(source in {"ocr", "unreadable"}, f"pixelated: text_source is {source}")
    check_absent("pixelated", parse, PASS_PHRASES)
    print("degraded pixelated")

    source, items, pages = provenance_for(paths["heavy_blur"])
    parse = {"text_source": source, "items": items, "pages": pages}
    require(source == "unreadable", f"heavy_blur: text_source is {source}")
    require(items == [], "heavy_blur: items were not empty")
    require(pages[0]["text_source"] == "unreadable", "heavy_blur: page was not unreadable")
    public = convert_path(paths["heavy_blur"])
    require(public["text_source"] == "unreadable", f"heavy_blur public text_source is {public['text_source']}")
    require(public["items"] == [], "heavy_blur public items were not empty")
    require(public["pages"][0]["text_source"] == "unreadable", "heavy_blur public page was not unreadable")
    print("degraded heavy_blur")


def write_partial_pdf(path: Path, barcode: Path, blurred: Path) -> None:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    document = canvas.Canvas(str(path), pagesize=A4)
    document.drawString(72, 720, "Embedded page marker")
    document.showPage()
    document.drawImage(str(barcode), 72, 500, width=400, height=120, mask="auto")
    document.showPage()
    document.drawImage(str(blurred), 72, 180, width=420, height=540, mask="auto")
    document.save()


def check_partial_pdf(folder: Path) -> None:
    barcode = ROOT / "fixtures" / "samples" / "samples" / "240_F_529983275_crB5BaMmeNruQHhYnThYrfypQFGZQIbG.jpg"
    blurred = folder / "heavy_blur.png"
    pdf_path = folder / "partial.pdf"
    write_partial_pdf(pdf_path, barcode, blurred)
    parse = convert_path(pdf_path)
    pages = parse["pages"]
    require(len(pages) == 3, f"partial: expected 3 pages, got {len(pages)}")
    require(pages[0]["text_source"] == "embedded", f"partial: page 1 is {pages[0]['text_source']}")
    require("Embedded page marker" in pages[0]["text"], "partial: page 1 lost its text")
    require(pages[1]["text_source"] == "ocr", f"partial: barcode page is {pages[1]['text_source']}")
    require("5784966" in pages[1]["text"], f"partial: barcode page text is {pages[1]['text']!r}")
    barcode_items = [item for item in parse["items"] if item["page_number"] == 2]
    require(bool(barcode_items), "partial: barcode page has no items")
    for item in barcode_items:
        require("confidence" in item and isinstance(item.get("review"), bool), "partial: barcode item has no review signal")
    require("Embedded page marker" not in pages[1]["text"], "partial: barcode page inherited the text page")
    for phrase in ("PASSENGER", "JOHN", "FLIGHT", "BOARDING"):
        require(phrase not in pages[1]["text"].upper(), f"partial: barcode page invented {phrase}")
    require(pages[2]["text_source"] == "unreadable", f"partial: blurred page is {pages[2]['text_source']}")
    require(not pages[2]["text"].strip(), f"partial: blurred page text is {pages[2]['text']!r}")
    require(parse["text_source"] == "partial", f"partial: file text_source is {parse['text_source']}")
    print("partial mixed.pdf")
    embedded_only = folder / "embedded-unreadable.pdf"
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    document = canvas.Canvas(str(embedded_only), pagesize=A4)
    document.drawString(72, 720, "Embedded page marker")
    document.showPage()
    document.drawImage(str(blurred), 72, 180, width=420, height=540, mask="auto")
    document.save()
    hidden = convert_path(embedded_only)
    require(hidden["pages"][0]["text_source"] == "embedded", "embedded-unreadable: page 1 was not embedded")
    require(hidden["pages"][1]["text_source"] == "unreadable", "embedded-unreadable: page 2 was not unreadable")
    require(hidden["text_source"] == "partial", f"embedded-unreadable: file text_source is {hidden['text_source']}")
    print("partial embedded-unreadable.pdf")


def check_blank_and_invalid(folder: Path) -> None:
    from reportlab.pdfgen import canvas

    white = folder / "white.png"
    Image.new("RGB", (200, 200), "white").save(white)
    blank = convert_path(white)
    require(blank["text_source"] == "empty", f"white: text_source is {blank['text_source']}")
    require(blank["items"] == [], "white: items were not empty")
    require(blank["pages"][0]["text_source"] == "empty", "white: page was not empty")
    print("invalid white.png")
    faint = folder / "faint.png"
    font = ImageFont.truetype(str(ROOT / "parser" / "fonts" / "NotoSans-Regular.ttf"), 72)
    faint_image = Image.new("RGB", (900, 220), "white")
    ImageDraw.Draw(faint_image).text((40, 70), "SC101", fill=(245, 245, 245), font=font)
    faint_image.save(faint)
    faint_source, faint_items, faint_pages = provenance_for(faint)
    require(faint_source == "unreadable", f"faint: text_source is {faint_source}")
    require(faint_items == [], "faint: items were not empty")
    require(faint_pages[0]["text_source"] == "unreadable", "faint: page was not unreadable")
    print("invalid faint.png")

    locked = folder / "locked.pdf"
    document = canvas.Canvas(str(locked), encrypt="secret")
    document.drawString(72, 720, "Hidden page")
    document.save()
    broken = folder / "broken.pdf"
    broken.write_bytes(b"%PDF-1.4\nnot a pdf")
    note = folder / "note.txt"
    note.write_text("not a boarding pass", encoding="utf-8")
    document_file = folder / "notes.docx"
    document_file.write_bytes(b"not a pdf")
    huge = folder / "huge.jpg"
    Image.new("RGB", (5000, 5000), "white").save(huge, quality=30)

    for path, needle in (
        (locked, "password"),
        (broken, "could not read pdf"),
        (note, "unsupported"),
        (document_file, "unsupported"),
        (huge, "too large"),
    ):
        output = folder / f"{path.name}.json"
        try:
            write_parse(path, output)
        except Exception as exc:
            message = str(exc).lower()
            require(needle in message, f"{path.name}: {exc}")
            require(not output.exists(), f"{path.name}: wrote {output.name}")
            print(f"invalid {path.name}")
            continue
        raise AssertionError(f"{path.name}: parser returned a document")


def main() -> int:
    expected = json.loads(EXPECTED_PATH.read_text(encoding="utf-8"))
    check_stock(expected)
    with tempfile.TemporaryDirectory() as directory:
        folder = Path(directory)
        check_degraded(folder)
        check_partial_pdf(folder)
        check_blank_and_invalid(folder)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from exc
