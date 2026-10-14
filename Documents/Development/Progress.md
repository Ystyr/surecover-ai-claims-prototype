# Progress

A record of work that is in the tree. Each stage says what was produced, which choice was made, and which problem that choice was answering. Direction for later work stays in `Direction.md`, `Backlog.md`, and `OpenQuestions.md`.

## Direction documents

`README.md`, `Direction.md`, `ProductDesign.md`, `Brainstorm.md`, `SuccessCriteria.md`, `OpenQuestions.md`, `Backlog.md`, and `UsefulLinks.md` record the current boundary.

The assignment does not include SureCover's policy wording or claim form. Two rules are taken from the assignment and written down as such: a claim is filed within 30 working days after return to Singapore, and the documents are a claim form, a scheduled itinerary, a revised itinerary, a boarding pass for every affected flight, and an airline or handling-agent letter stating delay reason and duration. Other rules are labeled fictional and frozen in policy version `demo-2026.1`: a 6-hour minimum delay, coverage from 20 July 2026 through 31 August 2026, and the 2026 Singapore public-holiday list. Question set `jev-questions-demo-2026.1` freezes the abstain gates at 0.60 for a choice and 0.25/0.75 for a noul. Choices that are not settled stay in `OpenQuestions.md`.

Jev is recorded as the semantic model to evaluate, behind an adapter, with a fixture adapter for a run that does not call it. A generative model is recorded as a backup for a semantic task Jev does not handle. No Jev call has been made. Docling is the local parser. Resend is the recorded email provider, with a simulated adapter for local runs. No email integration is in the tree.

## Complete-claim fixture

`fixtures/expected/complete-claim.json` locks the fictional complete bundle. `parser/generate_samples.py` writes the PDFs from those values.

The traveler is Jamie Lee, policy reference `SC-DEMO-1001`. The claim form is the source of the affected flights and the return date: SC101 on 1 August 2026 from SIN to NRT, SC202 on 7 August 2026 from NRT to SIN, return Friday 7 August 2026, received Wednesday 12 August 2026 at 09:00 Asia/Singapore. The delay letter states 8 hours and the reason "late inbound aircraft".

The counting rule is stored with that bundle because 30 working days is not 30 calendar days, and this claim crosses a weekend and a holiday. Dates are Asia/Singapore calendar dates. The return date is day 0. Saturday, Sunday, and the holidays in `demo-2026.1` are not working days. National Day is Sunday 9 August 2026, and Monday 10 August 2026 is the gazetted holiday in lieu. Tuesday 11 August 2026 is working day 1. Wednesday 12 August 2026 is working day 2. Working day 30 is Monday 21 September 2026. The late sample date is Tuesday 22 September 2026. The holiday list is the Ministry of Manpower 2026 list published on 16 June 2025. `checks/assess.mjs` counts those working days from the stored received instant and the holiday list on the policy row.

## First parser

`parser/convert_document.py` calls local Docling 2.138.0. The standard pipeline is on, table structure is on, and picture description, picture classification, code enrichment, and formula enrichment are off. OCR language is English. The device is CPU. `parser/requirements.txt` pins `docling==2.138.0`, `reportlab==5.0.1`, and `pillow==12.3.0`.

The six PDFs and the boarding-pass image were converted and stored under `fixtures/parses/complete/`. `parser/check_parses.py` checks that recorded JSON against the phrases in the fixture. The recorded JSON is what a later run can read without loading the parser models. The seventh file is `boarding-pass-sc202.pdf`, the 7 August 2026 NRT–SIN pass. `generate_samples.py` can write that PDF on its own. Regenerating the other PDFs is a separate run, and an existing `boarding-pass-sc101.png` is left in place.

Windows checkout rewrote the sample PDFs and PNGs, so the files on disk no longer matched the parsed bytes. `.gitattributes` marks `pdf`, `png`, `jpg`, `jpeg`, and `ttf` as binary.

That first parser used Docling's document tree as the evidence. Page text was a markdown export. A table cell and a paragraph could share one box, and each box kept the coordinate origin Docling emitted. `text_source` was one value for the file: any PDF page with a text layer made the file `embedded`. Integers in the raw Docling JSON can exceed the range JavaScript keeps exact. `json_safe` writes those integers as strings. The line-and-box contract below replaced the document tree as the provenance list. The raw Docling document is still stored on the parse.

## Line items and one box system

Provenance items are separate from the raw Docling document. A PDF page with a text layer yields one item per text rectangle, read with pypdfium2. A page or image with no text layer yields one item per OCR line, read with RapidOCR. Every box is `l`, `t`, `r`, `b` with `coord_origin` set to `BOTTOMLEFT`. Items on a page are grouped into rows within 2 points, then ordered left to right.

The check re-reads each PDF box and requires the text in the box to equal the item text. Mixed origins made that check meaningless, because the same numbers meant "from the top" on one item and "from the bottom" on another.

An embedded line has no recognition score. An OCR line keeps RapidOCR's score, rounded to four decimals. RapidOCR already omits a line below 0.5. A kept score below 0.80 sets `review` on that line, and the line stays in the parse. A missing score also sets `review`. The flag does not drop the text.

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

The complete claim is stored in the hosted Supabase project SureCover Claims (`xrsqiqcyvhkfvyipcqhf`, Singapore). Node 24 and Supabase CLI 2.120 are installed. Local `supabase start` did not run: it needs Docker, and firmware virtualization is off on this machine. The project URL, publishable key, secret key, and officer password are named in `.env.example`. `.env` is gitignored.

`supabase/migrations/20261014083345_system_of_record.sql` creates `officers`, `policies`, `claims`, `claim_documents`, `document_pages`, and `document_items`, and the private `claim-files` bucket. The bucket limit is 25 MB. Allowed types are PDF, PNG, JPEG, TIFF, BMP, and WebP. A file is stored at `{claim id}/{file name}`. The storage policy treats the first folder as the claim id and allows a select when that claim is assigned to `auth.uid()`.

The stored text is the pages and items. The raw Docling document is not stored. An item row keeps the text, label, page number, `BOTTOMLEFT` box, and, for an OCR line, `confidence` and `review`. An embedded line stores a null score. `document_pages` keeps every page, including `empty` and `unreadable`. `supabase/migrations/20261014085334_quotable_pages.sql` adds `quotable_pages`, a security-invoker view of pages whose `text_source` is `embedded` or `ocr`. The invoker setting means the view still uses the caller's row-level security. An unreadable page stays on `document_pages` and is absent from the view.

Row-level security is on for every table. `anon` and `public` have no grants. An authenticated officer can select their own `officers` row, any `policies` row, and a claim only when `assigned_officer_id` is `auth.uid()`. Documents, pages, and items follow that claim. Officers have select policies only.

The seeded claim is `CLM-DEMO-1001`, id `c1a10001-de10-4000-a000-000000001001`, status `submitted`, policy `demo-2026.1`, assigned to `officer-a@example.com`. The policy row holds the version label, the coverage dates 20 July 2026 through 31 August 2026, and the 2026 holiday list. The seven fixture files are the documents: the form, both itineraries, the delay letter, a PDF and a photo for SC101, and `boarding-pass-sc202.pdf`. `officer-b@example.com` exists and is assigned nothing.

The first load could run with the publishable key. That path signed in as officer A and replaced documents on a claim that already existed. It could not create the auth users, the officer rows, or the claim. To let that session insert and delete, `20261014083725_seed_write_policies.sql` added write policies for the assigned officer, on the document tables and on `claim-files`. The password was also a literal in the seed script, `local-officer-demo`.

That left an officer able to write claim rows. The write policies were applied on the host and then removed by `20261014083753_drop_seed_write_policies.sql`. Both files stay in the repo so the migration history matches the host. The migration that creates the tables was renamed from `20261014065300` to `20261014083345` for the same reason.

`npm run seed:claim` is now the only load, and it requires `SUPABASE_SERVICE_ROLE_KEY` and `OFFICER_PASSWORD`. The publishable key is not used. The secret key is what creates users and writes rows. A reload deletes the claim first, because the claim references the officer, then removes the stored files, then deletes the officer rows, then deletes and recreates both auth users. The new auth user id is the officer id. The claim is inserted after that, assigned to officer A, and the seven files, pages, and items are written again. Replacing the auth user in place would have kept an id the new officer row might not use. Deleting the auth user while a claim still pointed at the officer would have failed the foreign key.

`npm run verify:access` signs in as each officer with the publishable key only. Officer A sees one claim, Jamie Lee, status `submitted`, seven documents, an embedded page containing `Jamie Lee`, an OCR page, and `quotable_pages` equal to the embedded and OCR pages only. The embedded item `Claimant: Jamie Lee` has a null score. The OCR item `Jamie Lee` has a numeric score and a boolean `review`. Each of the seven downloads matches the fixture bytes. Officer A sees only `officer-a@example.com` on `officers`. Officer B sees no rows on the claim tables or `quotable_pages`, and no file bytes. Officer B sees only their own officer row, and can read policy `demo-2026.1`.

## Policy checks

`checks/assess.mjs` reads item text from quotable pages and writes six results: completeness, filing deadline, coverage, claim type, consistency, and delay. Each is `pass`, `fail`, or `unknown`. `npm run test:checks` runs those cases locally. It does not create hosted claims.

The complete bundle could not pass completeness as it stood. The form lists SC101 and SC202, and the samples had a pass only for SC101. `parser/generate_samples.py` now also writes `boarding-pass-sc202.pdf` for SC202 on 7 August 2026 from NRT to SIN, and that parse is recorded. The seeded claim has seven files. The access check compares all seven to the fixture bytes.

Document roles for the seeded filenames are adapter `fixture`. A supplied choice replaces the filename. The role is not established when the choice is missing, `other`, or below 0.60. A file with no established role is unclassified. A required document that is absent fails completeness and names the gap. An unclassified file leaves completeness `unknown`, because a file is present and its type is not established. That missing-document failure is applied first. A form whose flight date cannot be read stays `unknown` only when the claim form, both itineraries, and the delay letter are already established. A missing delay letter still fails completeness and names that letter, even when a flight date on the form cannot be read.

The three flight layouts in the samples are not the same item list, so each has its own reader. The PDF pass is one labeled line per field, `Flight: SC202`. The form and the itineraries are a table: the header cells `Flight`, `Date`, `From`, `To`, then four cells per leg. The photographed pass is separate caption and value items, in row order. A pass matches a form flight on flight number plus local departure date. The SC101 PDF and the SC101 photo both match that flight, and one match is enough. A route that differs on an otherwise matching pass still satisfies completeness. Consistency is `unknown`, and both destinations stay in the detail.

The revised itinerary supplies the Singapore arrival, taken from the leg whose destination is SIN. That leg's departure date is the date used, because these samples have no arrival-time column. When that date disagrees with the form return date, the deadline and consistency checks are `unknown`, both dates stay visible, and no deadline is calculated. Two different SIN dates on the revised itinerary are the same kind of disagreement. No SIN leg is not a conflict. The deadline then uses the form return date.

The deadline uses the received instant's Asia/Singapore calendar date, the form return date, and the holiday list on the policy row. `2026-08-11T17:00:00Z` is 12 August in Singapore, so that instant is the same filing day as `2026-08-12T09:00:00+08:00`. The return date is day 0. Filing on 21 September 2026 is working day 30 and passes. Filing on 22 September 2026 is working day 31 and fails. The stored complete claim records return date 7 August 2026, working day 2, and deadline 21 September 2026. Coverage compares each form leg's departure date with 20 July 2026 through 31 August 2026. A readable leg outside that period fails. A missing policy row, or a departure that cannot be read and no leg clearly outside, is `unknown`. A readable claim type other than flight delay fails. A delay letter that is missing, labeled `other`, or below 0.60 leaves claim type `unknown`.

The delay letter is the only source of duration and reason. The first check constraint allowed completeness, filing deadline, coverage, claim type, and consistency. Putting the 6-hour rule on completeness would have failed a present letter, or stored a 3-hour letter as a passing completeness row. `supabase/migrations/20261014113206_delay_check.sql` adds `delay` as its own check name. Eight hours passes. Three hours fails that check and leaves completeness `pass`. `Delay duration: several hours.` is `unknown`, and completeness stays `pass`. The detail keeps the 6-hour rule labeled as a fictional demo assumption, the parsed hours, and the quoted reason. The complete letter's reason is "late inbound aircraft".

`supabase/migrations/20261014101830_policy_checks.sql` adds `assessments` and `policy_checks`. A later run inserts a new assessment and leaves the earlier one in place. Officers can select a row only when the claim is assigned to them. There is no officer write policy. `npm run assess:claim` uses the secret key, reads `quotable_pages`, and refuses to insert when any of the six results is not `pass`. An item on a page that is not quotable is not read. A 3-hour line on an unreadable page does not replace an 8-hour line on a quotable page. For `CLM-DEMO-1001` the six checks pass. `npm run verify:checks` signs in as both officers. Officer A reads the latest assessment, adapter `fixture`, and those six passes, including the filing dates and the 8-hour delay. Officer B reads no assessment and no check rows.

Messages and a workbench are not in this schema. The next build is the officer workbench. It signs an officer in, lists only that officer's claims, and opens the latest assessment with the six results, their quotes, and the original files. Resend, a live Jev call, fact correction, and the approve, reject, or request actions stay later.
