# @arvist/react

React SDK for the [Arvist](https://arvist.ai) API. Headless hooks and
dependency-free components for quality inspection — live station feeds,
exception handling, and count reconciliation.

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

`react` 18 or 19 is the only required peer dependency. `socket.io-client` is
optional, needed only for the realtime feed. There are no runtime dependencies
and no styling framework to adopt.

## Three layers

Use whichever you need — they are separate entry points.

| Import | What you get | React? |
|---|---|---|
| `@arvist/react/core` | API client, realtime feed, exception and reconciliation logic | No |
| `@arvist/react` | Provider and headless hooks | Yes |
| `@arvist/react/ui` | Ready-made components built on those hooks | Yes |

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
  const exceptions = useExceptions(inspection.shipment, { onResolved: inspection.refresh });

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

### Nine exception types from seven stored rows, in three shapes

The API persists seven issue types, in three different shapes:

- **Session-scoped singleton** — `damage`, `wrong_load`, `no_identifiers`. At
  most one open row per unit session; resolved with a plain status write
  (`resolveIssue`).
- **Per-instance** — `unidentified_product`, `wrong_product`. One row per
  detected annotation, so a session can carry several of the same type;
  resolved by id with a keyword action (`resolveIssueById`).
- **Session-less, per line item** — `overage`, `shortage`. At most one open
  row per line item (`line_items[].issue`), not attached to any unit session;
  also resolved by id with a keyword action.

An operator screen has to cover nine situations regardless of shape. The rest
are implied by the line items — a hand-edited count, or a sentinel SKU
standing in for an off-order item.

`deriveExceptions()` produces the full list, normalised, sorted blocking-first,
with resolution paths attached:

| Exception | Where it comes from |
|---|---|
| Unidentified product | `unidentified_product` row(s) only |
| Wrong product | `wrong_product` row(s) only |
| Overage | `overage` row on the line item only |
| Shortage | `shortage` row on the line item only |
| Manual count correction | `is_edited` on a line |
| Wrong load *(pallet only)* | `wrong_load` row |
| Missing identifiers *(pallet only)* | `no_identifiers` row |
| Unit removed | `wrong_load` row resolved as `canceled` |
| Damage | `damage` row |

Four things this gets right that are easy to get wrong by hand. An
unidentified item is recorded **twice** — an issue row *and* an `unknown`
sentinel line carrying the count — and they are one problem, so the count is
folded in and it is reported once. A `wrong_load` closed by cancelling the unit
is reported as **Unit removed**, because the unit leaving the inspection is
what downstream systems need to see. A per-instance issue type keeps every
detected instance as its own exception rather than collapsing same-type rows
into one — resolving one `wrong_product` finding never silently closes another.
And every exception type traces back to a real row in the issues table — none
of them are derived from quantity math or a sentinel SKU alone, even when the
raw numbers would already tell the same story, because the issues table is the
system of record for audit and KPI tracking. An exception invented client-side
would be invisible to that tracking while it sat in front of an operator.

### A shortage only ever comes from the API, never from quantity math

The API creates a `shortage` row exactly once: when the operator tries to
complete the inspection and comes up short (`detectShortages`, run from
`finishInspection`/`submitInspection` — never continuously during counting).
Before that point every ordered line reads as short by definition (counts
climb from zero as units complete), so deriving a "shortage" from
`actual_quantity < expected_quantity` client-side would mean reporting one on
every single line the instant an inspection starts. `deriveExceptions()`
reports nothing for a line until that real row exists.

Concretely, `finish()` can come back rejected rather than succeeding:

```tsx
try {
  await inspection.finish();
} catch (err) {
  // err.code === 'completion_blocked' — the API found real, open shortages.
  // inspection.shipment has already been refreshed, so the exceptions list
  // now shows them as real, resolvable rows.
}
```

Resolve those (or any other exception) and call `finish()` again. Set
`autoCompleted` on the provider when an upstream system closes shipments out of
band (a box-closure scan, say) — an open shortage is still recorded, but
`blocksCompletion` reads `false` instead of `true`.

### Count corrections are staged, not written

There is no endpoint for editing a line item's count on its own, outside of
resolving a `shortage` exception (see below). The API applies a standalone
correction as part of `submit`. So `useInspection` holds them:

```tsx
inspection.stageCorrection(lineItem, 4);
inspection.corrections;   // pending, sent on submit
await inspection.submit(); // flushes them
```

Staged corrections are layered *over* the fetched shipment rather than written
into it, so a refetch cannot silently discard them.

A `shortage` exception's own `correct_count` resolution is different: it writes
immediately, resolving that specific issue row —

```tsx
exceptions.resolve({ exception, resolution, quantity: 4 });
```

— rather than waiting for `submit`. Reach for `stageCorrection` only when you
want a standalone "edit this line's count" control that isn't tied to
resolving a specific exception.

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

Components ship plain CSS — no Tailwind, no CSS-in-JS, nothing to configure.
Import the stylesheet once:

```ts
import '@arvist/react/styles.css';
```

Everything is scoped under `.arvist-root`, which each component sets on its own
outermost element, so nothing leaks into the rest of your page.

There are three levels of override, in increasing order of control:

```tsx
// 1. Retheme everything at once — redefine the tokens on :root or any ancestor.
:root { --arvist-blocking: #b91c1c; --arvist-radius: 0; }

// 2. Restyle one part of one component.
<ExceptionCard exception={e} classNames={{ title: 'font-mono', actions: 'my-grid' }} />

// 3. Take the markup and behaviour, drop the visuals entirely.
<ExceptionCard exception={e} unstyled />
```

Every component's slot names are exported as a type (`ExceptionCardSlot`,
`ReconciliationTableSlot`, …), so the override map is autocompleted and
typo-checked.

Components also set data attributes for the states worth styling on —
`data-exception-type`, `data-severity`, `data-status`, `data-phase`,
`data-variance`, `data-connection` — which is usually cleaner than slot classes
when you want one rule to cover every severity.

Light and dark are both defined. The system preference applies by default;
`.arvist-dark` or `[data-theme="dark"]` forces dark on a subtree, which is how
you render a dark packstation panel inside a light admin app. `.arvist-touch`
enlarges hit targets for gloved operators at arm's length.

**Using Tailwind?** The components don't need it, but you can point Tailwind's
colour utilities at the same tokens so your markup and the SDK stay in lockstep
through theme changes:

```css
@theme {
  --color-arvist-surface: var(--arvist-surface);
  --color-arvist-blocking: var(--arvist-blocking);
  /* ... */
}
```

The [example](./examples/packstation) does exactly this.

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
npm test          # 166 tests: derivation, reconciliation, transport, and component rendering
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
