/**
 * "Something is running" — one counter for everything the user started and
 * is now waiting on: a page navigation, a save or delete, an Excel export.
 * `IndikatorSibuk.svelte` turns it into the progress cursor and a thin bar.
 *
 * Saves and deletes are not wired one by one. Every `use:enhance` form posts
 * through `fetch`, so a single wrapper around `fetch` sees all of them, along
 * with the lampiran calls and the imports. What is deliberately not counted:
 *
 *   __data.json   page data. Navigations are covered by `navigating`, and
 *                 counting these would turn hover-preloading into a cursor
 *                 that flickers whenever the mouse crosses a link.
 *   AKTIVITAS     the background poll for other people's changes. Nobody
 *                 is waiting on it.
 */

import { notify } from '$lib/feedback.svelte';

const AKTIVITAS = '/operasional/aktivitas';

let jalan = $state(0);

export const sibuk = {
  get aktif() {
    return jalan > 0;
  }
};

/** Mark one process as running; call the returned function exactly once when it ends. */
export function mulai(): () => void {
  jalan++;
  let selesai = false;
  return () => {
    if (selesai) return;
    selesai = true;
    jalan--;
  };
}

function dihitung(input: RequestInfo | URL): boolean {
  const raw = input instanceof Request ? input.url : String(input);
  const url = new URL(raw, location.href);
  if (url.origin !== location.origin) return false;
  if (url.pathname.endsWith('/__data.json')) return false;
  if (url.pathname.startsWith(AKTIVITAS)) return false;
  return true;
}

let terpasang = false;

/** Wraps `window.fetch` once. Idempotent, so a remounted layout does not wrap twice. */
export function pantauFetch(): void {
  if (terpasang) return;
  terpasang = true;
  const asli = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    if (!dihitung(input)) return asli(input, init);
    const selesai = mulai();
    try {
      return await asli(input, init);
    } finally {
      selesai();
    }
  };
}

/** `filename*=UTF-8''…` first (keeps non-ASCII names), then `filename="…"`. */
function namaBerkas(header: string | null, cadangan: string): string {
  if (header) {
    const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
    if (utf8) {
      try {
        return decodeURIComponent(utf8[1].trim());
      } catch {
        // Malformed escape; fall through to the plain name.
      }
    }
    const biasa = /filename="?([^";]+)"?/i.exec(header);
    if (biasa) return biasa[1].trim();
  }
  return cadangan;
}

/**
 * An `<a download>` fetched in the page instead of handed to the browser.
 *
 * A plain download link gives no sign of life while the server builds the
 * workbook — the user clicks again, and gets two files. Fetching it here
 * keeps the busy cursor up until the file is ready, and a refusal becomes
 * the usual error modal instead of an HTML error page saved as `.xlsx`.
 */
async function unduh(link: HTMLAnchorElement): Promise<void> {
  const cadangan = link.getAttribute('download') || link.pathname.split('/').pop() || 'unduhan';
  let res: Response;
  try {
    res = await fetch(link.href, { headers: { accept: 'application/json, */*' } });
  } catch {
    void notify('error', {
      title: 'Unduhan gagal',
      message: 'Koneksi ke server terputus. Periksa koneksi internet Anda lalu coba lagi.'
    });
    return;
  }

  if (!res.ok) {
    let message = 'Berkas tidak dapat dibuat saat ini. Coba lagi sebentar.';
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // Not JSON; keep the generic sentence.
    }
    void notify('error', { title: 'Unduhan gagal', message });
    return;
  }

  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = namaBerkas(res.headers.get('content-disposition'), cadangan);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const sedangDiunduh = new WeakSet<HTMLAnchorElement>();

/**
 * One listener for every download link on every page. Modified clicks
 * (Ctrl/⌘, middle button) are left to the browser, as are links to other
 * origins and links opening a new tab.
 */
export function pantauUnduhan(): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest?.('a[download]');
    if (!(link instanceof HTMLAnchorElement)) return;
    if (link.origin !== location.origin || link.target === '_blank') return;

    event.preventDefault();
    // A second click while the first is still building does nothing.
    if (sedangDiunduh.has(link)) return;
    sedangDiunduh.add(link);
    void unduh(link).finally(() => sedangDiunduh.delete(link));
  };
  document.addEventListener('click', onClick);
  return () => document.removeEventListener('click', onClick);
}
