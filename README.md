# SureCover AI Claims Prototype

An officer workbench for a fictional flight-delay claim. A traveler sends documents by email. An officer signs in, reads the checks and the evidence, and records the decision.

Travelers and officers: [Using SureCover](Documents/Guide.md).

## Where it is

The workbench is [surecover-ai-claims-prototype.vercel.app](https://surecover-ai-claims-prototype.vercel.app).

Send documents to `claims@eeelkoizil.resend.app`. Replies come from `claims@claims.refund.casa`.

## Run it

```bash
npm install
npm run dev
```

The workbench is at [http://localhost:3000](http://localhost:3000). Copy `.env.example` to `.env` and fill in the values. The names are `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OFFICER_PASSWORD`, `TYPESAFE_API_KEY`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, and `RESEND_FROM`.

Intake reads stored mail and sends the replies. Each run handles the mail waiting at that moment:

```bash
npm run receive:mail
```

Repeat it while this machine should keep up with new mail. Mail that arrives between runs stays stored until the next pass. A document that is not a known sample is read by the parser in `parser/`.

## What is in the box

- Next.js workbench on Vercel
- Hosted Supabase for claims, documents, and row-level security
- Resend for inbound mail and outbound replies
- A local document parser for dates, flight numbers, and page text
- Jev for three yes-or-no questions: handle this sooner, a requested document cannot be obtained, and which documents to send

The six checks are fixed rules. The guide shows the mail path, the checks, and those three questions.
