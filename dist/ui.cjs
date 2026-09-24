'use strict';

var chunkJFRZCX24_cjs = require('./chunk-JFRZCX24.cjs');
var React = require('react');
var jsxRuntime = require('react/jsx-runtime');

function _interopNamespace(e) {
  if (e && e.__esModule) return e;
  var n = Object.create(null);
  if (e) {
    Object.keys(e).forEach(function (k) {
      if (k !== 'default') {
        var d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: function () { return e[k]; }
        });
      }
    });
  }
  n.default = e;
  return Object.freeze(n);
}

var React__namespace = /*#__PURE__*/_interopNamespace(React);

/**
 * @arvist/react
 * Copyright (c) 2026 Arvist, Inc.
 *
 * Licensed under the Business Source License 1.1 (the "License").
 * Production use is granted solely to develop, test, and operate
 * applications that interface with Arvist Services. Converts to the
 * Apache License 2.0 on 2030-03-01.
 *
 * SPDX-License-Identifier: BUSL-1.1
 * See the LICENSE file distributed with this package.
 */

// src/ui/cn.ts
function cn(...inputs) {
  const out = [];
  const walk = (value) => {
    if (!value) return;
    if (typeof value === "string") {
      if (value) out.push(value);
      return;
    }
    if (typeof value === "number") {
      out.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    for (const [key, enabled] of Object.entries(value)) {
      if (enabled) out.push(key);
    }
  };
  for (const input of inputs) walk(input);
  return out.join(" ");
}

// src/ui/slots.ts
function createSlots(props) {
  return (slot, ...defaults) => cn(props.unstyled ? void 0 : defaults, props.classNames?.[slot]);
}
var STATUS_LABELS = {
  open: "Open",
  unresolved: "Escalated",
  resolved: "Resolved",
  canceled: "Removed",
  false_positive: "Not an issue"
};
function ExceptionCard({
  exception,
  onResolve,
  busy = false,
  readOnly = false,
  children,
  className,
  classNames,
  unstyled
}) {
  const slot = createSlots({ classNames, unstyled });
  const open = chunkJFRZCX24_cjs.isExceptionOpen(exception);
  const [pending, setPending] = React__namespace.useState(null);
  const [reason, setReason] = React__namespace.useState("");
  const [error, setError] = React__namespace.useState(null);
  const submit = async (resolution) => {
    setError(null);
    if (resolution.requiresReason && !reason.trim()) {
      setPending(resolution);
      return;
    }
    try {
      await onResolve?.(resolution, resolution.requiresReason ? reason.trim() : void 0);
      setPending(null);
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resolve.");
    }
  };
  return /* @__PURE__ */ jsxRuntime.jsxs(
    "article",
    {
      "data-exception-type": exception.type,
      "data-severity": exception.severity,
      "data-status": exception.status,
      className: cn(
        slot(
          "root",
          "arvist-root arvist-exception",
          `arvist-exception--${exception.severity}`,
          !open && "arvist-exception--closed"
        ),
        className
      ),
      children: [
        /* @__PURE__ */ jsxRuntime.jsxs("header", { className: slot("header", "arvist-exception__header"), children: [
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: slot("badge", "arvist-exception__badge"), children: [
            /* @__PURE__ */ jsxRuntime.jsx("span", { "aria-hidden": "true", className: slot("dot", "arvist-dot") }),
            /* @__PURE__ */ jsxRuntime.jsx("h3", { className: slot("title", "arvist-exception__title"), children: exception.title }),
            exception.palletOnly ? /* @__PURE__ */ jsxRuntime.jsx("span", { className: slot("scope", "arvist-exception__scope"), children: "pallet" }) : null
          ] }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: slot("status", "arvist-pill arvist-exception__status"), children: STATUS_LABELS[exception.status] ?? exception.status })
        ] }),
        exception.description ? /* @__PURE__ */ jsxRuntime.jsx("p", { className: slot("description", "arvist-exception__description"), children: exception.description }) : null,
        exception.blocksCompletion ? /* @__PURE__ */ jsxRuntime.jsx("p", { className: slot("blocker", "arvist-exception__blocker"), children: "Blocks completion until resolved." }) : null,
        children,
        pending?.requiresReason ? /* @__PURE__ */ jsxRuntime.jsx("div", { className: slot("reason", "arvist-exception__reason"), children: /* @__PURE__ */ jsxRuntime.jsxs("label", { className: slot("reasonLabel", "arvist-exception__reason-label"), children: [
          "Why can this not be resolved?",
          /* @__PURE__ */ jsxRuntime.jsx(
            "textarea",
            {
              value: reason,
              onChange: (e) => setReason(e.target.value),
              rows: 2,
              autoFocus: true,
              className: slot("reasonInput", "arvist-exception__reason-input")
            }
          )
        ] }) }) : null,
        error ? /* @__PURE__ */ jsxRuntime.jsx("p", { role: "alert", className: slot("error", "arvist-exception__error"), children: error }) : null,
        !readOnly && open && exception.resolutions.length > 0 ? /* @__PURE__ */ jsxRuntime.jsx("div", { className: slot("actions", "arvist-exception__actions"), children: exception.resolutions.map((resolution) => /* @__PURE__ */ jsxRuntime.jsxs(
          "button",
          {
            type: "button",
            disabled: busy,
            onClick: () => void submit(resolution),
            title: resolution.requiresPhysicalAction ? "Confirm only after the physical action is done" : void 0,
            className: slot("action", "arvist-btn"),
            children: [
              resolution.label,
              resolution.requiresPhysicalAction ? /* @__PURE__ */ jsxRuntime.jsx("span", { "aria-hidden": "true", className: "arvist-exception__physical-hint", children: "\u2197" }) : null
            ]
          },
          resolution.action
        )) }) : null
      ]
    }
  );
}
function ExceptionList({
  exceptions,
  onResolve,
  resolvingKey,
  openOnly = false,
  emptyState,
  groupBySeverity = true,
  readOnly,
  renderException,
  className,
  classNames,
  unstyled
}) {
  const slot = createSlots({ classNames, unstyled });
  const visible = React__namespace.useMemo(
    () => openOnly ? exceptions.filter(chunkJFRZCX24_cjs.isExceptionOpen) : exceptions,
    [exceptions, openOnly]
  );
  const blocking = visible.filter((e) => e.blocksCompletion);
  const rest = visible.filter((e) => !e.blocksCompletion);
  const card = (exception) => {
    const props = {
      exception,
      busy: resolvingKey === exception.key,
      readOnly,
      onResolve: onResolve ? (resolution, reason) => onResolve(exception, resolution, reason) : void 0,
      unstyled
    };
    return /* @__PURE__ */ jsxRuntime.jsx("li", { children: renderException ? renderException(props) : /* @__PURE__ */ jsxRuntime.jsx(ExceptionCard, { ...props }) }, exception.key);
  };
  if (visible.length === 0) {
    return /* @__PURE__ */ jsxRuntime.jsx("div", { className: cn(slot("root", "arvist-root"), className), children: /* @__PURE__ */ jsxRuntime.jsx("div", { className: slot("empty", "arvist-exceptions__empty"), children: emptyState ?? "No exceptions. This inspection is clean." }) });
  }
  return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: cn(slot("root", "arvist-root arvist-exceptions"), className), children: [
    /* @__PURE__ */ jsxRuntime.jsxs("p", { className: slot("summary", "arvist-exceptions__summary"), children: [
      /* @__PURE__ */ jsxRuntime.jsx("span", { className: slot("summaryCount", "arvist-exceptions__count"), children: visible.length }),
      " ",
      "exception",
      visible.length === 1 ? "" : "s",
      blocking.length > 0 ? /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
        " \xB7 ",
        /* @__PURE__ */ jsxRuntime.jsxs("span", { className: slot("blockingCount", "arvist-exceptions__count--blocking"), children: [
          blocking.length,
          " blocking"
        ] })
      ] }) : null
    ] }),
    groupBySeverity && blocking.length > 0 ? /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
      /* @__PURE__ */ jsxRuntime.jsxs("section", { className: slot("group", "arvist-exceptions__group"), children: [
        /* @__PURE__ */ jsxRuntime.jsx(
          "h2",
          {
            className: slot(
              "groupLabel",
              "arvist-exceptions__group-label arvist-exceptions__group-label--blocking"
            ),
            children: "Must resolve"
          }
        ),
        /* @__PURE__ */ jsxRuntime.jsx("ul", { className: slot("list", "arvist-exceptions__list"), children: blocking.map(card) })
      ] }),
      rest.length > 0 ? /* @__PURE__ */ jsxRuntime.jsxs("section", { className: slot("group", "arvist-exceptions__group"), children: [
        /* @__PURE__ */ jsxRuntime.jsx("h2", { className: slot("groupLabel", "arvist-exceptions__group-label"), children: "Also flagged" }),
        /* @__PURE__ */ jsxRuntime.jsx("ul", { className: slot("list", "arvist-exceptions__list"), children: rest.map(card) })
      ] }) : null
    ] }) : /* @__PURE__ */ jsxRuntime.jsx("ul", { className: slot("list", "arvist-exceptions__list"), children: visible.map(card) })
  ] });
}
function ReconciliationTable({
  reconciliation,
  final = false,
  variancesOnly = false,
  showBarcode = false,
  className,
  classNames,
  unstyled
}) {
  const slot = createSlots({ classNames, unstyled });
  const { lines, offOrder, totals, counts } = reconciliation;
  const rows = React__namespace.useMemo(
    () => variancesOnly ? lines.filter((l) => l.variance !== "match") : lines,
    [lines, variancesOnly]
  );
  const headCell = (extra) => slot("headCell", "arvist-recon__head-cell", extra);
  const cell = (extra) => slot("cell", "arvist-recon__cell", extra);
  const num = "arvist-recon__num";
  const deltaText = (line) => line.delta > 0 ? `+${line.delta}` : line.delta === 0 ? "\u2014" : String(line.delta);
  return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: cn(slot("root", "arvist-root"), className), children: [
    /* @__PURE__ */ jsxRuntime.jsx("div", { className: slot("scroll", "arvist-scroll-x"), children: /* @__PURE__ */ jsxRuntime.jsxs("table", { className: slot("table", "arvist-recon__table"), children: [
      !final ? /* @__PURE__ */ jsxRuntime.jsx("caption", { className: slot("caption", "arvist-recon__caption"), children: "Provisional \u2014 counts are final only once the inspection completes." }) : null,
      /* @__PURE__ */ jsxRuntime.jsx("thead", { className: slot("head", "arvist-recon__head"), children: /* @__PURE__ */ jsxRuntime.jsxs("tr", { children: [
        /* @__PURE__ */ jsxRuntime.jsx("th", { scope: "col", className: headCell(), children: "Item" }),
        showBarcode ? /* @__PURE__ */ jsxRuntime.jsx("th", { scope: "col", className: headCell(), children: "Barcode" }) : null,
        /* @__PURE__ */ jsxRuntime.jsx("th", { scope: "col", className: headCell(num), children: "Expected" }),
        /* @__PURE__ */ jsxRuntime.jsx("th", { scope: "col", className: headCell(num), children: "Counted" }),
        /* @__PURE__ */ jsxRuntime.jsx("th", { scope: "col", className: headCell(num), children: "\u0394" })
      ] }) }),
      /* @__PURE__ */ jsxRuntime.jsx("tbody", { className: slot("body"), children: rows.map((line) => /* @__PURE__ */ jsxRuntime.jsxs(
        "tr",
        {
          "data-variance": line.variance,
          className: slot("row", "arvist-recon__row", `arvist-recon__row--${line.variance}`),
          children: [
            /* @__PURE__ */ jsxRuntime.jsxs("td", { className: cell(), children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: slot("name", "arvist-recon__name"), children: line.item.name || line.item.sku }),
              /* @__PURE__ */ jsxRuntime.jsxs("span", { className: slot("sku", "arvist-recon__sku"), children: [
                line.item.sku,
                line.manuallyCorrected ? /* @__PURE__ */ jsxRuntime.jsx("span", { className: slot("flag", "arvist-recon__flag"), children: "hand-corrected" }) : null
              ] })
            ] }),
            showBarcode ? /* @__PURE__ */ jsxRuntime.jsx("td", { className: cell(slot("barcode", "arvist-recon__barcode")), children: line.barcode ?? "\u2014" }) : null,
            /* @__PURE__ */ jsxRuntime.jsx("td", { className: cell(num), children: line.expected }),
            /* @__PURE__ */ jsxRuntime.jsx("td", { className: cell(num), children: line.actual }),
            /* @__PURE__ */ jsxRuntime.jsx(
              "td",
              {
                className: cell(
                  cn(num, slot("delta", `arvist-recon__delta--${line.variance}`))
                ),
                children: deltaText(line)
              }
            )
          ]
        },
        line.item.id ?? line.item.sku
      )) }),
      /* @__PURE__ */ jsxRuntime.jsx("tfoot", { className: slot("footer", "arvist-recon__footer"), children: /* @__PURE__ */ jsxRuntime.jsxs("tr", { children: [
        /* @__PURE__ */ jsxRuntime.jsxs("td", { className: cell(), colSpan: showBarcode ? 2 : 1, children: [
          counts.matched,
          "/",
          lines.length,
          " matched"
        ] }),
        /* @__PURE__ */ jsxRuntime.jsx("td", { className: cell(num), children: totals.expected }),
        /* @__PURE__ */ jsxRuntime.jsx("td", { className: cell(num), children: totals.actual }),
        /* @__PURE__ */ jsxRuntime.jsx(
          "td",
          {
            className: cell(
              cn(
                num,
                slot(
                  "total",
                  totals.delta === 0 ? "arvist-recon__total--balanced" : "arvist-recon__total--unbalanced"
                )
              )
            ),
            children: totals.delta > 0 ? `+${totals.delta}` : totals.delta
          }
        )
      ] }) })
    ] }) }),
    offOrder.length > 0 ? /* @__PURE__ */ jsxRuntime.jsxs("div", { className: slot("offOrder", "arvist-recon__off-order"), children: [
      /* @__PURE__ */ jsxRuntime.jsx("p", { className: "arvist-recon__off-order-title", children: "Not on this order" }),
      /* @__PURE__ */ jsxRuntime.jsx("ul", { className: "arvist-recon__off-order-list", children: offOrder.map((entry) => /* @__PURE__ */ jsxRuntime.jsxs("li", { children: [
        entry.quantity,
        " \xD7",
        " ",
        entry.sku === "wrong" ? "item(s) from another order" : "unidentified item(s)"
      ] }, entry.sku)) })
    ] }) : null
  ] });
}
var PHASE_LABELS = {
  idle: "Waiting for a tote",
  starting: "Starting\u2026",
  in_progress: "Inspecting",
  paused: "Paused",
  review: "In review",
  completed: "Complete",
  canceled: "Canceled",
  error: "Error"
};
var CONNECTION_LABELS = {
  idle: "Not connected",
  connecting: "Connecting\u2026",
  connected: "Live",
  reconnecting: "Reconnecting\u2026",
  closed: "Disconnected"
};
function InspectionStatus({
  phase,
  progress = null,
  connection,
  detail,
  hideConnection = false,
  className,
  classNames,
  unstyled
}) {
  const slot = createSlots({ classNames, unstyled });
  const pct = progress == null ? null : Math.round(Math.min(Math.max(progress, 0), 1) * 100);
  return /* @__PURE__ */ jsxRuntime.jsxs("div", { "data-phase": phase, className: cn(slot("root", "arvist-root arvist-status"), className), children: [
    /* @__PURE__ */ jsxRuntime.jsxs("div", { className: slot("phase", "arvist-status__phase"), children: [
      /* @__PURE__ */ jsxRuntime.jsxs("div", { className: slot("phaseGroup", "arvist-status__phase-group"), children: [
        /* @__PURE__ */ jsxRuntime.jsx(
          "span",
          {
            "aria-hidden": "true",
            className: slot("dot", "arvist-dot arvist-status__dot", `arvist-status__dot--${phase}`)
          }
        ),
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: slot("label", "arvist-status__label"), children: PHASE_LABELS[phase] })
      ] }),
      !hideConnection && connection ? /* @__PURE__ */ jsxRuntime.jsx(
        "span",
        {
          "data-connection": connection,
          className: slot(
            "connection",
            "arvist-status__connection",
            `arvist-status__connection--${connection}`
          ),
          children: CONNECTION_LABELS[connection]
        }
      ) : null
    ] }),
    detail ? /* @__PURE__ */ jsxRuntime.jsx("p", { className: slot("detail", "arvist-status__detail"), children: detail }) : null,
    pct != null ? /* @__PURE__ */ jsxRuntime.jsxs("div", { className: slot("progress", "arvist-status__progress"), children: [
      /* @__PURE__ */ jsxRuntime.jsx(
        "div",
        {
          role: "progressbar",
          "aria-valuenow": pct,
          "aria-valuemin": 0,
          "aria-valuemax": 100,
          "aria-label": "Inspection progress",
          className: slot("bar", "arvist-status__bar"),
          children: /* @__PURE__ */ jsxRuntime.jsx("div", { className: slot("fill", "arvist-status__fill"), style: { width: `${pct}%` } })
        }
      ),
      /* @__PURE__ */ jsxRuntime.jsxs("p", { className: slot("pct", "arvist-status__pct"), children: [
        pct,
        "%"
      ] })
    ] }) : null
  ] });
}
function StationStatus({
  areaName,
  station,
  resolved,
  hasOpenInspection,
  loading,
  error,
  action,
  className,
  classNames,
  unstyled
}) {
  const slot = createSlots({ classNames, unstyled });
  const state = loading ? { label: "Checking\u2026", tone: "pending" } : error ? { label: "Unavailable", tone: "error", hint: error.message } : !resolved ? {
    label: "Not configured",
    tone: "error",
    hint: `No quality station named "${areaName}" exists at this site. Inspections sent here will be created but never opened.`
  } : hasOpenInspection ? {
    label: "Inspection open",
    tone: "warning",
    hint: "An inspection is already running at this station."
  } : { label: "Ready", tone: "ok" };
  return /* @__PURE__ */ jsxRuntime.jsxs(
    "div",
    {
      "data-resolved": resolved,
      "data-tone": state.tone,
      className: cn(slot("root", "arvist-root arvist-station"), className),
      children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: slot("header", "arvist-station__header"), children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: slot("name", "arvist-station__name"), children: station?.area_name ?? station?.name ?? areaName }),
          /* @__PURE__ */ jsxRuntime.jsx(
            "span",
            {
              className: slot("state", "arvist-station__state", `arvist-station__state--${state.tone}`),
              children: state.label
            }
          )
        ] }),
        state.hint ? /* @__PURE__ */ jsxRuntime.jsx("p", { className: slot("hint", "arvist-station__hint"), children: state.hint }) : null,
        action && !resolved ? /* @__PURE__ */ jsxRuntime.jsx("div", { className: slot("action", "arvist-station__action"), children: action }) : null
      ]
    }
  );
}
var SIDE_LABELS = {
  front: "Front",
  back: "Back",
  left: "Left",
  right: "Right",
  top: "Top",
  all: "Overview",
  front_low: "Front (low)",
  front_high: "Front (high)",
  left_low: "Left (low)",
  left_high: "Left (high)",
  right_low: "Right (low)",
  right_high: "Right (high)"
};
function MediaGallery({
  items,
  stale = false,
  onRefresh,
  onSelect,
  emptyState,
  className,
  classNames,
  unstyled
}) {
  const slot = createSlots({ classNames, unstyled });
  const [failed, setFailed] = React__namespace.useState(() => /* @__PURE__ */ new Set());
  if (items.length === 0) {
    return /* @__PURE__ */ jsxRuntime.jsx("div", { className: cn(slot("root", "arvist-root"), className), children: /* @__PURE__ */ jsxRuntime.jsx("p", { className: slot("empty", "arvist-media__empty"), children: emptyState ?? "No images captured yet." }) });
  }
  return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: cn(slot("root", "arvist-root"), className), children: [
    stale ? /* @__PURE__ */ jsxRuntime.jsxs("div", { className: slot("notice", "arvist-media__notice"), children: [
      /* @__PURE__ */ jsxRuntime.jsx("span", { children: "These image links are about to expire." }),
      onRefresh ? /* @__PURE__ */ jsxRuntime.jsx("button", { type: "button", onClick: onRefresh, className: slot("refresh", "arvist-media__refresh"), children: "Refresh" }) : null
    ] }) : null,
    /* @__PURE__ */ jsxRuntime.jsx("ul", { className: slot("grid", "arvist-media__grid"), children: items.map((item) => {
      const label = SIDE_LABELS[item.side] ?? item.side;
      const broken = failed.has(item.id) || !item.url;
      const inner = /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: slot("frame", "arvist-media__frame"), children: [
          broken ? /* @__PURE__ */ jsxRuntime.jsx("span", { className: slot("placeholder", "arvist-media__placeholder"), children: "Link expired" }) : /* @__PURE__ */ jsxRuntime.jsx(
            "img",
            {
              src: item.url,
              alt: `${label} view`,
              loading: "lazy",
              onError: () => setFailed((prev) => new Set(prev).add(item.id)),
              className: slot("image", "arvist-media__image")
            }
          ),
          item.damageCount > 0 ? /* @__PURE__ */ jsxRuntime.jsx(
            "span",
            {
              className: slot("badge", "arvist-media__badge"),
              "aria-label": `${item.damageCount} damage finding(s)`,
              children: item.damageCount
            }
          ) : null
        ] }),
        /* @__PURE__ */ jsxRuntime.jsx("p", { className: slot("caption", "arvist-media__caption"), children: label })
      ] });
      return /* @__PURE__ */ jsxRuntime.jsx("li", { children: onSelect ? /* @__PURE__ */ jsxRuntime.jsx(
        "button",
        {
          type: "button",
          onClick: () => onSelect(item),
          className: slot("item", "arvist-media__item"),
          children: inner
        }
      ) : /* @__PURE__ */ jsxRuntime.jsx("div", { className: slot("item", "arvist-media__item"), children: inner }) }, item.id);
    }) })
  ] });
}

exports.ExceptionCard = ExceptionCard;
exports.ExceptionList = ExceptionList;
exports.InspectionStatus = InspectionStatus;
exports.MediaGallery = MediaGallery;
exports.ReconciliationTable = ReconciliationTable;
exports.StationStatus = StationStatus;
exports.cn = cn;
exports.createSlots = createSlots;
//# sourceMappingURL=ui.cjs.map
//# sourceMappingURL=ui.cjs.map