export const POCKETS = ['SALDO', 'JAJAN', 'LAUNDRY'] as const;
export type Pocket = (typeof POCKETS)[number];
export const POCKET_LABEL: Record<Pocket, string> = { SALDO: 'Saldo', JAJAN: 'Jajan', LAUNDRY: 'Laundry' };
