import type { ClassValue } from 'clsx';
import { cn } from './cn';

/**
 * Per-slot class overrides.
 *
 * Every component here exposes its internal structure as named slots, so a host
 * app can restyle any part without forking the component or resorting to
 * descendant selectors.
 */
export type SlotClasses<S extends string> = Partial<Record<S, ClassValue>>;

export interface StyleableProps<S extends string> {
  /** Class for the outermost element. */
  className?: string;
  /** Per-slot classes, merged over the defaults. */
  classNames?: SlotClasses<S>;
  /**
   * Drop every built-in class and emit structure only. Use when the design
   * system owns all visuals; slot classes still apply.
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
