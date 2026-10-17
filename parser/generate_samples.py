"""Write the fictional complete-claim PDFs and boarding-pass PNG."""

from __future__ import annotations

import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "fixtures" / "samples" / "complete"
CONFLICT = ROOT / "fixtures" / "samples" / "conflict"
UNREADABLE = ROOT / "fixtures" / "samples" / "unreadable"
CONFLICT_FLIGHTS = [
    ["SC101", "1 August 2026", "SIN", "NRT"],
    ["SC202", "8 August 2026", "NRT", "SIN"],
]
BANNER = "Fictional demonstration data. Not a SureCover policy document."

FLIGHT_HEADER = ["Flight", "Date", "From", "To"]
FLIGHTS = [
    ["SC101", "1 August 2026", "SIN", "NRT"],
    ["SC202", "7 August 2026", "NRT", "SIN"],
]


def styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "banner": ParagraphStyle(
            "Banner",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9,
            textColor=colors.HexColor("#555555"),
            spaceAfter=8,
        ),
        "title": ParagraphStyle(
            "DocTitle",
            parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=16,
            spaceAfter=10,
        ),
        "body": ParagraphStyle(
            "Body",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=11,
            leading=15,
            spaceAfter=6,
        ),
    }


def flight_table(flights: list[list[str]] | None = None) -> Table:
    rows = FLIGHTS if flights is None else flights
    table = Table([FLIGHT_HEADER, *rows], colWidths=[35 * mm, 45 * mm, 30 * mm, 30 * mm])
    table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
                ("FONTSIZE", (0, 0), (-1, -1), 11),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E6E6E6")),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#888888")),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    return table


def write_pdf(path: Path, story: list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    document = SimpleDocTemplate(
        str(path),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=path.stem,
    )
    document.build(story)


def write_claim_form(path: Path) -> None:
    style = styles()
    write_pdf(
        path,
        [
            Paragraph(BANNER, style["banner"]),
            Paragraph("Flight-delay claim form", style["title"]),
            Paragraph("Claimant: Jamie Lee", style["body"]),
            Paragraph("Policy reference: SC-DEMO-1001", style["body"]),
            Paragraph("Claim type: Flight delay", style["body"]),
            Paragraph("Return to Singapore: Friday 7 August 2026", style["body"]),
            Spacer(1, 4 * mm),
            Paragraph("Affected flights", style["body"]),
            flight_table(),
        ],
    )


def write_itinerary(path: Path, title: str, flights: list[list[str]] | None = None) -> None:
    style = styles()
    write_pdf(
        path,
        [
            Paragraph(BANNER, style["banner"]),
            Paragraph(title, style["title"]),
            Paragraph("Passenger: Jamie Lee", style["body"]),
            Spacer(1, 4 * mm),
            flight_table(flights),
        ],
    )


def write_boarding_pass(
    path: Path,
    flight: str = "SC101",
    date: str = "1 August 2026",
    origin: str = "SIN",
    destination: str = "NRT",
) -> None:
    style = styles()
    write_pdf(
        path,
        [
            Paragraph(BANNER, style["banner"]),
            Paragraph("Boarding pass", style["title"]),
            Paragraph("Passenger: Jamie Lee", style["body"]),
            Paragraph(f"Flight: {flight}", style["body"]),
            Paragraph(f"Date: {date}", style["body"]),
            Paragraph(f"From: {origin}", style["body"]),
            Paragraph(f"To: {destination}", style["body"]),
        ],
    )


def write_delay_letter(path: Path) -> None:
    style = styles()
    write_pdf(
        path,
        [
            Paragraph(BANNER, style["banner"]),
            Paragraph("Airline delay notice", style["title"]),
            Paragraph("Passenger: Jamie Lee", style["body"]),
            Paragraph(
                "Flight SC202 from NRT to SIN on 7 August 2026 was delayed because of a late inbound aircraft.",
                style["body"],
            ),
            Paragraph("Delay duration: 8 hours.", style["body"]),
        ],
    )


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "NotoSans-Bold.ttf" if bold else "NotoSans-Regular.ttf"
    font_path = Path(__file__).resolve().parent / "fonts" / name
    if not font_path.is_file():
        raise FileNotFoundError(f"Missing bundled font: {font_path}")
    return ImageFont.truetype(str(font_path), size=size)


def draw_barcode(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int]) -> None:
    left, top, right, bottom = box
    cursor = left
    picker = random.Random(101)
    while cursor < right:
        bar = picker.choice((2, 3, 4, 5))
        gap = picker.choice((2, 3, 4))
        draw.rectangle((cursor, top, min(cursor + bar, right), bottom), fill="#1A1A1A")
        cursor += bar + gap


def render_boarding_pass_card(
    flight: str = "SC101",
    date: str = "1 August 2026",
    origin: str = "SIN",
    destination: str = "NRT",
) -> Image.Image:
    """Sharp fictional pass. The claim phrases stay large and high contrast for OCR."""
    width, height = 1240, 1600
    card = Image.new("RGB", (width, height), "#F3EFE4")
    draw = ImageDraw.Draw(card)
    draw.rectangle((0, 0, width, 250), fill="#14315C")
    draw.rectangle((0, 250, width, 264), fill="#C4A35A")
    draw.text((72, 48), "SC AIR", fill="white", font=load_font(72, bold=True))
    draw.text((72, 140), "BOARDING PASS", fill="#E7EEF8", font=load_font(48, bold=True))

    label = load_font(32)
    value = load_font(68, bold=True)
    ink = "#1A1A1A"
    mute = "#5C6770"

    def field(caption: str, text: str, x: int, y: int) -> None:
        draw.text((x, y), caption, fill=mute, font=label)
        draw.text((x, y + 48), text, fill=ink, font=value)

    field("PASSENGER", "Jamie Lee", 72, 330)
    field("FLIGHT", flight, 72, 560)
    field("DATE", date, 620, 560)
    field("FROM", origin, 72, 820)
    field("TO", destination, 620, 820)
    draw_barcode(draw, (72, 1120, width - 72, 1280))
    draw.text(
        (72, 1360),
        "Fictional demonstration data. Not a SureCover policy document.",
        fill=mute,
        font=load_font(26),
    )
    return card


def write_boarding_pass_png(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    render_boarding_pass_card().save(path, format="PNG")


def write_conflict_itinerary() -> None:
    write_itinerary(CONFLICT / "revised-itinerary.pdf", "Revised itinerary", CONFLICT_FLIGHTS)


def write_unreadable_return_pass() -> None:
    card = render_boarding_pass_card(flight="SC202", date="7 August 2026", origin="NRT", destination="SIN")
    blurred = card.filter(ImageFilter.GaussianBlur(radius=18))
    path = UNREADABLE / "return-pass.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    blurred.save(path, format="PNG")


def main() -> None:
    write_claim_form(OUT / "claim-form.pdf")
    write_itinerary(OUT / "scheduled-itinerary.pdf", "Scheduled itinerary")
    write_itinerary(OUT / "revised-itinerary.pdf", "Revised itinerary")
    write_boarding_pass(OUT / "boarding-pass-sc101.pdf")
    write_boarding_pass(
        OUT / "boarding-pass-sc202.pdf",
        flight="SC202",
        date="7 August 2026",
        origin="NRT",
        destination="SIN",
    )
    write_delay_letter(OUT / "delay-letter.pdf")
    boarding_pass_png = OUT / "boarding-pass-sc101.png"
    # photograph_evidence.py replaces this file with a ComfyUI photo. Do not clobber it.
    if not boarding_pass_png.exists():
        write_boarding_pass_png(boarding_pass_png)
    write_conflict_itinerary()
    write_unreadable_return_pass()
    print((CONFLICT / "revised-itinerary.pdf").relative_to(ROOT))
    print((UNREADABLE / "return-pass.png").relative_to(ROOT))
    for path in sorted(OUT.iterdir()):
        print(path.relative_to(ROOT))


if __name__ == "__main__":
    main()
