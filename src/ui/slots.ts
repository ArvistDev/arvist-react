import { cn, type ClassValue } from './cn';

/**
 * Per-slot class overrides.
 *
 * Every component exposes its internal structure as named slots, so a host app
 * can restyle any part without forking the component or reaching in with
 * descendant selectors.
 */
export type SlotClasses<S extends string> = Partial<Record<S, ClassValue>>;

export interface StyleableProps<S extends string> {
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
export function createSlots<S extends string>(
  props: Pick<StyleableProps<S>, 'classNames' | 'unstyled'>,
) {
  return (slot: S, ...defaults: ClassValue[]): string =>
    cn(props.unstyled ? undefined : defaults, props.classNames?.[slot]);
}
