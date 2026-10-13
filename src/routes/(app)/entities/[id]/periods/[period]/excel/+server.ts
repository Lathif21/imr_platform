import ExcelJS from 'exceljs';
import { muatLaporanPnl } from '$lib/server/pnl-laporan';
import type { RequestHandler } from './$types';

/**
 * The approved P&L as an Excel file — the statement as filed, not the input
 * template (that one is /entry/[period]/excel, for staff filling it in).
 * Approved or locked periods only; muatLaporanPnl refuses the rest.
 */
const RP = '#,##0;(#,##0);"-"';
const ABU = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } } as const;
const MUDA = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } } as const;

export const GET: RequestHandler = async ({ locals, params }) => {
  const lap = await muatLaporanPnl(locals.supabase, params.id, params.period);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'IMR Platform';
  const ws = wb.addWorksheet('Laporan Laba Rugi', { views: [{ state: 'frozen', ySplit: 6 }] });

  ws.addRow(['LAPORAN LABA RUGI']).font = { bold: true, size: 13 };
  ws.addRow([lap.entitas.legal_name]).font = { bold: true };
  ws.addRow([`Periode ${lap.judulPeriode} · ${lap.statusLabel} · ${lap.basisLabel}`]).font = { color: { argb: 'FF4B5563' } };
  ws.addRow([`Diunduh dari IMR Platform, ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`]).font = {
    italic: true,
    size: 9,
    color: { argb: 'FF9CA3AF' }
  };
  ws.addRow([]);
  const head = ws.addRow(['Pos', 'Kode', 'Jumlah (Rp)', 'Catatan']);
  head.font = { bold: true };
  head.eachCell((c) => (c.fill = ABU));

  for (const b of lap.baris) {
    if (b.jenis === 'pos') {
      const r = ws.addRow([`   ${b.label}`, b.kode, b.jumlah, b.catatan ?? '']);
      r.getCell(2).font = { color: { argb: 'FF6B7280' } };
      r.getCell(3).numFmt = RP;
    } else {
      const r = ws.addRow([b.label, '', b.jumlah, '']);
      r.font = { bold: true };
      r.getCell(3).numFmt = RP;
      if (b.jenis === 'subtotal') r.eachCell({ includeEmpty: true }, (c) => (c.fill = MUDA));
    }
  }
  ws.columns = [{ width: 40 }, { width: 16 }, { width: 20 }, { width: 40 }];

  const berkas = `Laporan Laba Rugi ${lap.entitas.code} ${lap.bulan}.xlsx`;
  return new Response(new Uint8Array(await wb.xlsx.writeBuffer()), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${berkas}"`,
      'cache-control': 'no-store'
    }
  });
};
