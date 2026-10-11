/** The three approving departments, in the order they sign. PencairanApproval. */
export const DEPARTEMEN = ['Jetty', 'Gudang', 'Accounting'] as const;
export type Departemen = (typeof DEPARTEMEN)[number];
export type StatusPencairan = 'Pending' | 'Approved' | 'Rejected';

export interface Approval {
  departemen: Departemen;
  status: StatusPencairan;
  tanggal_ttd: string | null;
  keterangan: string | null;
}
