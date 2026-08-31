/**
 * Class-name value, in the shapes JSX conditionals naturally produce.
 *
 * Deliberately narrower than clsx's: no nested arrays of objects, because the
 * components never need them and the type is public API.
 */
export type ClassValue =
  | string
  | number
  | null
  | undefined
  | false
  | Record<string, boolean | null | undefined>
  | ClassValue[];

/**
 * Joins class names, dropping falsy values.
 *
 * There is no utility-conflict resolution here (what `tailwind-merge` does) and
 * none is needed: the built-in classes are semantic, so a caller's class sits
 * alongside them rather than fighting one. When you need to override a built-in
 * declaration, either raise specificity or import the SDK stylesheet before
 * your own so your rule wins on order.
 */
export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];

  const walk = (value: ClassValue): void => {
    if (!value) return;
    if (typeof value === 'string') {
      if (value) out.push(value);
      return;
    }
    if (typeof value === 'number') {
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
  return out.join(' ');
}
