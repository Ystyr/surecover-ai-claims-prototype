# Progress

A record of work that is in the tree. Each stage says what was produced, which choice was made, and which problem that choice was answering. Direction for later work stays in `Direction.md`, `Backlog.md`, and `OpenQuestions.md`.

## Direction documents

`README.md`, `Direction.md`, `ProductDesign.md`, `Brainstorm.md`, `SuccessCriteria.md`, `OpenQuestions.md`, `Backlog.md`, and `UsefulLinks.md` record the current boundary.

The assignment does not include SureCover's policy wording or claim form. Two rules are taken from the assignment and written down as such: a claim is filed within 30 working days after return to Singapore, and the documents are a claim form, a scheduled itinerary, a revised itinerary, a boarding pass for every affected flight, and an airline or handling-agent letter stating delay reason and duration. Other rules are labeled fictional and frozen in policy version `demo-2026.1`: a 6-hour minimum delay, coverage from 20 July 2026 through 31 August 2026, and the 2026 Singapore public-holiday list. Question set `jev-questions-demo-2026.1` freezes the abstain gates at 0.60 for a choice and 0.25/0.75 for a noul. Choices that are not settled stay in `OpenQuestions.md`.

Jev is recorded as the semantic model to evaluate, behind an adapter, with a fixture adapter for a run that does not call it. A generative language model is not part of this prototype. Dates and flight numbers stay with the parser. Each of the seven files on `CLM-DEMO-1001` has one stored classification from `jev-1.13.0`. Docling is the local parser. Resend is the email provider. A simulated message stays the local record when Resend is not configured. A signed inbound email can create a claim or match a reply, and the acknowledgment for that new claim is sent when `RESEND_FROM` is set. The stored demo requests stay simulated. Approve and reject still record no message.

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

The seeded claim is `CLM-DEMO-1001`, id `c1a10001-de10-4000-a000-000000001001`, status `information requested`, policy `demo-2026.1`, assigned to `officer-a@example.com`. The policy row holds the version label, the coverage dates 20 July 2026 through 31 August 2026, and the 2026 holiday list. The seven fixture files are the documents: the form, both itineraries, the delay letter, a PDF and a photo for SC101, and `boarding-pass-sc202.pdf`. `officer-b@example.com` exists and is assigned nothing.

The first load could run with the publishable key. That path signed in as officer A and replaced documents on a claim that already existed. It could not create the auth users, the officer rows, or the claim. To let that session insert and delete, `20261014083725_seed_write_policies.sql` added write policies for the assigned officer, on the document tables and on `claim-files`. The password was also a literal in the seed script, `local-officer-demo`.

That left an officer able to write claim rows. The write policies were applied on the host and then removed by `20261014083753_drop_seed_write_policies.sql`. Both files stay in the repo so the migration history matches the host. The migration that creates the tables was renamed from `20261014065300` to `20261014083345` for the same reason.

`npm run seed:claim` is now the only load, and it requires `SUPABASE_SERVICE_ROLE_KEY` and `OFFICER_PASSWORD`. The publishable key is not used. The secret key is what creates users and writes rows. A reload deletes the claim first, because the claim references the officer, then removes the stored files, then deletes the officer rows, then deletes and recreates both auth users. The new auth user id is the officer id. The claim is inserted after that, assigned to officer A, and the seven files, pages, and items are written again. Replacing the auth user in place would have kept an id the new officer row might not use. Deleting the auth user while a claim still pointed at the officer would have failed the foreign key.

`npm run verify:access` signs in as each officer with the publishable key only. Officer A sees one claim, Jamie Lee, status `information requested`, seven documents, an embedded page containing `Jamie Lee`, an OCR page, and `quotable_pages` equal to the embedded and OCR pages only. The embedded item `Claimant: Jamie Lee` has a null score. The OCR item `Jamie Lee` has a numeric score and a boolean `review`. Each of the seven downloads matches the fixture bytes. Officer A sees only `officer-a@example.com` on `officers`. Officer A also sees one simulated request message. Officer B sees no rows on the claim tables, `claim_messages`, or `quotable_pages`, and no file bytes. Officer B sees only their own officer row, and can read policy `demo-2026.1`.

## Policy checks

`checks/assess.mjs` reads item text from quotable pages and writes six results: completeness, filing deadline, coverage, claim type, consistency, and delay. Each is `pass`, `fail`, or `unknown`. `npm run test:checks` runs those cases locally. It does not create hosted claims.

The complete bundle could not pass completeness as it stood. The form lists SC101 and SC202, and the samples had a pass only for SC101. `parser/generate_samples.py` now also writes `boarding-pass-sc202.pdf` for SC202 on 7 August 2026 from NRT to SIN, and that parse is recorded. The seeded claim has seven files. The access check compares all seven to the fixture bytes.

Document roles for the seeded filenames are adapter `fixture`. A supplied choice replaces the filename. The role is not established when the choice is missing, `other`, or below 0.60. A file with no established role is unclassified. A required document that is absent fails completeness and names the gap. An unclassified file leaves completeness `unknown`, because a file is present and its type is not established. That missing-document failure is applied first. A form whose flight date cannot be read stays `unknown` only when the claim form, both itineraries, and the delay letter are already established. A missing delay letter still fails completeness and names that letter, even when a flight date on the form cannot be read.

The three flight layouts in the samples are not the same item list, so each has its own reader. The PDF pass is one labeled line per field, `Flight: SC202`. The form and the itineraries are a table: the header cells `Flight`, `Date`, `From`, `To`, then four cells per leg. The photographed pass is separate caption and value items, in row order. A pass matches a form flight on flight number plus local departure date. The SC101 PDF and the SC101 photo both match that flight, and one match is enough. A route that differs on an otherwise matching pass still satisfies completeness. Consistency is `unknown`, and both destinations stay in the detail.

The revised itinerary supplies the Singapore arrival, taken from the leg whose destination is SIN. That leg's departure date is the date used, because these samples have no arrival-time column. When that date disagrees with the form return date, the deadline and consistency checks are `unknown`, both dates stay visible, and no deadline is calculated. Two different SIN dates on the revised itinerary are the same kind of disagreement. No SIN leg is not a conflict. The deadline then uses the form return date.

The deadline uses the received instant's Asia/Singapore calendar date, the form return date, and the holiday list on the policy row. `2026-08-11T17:00:00Z` is 12 August in Singapore, so that instant is the same filing day as `2026-08-12T09:00:00+08:00`. The return date is day 0. Filing on 21 September 2026 is working day 30 and passes. Filing on 22 September 2026 is working day 31 and fails. The stored complete claim records return date 7 August 2026, working day 2, and deadline 21 September 2026. Coverage compares each form leg's departure date with 20 July 2026 through 31 August 2026. A readable leg outside that period fails. A missing policy row, or a departure that cannot be read and no leg clearly outside, is `unknown`. A readable claim type other than flight delay fails. A delay letter that is missing, labeled `other`, or below 0.60 leaves claim type `unknown`.

The delay letter is the only source of duration and reason. The first check constraint allowed completeness, filing deadline, coverage, claim type, and consistency. Putting the 6-hour rule on completeness would have failed a present letter, or stored a 3-hour letter as a passing completeness row. `supabase/migrations/20261014113206_delay_check.sql` adds `delay` as its own check name. Eight hours passes. Three hours fails that check and leaves completeness `pass`. `Delay duration: several hours.` is `unknown`, and completeness stays `pass`. The detail keeps the 6-hour rule labeled as a fictional demo assumption, the parsed hours, and the quoted reason. The complete letter's reason is "late inbound aircraft".

`supabase/migrations/20261014101830_policy_checks.sql` adds `assessments` and `policy_checks`. A later run inserts a new assessment and leaves the earlier one in place. Officers can select a row only when the claim is assigned to them. There is no officer write policy. `npm run assess:claim` uses the secret key, reads `quotable_pages`, and refuses to insert when any of the six results is not `pass`. An item on a page that is not quotable is not read. A 3-hour line on an unreadable page does not replace an 8-hour line on a quotable page. For `CLM-DEMO-1001` the six checks pass. `npm run verify:checks` signs in as both officers. Officer A reads the latest assessment, adapter `fixture`, and those six passes, including the filing dates and the 8-hour delay. Officer B reads no assessment and no check rows.

## Officer workbench

`npm run dev` starts the Next.js workbench. The app reads `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. It does not read the service role or a stored officer password. The queue, the claim page, and the file route use the officer's Supabase session, so row-level security stays the access check. A signed-out visit to the queue or a claim goes to `/login`.

Sign-in started as a server action. That action could accept the password and still lose the session cookie, because a Server Component is not allowed to write cookies. The form now posts to `/login/session`. That route handler signs in with the publishable key and sets the session cookie on a 303 redirect to the queue. The response carries `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0`, `Expires: 0`, and `Pragma: no-cache`, and then any headers the session library adds. A rejected password redirects to `/login?error=1`, and the page says the credentials were not accepted. If the password is accepted and no cookie is stored, the handler throws "The session cookie was not stored." and does not open the queue.

The request proxy refreshes that session. Its first version set the new cookies on `NextResponse.next()` and then returned a different redirect, so the refreshed cookie never left with the redirect. The proxy now keeps the pending cookies and the session headers and copies them onto the redirect. `/login/session` has to be reachable while signed out, so a path under `/login/` is not sent back to the login page. A signed-in visit to `/login` still goes to the queue. The server client used by a page still cannot write cookies. It ignores only Next's message that cookies can be modified in a Server Action or Route Handler. Any other cookie error is raised.

The queue is the home page. A row shows the claim reference, the received time, the status, and a short summary from the stored claimant and return date. Action needed appears when the status is `needs review`. Check failed appears when the latest assessment has a `fail` or `unknown` check, and that indicator does not change the claim status. `CLM-DEMO-1001` is `information requested` and its latest assessment passes, so its row shows neither. Officer A sees that claim. Officer B sees "No claims are assigned to you." A failed queue read says the queue could not be read. That is a different sentence from an empty assignment. The signed-in email is shown, and sign-out is still a server action.

The claim page reads the stored assessments, newest `created_at` first, and does not run the checks again. Findings use the latest assessment and its six checks. The text is the stored detail. Completeness names the required documents and the matching passes. Filing shows return date 7 August 2026, working day 2, and deadline 21 September 2026 as the assignment rule. Coverage and the 6-hour minimum are labeled as demo assumptions. Claim type says the check treated `delay-letter.pdf` as the delay letter. The stored Jev label is not read by that check. Consistency shows the compared routes and the form return date against the revised Singapore arrival. Delay shows 8 hours and the quoted reason. The adapter is shown as `fixture`.

A quote was the text alone. The same airport code appears on two flights, SC101's SIN and SC202's SIN, and the PDF pass and the photo both repeat the form's route. A quote now keeps the text, the source file, and, on a consistency route, the flight number. The form quote for one flight is shown once when more than one pass matches that flight. The other flight keeps its own quote. The claim-type sentence stays on the claim form. The delay letter's filename is stored beside its quote. Two disagreeing Singapore arrivals stay as two quotes. The link opens `/claims/{claim id}/files/{document id}` for the file named on the quote. The route selects that document row with the officer's session and then streams the bytes from `claim-files`. It does not accept a raw storage path.

A missing file and a failed read were the same "Not found". A claim id or document id that is not a uuid is treated as absent before a query: the claim page says "This claim is not in your queue." and the file route returns "Not found". A claim the officer cannot see uses that same queue sentence and does not show the claimant or the reference. A select or download error is separate: "This claim could not be read." on the page, and "This file could not be read." with status 500 on the file route. Officer B receives "Not found" for the claim form.

History lists the recorded request, its simulated message, and the seven stored assessments by time, with the time and adapter. The latest is the 15 October pass that restored the delay to 8 hours. Under it is the 15 October assessment that failed delay at 3 hours, then the earlier restore and the earlier 3-hour fail, then the 16:08 six-check pass, the 14 October six-check pass, and the five-check assessment. None of those rows are deleted. When a newer assessment has the same outcomes and the same stored detail as the one before it, the history says so. When only the outcomes match, it says the stored detail differs. The restored pass and the 3-hour fail under it have different outcomes, so neither carries a comparison sentence. The 16:08 pass matches the 14 October six-check pass on outcomes, and its stored detail differs, so that row keeps the second sentence. Different outcomes get no comparison sentence. A banner on the queue and the claim says the data is fictional demonstration data. Opening `/claims/c1a10001-de10-4000-a000-000000001001` as officer B shows "This claim is not in your queue."

## Claim decision

Request, Approve, and Reject were visible and did not submit. Each is now a form with a rationale. The form posts the latest assessment id to `record_claim_decision`. The public function is invoker and calls the private definer function. The assigned officer cannot insert, update, or delete `claim_decisions`, and cannot update `claims` directly. Officer B receives no decision rows.

The function locks the claim before it reads the latest assessment. A fact correction takes that same lock, so a correction cannot insert a newer assessment between the decision's read and its write. If the posted assessment is not the latest, the save raises `stale decision` and the page says another assessment was saved first. A blank rationale is rejected. A claim the officer is not assigned, or an id that is not on the claim, raises `claim not found` and the app returns to the queue.

A request from `submitted`, `processing`, or `needs review` stores the officer, the time, the rationale, the assessment id, and `demo-2026.1`, then sets the status to `information requested`. Approve and Reject stay available after that request. A second request, while the status is already `information requested`, raises `decision recorded`. Approve sets `approved` and Reject sets `rejected`. Either one finishes the claim: the page shows that action and its rationale, and the three forms are gone. Another approve, reject, or request then raises `decision recorded`.

An approval while a check is `fail` or `unknown` must name that check as its own words: Completeness, Filing deadline, Coverage, Claim type, Consistency, or Delay. The match is the label with a boundary on each side. The word delayed does not name Delay. A missing name raises `checks unnamed`. `unknown` is not rewritten as `fail`. The decision does not write the traveler message and does not call Jev.

History lists the decision with the assessments. The request message joins that list once it is recorded. `CLM-DEMO-1001` is `information requested`. Its latest assessment passes, so the queue row shows neither Action needed nor Check failed. Action needed stays the `needs review` status. Check failed stays a note on the latest assessment and does not change the status.

## Request message

The request decision stored a rationale and left the message for a separate action. Before a message exists for that decision, the claim page shows the text and a Send request button. The text is built from the stored claim, not from the form. The subject is `Information requested for CLM-DEMO-1001`. The body greets Jamie Lee, names the claim, repeats the stored rationale, and ends with the fictional-data line. Approve and Reject do not show that button. On `CLM-DEMO-1001` that message is now recorded, so the button is gone.

Send request calls `record_request_message` with the request decision id. The public function is invoker and calls the private definer function. The function locks the claim, checks the officer is assigned, and rejects the save unless the decision is a request. A second save for the same decision raises `message recorded`, including when the unique `decision_id` is hit. The page then says the request message is already recorded. A decision the officer cannot see raises `claim not found` and the app returns to the queue.

The row is written to `claim_messages`. The address is the stored traveler address, `jamie.lee@example.com`. The provider is constrained to `simulated`, the status to `recorded`, and the provider message id must start with `simulated-`. The officer cannot insert, update, or delete the row. Officer B receives no message rows. Nothing is delivered.

`npm run verify:access` reads that one message as officer A and checks the address, subject, greeting, stored rationale, provider, status, and simulated id. History lists the message with the decision and the assessments, showing the subject, the address, `simulated`, `recorded`, and the body. Once the row exists, the Send request button is gone.

## Fact correction

`npm run extract:facts` stores the 32 parsed facts for `CLM-DEMO-1001`. A fact is one field: flight number, departure date, origin, destination, return date, claim type, delay hours, or delay reason. A leg is keyed by its source file and flight number, by the original departure date when that flight number appears twice, and by the original origin and destination when that date is repeated too. Two legs that also share the route keep one key. The row keeps the source file, the page, the quote, and the original value. A later run does not replace a fact that is already stored. It removes a leftover leg-index key only when that fact has no correction. The Next app does not use the service role.

The claim page lists those facts. Each one has its quote, the original value, the value in effect, and a form for a new value plus a rationale. Submitting one fact checks the value with the same rules as the parser, then calls `record_fact_correction` as the signed-in officer. The public function is invoker and calls the private definer function. That function checks the officer is assigned, locks the claim and then its facts, and rejects the save when another correction landed after the form was read. A decision takes that same claim lock before it reads the latest assessment. It stores the canonical value, the new `fixture` assessment, and its six checks in one transaction. It rejects the payload when the delay check disagrees with the saved hours, or when a claim type that is not a flight delay is not a failure. A coverage leg matches the corrected departure by the current flight number, origin, destination, and the stored date quote. When that file is already in the coverage legs, the matching leg has to be present and carry the new date. An agreed Singapore date on a file coverage does not cite has to be the filing arrival, and the filing quote has to cite that file. A copied Singapore date, or two Singapore dates that still differ, stays `unknown` with both original quotes. The officer cannot insert those rows directly and cannot update or delete them. Officer B receives no fact rows and no correction rows.

A correction of the delay from 8 hours to 3 hours fails the delay check and keeps the quote "Delay duration: 8 hours." The queue then says Check failed while the claim status stays unchanged. Correcting the duration back to 8 hours makes the latest assessment pass again and removes that queue note. `npm run verify:checks` reads the restored 8-hour pass and still finds the 3-hour assessment in history. It does not require the latest assessment to pass, so a later failing correction does not have to be undone. Copying one Singapore date onto the other leaves filing `unknown` while the original quotes differ. A shared date that is neither of those conflicting values can agree. A departure moved before 20 July 2026 fails coverage. A claim type other than flight delay fails that check. The correction does not call Jev and does not send email.

## Document classification

`npm run classify:claim` classifies each of the seven files on `CLM-DEMO-1001` once. The script reads `TYPESAFE_API_KEY` from `.env` and writes with the secret key. The claim page does not read that key and does not call Jev. Opening the page reads the stored rows.

The request is `POST https://api.typesafe.ai/v1/systemone` with model `jev-1.13.0`. The state is that file's stored page text, one block per page, with the page row id. Only `embedded` and `ocr` pages are included. No PDF or image bytes are sent, and no other claim is included. A file with no readable page text throws before the call. The question wording is in the script. The question set is `jev-questions-demo-2026.1`. The one question is a choice among claim form, scheduled itinerary, revised itinerary, boarding pass, delay letter, and other. A response that is not that choice, or a label outside those six, throws and does not store a Jev row.

The checks still take the document role from the filename. Reading the new Jev label into `checks/assess.mjs` would have replaced the role those stored assessments used. The claim-type finding now says the check treated `delay-letter.pdf` as the delay letter, so the Jev label on the file list is not the role the check used.

Each file has two rows in `document_classifications`. The fixture row is the filename label at probability 1, with no model and no token counts. The Jev row stores the choice, the probability of that choice, the full distribution, confidence, the model, input and output token counts, and the raw response. A later run keeps a stored Jev row and does not call again. The assigned officer can read the rows. An officer session cannot insert them. Officer B receives none. `npm run verify:access` expects seven fixture rows and seven Jev rows for officer A.

On this run every Jev label matched the filename and the probability was 1, so each label is established. Input and output tokens were 482/72 for `boarding-pass-sc101.pdf`, 491/72 for `boarding-pass-sc101.png`, 487/72 for `boarding-pass-sc202.pdf`, 535/72 for `claim-form.pdf`, 491/72 for `delay-letter.pdf`, 501/76 for `revised-itinerary.pdf`, and 500/74 for `scheduled-itinerary.pdf`. The six checks were not rewritten. The claim stays `information requested`, the latest delay stays 8 hours, and the simulated message is unchanged. The file list shows the fixture label and the Jev label, probability, `jev-1.13.0`, and the question set. A label of other, or a probability below 0.60, says the label is not established. This call did not ask Jev to choose a span.

## Delay letter judgments

`npm run judge:claim` asks `delay-letter.pdf` once whether it states a reason for the delay and whether it states a duration. The other six files are not sent, and the stored document-type call is not repeated. The state is that letter's page text and page id. The model is `jev-1.13.0` and the question set is `jev-questions-demo-2026.1`. The wording is in the script and does not quote the letter. Each answer is a noul. At least 0.75 supports the proposition, at most 0.25 contradicts it, and a value strictly between those two is not established.

On this run the reason was 0.98 and the duration was 0.99, so both support the proposition. The request used 387 input tokens and 38 output tokens. Both `document_judgments` rows store those counts, and they are one request. Adding the two rows counts it twice. A later run keeps the stored answers and does not call again. The rows are in `document_judgments`. The assigned officer can read them. An officer session cannot insert them. Officer B receives none. The file list shows both lines under `delay-letter.pdf`. The six checks were not rewritten. The claim stays `information requested` and the latest delay stays 8 hours. This call did not ask Jev to choose a line.

## Delay letter spans

`npm run select:spans` asks `delay-letter.pdf` once which stored line states the reason for the delay and which states how long the delay lasted. The candidates are that letter's stored lines plus `none`. The state is the page text and page id, then each line's item id and text. The model is `jev-1.13.0` and the question set is `jev-questions-demo-2026.1`. A choice is established only when it is one of those lines, its probability is at least 0.60, and the line's text occurs on the page. The chosen text is copied from the stored item. The delay check still reads the parsed letter.

On this run the reason line was "Flight SC202 from NRT to SIN on 7 August 2026 was delayed because of a late inbound aircraft." and the duration line was "Delay duration: 8 hours." Both probabilities were 1, so both spans are established. The request used 1178 input tokens and 470 output tokens. Both `document_span_choices` rows store those counts, and they are one request. Adding the two rows counts it twice. A later run keeps the stored choices and does not call again. The assigned officer can read them. An officer session cannot insert them. Officer B receives none. The file list shows both quoted lines under `delay-letter.pdf`. The claim stays `information requested` and the latest delay stays 8 hours. Dates and flight numbers stay with the parser. A generative language model is not part of this prototype.

## Missing boarding pass

The complete claim already has a pass for SC202, so dropping that file from `CLM-DEMO-1001` would have removed the case the other stages stored. `npm run seed:missing` adds `CLM-DEMO-1002` beside it. The script does not recreate the officers. It reads the existing `officer-a@example.com` row and assigns the new claim to that id. The traveler, policy, return date, and received time are the same as the complete claim. The status is `needs review`. The files are the six stored parses other than `boarding-pass-sc202.pdf`. No Jev call is made, and no decision or message is stored.

The assessment is written only when completeness fails with the gap `SC202 on 7 August 2026 from NRT to SIN` and the other five checks pass. Filing, coverage, claim type, consistency, and delay pass because those do not depend on the return-flight pass. After the insert, the script reads `CLM-DEMO-1001` again and throws if its id, status, or file count changed. A later run deletes and replaces only `CLM-DEMO-1002`, including that claim's stored files.

`npm run seed:claim` recreates both officers, so running it while `CLM-DEMO-1002` is assigned to officer A would delete that claim with the officer. It now reads the claim table first and stops before it deletes anything when any reference other than `CLM-DEMO-1001` is stored.

The queue shows Action needed and Check failed on `CLM-DEMO-1002`. `CLM-DEMO-1001` stays `information requested` and shows neither. `npm run verify:access` sees both claims. Officer A has seven files on the complete claim and six on the missing-pass claim, and none of those six is `boarding-pass-sc202.pdf`. The completeness row for `CLM-DEMO-1002` fails on that named flight. Officer B receives no rows for either claim.

## Conflicting return date

The revised itinerary on the complete bundle agrees with the form, so this case has its own file. `parser/generate_samples.py` writes `fixtures/samples/conflict/revised-itinerary.pdf` with SC202 on 8 August 2026. The complete PDFs stay on 7 August. `parser/convert_document.py` parsed that file into `fixtures/parses/conflict/revised-itinerary.pdf.json`. The stored items include `8 August 2026`.

`npm run seed:conflict` adds `CLM-DEMO-1003` beside the other two claims. It does not recreate the officers. The traveler, policy, and received time match the complete claim, and the status is `needs review`. Six files come from the complete bundle. `revised-itinerary.pdf` comes from the conflict file. No Jev call is made, and no facts, decision, or message are stored.

Filing and consistency are `unknown`. The form date stays 7 August 2026 and the revised Singapore arrival stays 8 August 2026. No deadline is stored. Completeness, coverage, claim type, and delay pass. A later run replaces only `CLM-DEMO-1003`. `CLM-DEMO-1001` and `CLM-DEMO-1002` keep their ids, statuses, and file counts.

The queue shows Action needed and Check failed on `CLM-DEMO-1003`. `CLM-DEMO-1001` stays `information requested` and shows neither. `CLM-DEMO-1002` still shows both badges for the missing pass. The filing finding names both dates. Officer A can read all three claims. Officer B receives no rows.

## Unreadable return pass

A missing file fails completeness. A file with ink and no readable text is a different result. `parser/generate_samples.py` writes `fixtures/samples/unreadable/return-pass.png` from the SC202 boarding-pass card, then blurs it at radius 18. The name is not a fixture role, so the check does not treat the blur as a boarding pass. `parser/convert_document.py` parsed that file into `fixtures/parses/unreadable/return-pass.png.json`. The page is `unreadable`, the page text is empty, and there are no items.

`npm run seed:unreadable` adds `CLM-DEMO-1004` beside the other three claims. It does not recreate the officers. The traveler, policy, and received time match the complete claim, and the status is `needs review`. Six files come from the complete bundle, with `boarding-pass-sc202.pdf` left out. `return-pass.png` comes from the unreadable photo. No Jev call is made, and no facts, decision, or message are stored.

Completeness stays `unknown`. The finding is "A file is present but its document type is not established. SC202 on 7 August 2026 from NRT to SIN has no established boarding pass." It does not say the file is missing. Filing, coverage, claim type, consistency, and delay pass. A later run replaces only `CLM-DEMO-1004`. `CLM-DEMO-1001`, `CLM-DEMO-1002`, and `CLM-DEMO-1003` keep their ids, statuses, and file counts.

The queue shows Action needed and Check failed on `CLM-DEMO-1004`. The earlier claims stay as they were. The file list includes `return-pass.png`. Officer A can read all four claims. Officer B receives no rows. `npm run verify:checks` still reads only `CLM-DEMO-1001`.

## Traveler email

The missing-pass request now names the flight. When the latest completeness check is `fail`, the message keeps the greeting and the officer's rationale and adds one sentence per gap. For `CLM-DEMO-1002` that sentence is "The boarding pass for SC202 on 7 August 2026 from NRT to SIN is not on file." A passing check, including the stored message on `CLM-DEMO-1001`, keeps the earlier template. An `unknown` completeness check does not get this sentence. The officer does not edit the template. `private.record_request_message` reads the latest completeness row and writes the same sentence.

`npm run request:missing` signs in as officer A and records one request on `CLM-DEMO-1002` when none exists. The claim becomes `information requested`. Approve and Reject stay available. A second run leaves that decision and message in place. The row is `simulated` and `recorded`. If `RESEND_API_KEY` and `RESEND_FROM` are set, the server action sends that stored body and marks it `sent`. The mark function is not granted to the officer session. Those keys are not set, so nothing was delivered.

`POST /inbound/resend` is outside the login redirect. It verifies the Resend signature on the raw body and returns 401 otherwise. A repeated provider email id returns 200 and does not create a second claim. The webhook payload is not used as the file bytes. When `RESEND_API_KEY` is set, the route fetches the attachments and keeps PDF, PNG, and JPEG files within 25 MB.

`npm run intake:email` stores `CLM-DEMO-1005` from the fixture email `fixture-email-1005`. It reuses the seven complete files and their stored parses. It does not call Docling or Jev, and it stores no facts or decision. The traveler, policy, and received time match the complete claim. The status is `needs review`. All six checks pass. The acknowledgment is "Hello Jamie Lee," / "We received claim CLM-DEMO-1005." / the usual fictional footer. Its provider is `simulated` and its status is `recorded`. A second run replaces only this claim and this inbound row.

On the queue, `CLM-DEMO-1002` shows Check failed and does not show Action needed. `CLM-DEMO-1005` shows Action needed only. `CLM-DEMO-1001` shows neither. `CLM-DEMO-1003` and `CLM-DEMO-1004` still show both. The 1002 history names the 7 August flight. The 1005 history shows the acknowledgment. Officer A can read all five claims. Officer B receives no rows. `npm run verify:checks` still reads only `CLM-DEMO-1001`.

## Missing pass reply

The request on `CLM-DEMO-1002` stays. `npm run reply:missing` stores the traveler's reply on that same claim. The inbound row is `fixture-reply-1002`, from `jamie.lee@example.com`, with the subject `Re: Information requested for CLM-DEMO-1002`. The file is the stored complete `boarding-pass-sc202.pdf`. No Docling call and no Jev call are made.

A second assessment is stored beside the failed one. All six checks on that new assessment pass. The earlier completeness check still fails on `SC202 on 7 August 2026 from NRT to SIN`. The status returns to `needs review`. The request decision and its message stay. A second run does not add another file, assessment, or reply. The other four claims keep their statuses, file counts, and mail.

The history lists the reply first, then the passing assessment, then the request, then the failed assessment. Approve and Reject stay available. Request stays hidden because a request decision already exists. On the queue, `CLM-DEMO-1002` shows Action needed and does not show Check failed. The other rows keep their badges. Officer A can read all five claims. Officer B receives no rows. `npm run verify:checks` still reads only `CLM-DEMO-1001`.

## Clearer photo request

An unreadable file is not a missing file. When the latest completeness check is `unknown`, the file is unclassified, and the reason is that the document type is not established, the request names each gap as a clearer photo. For `CLM-DEMO-1004` that sentence is "Please send a clearer photo of the boarding pass for SC202 on 7 August 2026 from NRT to SIN." It does not say the boarding pass is not on file. A failed completeness check still uses the missing-pass sentence. A passing check, including the stored message on `CLM-DEMO-1001`, gets neither sentence. The officer does not edit the template. `private.record_request_message` reads the latest completeness row and writes the same sentence.

`npm run request:photo` signs in as officer A and records one request on `CLM-DEMO-1004` when none exists. The rationale is "Please send a clearer photo of the return boarding pass." The claim becomes `information requested`. Completeness stays `unknown`. The file `return-pass.png` stays. Approve and Reject stay available. A second run leaves that decision and message in place. The row is `simulated` and `recorded`. The other four claims keep their ids, statuses, and file counts.

On the queue, `CLM-DEMO-1004` shows Check failed and does not show Action needed. The history lists the message, then the request, then the unknown assessment. Officer A can read all five claims. Officer B receives no rows. `npm run verify:checks` still reads only `CLM-DEMO-1001`.

## Clearer photo reply

The request on `CLM-DEMO-1004` stays. `npm run reply:photo` stores the traveler's reply on that same claim. The inbound row is `fixture-reply-1004`, from `jamie.lee@example.com`, with the subject `Re: Information requested for CLM-DEMO-1004`. The file is the stored complete `boarding-pass-sc202.pdf`. `return-pass.png` stays. No Docling call and no Jev call are made.

A second assessment is stored beside the unknown one. All six checks on that new assessment pass. The earlier completeness check still says the document type is not established and names `SC202 on 7 August 2026 from NRT to SIN`. The status returns to `needs review`. The request decision and its message stay. A second run does not add another file, assessment, or reply. The other four claims keep their statuses, file counts, and mail.

The history lists the reply first, then the passing assessment, then the request, then the unknown assessment. Approve and Reject stay available. Request stays hidden because a request decision already exists. On the queue, `CLM-DEMO-1004` shows Action needed and does not show Check failed. The other rows keep their badges. Officer A can read all five claims. Officer B receives no rows. `npm run verify:checks` still reads only `CLM-DEMO-1001`.

## Conflicting return request

A date conflict is not a missing file. When the latest filing check is `unknown` and the form return date differs from the revised Singapore arrival, the request names both dates and does not pick one. For `CLM-DEMO-1003` that sentence is "The form return date 7 August 2026 disagrees with the revised Singapore arrival 8 August 2026. Both dates stay visible." It does not say a boarding pass is missing and it does not ask for a clearer photo. A passing filing check gets no date sentence. The officer does not edit the template. `private.record_request_message` reads the latest filing row and writes the same sentence.

`npm run request:conflict` signs in as officer A and records one request on `CLM-DEMO-1003` when none exists. The rationale is "Please confirm which return date is correct." The claim becomes `information requested`. Filing and consistency stay `unknown`. No deadline is stored. Approve and Reject stay available. A second run leaves that decision and message in place. The row is `simulated` and `recorded`. The other four claims keep their ids, statuses, and file counts.

On the queue, `CLM-DEMO-1003` shows Check failed and does not show Action needed. The history lists the message, then the request, then the assessment whose filing and consistency are `unknown`. Officer A can read all five claims. Officer B receives no rows. `npm run verify:checks` still reads only `CLM-DEMO-1001`.

## Conflicting return reply

The request on `CLM-DEMO-1003` stays. `npm run reply:conflict` stores the traveler's reply on that same claim. The inbound row is `fixture-reply-1003`, from `jamie.lee@example.com`, with the subject `Re: Information requested for CLM-DEMO-1003`. The 8 August file stays, now named `revised-itinerary-8-august.pdf`, and the earlier quote still points at it. `revised-itinerary.pdf` is the stored complete itinerary, which says 7 August 2026. No Docling call and no Jev call are made.

A second assessment is stored beside the unknown one. All six checks on that new assessment pass. Filing now has the 7 August return, working day 2, and deadline 21 September 2026. The earlier filing check still disagrees, 7 August against 8 August, and still stores no deadline. The status returns to `needs review`. The request decision and its message stay. A second run does not add another file, assessment, or reply. The other four claims keep their statuses, file counts, and mail.

The history lists the reply first, then the passing assessment, then the request, then the unknown assessment. Approve and Reject stay available. Request stays hidden because a request decision already exists. On the queue, `CLM-DEMO-1003` shows Action needed and does not show Check failed. The other rows keep their badges. Officer A can read all five claims. Officer B receives no rows. `npm run verify:checks` still reads only `CLM-DEMO-1001`.

## Missing pass approval

`CLM-DEMO-1002` is the claim that finished the round trip. The latest six checks pass, the earlier completeness failure stays, and the request and reply stay. `npm run approve:missing` signs in as officer A and records one approval when none exists. The rationale is "The missing boarding pass is now on file and the latest checks pass." The claim becomes `approved`. No message is recorded. A second run leaves that decision in place. The other four claims keep their ids, statuses, file counts, and mail.

The history lists the approval first, then the reply, then the passing assessment, then the request, then the failed assessment. Approve and Reject are gone. On the queue, `CLM-DEMO-1002` shows `approved` and shows neither badge. Officer A can read all five claims. Officer B receives no rows. `npm run verify:checks` still reads only `CLM-DEMO-1001`.

## Live inbound mail

`POST /inbound/resend` verifies the signature, stores PDF, PNG, and JPEG bytes, and inserts the inbound row before it answers. It then starts `npm run receive:mail` for that row. The same command retries every Resend row that still has no claim. Docling runs on this machine. A file whose bytes match a stored sample uses that sample's parse.

A new claim needs a file named `claim-form.pdf`. The form supplies the claimant, the policy reference, and the return date. The sender address is the traveler email. The claim is assigned to officer A, the files are stored, and the six checks run. The reference is `CLM-LIVE-` plus twelve characters from the provider email id. The received time is the time the mail was stored. An email whose subject names a `CLM-DEMO-` claim is left unmatched. A subject that names a `CLM-LIVE-` claim in `information requested` adds the new files, stores a new assessment, and returns that claim to `needs review`.

`CLM-LIVE-7FEE6FF8C2E1` is the mail that arrived at the Resend receiving address with the subject `Flight delay documents`. All seven complete-sample files are on the claim. The return date is 7 August 2026. Five checks pass. Filing fails because the mail was received on 17 October 2026, after the deadline of 21 September 2026. The acknowledgment was sent through Resend. A second run does not add another claim. An earlier message with the subject `Test` and no claim form stays unmatched, so officer A cannot see it. `CLM-LIVE-DRYRUNCOMPLE` is the earlier local rehearsal of the same path, including one request and one reply. The five demo claims keep their statuses.

`npm run verify:access` still requires the five demo claims and their fixture mail. Any other claim must use a `CLM-LIVE-` reference. Officer B receives no rows. `npm run verify:checks` still reads only `CLM-DEMO-1001`.

## Unavailable document reply

A reply can say the requested document cannot be obtained. `POST /inbound/resend` reads the plain-text body from Resend and stores it on the inbound row. Existing rows stay without a body. The new `unavailable_noul` column stores the judgment so a second run does not call Jev again.

The subject must name a `CLM-LIVE-` claim whose status is `information requested`. A `CLM-DEMO-` subject stays unmatched. The question stays in code: whether the traveler says a requested document is missing or cannot be obtained. The state sent to `jev-1.13.0` is the stored body plus the gaps named by the latest completeness check. One noul is asked. Support is `noul >= 0.75`. A missing key, a failed call, an empty body, or a lower probability does not send the new sentence. A reply that is not a clear yes still requires files, stores a new assessment, and returns the claim to `needs review`.

A clear yes may have no attachments. It does not store a new assessment. The message subject is `Update for {reference}`. The body greets the claimant, then one line per gap: "If the boarding pass for {gap} is not available, you do not need to send it. The claim stays with the officer." `decision_id` stays null. Resend is tried when `RESEND_FROM` is set, and the message is recorded either way. A second run finds that subject and does not send again. The claim returns to `needs review`. Approve and Reject remain. The history shows the stored body on the reply line.

`npm run reply:unavailable` creates `CLM-LIVE-UNAVAILABLER` from the missing-pass sample only when that claim is absent. It records one officer request, then one body-only reply: "I do not have the boarding pass for the return flight." Jev returned 0.96. The update was recorded as simulated because the traveler address is `jamie.lee@example.com`. Completeness is still the latest check and still fails on SC202 on 7 August 2026 from NRT to SIN. The status is `needs review`. A second run adds nothing. The five demo claims keep their statuses. `npm run verify:access` still requires those five claims.

## Unmatched document question

A message that never becomes a claim can ask which documents to send. It stays off the queue. Officer A reads those rows from Unmatched mail. Officer B still receives no inbound rows. The stored `Test` message has no body, so it stays on that list with no reply.

The question is asked only when the row has a body, no `claim-form.pdf`, and no claim reference in the subject. The question stays in code: whether the traveler is asking which documents to send. The state sent to `jev-1.13.0` is the stored body and the subject. One noul is asked. Support is `noul >= 0.75`. The noul is stored on the inbound row so a second run does not call Jev again. A missing key, a failed call, an empty body, or a lower probability sends nothing.

A clear yes records one message on that same inbound row. There is no claim, so there is no `decision_id`. The subject is `Documents to send`. The body greets the sender, then names the claim form, the scheduled itinerary, the revised itinerary, the delay letter, and a boarding pass for each flight. Resend is tried when `RESEND_FROM` is set, and the message is recorded either way. A second run finds that reply and does not send again.

`npm run ask:documents` stores one body-only message, "What documents should I send?", only when that row is absent. Jev returned 0.92. The list was recorded as simulated because the sender address is `jamie.lee@example.com`. No claim was created. A second run adds nothing. The five demo claims, `CLM-LIVE-7FEE6FF8C2E1`, `CLM-LIVE-DRYRUNCOMPLE`, `CLM-LIVE-UNAVAILABLER`, and the `Test` message stay as they were. `npm run verify:access` still requires the five demo claims.
