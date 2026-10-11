/**
 * One `use:enhance` handler for every operational form, so every save and
 * delete answers the same way — the UX taken from the operational system:
 *
 *   before   confirmDialog(), when the action changes or removes something
 *   success  notify('success') with the action's own title and message
 *   failure  notify('error') listing every `details` line the action returned
 *   no reply notify('error') saying the connection failed and nothing is lost
 *
 * Actions return `{ title?, message }` on success and
 * `fail(400, { message, details? })` on refusal — see
 * `$lib/server/operasional.ts`.
 */

import type { SubmitFunction } from '@sveltejs/kit';
import { confirmDialog, notify, type ConfirmOptions } from '$lib/feedback.svelte';

const NETWORK_MESSAGE =
  'Koneksi ke server terputus atau server sedang bermasalah. Periksa koneksi internet Anda lalu coba lagi. Isian Anda masih ada di layar.';

export function withFeedback(options: {
  /** Asked first; `null` from the function form means "no question needed". */
  confirm?: ConfirmOptions | ((data: FormData) => ConfirmOptions | null);
  /** Title of the error modal: "Pemilik gagal disimpan". */
  failTitle: string;
  /** Default success title when the action gives none. */
  successTitle?: string;
  /** After a success, before the modal shows — close the form, clear a field. */
  onSuccess?: () => void;
  /** Drives the button spinner and disables a second click mid-request. */
  onPending?: (pending: boolean) => void;
}): SubmitFunction {
  return async ({ formData, cancel }) => {
    const question =
      typeof options.confirm === 'function' ? options.confirm(formData) : options.confirm;

    if (question && !(await confirmDialog(question))) {
      cancel();
      return;
    }

    options.onPending?.(true);

    return async ({ result, update }) => {
      try {
        // `reset: false`: a refused form keeps what the user typed. A form
        // that succeeded is closed by onSuccess, so nothing stale remains.
        await update({ reset: false });

        if (result.type === 'success') {
          const data = (result.data ?? {}) as { title?: string; message?: string };
          options.onSuccess?.();
          void notify('success', {
            title: data.title ?? options.successTitle ?? 'Berhasil disimpan',
            message: data.message
          });
        } else if (result.type === 'failure') {
          const data = (result.data ?? {}) as { message?: string; details?: string[] };
          void notify('error', {
            title: options.failTitle,
            message: data.message,
            details: data.details
          });
        } else if (result.type === 'error') {
          void notify('error', { title: options.failTitle, message: NETWORK_MESSAGE });
        }
      } finally {
        options.onPending?.(false);
      }
    };
  };
}
