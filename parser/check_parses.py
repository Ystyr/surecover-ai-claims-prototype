"""Check recorded Docling parses, and optionally reconvert every sample."""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPECTED_PATH = ROOT / "fixtures" / "expected" / "complete-claim.json"
PARSE_DIR = ROOT / "fixtures" / "parses" / "complete"
SAMPLE_DIR = ROOT / "fixtures" / "samples" / "complete"
MAX_SAFE_INTEGER = 2**53 - 1


def normalize(text: str) -> str:
    return " ".join(text.split())


def page_text(parse: dict) -> str:
    return normalize("\n".join(page.get("text", "") for page in parse.get("pages", [])))


def item_texts(parse: dict) -> list[str]:
    return [normalize(item.get("text", "")) for item in parse.get("items", [])]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def walk_ints(value: object) -> list[int]:
    found: list[int] = []
    if isinstance(value, bool) or value is None:
        return found
    if isinstance(value, int):
        return [value]
    if isinstance(value, dict):
        for item in value.values():
            found.extend(walk_ints(item))
        return found
    if isinstance(value, list):
        for item in value:
            found.extend(walk_ints(item))
    return found


def check_item_confidence(name: str, index: int, item: dict, file_source: str) -> None:
    from convert_document import OCR_REVIEW_BELOW

    if file_source == "embedded":
        require("confidence" not in item, f"{name}: embedded item {index} has an OCR score")
        return
    if file_source != "ocr":
        return
    require("confidence" in item, f"{name}: OCR item {index} has no confidence")
    score = item.get("confidence")
    review = item.get("review")
    require(isinstance(review, bool), f"{name}: OCR item {index} has review {review!r}")
    if score is None:
        require(review is True, f"{name}: OCR item {index} is missing a score but is not marked for review")
        return
    require(isinstance(score, (int, float)) and not isinstance(score, bool), f"{name}: OCR item {index} confidence is {score!r}")
    require(0 <= float(score) <= 1, f"{name}: OCR item {index} confidence is {score}")
    require(review is (float(score) < OCR_REVIEW_BELOW), f"{name}: OCR item {index} review flag does not match {score}")


def check_box(name: str, index: int, item: dict) -> None:
    box = item.get("bbox")
    require(isinstance(box, dict), f"{name}: item {index} has no box")
    require(box.get("coord_origin") == "BOTTOMLEFT", f"{name}: item {index} is not BOTTOMLEFT")
    require(box["l"] < box["r"], f"{name}: item {index} has a reversed horizontal box")
    require(box["t"] > box["b"], f"{name}: item {index} has a reversed vertical box")


def check_page_sources(name: str, parse: dict, expected_source: str) -> None:
    pages = parse.get("pages") or []
    require(bool(pages), f"{name}: no pages")
    for page in pages:
        source = page.get("text_source")
        require(source in {"embedded", "ocr", "empty", "unreadable"}, f"{name}: page {page.get('page_number')} has text_source {source!r}")
        require(source == expected_source, f"{name}: page {page.get('page_number')} is {source}, expected {expected_source}")
        if source in {"empty", "unreadable"}:
            require(not str(page.get("text", "")).strip(), f"{name}: page {page.get('page_number')} is {source} but contains text")


def check_pdf_locations(sample_path: Path, parse: dict) -> None:
    import pypdfium2 as pdfium

    document = pdfium.PdfDocument(str(sample_path))
    try:
        for index, item in enumerate(parse.get("items", [])):
            box = item["bbox"]
            text_page = document[item["page_number"] - 1].get_textpage()
            found = " ".join(text_page.get_text_bounded(box["l"], box["b"], box["r"], box["t"]).split())
            require(
                normalize(found) == normalize(item["text"]),
                f"{sample_path.name}: item {index} box reads {found!r}, not {item['text']!r}",
            )
    finally:
        document.close()


def check_image_locations(sample_path: Path, parse: dict, phrases: list[str], exact: bool = True) -> None:
    from PIL import Image

    sys.path.insert(0, str(ROOT / "parser"))
    from convert_document import ocr_image

    with Image.open(sample_path) as image:
        width, height = image.size
        by_text = {normalize(item["text"]): item for item in parse.get("items", [])}
        for phrase in phrases:
            item = by_text.get(normalize(phrase))
            require(item is not None, f"{sample_path.name}: no item for location check {phrase!r}")
            box = item["bbox"]
            # Twelve pixels covers clipped glyph edges on the photographed pass.
            # A wider crop starts to include the label on the line above.
            # Crop OCR can reorder words on one line, so the words are compared.
            pad = 12
            left = max(0, int(box["l"]) - pad)
            right = min(width, int(box["r"]) + pad + 1)
            upper = max(0, int(height - box["t"]) - pad)
            lower = min(height, int(height - box["b"]) + pad + 1)
            require(right > left and lower > upper, f"{sample_path.name}: crop for {phrase!r} is empty")
            crop = image.crop((left, upper, right, lower))
            found_items = ocr_image(crop, 1, float(crop.height), 1.0)
            found = " ".join(entry["text"] for entry in found_items)
            found_words = normalize(found).split()
            phrase_words = normalize(phrase).split()
            if exact:
                matches = sorted(found_words) == sorted(phrase_words)
            else:
                crop_area = (right - left) * (lower - upper)
                require(
                    crop_area * 4 < width * height,
                    f"{sample_path.name}: box for {phrase!r} covers too much of the page",
                )
                matches = all(word in found_words for word in phrase_words)
            require(matches, f"{sample_path.name}: crop for {phrase!r} reads {found!r}")


def check_locations(sample_path: Path, parse: dict, expected: dict) -> None:
    if parse.get("text_source") == "empty":
        return
    if sample_path.suffix.lower() == ".pdf":
        check_pdf_locations(sample_path, parse)
        return
    check_image_locations(sample_path, parse, expected.get("whole_items", []))


def check_parse(parse: dict, expected: dict) -> None:
    name = expected["file"]
    require(parse.get("parser") == "docling", f"{name}: parser is {parse.get('parser')!r}")
    require(parse.get("media_type"), f"{name}: missing media_type")
    require(
        parse.get("text_source") == expected["text_source"],
        f"{name}: text_source is {parse.get('text_source')!r}, expected {expected['text_source']!r}",
    )
    blob = page_text(parse)
    for phrase in expected["contains"]:
        require(normalize(phrase) in blob, f"{name}: missing {phrase!r}")
    texts = item_texts(parse)
    require(bool(texts), f"{name}: expected extracted items")
    for phrase in expected.get("whole_items", []):
        require(normalize(phrase) in texts, f"{name}: no item is exactly {phrase!r}")
    for index, item in enumerate(parse.get("items", [])):
        require(isinstance(item.get("page_number"), int), f"{name}: item {index} has no page number")
        check_box(name, index, item)
        check_item_confidence(name, index, item, expected["text_source"])
    check_page_sources(name, parse, expected["text_source"])
    for number in walk_ints(parse.get("document")):
        require(abs(number) <= MAX_SAFE_INTEGER, f"{name}: raw document has an unsafe integer")


def check_recorded(expected: dict) -> None:
    for document in expected["sample_documents"]:
        path = PARSE_DIR / f"{document['file']}.json"
        require(path.is_file(), f"Missing recorded parse: {path.relative_to(ROOT)}")
        parse = json.loads(path.read_text(encoding="utf-8"))
        check_parse(parse, document)
        check_locations(SAMPLE_DIR / document["file"], parse, document)
        print(f"recorded {document['file']}")


def check_live(expected: dict) -> None:
    from PIL import Image

    sys.path.insert(0, str(ROOT / "parser"))
    from convert_document import convert_path

    for document in expected["sample_documents"]:
        live = convert_path(SAMPLE_DIR / document["file"])
        check_parse(live, document)
        recorded = json.loads((PARSE_DIR / f"{document['file']}.json").read_text(encoding="utf-8"))
        require(
            item_texts(live) == item_texts(recorded),
            f"{document['file']}: live item text does not match the recorded parse",
        )
        print(f"live {document['file']}")

    with tempfile.TemporaryDirectory() as directory:
        blank_path = Path(directory) / "blank.png"
        Image.new("RGB", (200, 200), "white").save(blank_path, format="PNG")
        blank = convert_path(blank_path)
        require(blank.get("text_source") == "empty", f"blank: text_source is {blank.get('text_source')!r}")
        require(blank.get("items") == [], "blank: items were not empty")
        require(page_text(blank) == "", "blank: page text was not empty")
        require(
            blank["pages"][0]["text_source"] == "empty",
            f"blank: page text_source is {blank['pages'][0].get('text_source')!r}",
        )
        print("live blank.png")
        check_mixed_pdf()


def write_mixed_pdf(path: Path, scanned_image: Path) -> None:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    document = canvas.Canvas(str(path), pagesize=A4)
    document.drawString(72, 720, "Embedded page marker")
    document.showPage()
    document.drawImage(str(scanned_image), 72, 520, width=360, height=90, mask="auto")
    document.showPage()
    document.showPage()
    document.save()


def write_scanned_line(path: Path) -> None:
    from PIL import Image, ImageDraw, ImageFont

    font = ImageFont.truetype(str(ROOT / "parser" / "fonts" / "NotoSans-Regular.ttf"), 48)
    image = Image.new("RGB", (900, 180), "white")
    ImageDraw.Draw(image).text((24, 60), "Scanned page SC101", fill="black", font=font)
    image.save(path, format="PNG")


def check_mixed_pdf() -> None:
    sys.path.insert(0, str(ROOT / "parser"))
    from convert_document import convert_path

    with tempfile.TemporaryDirectory() as directory:
        folder = Path(directory)
        scanned = folder / "scanned-line.png"
        pdf_path = folder / "mixed.pdf"
        write_scanned_line(scanned)
        write_mixed_pdf(pdf_path, scanned)
        parse = convert_path(pdf_path)
        pages = parse["pages"]
        require(len(pages) == 3, f"mixed: expected 3 pages, got {len(pages)}")
        require(pages[0]["text_source"] == "embedded", f"mixed: page 1 is {pages[0]['text_source']}")
        require("Embedded page marker" in pages[0]["text"], "mixed: page 1 lost its embedded text")
        require(pages[1]["text_source"] == "ocr", f"mixed: scanned page is {pages[1]['text_source']}")
        require("SC101" in pages[1]["text"], f"mixed: scanned page text is {pages[1]['text']!r}")
        require(pages[2]["text_source"] == "empty", f"mixed: blank page is {pages[2]['text_source']}")
        require(not pages[2]["text"].strip(), f"mixed: blank page text is {pages[2]['text']!r}")
        require(parse["text_source"] == "ocr", f"mixed: file text_source is {parse['text_source']}")
        print("live mixed.pdf")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check stage-1 Docling parses.")
    parser.add_argument(
        "--live",
        action="store_true",
        help="Reconvert every sample and a blank image.",
    )
    args = parser.parse_args(argv)
    expected = json.loads(EXPECTED_PATH.read_text(encoding="utf-8"))
    check_recorded(expected)
    if args.live:
        check_live(expected)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from exc
