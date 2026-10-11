/**
 * `src/lib/operasional/pendapatan.ts`. No database.
 *
 * The screen and the printout both sum through ringkas(); these rules decide
 * which invoice counts as paid and where an unpaid one sits.
 */

import { describe, expect, it } from 'vitest';
import { posisi, ringkas, sudahDibayar } from '$lib/operasional/pendapatan';

const row = (status_entry: string | null, payment_date: string | null = null, net = 100) => ({
  party_kg: 1000,
  total: net,
  pajak: 0,
  net_tagihan: net,
  status_entry,
  payment_date
});

describe('sudahDibayar', () => {
  it.each([
    [row('LUNAS'), true],
    [row(' paid '), true],
    [row('ACCOUNTING', '2026-10-01'), true],
    [row('PROSES PAYMENT'), false],
    [row(null), false]
  ])('%o → %s', (r, expected) => {
    expect(sudahDibayar(r)).toBe(expected);
  });
});

describe('posisi', () => {
  it.each([
    [row(null), 'PENDING'],
    [row('pending'), 'PENDING'],
    [row('MB AMEL'), 'JETTY'],
    [row('ADMIN LAPANGAN'), 'JETTY'],
    [row('ACCOUNTING'), 'ACCOUNTING'],
    [row('PROSES PAYMENT'), 'PROSES PAYMENT'],
    [row('PROSES PAYMENT', '2026-10-02'), 'LUNAS'],
    [row('LAINNYA'), 'LAIN']
  ])('%o → %s', (r, expected) => {
    expect(posisi(r)).toBe(expected);
  });
});

it('ringkas memisahkan belum dan sudah dibayar', () => {
  const r = ringkas([row(null, null, 100), row('LUNAS', null, 50), row('ACCOUNTING', null, 25)]);
  expect(r.semua.net_tagihan).toBe(175);
  expect(r.belum).toMatchObject({ jumlah: 2, net_tagihan: 125 });
  expect(r.sudah).toMatchObject({ jumlah: 1, net_tagihan: 50 });
  expect(r.perPosisi.get('ACCOUNTING')?.jumlah).toBe(1);
});
