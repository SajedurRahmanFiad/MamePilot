import type { AgeComponents } from '../../types';

export function ageToDays(age: AgeComponents): number {
  return age.years * 365 + age.months * 30 + age.days;
}

export function daysToAge(days: number): AgeComponents {
  const years = Math.floor(days / 365);
  const remainingDays = days % 365;
  const months = Math.floor(remainingDays / 30);
  const daysRemaining = remainingDays % 30;
  return { years, months, days: daysRemaining };
}

export function formatAge(days: number): string {
  const { years, months, days: daysPart } = daysToAge(days);
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} year${years !== 1 ? 's' : ''}`);
  if (months > 0) parts.push(`${months} month${months !== 1 ? 's' : ''}`);
  if (daysPart > 0 || parts.length === 0) parts.push(`${daysPart} day${daysPart !== 1 ? 's' : ''}`);
  return parts.join(', ');
}

export function isBatchId(productId: string): boolean {
  return productId.startsWith('batch-');
}

export function extractBatchId(productId: string): string | null {
  if (isBatchId(productId)) {
    return productId.substring(6);
  }
  return null;
}

export function getBatchDisplayName(name: string): string {
  return `[Batch] ${name}`;
}
