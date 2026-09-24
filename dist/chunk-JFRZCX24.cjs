'use strict';

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

// src/core/types.ts
var SENTINEL_SKUS = ["unknown", "wrong"];

// src/core/exceptions.ts
var PALLET_ONLY_EXCEPTIONS = ["wrong_load", "missing_identifiers"];
var ISSUE_TO_EXCEPTION = {
  damage: "damage",
  unidentified_product: "unidentified_product",
  wrong_load: "wrong_load",
  no_identifiers: "missing_identifiers",
  wrong_product: "wrong_product",
  overage: "overage",
  shortage: "shortage"
};
var ISSUE_ACTION_BY_RESOLUTION = {
  unidentified_product: {
    identify_product: "assign",
    remove_item: "remove_product",
    flag_false_positive: "invalid"
  },
  wrong_product: {
    accept_substitute: "keep_in_order",
    remove_item: "remove_product",
    correct_product: "correct_product"
  },
  overage: {
    remove_item: "remove_extra",
    reassign_product: "reassign"
  },
  shortage: {
    locate_stock: "missing_added",
    correct_count: "wrong_counting"
  }
};
var OPEN_STATUSES = ["open", "unresolved"];
function isExceptionOpen(exception) {
  return OPEN_STATUSES.includes(exception.status);
}
var DEFAULT_EXCEPTION_COPY = {
  titles: {
    unidentified_product: "Unidentified Product Detected",
    wrong_product: "Wrong Product Detected",
    overage: "Overage Detected",
    shortage: "Shortage Detected",
    manual_count_correction: "Manual count correction",
    wrong_load: "Wrong Load Detected",
    missing_identifiers: "Pallet Identifier Not Detected",
    unit_removed: "Unit removed from inspection",
    damage: "Damages Detected"
  },
  actions: {
    identify_product: "Assign Product",
    remove_item: "Remove Product",
    accept_substitute: "Keep in Order",
    accept_count: "Accept count",
    correct_count: "Wrong Counting",
    locate_stock: "Missing Product Added",
    redirect_load: "Redirected to correct load",
    cancel_unit: "Remove unit from inspection",
    submit_identifiers: "Enter identifiers",
    acknowledge: "Acknowledge",
    flag_false_positive: "That's Not a Product",
    mark_unresolved: "Cannot resolve",
    correct_product: "It Is a Correct Product",
    reassign_product: "Reassign to a Different Product"
  }
};
function opt(action, copy, extra = {}) {
  const { requiresPhysicalAction = false, ...rest } = extra;
  return { action, label: copy.actions[action], requiresPhysicalAction, ...rest };
}
function resolutionsFor(type, copy) {
  switch (type) {
    case "unidentified_product":
      return [
        opt("identify_product", copy, { status: "resolved" }),
        opt("remove_item", copy, { status: "resolved", requiresPhysicalAction: true }),
        opt("flag_false_positive", copy, { status: "false_positive" })
      ];
    case "wrong_product":
      return [
        opt("remove_item", copy, { status: "resolved", requiresPhysicalAction: true }),
        opt("accept_substitute", copy, { status: "resolved" }),
        opt("correct_product", copy, { status: "false_positive" })
      ];
    case "overage":
      return [
        opt("remove_item", copy, { status: "resolved", requiresPhysicalAction: true }),
        opt("reassign_product", copy, { status: "false_positive" })
      ];
    case "shortage":
      return [
        opt("locate_stock", copy, { status: "resolved", requiresPhysicalAction: true }),
        opt("correct_count", copy, { status: "false_positive" })
      ];
    case "manual_count_correction":
      return [opt("acknowledge", copy, { status: "resolved" })];
    case "wrong_load":
      return [
        opt("redirect_load", copy, { status: "resolved", requiresPhysicalAction: true }),
        opt("cancel_unit", copy, { status: "canceled" })
      ];
    case "missing_identifiers":
      return [
        opt("submit_identifiers", copy, { status: "resolved" }),
        opt("mark_unresolved", copy, { status: "unresolved", requiresReason: true })
      ];
    case "unit_removed":
      return [opt("acknowledge", copy, { status: "resolved" })];
    case "damage":
      return [
        opt("acknowledge", copy, { status: "resolved" }),
        opt("flag_false_positive", copy, { status: "false_positive" }),
        opt("mark_unresolved", copy, { status: "unresolved", requiresReason: true })
      ];
  }
}
function isSentinelLineItem(item) {
  return SENTINEL_SKUS.includes((item.sku ?? "").toLowerCase().trim());
}
function orderedLineItems(items) {
  return (items ?? []).filter((i) => !isSentinelLineItem(i));
}
function lineItemKey(item, suffix) {
  return `line:${item.id ?? item.sku ?? item.product_id}:${suffix}`;
}
function inferUnitType(shipment) {
  const unitTypes = (shipment?.units ?? []).map((u) => u.type).filter(Boolean);
  return unitTypes.includes("pallet") ? "pallet" : "product";
}
function issueInstanceKey(issue) {
  const annotationId = issue.metadata?.["annotation_id"];
  return annotationId != null ? `${issue.issue_type}:${String(annotationId)}` : issue.issue_type;
}
function collectIssues(shipment) {
  const out = [];
  for (const unit of shipment?.units ?? []) {
    const session = unit.quality_sessions?.[0];
    if (!session) continue;
    const seen = /* @__PURE__ */ new Set();
    for (const issue of session.issues ?? []) {
      const key = issueInstanceKey(issue);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...issue, unit_id: unit.id, unit_session_id: session.id });
    }
  }
  return out;
}
function deriveExceptions(shipment, options = {}) {
  if (!shipment) return [];
  const copy = options.copy ?? DEFAULT_EXCEPTION_COPY;
  const unitType = options.unitType ?? inferUnitType(shipment);
  const exclude = new Set(options.exclude ?? []);
  const out = [];
  const push = (e) => {
    if (!exclude.has(e.type)) out.push(e);
  };
  const unknownRow = (shipment.line_items ?? []).find(
    (i) => i.sku?.toLowerCase().trim() === "unknown" && (i.actual_quantity ?? 0) > 0
  );
  for (const issue of collectIssues(shipment)) {
    const type = ISSUE_TO_EXCEPTION[issue.issue_type];
    const palletOnly = PALLET_ONLY_EXCEPTIONS.includes(type);
    if (palletOnly && unitType !== "pallet") continue;
    const resolvedType = type === "wrong_load" && issue.status === "canceled" ? "unit_removed" : type;
    const mergesUnknownRow = resolvedType === "unidentified_product" && unknownRow !== void 0;
    const quantity = mergesUnknownRow ? unknownRow.actual_quantity ?? 0 : void 0;
    push({
      key: `issue:${issue.id}`,
      type: resolvedType,
      status: issue.status,
      severity: severityFor(resolvedType, issue.status),
      title: copy.titles[resolvedType],
      description: quantity ? `${quantity} item(s) could not be identified.` : describeIssue(resolvedType, issue),
      resolutions: resolutionsFor(resolvedType, copy),
      blocksCompletion: false,
      issue,
      lineItem: mergesUnknownRow ? unknownRow : void 0,
      unitId: issue.unit_id,
      unitSessionId: issue.unit_session_id,
      palletOnly: PALLET_ONLY_EXCEPTIONS.includes(resolvedType),
      ...quantity !== void 0 ? { quantities: { expected: 0, actual: quantity, delta: quantity } } : {}
    });
  }
  for (const item of orderedLineItems(shipment.line_items)) {
    const expected = item.expected_quantity ?? 0;
    const actual = item.actual_quantity ?? 0;
    const delta = actual - expected;
    const issueType = item.issue?.issue_type;
    if (item.issue && (issueType === "overage" || issueType === "shortage")) {
      const storedIssue = item.issue;
      const type = issueType;
      const open = OPEN_STATUSES.includes(storedIssue.status);
      const blocks = type === "shortage" && open && !options.autoCompleted;
      push({
        key: `issue:${storedIssue.id}`,
        type,
        status: storedIssue.status,
        severity: !open ? "info" : blocks ? "blocking" : "warning",
        title: copy.titles[type],
        description: `${item.name || item.sku}: expected ${expected}, counted ${actual} (${delta > 0 ? "+" : ""}${delta}).`,
        resolutions: resolutionsFor(type, copy),
        blocksCompletion: blocks,
        issue: storedIssue,
        lineItem: item,
        palletOnly: false,
        quantities: { expected, actual, delta }
      });
    }
    if (item.is_edited) {
      push({
        key: lineItemKey(item, "manual_count_correction"),
        type: "manual_count_correction",
        status: "resolved",
        severity: "info",
        title: copy.titles.manual_count_correction,
        description: `${item.name || item.sku}: count set to ${actual} by an operator.`,
        resolutions: resolutionsFor("manual_count_correction", copy),
        blocksCompletion: false,
        lineItem: item,
        palletOnly: false,
        quantities: { expected, actual, delta }
      });
    }
  }
  return out.sort(bySeverityThenType);
}
function severityFor(type, status) {
  if (!OPEN_STATUSES.includes(status)) return "info";
  if (type === "manual_count_correction" || type === "unit_removed") return "info";
  return "warning";
}
function describeIssue(type, issue) {
  if (issue.description) return issue.description;
  const meta = issue.metadata ?? {};
  switch (type) {
    case "wrong_load": {
      const id = meta.pallet_identifier ?? meta.identifier;
      return id ? `Pallet ${String(id)} belongs to a different load.` : "Pallet belongs to a different load.";
    }
    case "missing_identifiers":
      return "No pallet identifier could be read from this unit.";
    case "unit_removed":
      return "This unit was removed from the inspection.";
    case "damage": {
      const count = Array.isArray(meta.damages) ? meta.damages.length : void 0;
      return count ? `${count} damage finding(s) on this unit.` : "Damage was detected on this unit.";
    }
    case "unidentified_product":
      return "An item was detected that could not be matched to a product.";
    default:
      return "";
  }
}
var SEVERITY_ORDER = { blocking: 0, warning: 1, info: 2 };
var TYPE_ORDER = [
  "shortage",
  "wrong_product",
  "unidentified_product",
  "wrong_load",
  "missing_identifiers",
  "overage",
  "damage",
  "unit_removed",
  "manual_count_correction"
];
function bySeverityThenType(a, b) {
  const openDiff = Number(isExceptionOpen(b)) - Number(isExceptionOpen(a));
  if (openDiff !== 0) return openDiff;
  const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  if (sev !== 0) return sev;
  return TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type);
}
function mergeRealtimeIssues(shipment, update) {
  if (!update.issues?.length || !update.unit_id) return shipment;
  const incoming = update.issues.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const r = raw;
    const issueType = r.issue_type ?? r.type;
    if (!issueType) return [];
    return [{
      id: typeof r.id === "number" ? r.id : -1,
      issue_type: issueType,
      status: r.status ?? "open",
      description: typeof r.description === "string" ? r.description : void 0,
      metadata: r.metadata ?? void 0,
      created_at: r.created_at ?? (/* @__PURE__ */ new Date()).toISOString(),
      updated_at: r.updated_at ?? (/* @__PURE__ */ new Date()).toISOString(),
      unit_id: update.unit_id,
      unit_session_id: update.unit_session_id
    }];
  });
  if (!incoming.length) return shipment;
  const units = (shipment.units ?? []).map((unit) => {
    if (unit.id !== update.unit_id) return unit;
    const [current, ...rest] = unit.quality_sessions ?? [];
    const session = current ?? {
      id: update.unit_session_id ?? -1,
      shipment_unit_id: unit.id,
      created_at: (/* @__PURE__ */ new Date()).toISOString(),
      updated_at: (/* @__PURE__ */ new Date()).toISOString(),
      issues: []
    };
    const byInstance = new Map(
      (session.issues ?? []).map((i) => [issueInstanceKey(i), i])
    );
    for (const i of incoming) byInstance.set(issueInstanceKey(i), i);
    return {
      ...unit,
      quality_sessions: [{ ...session, issues: [...byInstance.values()] }, ...rest]
    };
  });
  return { ...shipment, units };
}

exports.DEFAULT_EXCEPTION_COPY = DEFAULT_EXCEPTION_COPY;
exports.ISSUE_ACTION_BY_RESOLUTION = ISSUE_ACTION_BY_RESOLUTION;
exports.PALLET_ONLY_EXCEPTIONS = PALLET_ONLY_EXCEPTIONS;
exports.SENTINEL_SKUS = SENTINEL_SKUS;
exports.collectIssues = collectIssues;
exports.deriveExceptions = deriveExceptions;
exports.isExceptionOpen = isExceptionOpen;
exports.isSentinelLineItem = isSentinelLineItem;
exports.mergeRealtimeIssues = mergeRealtimeIssues;
exports.orderedLineItems = orderedLineItems;
exports.resolutionsFor = resolutionsFor;
//# sourceMappingURL=chunk-JFRZCX24.cjs.map
//# sourceMappingURL=chunk-JFRZCX24.cjs.map