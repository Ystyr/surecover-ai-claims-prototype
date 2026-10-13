"""Check recorded Docling parses, and optionally reconvert the live samples."""

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


def normalize(text: str) -> str:
    return " ".join(text.split())


def page_text(parse: dict) -> str:
    return normalize("\n".join(page.get("text", "") for page in parse.get("pages", [])))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def check_parse(parse: dict, expected: dict) -> None:
    name = expected["file"]
    require(parse.get("parser") == "docling", f"{name}: parser is {parse.get('parser')!r}")
    require(
        parse.get("text_source") == expected["text_source"],
        f"{name}: text_source is {parse.get('text_source')!r}, expected {expected['text_source']!r}",
    )
    blob = page_text(parse)
    for phrase in expected["contains"]:
        require(normalize(phrase) in blob, f"{name}: missing {phrase!r}")
    items = parse.get("items", [])
    require(bool(items), f"{name}: expected extracted items")
    for index, item in enumerate(items):
        require(
            isinstance(item.get("page_number"), int),
            f"{name}: item {index} has no page number",
        )


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

    by_file = {document["file"]: document for document in expected["sample_documents"]}
    for name in ("claim-form.pdf", "boarding-pass-sc101.png"):
        parse = convert_path(SAMPLE_DIR / name)
        check_parse(parse, by_file[name])
        print(f"live {name}")

    with tempfile.TemporaryDirectory() as directory:
        blank_path = Path(directory) / "blank.png"
        Image.new("RGB", (200, 200), "white").save(blank_path, format="PNG")
        blank = convert_path(blank_path)
        require(blank.get("parser") == "docling", "blank: parser was not docling")
        require(blank.get("text_source") == "empty", f"blank: text_source is {blank.get('text_source')!r}")
        require(page_text(blank) == "", "blank: page text was not empty")
        print("live blank.png")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check stage-1 Docling parses.")
    parser.add_argument(
        "--live",
        action="store_true",
        help="Reconvert the claim form, boarding-pass PNG, and a blank image.",
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
