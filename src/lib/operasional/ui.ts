/**
 * Class strings the operational forms share. The report screens inline
 * these; with three CRUD screens and more to come, one copy is the version
 * that stays consistent. Tokens only — no raw hex (CLAUDE.md, Design).
 */

export const LABEL = 'block text-[12px] font-medium text-muted-foreground mb-1.5';

export const FIELD =
  'w-full h-[34px] px-3 bg-background border border-border rounded-lg text-[14px] text-foreground ' +
  'placeholder:text-subtle focus:outline-none focus:border-primary';

export const TEXTAREA =
  'w-full min-h-[72px] px-3 py-2 bg-background border border-border rounded-lg text-[14px] ' +
  'text-foreground placeholder:text-subtle focus:outline-none focus:border-primary';

export const BTN_PRIMARY =
  'h-[34px] px-4 rounded-lg bg-primary text-[14px] font-medium text-primary-foreground ' +
  'hover:bg-accent transition-colors disabled:opacity-60 disabled:cursor-wait ' +
  'inline-flex items-center justify-center gap-1.5';

export const BTN_SOFT =
  'h-[34px] px-4 rounded-lg border border-border bg-card text-[14px] font-medium ' +
  'text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ' +
  'inline-flex items-center justify-center gap-1.5';

/**
 * Save bar for long forms: stays pinned to the bottom of the screen, so the
 * save button is never a scroll away. Spans the page's own padding.
 */
export const SAVE_BAR =
  'sticky bottom-0 z-10 -mx-4 sm:-mx-5 px-4 sm:px-5 py-3 border-t border-border ' +
  'bg-background/95 backdrop-blur flex justify-end items-center gap-2';

/** Row action: icon button in a table. */
export const BTN_ICON =
  'p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

export const BTN_ICON_DANGER =
  'p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 ' +
  'transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

/** "Rp 1.250.000" — Rupiah in full, as the operational screens printed it. */
export function rupiah(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  return 'Rp ' + new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(n);
}

/** Case- and space-insensitive match for the search boxes. */
export function matches(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return fields.some((field) => (field ?? '').toLowerCase().includes(q));
}
