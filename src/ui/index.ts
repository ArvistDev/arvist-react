'use client';

/**
 * Tailwind-styled components.
 *
 * Every component is a thin shell over the headless hooks and takes
 * `className`, per-slot `classNames`, and `unstyled` — so you can nudge one
 * detail, restyle a slot, or strip the visuals entirely and keep only the
 * structure and behaviour. Colours come from `--color-arvist-*` theme
 * variables; redefine those to rebrand everything at once.
 *
 * Import the stylesheet once: `import '@arvist/react/styles.css'`.
 */

export { cn } from './cn';
export { createSlots } from './slots';
export type { SlotClasses, StyleableProps } from './slots';

export { ExceptionCard } from './components/exception-card';
export type { ExceptionCardProps, ExceptionCardSlot } from './components/exception-card';

export { ExceptionList } from './components/exception-list';
export type { ExceptionListProps, ExceptionListSlot } from './components/exception-list';

export { ReconciliationTable } from './components/reconciliation-table';
export type {
  ReconciliationTableProps,
  ReconciliationTableSlot,
} from './components/reconciliation-table';

export { InspectionStatus } from './components/inspection-status';
export type { InspectionStatusProps, InspectionStatusSlot } from './components/inspection-status';

export { StationStatus } from './components/station-status';
export type { StationStatusProps, StationStatusSlot } from './components/station-status';

export { MediaGallery } from './components/media-gallery';
export type { MediaGalleryProps, MediaGallerySlot } from './components/media-gallery';
