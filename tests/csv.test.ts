import assert from 'node:assert/strict';
import { buildCsv, parseCsv } from '../src/utils/csv';
import { createAutomaticDataMapping, createDataImportBatches, dataMappingErrors, isMamePilotDataExport } from '../src/utils/dataImportMapping';
import type { DataManagementDataset } from '../src/services/dataManagement';

const source = buildCsv(
  ['Name', 'Notes', 'JSON'],
  [
    ['A, B', 'line 1\nline "2"', { ok: true }],
    ['Plain', ' spaced ', null],
  ],
);
const parsed = parseCsv(source);

assert.deepEqual(parsed.headers, ['Name', 'Notes', 'JSON']);
assert.deepEqual(parsed.rows, [
  ['A, B', 'line 1\nline "2"', '{"ok":true}'],
  ['Plain', ' spaced ', ''],
]);
assert.throws(() => parseCsv('Name\r\n"broken'), /unclosed quoted value/);

const dataset: DataManagementDataset = {
  key: 'customers',
  label: 'Customers',
  description: '',
  sampleRow: { name: 'Sample', phone: '01700000000' },
  fields: [
    { key: 'name', label: 'Customer Name', required: true, aliases: ['name'] },
    { key: 'phone', label: 'Customer Phone', required: true, aliases: ['mobile number'] },
  ],
};
const exactHeaders = dataset.fields.map((field) => field.label);
const exactMapping = createAutomaticDataMapping(dataset, exactHeaders);
assert.deepEqual(exactMapping, { name: '0', phone: '1' });
assert.equal(isMamePilotDataExport(dataset, 'mamepilot-customers-2026-07-22.csv', exactHeaders), true);
assert.deepEqual(createAutomaticDataMapping(dataset, ['Mobile Number', 'Name']), { name: '1', phone: '0' });
assert.deepEqual(dataMappingErrors(dataset, { name: '1' }), ['Customer Phone is required.']);
const orderBatches = createDataImportBatches('orders', [
  { orderNumber: 'ORD-1', productName: 'First' },
  { orderNumber: 'ORD-2', productName: 'Other' },
  { orderNumber: 'ORD-1', productName: 'Second' },
], 2);
assert.deepEqual(orderBatches, [
  [
    { orderNumber: 'ORD-1', productName: 'First' },
    { orderNumber: 'ORD-1', productName: 'Second' },
  ],
  [{ orderNumber: 'ORD-2', productName: 'Other' }],
]);

console.log('CSV parser and automatic/manual column-mapping checks passed.');
