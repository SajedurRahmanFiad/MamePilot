import type { DataManagementDataset } from '../services/dataManagement';
import { normalizeCsvHeader } from './csv';

export function createAutomaticDataMapping(
  dataset: DataManagementDataset,
  headers: string[],
): Record<string, string> {
  const normalizedHeaders = headers.map(normalizeCsvHeader);
  const mapping: Record<string, string> = {};
  const usedColumns = new Set<number>();

  dataset.fields.forEach((field) => {
    const candidates = [field.key, field.label, ...(field.aliases || [])]
      .map(normalizeCsvHeader)
      .filter(Boolean);
    const columnIndex = normalizedHeaders.findIndex((header, index) => (
      !usedColumns.has(index) && candidates.includes(header)
    ));
    if (columnIndex >= 0) {
      mapping[field.key] = String(columnIndex);
      usedColumns.add(columnIndex);
    }
  });

  return mapping;
}

export function isMamePilotDataExport(
  dataset: DataManagementDataset,
  fileName: string,
  headers: string[],
): boolean {
  const exactHeaders = dataset.fields.map((field) => normalizeCsvHeader(field.label));
  const uploadedHeaders = headers.map(normalizeCsvHeader);
  return (
    fileName.toLocaleLowerCase().startsWith(`mamepilot-${dataset.key}-`)
    && exactHeaders.length === uploadedHeaders.length
    && exactHeaders.every((header, index) => header === uploadedHeaders[index])
  );
}

export function dataMappingErrors(
  dataset: DataManagementDataset,
  mapping: Record<string, string>,
): string[] {
  const errors: string[] = [];
  dataset.fields.forEach((field) => {
    if (field.required && mapping[field.key] === undefined) {
      errors.push(`${field.label} is required.`);
    }
  });

  const groups = new Map<string, string[]>();
  dataset.fields.forEach((field) => {
    if (!field.requiredGroup) return;
    const labels = groups.get(field.requiredGroup) || [];
    labels.push(field.label);
    groups.set(field.requiredGroup, labels);
  });
  groups.forEach((labels, group) => {
    const hasMappedField = dataset.fields.some((field) => (
      field.requiredGroup === group && mapping[field.key] !== undefined
    ));
    if (!hasMappedField) {
      errors.push(`Map at least one of: ${labels.join(' or ')}.`);
    }
  });

  return errors;
}

export function createDataImportBatches(
  entity: string,
  records: Array<Record<string, string>>,
  maximumBatchSize: number,
): Array<Array<Record<string, string>>> {
  if (!['orders', 'bills'].includes(entity)) {
    const batches: Array<Array<Record<string, string>>> = [];
    for (let offset = 0; offset < records.length; offset += maximumBatchSize) {
      batches.push(records.slice(offset, offset + maximumBatchSize));
    }
    return batches;
  }

  const numberKey = entity === 'orders' ? 'orderNumber' : 'billNumber';
  const groups = new Map<string, Array<Record<string, string>>>();
  records.forEach((record, index) => {
    const number = (record[numberKey] || '').trim().toLocaleLowerCase();
    const key = number || `__missing_${index}`;
    const group = groups.get(key) || [];
    group.push(record);
    groups.set(key, group);
  });

  const batches: Array<Array<Record<string, string>>> = [];
  let currentBatch: Array<Record<string, string>> = [];
  groups.forEach((group) => {
    if (group.length > maximumBatchSize) {
      throw new Error(`A single ${entity === 'orders' ? 'order' : 'bill'} cannot contain more than ${maximumBatchSize} CSV item rows.`);
    }
    if (currentBatch.length > 0 && currentBatch.length + group.length > maximumBatchSize) {
      batches.push(currentBatch);
      currentBatch = [];
    }
    currentBatch.push(...group);
  });
  if (currentBatch.length > 0) batches.push(currentBatch);
  return batches;
}
