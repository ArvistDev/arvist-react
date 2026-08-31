# @arvist/react

React SDK for the [Arvist](https://arvist.ai) API. Headless hooks and Tailwind
components for quality inspection — live station feeds, exception handling, and
count reconciliation.

Source-available under the [Business Source License 1.1](./LICENSE): free to
use in production to build applications that interface with Arvist Services,
and Apache-2.0 from 2030-03-01. See [License](#license).

The API is straightforward to call. What is not straightforward is everything
around it: nine operator-facing exception types derived from four stored issue
rows, realtime topics keyed three different ways, presigned media that expires
in about half an hour, and count corrections that are not a live write at all.
This package carries that weight so an integration is a day of work rather than
a fortnight of discovering it.

```bash
npm install @arvist/react
```

`react` 18 or 19 is a peer dependency. `socket.io-client` is an optional peer
dependency, needed only for the realtime feed.

## Three layers

Use whichever you need — they are separate entry points.

| Import | What you get | React? |
|---|---|---|
| `@arvist/react/core` | API client, realtime feed, exception and reconciliation logic | No |
| `@arvist/react` | Provider and headless hooks | Yes |
| `@arvist/react/ui` | Tailwind components built on those hooks | Yes |

## Quick start

```tsx
import { io } from 'socket.io-client';
import { ArvistProvider, useInspection, useExceptions } from '@arvist/react';
import { ExceptionList, InspectionStatus } from '@arvist/react/ui';
import '@arvist/react/styles.css';

const config = { baseUrl: 'https://arvist.example.com', token: getToken, siteId: 1 };

function App() {
  return (
    <ArvistProvider config={config} realtime={{ io }}>
      <PackStation />
    </ArvistProvider>
  );
}

function PackStation() {
  const inspection = useInspection({ areaName: 'Z01-PS-001' });
  const exceptions = useExceptions(inspection.shipment, {
    onResolved: inspection.refresh,
    onCorrectCount: ({ lineItem, quantity }) =>
      inspection.stageCorrection(lineItem, quantity),
  });

  return (
    <>
      <InspectionStatus
        phase={inspection.phase}
        progress={inspection.progress}
        connection={inspection.connection}
      />
      <ExceptionList
        exceptions={exceptions.exceptions}
        resolvingKey={exceptions.resolving}
        onResolve={(exception, resolution, reason) =>
          exceptions.resolve({ exception, resolution, reason })
        }
      />
      <button disabled={!inspection.completion.canComplete} onClick={inspection.submit}>
        Complete
      </button>
    </>
  );
}
```

Hold `config` stable — memoise it or define it at module scope. The provider
rebuilds its client and reconnects whenever that object's identity changes.

## What the SDK actually decides for you

### Nine exception types from four stored rows

The API persists four issue types: `damage`, `unidentified_product`,
`wrong_load`, `no_identifiers`. An operator screen has to cover nine
situations. The rest are implied by the line items — a count over or under
expected, a hand-edited count, or a sentinel SKU standing in for an off-order
item.

`deriveExceptions()` produces the full list, normalised, sorted blocking-first,
with resolution paths attached:

| Exception | Where it comes from |
|---|---|
| Unidentified product | `unidentified_product` row, and/or an `unknown` sentinel line |
| Wrong product | a `wrong` sentinel line |
| Overage | `actual_quantity` > `expected_quantity` |
| Shortage | `actual_quantity` < `expected_quantity` |
| Manual count correction | `is_edited` on a line |
| Wrong load *(pallet only)* | `wrong_load` row |
| Missing identifiers *(pallet only)* | `no_identifiers` row |
| Unit removed | `wrong_load` row resolved as `canceled` |
| Damage | `damage` row |

Two things this gets right that are easy to get wrong by hand. An unidentified
item is recorded **twice** — an issue row *and* an `unknown` sentinel line
carrying the count — and they are one problem, so the count is folded in and it
is reported once. And a `wrong_load` closed by cancelling the unit is reported
as **Unit removed**, because the unit leaving the inspection is what downstream
systems need to see.

### Shortages are provisional until counting is done

Counts climb from zero as units complete, so mid-inspection every uncounted
line looks short. Reporting those as real exceptions buries the operator before
a single item is scanned.

A shortage is therefore `info` and non-blocking while the shipment is still
`in_progress`, and becomes `blocking` once it reaches `review`. `checkCompletion()`
always evaluates it as real — asking to complete an inspection *is* the
assertion that counting is done.

Set `autoCompleted` on the provider when an upstream system closes shipments out
of band (a box-closure scan, say). A shortage is then recorded but never blocks.

### Count corrections are staged, not written

There is no endpoint for editing a line item's count. The API applies
corrections as part of `submit`. So `useInspection` holds them:

```tsx
inspection.stageCorrection(lineItem, 4);
inspection.corrections;   // pending, sent on submit
await inspection.submit(); // flushes them
```

Staged corrections are layered *over* the fetched shipment rather than written
into it, so a refetch cannot silently discard them.

### Stations resolve two ways, and can silently go nowhere

Upstream systems address a station by name (`Z01-PS-001`); the realtime feed
keys per-unit topics on the numeric `area_id`. `useInspection` resolves one from
the other for you.

Separately: starting an inspection succeeds whether or not a screen has the
station selected. The record is created either way — it just never opens for an
operator. That is the most common "station not responding" report, and it is
invisible from the response alone. `useStationBinding()` surfaces it:

```tsx
const binding = useStationBinding('Z01-PS-001', { pollMs: 30_000 });
// binding.resolved === false → nothing is listening; work sent here disappears
```

### Errors have codes and operator-facing copy

Every failure is an `ArvistError` with a stable `code`. Branch on the code; show
`message` to an operator. The API reports most controller failures as a `400`
with prose, so the client narrows those to specific codes
(`station_not_found`, `completion_blocked`, `shipment_already_open`, …).

```tsx
import { getDisplayMessage } from '@arvist/react';
setToast(getDisplayMessage(err, resolveErrorMessage));
```

Override any string — for localisation or house voice — via `errorMessages` on
the provider.

### Barcodes

Line items carry their scannable code at `additional_data.upc`, falling back to
the SKU. That fallback is load-bearing: UPC population is not guaranteed, and a
shipment where only half the lines carry one must still scan for the rest.

```tsx
useScanMatch(shipment?.line_items, {
  onMatch: (item) => confirm(item),
  onUnmatched: (scan) => flagOffOrder(scan.value),
});

upcCoverage(shipment?.line_items); // { total, withUpc, ratio, missing }
```

Handheld scanners type their payload and press Enter, which is
indistinguishable from an operator at the keyboard until you look at the
timing. `useBarcodeScanner` listens page-wide and separates the two by
inter-keystroke gap, then validates the GTIN check digit.

### Media expires

Inspection images are presigned URLs, good for roughly thirty minutes.
`useShipmentMedia` tracks expiry and refetches before they break.

Pass the **shipment**, not its id — media arrives unit by unit, and a hook keyed
on the id alone fetches once and then shows the first unit's images forever.

```tsx
const media = useShipmentMedia(inspection.shipment);
```

This keeps a long-lived screen working. It is **not** retention: anything you
need to keep — for a claim, an audit, a customer-facing record — must be copied
to your own storage on receipt.

## Realtime

`realtime={{ io }}` is the common case. The transport is pluggable, so any
duplex channel can be adapted:

```ts
import { InspectionFeed, type RealtimeTransport } from '@arvist/react/core';
```

Normalised events: `started`, `unit-processing`, `unit-completed`,
`damages-detected`, `status`, `state-change`, `completed`, `canceled`, `error`.

Two things worth knowing. On `unit-completed`, `issues` is the **authoritative**
state for that unit — replace, do not append; empty means the unit was clean.
And `completed` is the reconciliation point; every count before it is
provisional.

Events arriving before a listener mounts are buffered and replayed, so a React
mount race cannot swallow the `started` event.

## Styling

Components are Tailwind-styled and take three escape hatches:

```tsx
<ExceptionCard
  exception={exception}
  className="p-8"                                 // wins over the built-in padding
  classNames={{ title: 'font-mono', actions: 'grid' }}  // per-slot
  unstyled                                        // structure only
/>
```

Colours come from `--color-arvist-*` theme variables. Redefine them on `:root`
to rebrand everything at once. Light and dark are both defined; `.arvist-dark`
forces dark on a subtree. `.arvist-touch` enlarges hit targets for gloved
operators at arm's length.

Ship the prebuilt stylesheet:

```ts
import '@arvist/react/styles.css';
```

Or, on Tailwind v4, generate utilities from source instead:

```css
@import 'tailwindcss';
@source "../node_modules/@arvist/react/dist";
```

## Not using React?

`@arvist/react/core` has no React dependency. The client, the realtime feed,
and — most usefully — `deriveExceptions`, `reconcile`, and `checkCompletion`
all run anywhere. A server consuming the same events reaches identical
conclusions to the screen, which is the point.

## Example

[`examples/packstation`](./examples/packstation) is a complete
packstation screen. It runs against a scripted mock backend by default, so you
can open it with no credentials:

```bash
cd examples/packstation && npm install && npm run dev
```

The mock mirrors the real API's response envelopes exactly, inconsistencies
included — that is deliberate, and it caught several real bugs in this SDK.

## Development

```bash
npm install
npm test          # 119 tests over the derivation, reconciliation, and transport logic
npm run typecheck
npm run build
```

## License

[Business Source License 1.1](./LICENSE).

In short: you can read, modify, and redistribute the source freely, and you can
run it in production **to build applications that talk to Arvist Services**.
That is the normal case — this SDK does nothing else. Using it against a
non-Arvist backend in production is not covered; contact licensing@arvist.ai if
you need different terms.

Each released version converts to the Apache License 2.0 on the Change Date
(2030-03-01) or four years after it was published, whichever comes first.

SPDX identifier: `BUSL-1.1`.
