"""Write the fictional complete-claim PDFs and boarding-pass PNG."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "fixtures" / "samples" / "complete"
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


def flight_table() -> Table:
    table = Table([FLIGHT_HEADER, *FLIGHTS], colWidths=[35 * mm, 45 * mm, 30 * mm, 30 * mm])
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


def write_itinerary(path: Path, title: str) -> None:
    style = styles()
    write_pdf(
        path,
        [
            Paragraph(BANNER, style["banner"]),
            Paragraph(title, style["title"]),
            Paragraph("Passenger: Jamie Lee", style["body"]),
            Spacer(1, 4 * mm),
            flight_table(),
        ],
    )


def write_boarding_pass(path: Path) -> None:
    style = styles()
    write_pdf(
        path,
        [
            Paragraph(BANNER, style["banner"]),
            Paragraph("Boarding pass", style["title"]),
            Paragraph("Passenger: Jamie Lee", style["body"]),
            Paragraph("Flight: SC101", style["body"]),
            Paragraph("Date: 1 August 2026", style["body"]),
            Paragraph("From: SIN", style["body"]),
            Paragraph("To: NRT", style["body"]),
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


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for candidate in (
        Path(r"C:\Windows\Fonts\arial.ttf"),
        Path(r"C:\Windows\Fonts\calibri.ttf"),
        Path(r"C:\Windows\Fonts\segoeui.ttf"),
    ):
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    raise FileNotFoundError("No TrueType font found for the boarding-pass PNG")


def write_boarding_pass_png(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGB", (1400, 1800), "white")
    draw = ImageDraw.Draw(image)
    font = load_font(72)
    lines = [
        "BOARDING PASS",
        "Passenger Jamie Lee",
        "Flight SC101",
        "Date 1 August 2026",
        "From SIN",
        "To NRT",
    ]
    y = 160
    for line in lines:
        draw.text((120, y), line, fill="black", font=font)
        y += 140
    image.save(path, format="PNG")


def main() -> None:
    write_claim_form(OUT / "claim-form.pdf")
    write_itinerary(OUT / "scheduled-itinerary.pdf", "Scheduled itinerary")
    write_itinerary(OUT / "revised-itinerary.pdf", "Revised itinerary")
    write_boarding_pass(OUT / "boarding-pass-sc101.pdf")
    write_delay_letter(OUT / "delay-letter.pdf")
    write_boarding_pass_png(OUT / "boarding-pass-sc101.png")
    for path in sorted(OUT.iterdir()):
        print(path.relative_to(ROOT))


if __name__ == "__main__":
    main()
