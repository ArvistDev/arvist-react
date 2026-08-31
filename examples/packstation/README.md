# Packstation example

A complete packstation screen built on `@arvist/react`: one station, one
inspection at a time, exceptions handled in place.

It runs against a **scripted mock backend** by default, so you can open it with
no credentials and no site:

```bash
npm install
npm run dev
```

## What it demonstrates

- **Station binding** — resolves `Z01-PS-001` by name and polls whether anything
  is actually listening on it, so an unbound station is visible before the next
  tote arrives instead of after the work goes missing.
- **Live inspection** — subscribes to the station's realtime topics and folds
  unit completions into local state as they arrive.
- **The exceptions panel** — all nine exception types, grouped blocking-first,
  each with its own resolution paths. This is the piece that moves exception
  handling out of the Arvist UI.
- **Reconciliation** — expected against counted per line, with off-order items
  listed separately, and a provisional marker until counts are final.
- **Staged count corrections** — corrections are held and flushed on submit,
  because the API has no endpoint for writing one on its own.
- **Scan handling** — a tote scan starts an inspection; scans during one are
  matched against line items via UPC with SKU fallback.
- **Media** — presigned images with expiry tracking, refreshing as units land.

## Driving it

The **Simulate** panel stands in for the upstream system and the floor:

| Button | What it does |
|---|---|
| Scan tote | Calls Start Shipment Processing, as an upstream tote scan would |
| Next unit | Completes one unit, advancing the scripted scenario |
| Reset | Clears the shipment |

The scenario walks through every exception family in four units — a clean unit,
an unidentified item, an off-order item plus damage, and finally a shortage that
blocks completion until it is resolved or corrected.

Toggle **Shipment auto-completed upstream** to see the shortage stop blocking,
which is the behaviour you want when a box-closure scan closes the shipment out
of band.

A real handheld scanner works too — the page reads scanner input from anywhere
on screen, no focused field required.

## Against a real deployment

Copy `.env.example` to `.env` and set `VITE_ARVIST_URL`. Nothing in the app
changes: the mock is swapped out at the provider, and every component and hook
below it is untouched.

Behind Cloudflare Access, set the service-token pair as well. The two auth
layers are independent — Access authenticates the device at the edge, the bearer
token authenticates the caller, and a deployment behind Access needs both.

## About the mock

Response envelopes mirror the real API exactly, **including its
inconsistencies**: reads return their payload bare, `start` returns
`{ message, shipment }`, and several writes return a plain JSON string. That is
deliberate. A mock that tidied the API up would hide precisely the bugs this
example exists to catch — and it caught several while the SDK was being written.
