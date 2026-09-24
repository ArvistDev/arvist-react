import * as React from 'react';
import { N as NormalizedException, i as ResolutionOption, R as Reconciliation, C as ConnectionState, F as FlatMediaItem } from './media-DnQFgvEV.js';
import { I as InspectionPhase, S as StationBindingState } from './use-inspection-b8I4z4bo.js';

/**
 * Class-name value, in the shapes JSX conditionals naturally produce.
 *
 * Deliberately narrower than clsx's: no nested arrays of objects, because the
 * components never need them and the type is public API.
 */
type ClassValue = string | number | null | undefined | false | Record<string, boolean | null | undefined> | ClassValue[];
/**
 * Joins class names, dropping falsy values.
 *
 * There is no utility-conflict resolution here (what `tailwind-merge` does) and
 * none is needed: the built-in classes are semantic, so a caller's class sits
 * alongside them rather than fighting one. When you need to override a built-in
 * declaration, either raise specificity or import the SDK stylesheet before
 * your own so your rule wins on order.
 */
declare function cn(...inputs: ClassValue[]): string;

/**
 * Per-slot class overrides.
 *
 * Every component exposes its internal structure as named slots, so a host app
 * can restyle any part without forking the component or reaching in with
 * descendant selectors.
 */
type SlotClasses<S extends string> = Partial<Record<S, ClassValue>>;
interface StyleableProps<S extends string> {
    /** Class for the outermost element. */
    className?: string;
    /** Per-slot classes, added alongside the defaults. */
    classNames?: SlotClasses<S>;
    /**
     * Drop every built-in class and emit structure only — the markup, ARIA, and
     * behaviour stay, the styling is yours. Slot classes still apply, so this is
     * also how you swap in a design system wholesale.
     */
    unstyled?: boolean;
}
/** Builds a slot resolver honouring `unstyled` and per-slot overrides. */
declare function createSlots<S extends string>(props: Pick<StyleableProps<S>, 'classNames' | 'unstyled'>): (slot: S, ...defaults: ClassValue[]) => string;

type ExceptionCardSlot = 'root' | 'header' | 'badge' | 'dot' | 'title' | 'scope' | 'status' | 'description' | 'blocker' | 'actions' | 'action' | 'reason' | 'reasonLabel' | 'reasonInput' | 'error';
interface ExceptionCardProps extends StyleableProps<ExceptionCardSlot> {
    exception: NormalizedException;
    /**
     * Invoked when an operator picks a resolution. Reason text is passed through
     * for resolutions that require one; the card will not submit without it.
     */
    onResolve?: (resolution: ResolutionOption, reason?: string) => void | Promise<void>;
    /** Show a pending state on this card. */
    busy?: boolean;
    /** Hide the resolution buttons — for a read-only or summary view. */
    readOnly?: boolean;
    /** Extra content below the description: a product picker, an image, a note field. */
    children?: React.ReactNode;
}
/**
 * One exception, with its resolution paths.
 *
 * The card renders whatever the exception carries rather than switching on the
 * type itself — resolution options, whether a reason is required, and whether
 * the operator has to do something physical all come from
 * {@link NormalizedException}. Adding a type upstream does not require touching
 * this component.
 */
declare function ExceptionCard({ exception, onResolve, busy, readOnly, children, className, classNames, unstyled, }: ExceptionCardProps): React.JSX.Element;

type ExceptionListSlot = 'root' | 'summary' | 'summaryCount' | 'blockingCount' | 'list' | 'empty' | 'group' | 'groupLabel';
interface ExceptionListProps extends StyleableProps<ExceptionListSlot> {
    exceptions: NormalizedException[];
    onResolve?: (exception: NormalizedException, resolution: ResolutionOption, reason?: string) => void | Promise<void>;
    /** Key of the exception currently being submitted. */
    resolvingKey?: string | null;
    /** Hide exceptions that are already closed. Defaults to `false`. */
    openOnly?: boolean;
    /** Shown when there is nothing to display. */
    emptyState?: React.ReactNode;
    /** Group blocking exceptions above the rest. Defaults to `true`. */
    groupBySeverity?: boolean;
    readOnly?: boolean;
    /** Render a card yourself — for a custom layout or an inline product picker. */
    renderException?: (props: ExceptionCardProps) => React.ReactNode;
}
/**
 * The warnings panel.
 *
 * Blocking exceptions come first because they are the ones stopping the
 * operator from closing out; everything else follows in the order the core
 * sorts it. Pass `renderException` when a type needs an inline control — a
 * product picker for an unidentified item, say — and keep the rest as-is.
 */
declare function ExceptionList({ exceptions, onResolve, resolvingKey, openOnly, emptyState, groupBySeverity, readOnly, renderException, className, classNames, unstyled, }: ExceptionListProps): React.JSX.Element;

type ReconciliationTableSlot = 'root' | 'scroll' | 'table' | 'caption' | 'head' | 'headCell' | 'body' | 'row' | 'cell' | 'name' | 'sku' | 'flag' | 'barcode' | 'delta' | 'footer' | 'total' | 'offOrder';
interface ReconciliationTableProps extends StyleableProps<ReconciliationTableSlot> {
    reconciliation: Reconciliation;
    /**
     * Counts before `completed` are provisional. Leave `false` while an
     * inspection is running so the table says so rather than implying finality.
     */
    final?: boolean;
    /** Hide rows where expected and actual already match. */
    variancesOnly?: boolean;
    /** Show the barcode used for scan matching. */
    showBarcode?: boolean;
}
/**
 * Expected versus counted, per line.
 *
 * Off-order items are listed separately below rather than mixed into the order
 * lines — they have no expected quantity, so showing them as a variance against
 * zero reads as an overage when it is a different problem entirely.
 */
declare function ReconciliationTable({ reconciliation, final, variancesOnly, showBarcode, className, classNames, unstyled, }: ReconciliationTableProps): React.JSX.Element;

type InspectionStatusSlot = 'root' | 'phase' | 'phaseGroup' | 'dot' | 'label' | 'connection' | 'detail' | 'progress' | 'bar' | 'fill' | 'pct';
interface InspectionStatusProps extends StyleableProps<InspectionStatusSlot> {
    phase: InspectionPhase;
    /** 0–1, or null when the total is not yet known. */
    progress?: number | null;
    connection?: ConnectionState;
    /** Free-text line under the status — order number, tote id, station name. */
    detail?: React.ReactNode;
    /** Hide the connection indicator when the host app shows one already. */
    hideConnection?: boolean;
}
/**
 * Phase, progress and connection in one strip.
 *
 * The connection indicator is not decorative. When the feed drops the screen
 * keeps showing the last known state, and without this an operator cannot tell
 * a quiet station from a dead socket.
 */
declare function InspectionStatus({ phase, progress, connection, detail, hideConnection, className, classNames, unstyled, }: InspectionStatusProps): React.JSX.Element;

type StationStatusSlot = 'root' | 'header' | 'name' | 'state' | 'hint' | 'action';
interface StationStatusProps extends StyleableProps<StationStatusSlot>, StationBindingState {
    areaName: string;
    /** Rendered when the station cannot be resolved — usually a settings link. */
    action?: React.ReactNode;
}
/**
 * Whether a station is configured and ready to receive work.
 *
 * Starting an inspection succeeds whether or not a screen has the station
 * selected, so an unbound station fails silently: the record is created, and
 * nobody sees it. Surfacing that here turns the most common
 * "station not responding" report into something an operator can act on before
 * the next tote arrives.
 */
declare function StationStatus({ areaName, station, resolved, hasOpenInspection, loading, error, action, className, classNames, unstyled, }: StationStatusProps): React.JSX.Element;

type MediaGallerySlot = 'root' | 'notice' | 'refresh' | 'grid' | 'item' | 'frame' | 'image' | 'placeholder' | 'caption' | 'badge' | 'empty';
interface MediaGalleryProps extends StyleableProps<MediaGallerySlot> {
    items: FlatMediaItem[];
    /** Show the "URLs are expiring" notice. Wire to `useShipmentMedia().stale`. */
    stale?: boolean;
    onRefresh?: () => void;
    onSelect?: (item: FlatMediaItem) => void;
    emptyState?: React.ReactNode;
}
/**
 * Inspection images.
 *
 * The URLs are presigned and short-lived, so the gallery surfaces expiry rather
 * than letting images silently 403. If these images are evidence — a claim, an
 * audit trail — copy them to your own storage when you receive them; refreshing
 * only works while the media is still retained upstream.
 */
declare function MediaGallery({ items, stale, onRefresh, onSelect, emptyState, className, classNames, unstyled, }: MediaGalleryProps): React.JSX.Element;

export { ExceptionCard, type ExceptionCardProps, type ExceptionCardSlot, ExceptionList, type ExceptionListProps, type ExceptionListSlot, InspectionStatus, type InspectionStatusProps, type InspectionStatusSlot, MediaGallery, type MediaGalleryProps, type MediaGallerySlot, ReconciliationTable, type ReconciliationTableProps, type ReconciliationTableSlot, type SlotClasses, StationStatus, type StationStatusProps, type StationStatusSlot, type StyleableProps, cn, createSlots };
