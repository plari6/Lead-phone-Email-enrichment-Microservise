# Lead Phone & Email Enrichment Microservice

Checks every lead **before** it goes into a sales campaign:

- **Email deliverability** with [Hunter.io](https://hunter.io/api-documentation/v2#email-verifier) and [Abstract API](https://docs.abstractapi.com/email-validation), so sequences don't bounce and hurt your sender reputation.
- **Phone line type** (mobile, landline, VoIP, toll-free, premium) with [Abstract API](https://docs.abstractapi.com/phone-validation), so SMS only goes to mobiles and dialers skip junk numbers.
- **Campaign routing**: every lead gets the channels it can safely use (`email`, `sms`, `call`), a status (`ready`, `review`, `rejected`) and a 0–100 contactability score.

You can use it as a **CLI** on CSV, Excel or JSON lead lists, or as a **REST microservice** for a CRM, Zapier, Make or n8n.

```
leads.csv ─► free local checks ─► Hunter.io ─► Abstract API ─► decision ─► enriched.xlsx
             syntax, disposable,   (email)      (email if Hunter    email / sms / call
             DNS mail server,                    is unsure; phone   ready / review / rejected
             phone numbering plan                line type)
```

## Why it is cheap to run

- **Free checks first.** Bad syntax, disposable domains (mailinator…), domains with no mail server, and impossible phone numbers are rejected locally. They never use an API credit.
- **Waterfall strategy.** Hunter is asked first; Abstract is only called when Hunter can't give a clear answer (catch-all or unknown).
- **Cache + de-duplication.** The same email or number is never paid for twice: duplicates in a file are looked up once, and results are cached on disk for 30 days.
- **Rate limits and retries.** Requests are spaced to each provider's limits and retried with back-off on 429/5xx. If a key is invalid or out of credits, that provider is switched off for the run and the next one takes over.

## Quick start

```bash
npm install
npm run demo          # enrich samples/leads.csv with fake providers -> output/enriched-leads.xlsx
npm test              # 50 tests, no network or keys needed
```

Add your keys to use the real APIs:

```bash
cp .env.example .env  # then fill in HUNTER_API_KEY, ABSTRACT_EMAIL_API_KEY, ABSTRACT_PHONE_API_KEY
```

Every key is optional. With no keys, you still get the free local checks (emails come back as `unknown`, so they go to `review`).

## CLI

```bash
# Enrich a lead list (.csv, .xlsx or .json). Output: .xlsx (default), .csv or .json
node bin/lead-enrich.js file leads.csv -o output/leads-enriched.xlsx

# Only keep campaign-ready leads, as a ; separated CSV for Excel in comma-decimal locales
node bin/lead-enrich.js file leads.xlsx --only ready -o ready.csv -d ";"

# One-off checks (JSON output)
node bin/lead-enrich.js email jane@acme.com
node bin/lead-enrich.js phone "+44 7400 123456"
node bin/lead-enrich.js lead -e jane@acme.com -p "(212) 456-7890"

# Which providers are active?
node bin/lead-enrich.js providers
```

Install it globally with `npm link` to use `lead-enrich ...` from any folder.

| Option | Meaning |
|---|---|
| `--mock` | fake providers: no network, no credits |
| `-c, --country <ISO2>` | default country for numbers without `+code` (a `Country` column overrides it per row) |
| `-s, --strategy` | `waterfall` (default), `consensus`, `hunter`, `abstract` |
| `--allow-risky` | send catch-all emails to the email channel too |
| `--email-col`, `--phone-col`, `--country-col` | column names, if auto-detection misses them |
| `--only <status>` | write only `ready`, `review` or `rejected` leads |
| `--limit <n>` | process the first n leads (test a big file cheaply) |
| `--no-mx`, `--no-cache` | skip the DNS check / the cache |

Column names are detected automatically (`Email`, `Work Email`, `E-mail Address`, `Phone`, `Mobile`, `Cell Phone`, `Direct Phone`, `Country`…). Semicolon CSVs and BOMs are handled.

### Excel output

The `.xlsx` file has five sheets: **Summary**, **All Leads**, **Ready**, **Review** and **Rejected**. Your original columns are kept, followed by:

| Column | Example |
|---|---|
| `email_status` | `deliverable`, `risky`, `unknown`, `undeliverable`, `missing` |
| `email_score`, `email_reasons`, `email_suggestion` | `92`, `catch_all_domain; role_account`, `jane@gmail.com` |
| `phone_e164`, `phone_status` | `+12124567890`, `valid` |
| `phone_line_type`, `phone_line_type_source` | `mobile`, `carrier_lookup` |
| `phone_carrier`, `phone_country`, `phone_location` | `T-Mobile USA`, `US`, `California` |
| `can_email`, `can_sms`, `can_call` | `yes` / `no` |
| `campaign_channels`, `campaign_status`, `lead_score` | `email, sms, call`, `ready`, `100` |
| `notes` | `landline: call only, no SMS` |

## Decision rules

| Situation | Result |
|---|---|
| Email deliverable | email channel |
| Email risky (catch-all, providers disagree) | `review` (or email channel with `ALLOW_RISKY_EMAIL=true`) |
| Email unknown, or likely typo (`gmial.com`) | `review` |
| Email undeliverable / disposable / no mail server | suppressed |
| Mobile number | SMS + call |
| Landline, VoIP | call only |
| US/CA number with no carrier lookup (`landline_or_mobile`) | call only, until a lookup confirms it's a mobile |
| Toll-free, premium-rate | `review` |
| Invalid number | no phone channels |

A lead is `ready` if at least one channel is usable, `review` if a person should look at it, and `rejected` if there's no usable contact data. All rules can be changed in `.env` (`SMS_LINE_TYPES`, `CALL_LINE_TYPES`, `ALLOW_*`).

## REST API

```bash
node bin/lead-enrich.js serve            # or: npm start / docker build -t lead-enrich . && docker run -p 3000:3000 --env-file .env lead-enrich
```

If `SERVICE_API_KEY` is set, send it as `x-api-key` (or `Authorization: Bearer ...`).

| Method | Path | Body |
|---|---|---|
| GET | `/health` | public uptime check |
| GET | `/v1/providers` | active providers and settings |
| POST | `/v1/enrich` | `{ "email": "...", "phone": "...", "country": "US", ...any CRM fields }` |
| POST | `/v1/enrich/batch` | `{ "leads": [ ... ], "country": "US" }` (max 500) |
| POST | `/v1/verify/email` | `{ "email": "..." }` |
| POST | `/v1/verify/phone` | `{ "phone": "...", "country": "GB" }` |

```bash
curl -X POST localhost:3000/v1/enrich -H "content-type: application/json" \
  -d '{"email":"jane@acme.com","phone":"(212) 456-7890"}'
```

```json
{
  "lead": { "email": "jane@acme.com", "phone": "(212) 456-7890" },
  "email": { "status": "deliverable", "score": 92, "reasons": [], "providers": ["local", "hunter"] },
  "phone": { "e164": "+12124567890", "status": "valid", "lineType": "mobile", "lineTypeSource": "carrier_lookup", "carrier": "Verizon Wireless" },
  "decision": { "status": "ready", "channels": ["email", "sms", "call"], "score": 100, "notes": [] }
}
```

**Zapier / Make / n8n:** add an HTTP step that POSTs the new lead to `/v1/enrich`, then filter on `decision.status == "ready"` and branch on `decision.canSms` before adding the lead to your email or SMS sequence.

## Project layout

```
bin/lead-enrich.js        CLI (commander)
src/enricher.js           wires providers, cache, rate limits; enrichLead / enrichMany
src/verifiers/email.js    local pre-check -> waterfall / consensus -> combined verdict
src/verifiers/phone.js    numbering-plan parse -> carrier line-type lookup
src/decision.js           channel + status + score rules
src/providers/            hunter.js, abstract.js, local.js, mock.js
src/io/                   CSV / Excel / JSON read + write, column detection
src/server.js             Express REST API
test/                     node:test suite (fake HTTP, no keys needed)
```

## Provider notes

- **Hunter.io**: `401` = bad key, `429` = monthly quota used up (provider is switched off), `403` = rate limited and `202` = still verifying (both retried).
- **Abstract API**: email and phone are separate products with separate keys. `401`/`422` = bad key or quota (switched off), `429` = rate limited (retried). The free plan allows 1 request per second, which is the default spacing.
- Endpoints can be changed with `HUNTER_BASE_URL`, `ABSTRACT_EMAIL_BASE_URL` and `ABSTRACT_PHONE_BASE_URL`.
