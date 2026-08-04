import { apiAction } from './apiClient';
import type { AppCapabilityKey } from '../../types';

export type DataFieldFormat = 'date' | 'datetime' | 'number' | 'boolean' | 'json' | 'password';

export interface DataManagementField {
  key: string;
  label: string;
  required: boolean;
  aliases: string[];
  format?: DataFieldFormat;
  requiredGroup?: string;
}

export interface DataManagementDataset {
  key: string;
  label: string;
  description: string;
  capability?: AppCapabilityKey;
  fields: DataManagementField[];
  sampleRow: Record<string, string>;
}

export interface DataExportFilters {
  filterRange: 'All Time' | 'Today' | 'Last 7 days' | 'Last 30 days' | 'This Week' | 'This Month' | 'This Year' | 'Custom';
  customDates: { from: string; to: string };
  dependencyFor?: string;
}

export interface DataManagementSchemasResponse {
  schemaVersion: number;
  datasets: DataManagementDataset[];
  settingsTabs: SettingsTransferTab[];
}

export interface SettingsTransferTab {
  key: string;
  label: string;
  description: string;
}

export interface DataExportResponse {
  app: 'MamePilot';
  schemaVersion: number;
  entity: string;
  exportedAt: string;
  filename: string;
  fields: DataManagementField[];
  rows: Array<Record<string, unknown>>;
}

export interface DataImportError {
  row: number;
  message: string;
}

export interface DataImportResponse {
  entity: string;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: DataImportError[];
}

export interface SettingsPackage {
  app: 'MamePilot';
  schemaVersion: number;
  entity: 'settings';
  exportedAt: string;
  filename: string;
  tabs: Record<string, {
    label: string;
    tables: Record<string, Array<Record<string, unknown>>>;
    references?: Record<string, unknown>;
  }>;
}

export interface SettingsImportResponse {
  processed: number;
  imported: number;
  skipped: number;
  failed: number;
  recordsCreated: number;
  recordsSkipped: number;
  errors: Array<{ tab: string; label: string; message: string }>;
}

export function fetchDataManagementSchemas(): Promise<DataManagementSchemasResponse> {
  return apiAction<DataManagementSchemasResponse>('fetchDataManagementSchemas', {}, { timeoutMs: 60_000 });
}

export function exportDataRecords(entity: string, filters?: DataExportFilters): Promise<DataExportResponse> {
  return apiAction<DataExportResponse>('exportDataRecords', { entity, ...(filters || {}) }, { timeoutMs: 120_000 });
}

export function importDataRecords(
  entity: string,
  rows: Array<Record<string, string>>,
  rowOffset: number,
  dependencyFor?: string,
): Promise<DataImportResponse> {
  return apiAction<DataImportResponse>('importDataRecords', { entity, rows, rowOffset, ...(dependencyFor ? { dependencyFor } : {}) }, { timeoutMs: 120_000 });
}

export function exportSettingsPackage(tabs: string[]): Promise<SettingsPackage> {
  return apiAction<SettingsPackage>('exportSettingsPackage', { tabs }, { timeoutMs: 120_000 });
}

export function importSettingsPackage(
  settingsPackage: SettingsPackage,
  selectedTabs: string[],
): Promise<SettingsImportResponse> {
  return apiAction<SettingsImportResponse>(
    'importSettingsPackage',
    { package: settingsPackage, selectedTabs },
    { timeoutMs: 120_000 },
  );
}
