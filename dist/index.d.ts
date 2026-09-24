import { d as InspectionFeed, E as ErrorMessageResolver, e as ExceptionCopy, f as SocketIoFactory, g as RealtimeTransport, h as ArvistErrorCode, P as PartialExceptionCopy, N as NormalizedException, i as ResolutionOption, j as ExceptionType, A as ArvistError, S as Shipment, b as LineItem, k as ShipmentImage, F as FlatMediaItem } from './media-DnQFgvEV.js';
export { l as ActionResult, m as ArvistErrorInit, a as CompletionCheck, C as ConnectionState, D as DEFAULT_ERROR_MESSAGES, n as DEFAULT_EXCEPTION_COPY, o as DEFAULT_PRESIGNED_TTL_MS, p as DeriveOptions, q as DetectionAnnotation, r as ExceptionSeverity, s as FeedBinding, t as ISSUE_ACTION_BY_RESOLUTION, I as InspectionEvent, u as InspectionEventKind, v as InspectionFeedOptions, w as IssueResolveAction, x as IssueStatus, y as IssueType, L as LineItemCorrection, z as LineItemInput, B as LineVariance, G as ListShipmentsQuery, M as MediaExpiry, H as MediaRef, J as PALLET_ONLY_EXCEPTIONS, K as PRESIGN_REFRESH_MARGIN_MS, O as Paginated, Q as QualityStation, T as QualityStationType, U as RealtimeIssue, V as ReconciledLine, R as Reconciliation, W as ResolutionAction, X as ResolveIssueByIdInput, Y as ResolveIssueInput, Z as SENTINEL_SKUS, _ as SentinelSku, $ as ShipmentDamage, a0 as ShipmentDetail, a1 as ShipmentIssue, a2 as ShipmentPalletIdentifier, a3 as ShipmentSide, a4 as ShipmentStatus, a5 as ShipmentType, a6 as ShipmentUnit, a7 as ShipmentUnitSession, a8 as ShipmentUnitType, a9 as SocketIoTransportConfig, aa as SocketLike, c as StartInspectionInput, ab as SubmitInspectionInput, ac as UnitPayload, ad as UpdateUnknownProductInput, ae as buildBarcodeIndex, af as checkCompletion, ag as collectIssues, ah as createErrorMessageResolver, ai as createSocketIoTransport, aj as deriveExceptions, ak as errorFromResponse, al as flattenMedia, am as getDisplayMessage, an as getLineItemBarcode, ao as getMediaExpiry, ap as isExceptionOpen, aq as isMediaUrlExpired, ar as isSentinelLineItem, as as mergeRealtimeIssues, at as normalizeBarcode, au as orderedLineItems, av as parsePresignedExpiry, aw as reconcile, ax as resolutionsFor, ay as sortMediaBySide, az as topics, aA as upcCoverage } from './media-DnQFgvEV.js';
import { ArvistClient, ArvistClientConfig, ParsedScan } from './core.js';
export { RequestOptions, RequestTelemetry, ScanBuffer, ScanBufferOptions, ScanKind, createScanBuffer, parseScan, validateGtinCheckDigit } from './core.js';
import * as React from 'react';
import { u as useAsync } from './use-inspection-b8I4z4bo.js';
export { A as AsyncResult, a as AsyncState, I as InspectionPhase, S as StationBindingState, U as UseInspectionOptions, b as UseInspectionResult, c as useInspection, d as useStationBinding, e as useStations } from './use-inspection-b8I4z4bo.js';

interface ArvistProviderProps extends React.PropsWithChildren {
    /** Client config, or a pre-built client if you need to share one. */
    config?: ArvistClientConfig;
    client?: ArvistClient;
    /**
     * Realtime setup. Omit to run REST-only — hooks that need the feed will
     * report `realtimeAvailable: false` rather than throwing.
     */
    realtime?: ArvistRealtimeConfig;
    /** Override any operator-facing error copy, e.g. for localisation. */
    errorMessages?: Partial<Record<ArvistErrorCode, string>>;
    /** Override exception titles and resolution labels. Partial — unset strings keep their defaults. */
    copy?: PartialExceptionCopy;
    /**
     * Treat shortages as non-blocking because an upstream system completes the
     * shipment out of band (a box-closure scan, for example).
     */
    autoCompleted?: boolean;
}
type ArvistRealtimeConfig = {
    /**
     * `socket.io-client`'s `io`. Passing it explicitly keeps socket.io an
     * optional dependency of this package.
     */
    io: SocketIoFactory;
    /** Defaults to the client's `baseUrl`. */
    url?: string;
    path?: string;
    auth?: Record<string, unknown>;
    withCredentials?: boolean;
} | {
    transport: RealtimeTransport;
};
interface ArvistContextValue {
    client: ArvistClient;
    feed: InspectionFeed | null;
    realtimeAvailable: boolean;
    resolveErrorMessage: ErrorMessageResolver;
    copy: ExceptionCopy;
    autoCompleted: boolean;
}
/**
 * Supplies the API client, the realtime feed, and display copy to every hook.
 *
 * ```tsx
 * import { io } from 'socket.io-client';
 *
 * <ArvistProvider
 *   config={{ baseUrl: 'https://arvist.example.com', token: getToken }}
 *   realtime={{ io }}
 * >
 *   <PackStation />
 * </ArvistProvider>
 * ```
 */
declare function ArvistProvider({ children, config, client: providedClient, realtime, errorMessages, copy, autoCompleted, }: ArvistProviderProps): React.JSX.Element;
declare function useArvist(): ArvistContextValue;
/** The API client on its own, for calls the hooks do not wrap. */
declare function useArvistClient(): ArvistClient;

interface ResolveArgs {
    exception: NormalizedException;
    /** One of the exception's own `resolutions`. */
    resolution: ResolutionOption;
    /** Required when `resolution.requiresReason`. */
    reason?: string;
    /** Extra context stored on the issue — operator id, scanned identifier, notes. */
    metadata?: Record<string, unknown>;
    /** For `submit_identifiers`: the pallet identifier that could not be read. */
    identifier?: string;
    /** For `correct_count` on a `shortage`: the corrected quantity. */
    quantity?: number;
    /**
     * The product sku to apply. Required for `identify_product` and
     * `correct_product`; optional for `accept_substitute`/`remove_item` when the
     * operator entered one worth recording for audit.
     */
    sku?: string;
    /** For `reassign_product` (`overage`): the sku the extra units actually belong to. */
    targetSku?: string;
    /**
     * For `reassign_product` (`overage`) only: which detected instance on the
     * line item is being reassigned. `overage` issues are session-less and can
     * have several candidate detections, so — unlike every other per-instance
     * action — this can't be inferred from the issue row and the caller must
     * supply it (e.g. from an image-overlay picker).
     */
    annotationId?: number;
}
interface UseExceptionsResult {
    /** Everything, open and closed, sorted blocking-first. */
    exceptions: NormalizedException[];
    open: NormalizedException[];
    blocking: NormalizedException[];
    byType: Record<ExceptionType, NormalizedException[]>;
    /** `true` while an unresolved exception holds completion open. */
    hasBlockers: boolean;
    resolving: string | null;
    error: ArvistError | undefined;
    /** Applies a resolution and routes it to the right endpoint. */
    resolve: (args: ResolveArgs) => Promise<void>;
}
/**
 * Normalised exceptions for a shipment, with resolution wired up.
 *
 * The nine operator-facing exception types do not map one-to-one onto API
 * endpoints — some are issue rows closed with a status, others are line-item
 * corrections, and one is a unit cancellation. {@link UseExceptionsResult.resolve}
 * picks the right call from the resolution you hand it, so the UI only has to
 * render the options the exception already carries.
 */
declare function useExceptions(shipment: Shipment | undefined, options?: {
    onResolved?: () => void | Promise<void>;
}): UseExceptionsResult;

interface UseBarcodeScannerOptions {
    onScan: (scan: ParsedScan) => void;
    /** Attach the listener. Set `false` behind a modal that owns input. Defaults to `true`. */
    enabled?: boolean;
    /** Element to listen on. Defaults to `document`. */
    target?: React.RefObject<HTMLElement | null> | HTMLElement | null;
    /** Keep scanner output out of whatever has focus. Defaults to `true`. */
    preventDefault?: boolean;
    /**
     * Keep listening while a text input has focus. Off by default so operators
     * can type in search boxes without their keystrokes being read as scans.
     */
    captureInInputs?: boolean;
    maxKeystrokeGapMs?: number;
    minLength?: number;
}
/**
 * Reads handheld-scanner input from anywhere on the page.
 *
 * Scanners type their payload and press Enter, which is indistinguishable from
 * an operator at the keyboard until you look at the timing. This listens
 * globally, uses the inter-keystroke gap to tell the two apart, and hands you a
 * parsed scan with the check digit already validated.
 */
declare function useBarcodeScanner(options: UseBarcodeScannerOptions): void;
interface UseScanMatchResult {
    /** Last scan received, matched or not. */
    lastScan: ParsedScan | undefined;
    /** Line item the last scan resolved to, if any. */
    matched: LineItem | undefined;
    /** `true` when the last scan matched nothing on the order. */
    unmatched: boolean;
    clear: () => void;
}
/**
 * Matches scans against a shipment's line items.
 *
 * Lookup goes through `additional_data.upc` first and falls back to the SKU,
 * because UPC population is not guaranteed — a shipment where only some lines
 * carry one still scans correctly for the rest. An unmatched scan is a signal
 * in its own right: it usually means an off-order item is in the tote.
 */
declare function useScanMatch(lineItems: LineItem[] | undefined, options?: Omit<UseBarcodeScannerOptions, 'onScan'> & {
    onMatch?: (item: LineItem, scan: ParsedScan) => void;
    onUnmatched?: (scan: ParsedScan) => void;
}): UseScanMatchResult;

interface UseShipmentMediaResult {
    images: ShipmentImage[];
    /** Flattened and ordered the way an operator walks a unit. */
    items: FlatMediaItem[];
    loading: boolean;
    error: ReturnType<typeof useAsync>['error'];
    /** `true` once the presigned URLs are close enough to expiry to re-fetch. */
    stale: boolean;
    refresh: () => Promise<void>;
}
/**
 * Inspection media for a shipment, kept ahead of presigned-URL expiry.
 *
 * Pass the shipment rather than its id when you have it. Media arrives unit by
 * unit as an inspection runs, and the id alone never changes — so a hook keyed
 * only on the id fetches once and then shows the first unit's images for the
 * rest of the inspection. Given the shipment, this refetches whenever a new
 * unit or session appears.
 *
 * The URLs are short-lived, so this also tracks when they go stale and
 * re-fetches before they break. That keeps a long-lived screen working, but it
 * is not a retention strategy: anything you need to keep — for a claim, an
 * audit, a customer-facing record — must be copied to your own storage when you
 * receive it. Re-fetching only works while the media is still retained upstream.
 */
declare function useShipmentMedia(source: number | Pick<Shipment, 'id' | 'units'> | undefined, options?: {
    autoRefresh?: boolean;
}): UseShipmentMediaResult;

export { ArvistClient, ArvistClientConfig, type ArvistContextValue, ArvistError, ArvistErrorCode, ArvistProvider, type ArvistProviderProps, type ArvistRealtimeConfig, ErrorMessageResolver, ExceptionCopy, ExceptionType, FlatMediaItem, InspectionFeed, LineItem, NormalizedException, ParsedScan, PartialExceptionCopy, RealtimeTransport, ResolutionOption, type ResolveArgs, Shipment, ShipmentImage, SocketIoFactory, type UseBarcodeScannerOptions, type UseExceptionsResult, type UseScanMatchResult, type UseShipmentMediaResult, useArvist, useArvistClient, useAsync, useBarcodeScanner, useExceptions, useScanMatch, useShipmentMedia };
