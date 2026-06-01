import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fmtMoney = (n: number | null | undefined): string =>
  (n || 0).toLocaleString('ko-KR');

export const fmtDate = (d: Date | string): string => {
  const x = typeof d === 'string' ? new Date(d) : d;
  return (
    x.getFullYear() +
    '-' +
    String(x.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(x.getDate()).padStart(2, '0')
  );
};

export const fmtPeriod = (d: Date): string =>
  d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');

export const daysBetween = (a: Date | string, b: Date | string): number =>
  Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000);

export const addMonths = (d: Date | string, n: number): Date => {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
};

export const addDays = (d: Date | string, n: number): Date => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

export const monthStart = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), 1);

export const monthEnd = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth() + 1, 0);

/** ID 생성기 (Firestore 자동 ID 대신 의미 있는 prefix 사용) */
export const newId = (prefix: string): string =>
  prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
