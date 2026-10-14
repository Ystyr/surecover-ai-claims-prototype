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


def check_box(name: str, index: int, item: dict) -> None:
    box = item.get("bbox")
    require(isinstance(box, dict), f"{name}: item {index} has no box")
    require(box.get("coord_origin") == "BOTTOMLEFT", f"{name}: item {index} is not BOTTOMLEFT")
    require(box["l"] < box["r"], f"{name}: item {index} has a reversed horizontal box")
    require(box["t"] > box["b"], f"{name}: item {index} has a reversed vertical box")


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
    for number in walk_ints(parse.get("document")):
        require(abs(number) <= MAX_SAFE_INTEGER, f"{name}: raw document has an unsafe integer")


def check_recorded(expected: dict) -> None:
    for document in expected["sample_documents"]:
        path = PARSE_DIR / f"{document['file']}.json"
        require(path.is_file(), f"Missing recorded parse: {path.relative_to(ROOT)}")
        check_parse(json.loads(path.read_text(encoding="utf-8")), document)
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
        print("live blank.png")


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
