# Progress

A record of work that is in the tree. Each stage says what was produced, which choice was made, and which problem that choice was answering. Direction for later work stays in `Direction.md`, `Backlog.md`, and `OpenQuestions.md`.

## Direction documents

`README.md`, `Direction.md`, `ProductDesign.md`, `Brainstorm.md`, `SuccessCriteria.md`, `OpenQuestions.md`, `Backlog.md`, and `UsefulLinks.md` record the current boundary.

The assignment does not include SureCover's policy wording or claim form. Two rules are taken from the assignment and written down as such: a claim is filed within 30 working days after return to Singapore, and the documents are a claim form, a scheduled itinerary, a revised itinerary, a boarding pass for every affected flight, and an airline or handling-agent letter stating delay reason and duration. Other rules are labeled fictional and frozen in policy version `demo-2026.1`: a 6-hour minimum delay, coverage from 20 July 2026 through 31 August 2026, and the 2026 Singapore public-holiday list. Question set `jev-questions-demo-2026.1` freezes the abstain gates at 0.60 for a choice and 0.25/0.75 for a noul. Choices that are not settled stay in `OpenQuestions.md`.

Jev is recorded as the semantic model to evaluate, behind an adapter, with a fixture adapter for a run that does not call it. A generative model is recorded as a backup for a semantic task Jev does not handle. No Jev call has been made. Docling is the local parser. Resend is the recorded email provider, with a simulated adapter for local runs. No email integration is in the tree.

## Complete-claim fixture

`fixtures/expected/complete-claim.json` locks the fictional complete bundle. `parser/generate_samples.py` writes the PDFs from those values.

The traveler is Jamie Lee, policy reference `SC-DEMO-1001`. The claim form is the source of the affected flights and the return date: SC101 on 1 August 2026 from SIN to NRT, SC202 on 7 August 2026 from NRT to SIN, return Friday 7 August 2026, received Wednesday 12 August 2026 at 09:00 Asia/Singapore. The delay letter states 8 hours and the reason "late inbound aircraft".

The counting rule is stored with that bundle because 30 working days is not 30 calendar days, and this claim crosses a weekend and a holiday. Dates are Asia/Singapore calendar dates. The return date is day 0. Saturday, Sunday, and the holidays in `demo-2026.1` are not working days. National Day is Sunday 9 August 2026, and Monday 10 August 2026 is the gazetted holiday in lieu. Tuesday 11 August 2026 is working day 1. Wednesday 12 August 2026 is working day 2. Working day 30 is Monday 21 September 2026. The late sample date is Tuesday 22 September 2026. The holiday list is the Ministry of Manpower 2026 list published on 16 June 2025. There is no deadline function in the tree yet. The dates are the fixture.

## First parser

`parser/convert_document.py` calls local Docling 2.138.0. The standard pipeline is on, table structure is on, and picture description, picture classification, code enrichment, and formula enrichment are off. OCR language is English. The device is CPU. `parser/requirements.txt` pins `docling==2.138.0`, `reportlab==5.0.1`, and `pillow==12.3.0`.

The five PDFs and the boarding-pass image were converted and stored under `fixtures/parses/complete/`. `parser/check_parses.py` checks that recorded JSON against the phrases in the fixture. The recorded JSON is what a later run can read without loading the parser models.

Windows checkout rewrote the sample PDFs and PNGs, so the files on disk no longer matched the parsed bytes. `.gitattributes` marks `pdf`, `png`, `jpg`, `jpeg`, and `ttf` as binary.

That first parser used Docling's document tree as the evidence. Page text was a markdown export. A table cell and a paragraph could share one box, and each box kept the coordinate origin Docling emitted. `text_source` was one value for the file: any PDF page with a text layer made the file `embedded`. Integers in the raw Docling JSON can exceed the range JavaScript keeps exact. `json_safe` writes those integers as strings. The line-and-box contract below replaced the document tree as the provenance list. The raw Docling document is still stored on the parse.

## Line items and one box system

Provenance items are separate from the raw Docling document. A PDF page with a text layer yields one item per text rectangle, read with pypdfium2. A page or image with no text layer yields one item per OCR line, read with RapidOCR. Every box is `l`, `t`, `r`, `b` with `coord_origin` set to `BOTTOMLEFT`. Items on a page are grouped into rows within 2 points, then ordered left to right.

The check re-reads each PDF box and requires the text in the box to equal the item text. Mixed origins made that check meaningless, because the same numbers meant "from the top" on one item and "from the bottom" on another.

The image check crops the box and OCRs the crop. A tight crop clipped the glyphs. A wider crop included the caption on the line above, so the crop read `PASSENGER Jamie Lee` instead of `Jamie Lee`. A tilted crop also reordered the words. The pad is 12 pixels. The comparison is the set of words. When the match is allowed to be partial, the crop must still cover less than a quarter of the page.

A white image has no ink, so its page is `empty` and its item list is empty. A page with ink and no extracted text is `unreadable`, and its item list is empty. Those two labels are different. The recorded complete-claim parses are neither.

## Photographed boarding pass

`render_boarding_pass_card()` draws the SC101 card in bundled Noto Sans. The fonts are `parser/fonts/NotoSans-Regular.ttf` and `parser/fonts/NotoSans-Bold.ttf`, so sample generation does not depend on fonts installed on the machine.

`parser/photograph_evidence.py` asks a local ComfyUI checkpoint to paint an empty oak table, then composites that card onto the photo: a −2.4 degree rotation, warm paper, fine grain, a shadow, and a vignette. The phrases on the card are `Jamie Lee`, `SC101`, `1 August 2026`, `SIN`, and `NRT`. `generate_samples.py` leaves `boarding-pass-sc101.png` in place when the file already exists, so regenerating the PDFs does not replace the photo.

Asking the image model to paint the boarding pass rewrote the words. The model now paints only the table. The prompt rejects text, paper, documents, and people. The words are the card drawn by the sample generator.

## Page source and rejected files

Each page has its own `text_source`:

- `embedded` — items came from that page's text layer.
- `ocr` — that page was read with English OCR.
- `empty` — the page has no ink.
- `unreadable` — the page has ink and no extracted text.

The file value is `empty` when every page is blank, `unreadable` when no page produced text and at least one page has ink, `partial` when at least one page produced text and at least one page is unreadable, `ocr` when any page was read by OCR and none is unreadable, and `embedded` when every page that produced text came from the text layer and none is unreadable. Later code quotes only `embedded` and `ocr` pages. An `unreadable` page is an unknown gap and is not sent as text. A `partial` file keeps its readable pages. An `empty` page means no ink, not that the traveler submitted nothing.

The earlier file-level rule hid a scanned page. A PDF with one text page was labeled `embedded`, and an image page in the same file contributed no items. The text layer is now tried per page. A page with no lines is rendered at scale 2 and OCR'd. `check_parses.py --live` builds a three-page PDF: an embedded line, a scanned line containing `SC101`, and a blank page. The page sources are `embedded`, `ocr`, and `empty`. The file source is `ocr`.

A password-protected PDF, a truncated PDF, a `.txt`, a `.docx`, and a 5000×5000 image are not returned as parses. `convert_path` raises, and `check_stress.py` requires that no JSON was written. The messages distinguish a password, an unreadable PDF, an unsupported type, and a file that is too large. The limits in code are 25 MB and 20 million image pixels. Accepted suffixes are PDF, PNG, JPEG, TIFF, BMP, and WebP. An empty parse is reserved for a page with no ink. Using it for a file the parser rejected would have labeled a bad file as a blank page.

Ink is measured in 16-pixel tiles on a grayscale copy whose long side is at most 512 pixels. A tile has ink when its light-to-dark gap is at least 8. A plain white image stays empty.

## Stress images

`parser/check_stress.py` and `fixtures/expected/stress-images.json` cover images that are not the complete claim. The stock JPEGs live in `fixtures/samples/samples/` and are not part of the golden parse set. Degraded copies and bad files are built in a temporary directory when the check runs.

Stock results that the check currently requires:

- The barcode image returns `5784966457` twice, in separate columns, and only digit items. It does not return passenger, flight, gate, seat, date, or boarding words.
- The empty boarding-pass template returns `BOARDING PASS` twice. It does not return a passenger name, a flight word, a gate, a seat, or an airport code from that template.
- The phone-screen images return `D 10` and `D10`. The pass photographed in a scene returns `44 D`. None of them return `SC101`, `JAMIE`, `SIN`, `NRT`, or `JFK`.
- The two-column passes return `JOHN DOE` and the flight number as separate items, repeated across columns. One pass also checks order: `JOHN DOE`, then `F3954`, then `07 APR 2019`.
- The small-print image returns `35G`, `15JUN`, and `CITY`, with `35G` and `15JUN` repeated.

A repeated phrase must occur at least twice, and the left edges of the copies must be more than 20 pixels apart. Rows are formed before left-to-right order so the two columns are not merged into one item. The absence checks fail if those files emit words they do not contain.

Degraded copies of `boarding-pass-sc101.png`:

- Blur radius 1.2, scale 0.55, rotation 12 degrees, contrast 0.55, and rotation 90 degrees still return `Jamie Lee`, `SC101`, `1 August 2026`, `SIN`, and `NRT` as whole items.
- Contrast 0.08 returns `Jamie Lee`, `SC101`, `1 August 2026`, and `NRT`, and does not return `SIN`.
- A crop of the left 42 percent returns `Jamie Lee`, `SC101`, and `SIN`, and does not return `NRT` or `1 August 2026`.
- The pixelated copy must not contain those five phrases. Its source may be `ocr` or `unreadable`.
- Blur radius 18 is `unreadable`, with no items, both from the line reader and from `convert_path`.

A 90-degree crop is sideways, so a second OCR of that crop is not a stable location check. That case checks the item text only. The milder rotation still goes through the crop check.

One generated PDF has three pages: an embedded line, the barcode image, and the heavy blur. The barcode page returns `5784966` and does not contain "Embedded page marker" or the words PASSENGER, JOHN, FLIGHT, or BOARDING. The blurred page is `unreadable` and has no text. The file source is `partial`, because one page produced text and one page is unreadable. The readable pages stay available to quote.

## System of record

The claim is stored in the hosted Supabase project SureCover Claims (`xrsqiqcyvhkfvyipcqhf`, Singapore). Local Supabase was set aside because Docker needs firmware virtualization, and that setting is off on this machine.

`supabase/migrations/20261014065300_system_of_record.sql` creates officers, one policy row, claims, documents, pages, and items, plus the private `claim-files` bucket. Reads use the assignment row and `auth.uid()`. Pages and items are the quotable text. The raw Docling document is not stored. An `unreadable` page is an unknown gap and is not sent as text. A `partial` file keeps its readable pages.

`npm run seed:claim` loads `CLM-DEMO-1001` for Jamie Lee and assigns it to `officer-a@example.com`. The six files in `fixtures/samples/complete` are in the private bucket, with the recorded parses from `fixtures/parses/complete` stored as pages and items. `officer-b@example.com` has no assignment. Both demo passwords are `local-officer-demo`. The project URL and publishable key are in `.env`, which is not committed.

`npm run verify:access` signs in as each officer with the publishable key. Officer A reads the claim and the boarding-pass file. Officer B receives no claim rows and no file bytes. Facts, checks, messages, and the workbench are not in this schema yet.
