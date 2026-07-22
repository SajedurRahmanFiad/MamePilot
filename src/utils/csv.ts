export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

export function parseCsv(source: string): ParsedCsv {
  const text = source.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field === '') {
      inQuotes = true;
    } else if (character === ',') {
      record.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') {
        index += 1;
      }
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (inQuotes) {
    throw new Error('The CSV file contains an unclosed quoted value.');
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const nonEmptyRecords = records.filter((candidate) => candidate.some((value) => value.trim() !== ''));
  if (nonEmptyRecords.length === 0) {
    throw new Error('The CSV file is empty.');
  }

  const headers = nonEmptyRecords[0].map((header, index) => header.trim() || `Column ${index + 1}`);
  if (headers.length === 0) {
    throw new Error('The CSV file does not contain a header row.');
  }

  const rows = nonEmptyRecords.slice(1).map((candidate) => {
    if (candidate.length > headers.length) {
      throw new Error('A CSV row has more columns than the header row.');
    }
    return Array.from({ length: headers.length }, (_, index) => candidate[index] ?? '');
  });
  if (rows.length === 0) {
    throw new Error('The CSV file does not contain any data rows.');
  }

  return { headers, rows };
}

function csvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function escapeCsvValue(value: unknown): string {
  const normalized = csvValue(value);
  if (/[",\r\n]/.test(normalized) || /^\s|\s$/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

export function buildCsv(headers: string[], rows: unknown[][]): string {
  const lines = [
    headers.map(escapeCsvValue).join(','),
    ...rows.map((row) => row.map(escapeCsvValue).join(',')),
  ];
  return `\uFEFF${lines.join('\r\n')}`;
}

export function normalizeCsvHeader(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}
