<script lang="ts">
  /**
   * "Excel" button for an operational report: downloads it for the entity
   * and month on screen (/operasional/laporan/excel). `semua` is the whole
   * month, a sheet per report.
   */
  import FileSpreadsheet from 'lucide-svelte/icons/file-spreadsheet';
  import { page } from '$app/state';
  import { BTN_SOFT } from './ui';

  let { laporan, label = 'Excel' }: { laporan: string; label?: string } = $props();

  const href = $derived.by(() => {
    const q = new URLSearchParams({ laporan });
    const entitas = (page.data.opEntity as { code: string } | null | undefined)?.code;
    const periode = page.data.periode as { bulan: number; tahun: number } | undefined;
    if (entitas) q.set('entitas', entitas);
    if (periode) {
      q.set('bulan', String(periode.bulan));
      q.set('tahun', String(periode.tahun));
    }
    return `/operasional/laporan/excel?${q}`;
  });
</script>

<a {href} download class={BTN_SOFT} title="Unduh sebagai Excel (.xlsx) — bisa dibuka di Google Sheets">
  <FileSpreadsheet size={14} />
  {label}
</a>
