/**
 * Shared feedback state: the result modal, the confirmation dialog, and
 * toasts. All three are mounted once in the (app) layout, so feedback raised
 * just before a redirect still shows on the page the user lands on.
 *
 * Which one to use — the UX is taken from the operational system
 * (LaporanKeuangan), keputusan 7 Oktober 2026:
 *
 *   notify('success' | 'error')  the outcome of something the user did:
 *                                saved, submitted, refused. A modal, so it
 *                                is read rather than missed, and an error
 *                                lists every reason, not only the first.
 *   confirmDialog()              a question before an action that changes
 *                                or overwrites something. `consequence`
 *                                spells out what else goes with it.
 *   toast()                      things nobody asked for and nobody has to
 *                                answer — someone else's change arriving.
 */

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` paints the confirm button red — for actions that overwrite or can't be undone. */
  tone?: 'primary' | 'danger';
  /**
   * What else happens, stated separately from the question: "Seluruh rincian
   * truk pada kapal ini ikut terhapus." Rendered as a warning box so it is
   * not read as part of the question and skimmed past.
   */
  consequence?: string;
}

export interface NoticeOptions {
  title: string;
  message?: string;
  /**
   * Each reason on its own line — every failed field of a validation error,
   * not just the first. Shown for both kinds, but meant for errors.
   */
  details?: string[];
  /** Defaults to "Selesai" for success and "Mengerti" for error. */
  buttonLabel?: string;
}

let nextId = 1;

export const toasts = $state<Toast[]>([]);

export function dismissToast(id: number) {
  const at = toasts.findIndex((t) => t.id === id);
  if (at >= 0) toasts.splice(at, 1);
}

export function toast(kind: ToastKind, title: string, message?: string) {
  const id = nextId++;
  toasts.push({ id, kind, title, message });
  // Errors stay longer: they usually need reading, not just noticing.
  setTimeout(() => dismissToast(id), kind === 'error' ? 8000 : 4500);
}

export const noticeState = $state<{
  open: boolean;
  kind: 'success' | 'error';
  options: NoticeOptions | null;
  resolve: (() => void) | null;
}>({ open: false, kind: 'success', options: null, resolve: null });

/**
 * The result of an action, as a modal the user closes. Resolves when it is
 * closed, so a caller that must not move on before the user has read the
 * outcome can await it. A second notice replaces the first rather than
 * stacking: only the latest outcome is true.
 */
export function notify(kind: 'success' | 'error', options: NoticeOptions): Promise<void> {
  noticeState.resolve?.();
  return new Promise((resolve) => {
    noticeState.kind = kind;
    noticeState.options = options;
    noticeState.resolve = resolve;
    noticeState.open = true;
  });
}

export function closeNotice() {
  const resolve = noticeState.resolve;
  noticeState.open = false;
  noticeState.resolve = null;
  resolve?.();
}

export const confirmState = $state<{
  open: boolean;
  options: ConfirmOptions | null;
  resolve: ((ok: boolean) => void) | null;
}>({ open: false, options: null, resolve: null });

/** Resolves true when the user confirms, false on cancel / Escape / backdrop. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  confirmState.resolve?.(false);
  return new Promise((resolve) => {
    confirmState.options = options;
    confirmState.resolve = resolve;
    confirmState.open = true;
  });
}

export function settleConfirm(ok: boolean) {
  const resolve = confirmState.resolve;
  confirmState.open = false;
  confirmState.resolve = null;
  resolve?.(ok);
}
