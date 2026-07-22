import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Database, Download, FileDown, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { Button } from './Button';
import { Modal } from './Modal';
import { useToastNotifications } from '../src/contexts/ToastContext';
import {
  exportDataRecords,
  exportSettingsPackage,
  fetchDataManagementSchemas,
  importDataRecords,
  importSettingsPackage,
  type DataImportError,
  type DataManagementDataset,
  type SettingsPackage,
  type SettingsTransferTab,
} from '../src/services/dataManagement';
import { buildCsv, parseCsv } from '../src/utils/csv';
import { createAutomaticDataMapping, createDataImportBatches, dataMappingErrors, isMamePilotDataExport } from '../src/utils/dataImportMapping';

interface ImportSession {
  dataset: DataManagementDataset;
  fileName: string;
  headers: string[];
  rows: string[][];
  mapping: Record<string, string>;
  appGenerated: boolean;
  dependencies: Array<{
    dataset: DataManagementDataset;
    records: Array<Record<string, string>>;
  }>;
}

interface ImportSummary {
  datasetLabel: string;
  fileName: string;
  processed: number;
  created: number;
  skipped: number;
  failed: number;
  errors: DataImportError[];
  stoppedMessage?: string;
}

const IMPORT_BATCH_SIZE = 200;
const PRODUCT_PACKAGE_BATCH_SIZE = 20;
const PRODUCT_PACKAGE_BATCH_BYTES = 12 * 1024 * 1024;
const MAX_CSV_SIZE = 25 * 1024 * 1024;
const MAX_PRODUCT_PACKAGE_SIZE = 100 * 1024 * 1024;
const MAX_PACKAGED_IMAGE_SIZE = 8 * 1024 * 1024;
const FINANCIAL_DATASET_KEYS = new Set(['orders', 'bills', 'transactions']);
const MAX_SETTINGS_PACKAGE_SIZE = 25 * 1024 * 1024;

interface SettingsTransferSession {
  mode: 'export' | 'import';
  selectedTabs: string[];
  settingsPackage?: SettingsPackage;
  fileName?: string;
}

const imageExtension = (mimeType: string, fallbackPath = '') => {
  const byMime: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
  };
  if (byMime[mimeType.toLocaleLowerCase()]) return byMime[mimeType.toLocaleLowerCase()];
  const match = fallbackPath.match(/\.([a-z0-9]{2,5})(?:[?#].*)?$/i);
  return match?.[1]?.toLocaleLowerCase() || 'bin';
};

const imageMimeType = (path: string) => {
  const extension = imageExtension('', path);
  return ({
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml',
  } as Record<string, string>)[extension] || '';
};

const safePackageName = (value: string, fallback: string) => {
  const normalized = value.normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || fallback;
};

const bytesToDataUrl = (bytes: Uint8Array, mimeType: string) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const portableImageValue = async (value: unknown) => {
  const imageValue = String(value ?? '').trim();
  if (!imageValue || imageValue.startsWith('data:')) return imageValue;
  try {
    const imageUrl = new URL(imageValue, window.location.origin);
    const response = await fetch(imageUrl, { credentials: imageUrl.origin === window.location.origin ? 'same-origin' : 'omit' });
    if (!response.ok) return imageValue;
    const mimeType = (response.headers.get('content-type') || '').split(';')[0].trim().toLocaleLowerCase();
    if (!mimeType.startsWith('image/')) return imageValue;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_PACKAGED_IMAGE_SIZE) return imageValue;
    return bytesToDataUrl(bytes, mimeType);
  } catch {
    return imageValue;
  }
};

const makeSettingsPackagePortable = async (settingsPackage: SettingsPackage) => {
  const portable = JSON.parse(JSON.stringify(settingsPackage)) as SettingsPackage;
  const companyRow = portable.tabs.company?.tables.company_settings?.[0];
  if (!companyRow) return portable;
  companyRow.logo = await portableImageValue(companyRow.logo);
  try {
    const pages = typeof companyRow.pages === 'string' ? JSON.parse(companyRow.pages) : companyRow.pages;
    if (Array.isArray(pages)) {
      for (const page of pages) {
        if (page && typeof page === 'object') {
          page.logo = await portableImageValue(page.logo);
        }
      }
      companyRow.pages = JSON.stringify(pages);
    }
  } catch {
    // Keep the backend-provided value when an older installation stores a non-JSON legacy value.
  }
  return portable;
};

const createProductPackageBatches = (records: Array<Record<string, string>>) => {
  const batches: Array<Array<Record<string, string>>> = [];
  let current: Array<Record<string, string>> = [];
  let currentBytes = 0;
  records.forEach((record) => {
    const recordBytes = JSON.stringify(record).length;
    if (current.length > 0 && (current.length >= PRODUCT_PACKAGE_BATCH_SIZE || currentBytes + recordBytes > PRODUCT_PACKAGE_BATCH_BYTES)) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(record);
    currentBytes += recordBytes;
  });
  if (current.length > 0) batches.push(current);
  return batches;
};

const DataManagementSettingsPanel: React.FC = () => {
  const queryClient = useQueryClient();
  const toast = useToastNotifications();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const settingsFileInputRef = useRef<HTMLInputElement>(null);
  const [datasets, setDatasets] = useState<DataManagementDataset[]>([]);
  const [settingsTabs, setSettingsTabs] = useState<SettingsTransferTab[]>([]);
  const [loadingSchemas, setLoadingSchemas] = useState(true);
  const [schemaError, setSchemaError] = useState('');
  const [selectedDatasetKey, setSelectedDatasetKey] = useState('');
  const [exportingKey, setExportingKey] = useState('');
  const [session, setSession] = useState<ImportSession | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [settingsSession, setSettingsSession] = useState<SettingsTransferSession | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingSchemas(true);
    fetchDataManagementSchemas()
      .then((response) => {
        if (!cancelled) {
          setDatasets(response.datasets);
          setSettingsTabs(response.settingsTabs || []);
          setSchemaError('');
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSchemaError(error instanceof Error ? error.message : 'Could not load the data management options.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSchemas(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const validationErrors = useMemo(() => (
    session ? dataMappingErrors(session.dataset, session.mapping) : []
  ), [session]);
  const mappedFields = useMemo(() => (
    session?.dataset.fields.filter((field) => session.mapping[field.key] !== undefined) || []
  ), [session]);

  const handleExport = async (dataset: DataManagementDataset) => {
    setExportingKey(dataset.key);
    try {
      const response = await exportDataRecords(dataset.key);
      const headers = response.fields.map((field) => field.label);
      const exportedRows = response.rows.map((row) => ({ ...row }));

      if (FINANCIAL_DATASET_KEYS.has(dataset.key)) {
        const accountsDataset = datasets.find((candidate) => candidate.key === 'accounts');
        if (!accountsDataset) throw new Error('The Accounts export option is unavailable. Refresh the page and try again.');
        const accountsResponse = await exportDataRecords('accounts');
        const primaryRows = exportedRows.map((row) => response.fields.map((field) => row[field.key]));
        const accountRows = accountsResponse.rows.map((row) => accountsResponse.fields.map((field) => row[field.key]));
        const archive: Record<string, Uint8Array> = {
          [response.filename]: strToU8(buildCsv(headers, primaryRows)),
          [accountsResponse.filename]: strToU8(buildCsv(
            accountsResponse.fields.map((field) => field.label),
            accountRows,
          )),
          'README.txt': strToU8(
            `MamePilot ${dataset.label} Package\n\nImport this ZIP from Settings > Import & Export > ${dataset.label}. `
            + 'Accounts are included and will be imported automatically before the main records. Existing records and accounts are skipped, never overwritten.\n',
          ),
        };
        const zipBytes = zipSync(archive, { level: 6 });
        downloadBlob(
          new Blob([zipBytes as BlobPart], { type: 'application/zip' }),
          response.filename.replace(/\.csv$/i, '.zip'),
        );
        toast.success(`${response.rows.length} ${dataset.label.toLocaleLowerCase()} and ${accountsResponse.rows.length} accounts exported.`);
        return;
      }

      if (dataset.key === 'products') {
        const archive: Record<string, Uint8Array> = {};
        let packagedImages = 0;
        let unavailableImages = 0;

        for (let offset = 0; offset < exportedRows.length; offset += 6) {
          await Promise.all(exportedRows.slice(offset, offset + 6).map(async (row, batchIndex) => {
            const index = offset + batchIndex;
            const imageValue = String(row.image ?? '').trim();
            if (!imageValue) return;

            try {
              const imageUrl = new URL(imageValue, window.location.origin);
              const imageResponse = await fetch(imageUrl, { credentials: imageUrl.origin === window.location.origin ? 'same-origin' : 'omit' });
              if (!imageResponse.ok) throw new Error(`HTTP ${imageResponse.status}`);
              const mimeType = (imageResponse.headers.get('content-type') || '').split(';')[0].trim().toLocaleLowerCase();
              if (!mimeType.startsWith('image/')) throw new Error('The file is not an image.');
              const bytes = new Uint8Array(await imageResponse.arrayBuffer());
              if (bytes.length === 0 || bytes.length > MAX_PACKAGED_IMAGE_SIZE) throw new Error('The image is empty or too large.');
              const productName = safePackageName(String(row.name ?? ''), `product-${index + 1}`);
              const packagePath = `images/${String(index + 1).padStart(5, '0')}-${productName}.${imageExtension(mimeType, imageUrl.pathname)}`;
              archive[packagePath] = bytes;
              row.image = packagePath;
              packagedImages++;
            } catch {
              row.image = imageValue.startsWith('/') ? new URL(imageValue, window.location.origin).toString() : imageValue;
              unavailableImages++;
            }
          }));
        }

        const rows = exportedRows.map((row) => response.fields.map((field) => row[field.key]));
        archive[response.filename] = strToU8(buildCsv(headers, rows));
        archive['README.txt'] = strToU8(
          'MamePilot Product Package\n\nImport this ZIP from Settings > Import and Export Data > Products. '
          + 'The product CSV and packaged images will be restored automatically.\n'
        );
        const packageFilename = response.filename.replace(/\.csv$/i, '.zip');
        const zipBytes = zipSync(archive, { level: 6 });
        downloadBlob(new Blob([zipBytes as BlobPart], { type: 'application/zip' }), packageFilename);
        const missingNote = unavailableImages > 0 ? ` ${unavailableImages} unavailable image(s) were left as URLs.` : '';
        toast.success(`${response.rows.length} products and ${packagedImages} image(s) exported.${missingNote}`);
        return;
      }

      const rows = exportedRows.map((row) => response.fields.map((field) => row[field.key]));
      downloadBlob(new Blob([buildCsv(headers, rows)], { type: 'text/csv;charset=utf-8' }), response.filename);
      toast.success(`${response.rows.length} ${dataset.label.toLocaleLowerCase()} exported.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Could not export ${dataset.label.toLocaleLowerCase()}.`);
    } finally {
      setExportingKey('');
    }
  };

  const handleTemplateDownload = (dataset: DataManagementDataset) => {
    const headers = dataset.fields.map((field) => field.label);
    const sample = dataset.fields.map((field) => dataset.sampleRow[field.key] ?? '');
    const blob = new Blob([buildCsv(headers, [sample])], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mamepilot-${dataset.key}-template.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast.success(`${dataset.label} template downloaded.`);
  };

  const openSettingsExport = () => {
    setSettingsSession({ mode: 'export', selectedTabs: settingsTabs.map((tab) => tab.key) });
  };

  const openSettingsImportPicker = () => {
    if (settingsFileInputRef.current) {
      settingsFileInputRef.current.value = '';
      settingsFileInputRef.current.click();
    }
  };

  const handleSettingsFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.toLocaleLowerCase().endsWith('.json')) {
      toast.error('Select a MamePilot Settings .json file.');
      return;
    }
    if (file.size > MAX_SETTINGS_PACKAGE_SIZE) {
      toast.error('Settings files can be up to 25 MB.');
      return;
    }
    try {
      const parsed = JSON.parse(await file.text()) as SettingsPackage;
      if (parsed?.app !== 'MamePilot' || parsed?.entity !== 'settings' || !parsed.tabs || typeof parsed.tabs !== 'object') {
        throw new Error('Select a MamePilot Settings export file.');
      }
      const availableTabs = settingsTabs.filter((tab) => parsed.tabs[tab.key]).map((tab) => tab.key);
      if (availableTabs.length === 0) throw new Error('This Settings file does not contain any supported tabs.');
      setSettingsSession({
        mode: 'import',
        selectedTabs: availableTabs,
        settingsPackage: parsed,
        fileName: file.name,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The Settings file could not be read.');
    }
  };

  const toggleSettingsTab = (key: string) => {
    setSettingsSession((current) => {
      if (!current) return current;
      const selectedTabs = current.selectedTabs.includes(key)
        ? current.selectedTabs.filter((candidate) => candidate !== key)
        : [...current.selectedTabs, key];
      return { ...current, selectedTabs };
    });
  };

  const runSettingsTransfer = async () => {
    if (!settingsSession || settingsSession.selectedTabs.length === 0) return;
    setSettingsBusy(true);
    try {
      if (settingsSession.mode === 'export') {
        const response = await exportSettingsPackage(settingsSession.selectedTabs);
        const portable = await makeSettingsPackagePortable(response);
        downloadBlob(
          new Blob([JSON.stringify(portable, null, 2)], { type: 'application/json;charset=utf-8' }),
          response.filename,
        );
        toast.success(`${settingsSession.selectedTabs.length} Settings tabs exported.`);
      } else if (settingsSession.settingsPackage) {
        const response = await importSettingsPackage(settingsSession.settingsPackage, settingsSession.selectedTabs);
        queryClient.invalidateQueries();
        if (response.failed > 0) {
          const firstError = response.errors[0];
          toast.warning(
            `${response.imported} tabs imported, ${response.skipped} skipped, and ${response.failed} failed.`
            + (firstError ? ` ${firstError.label}: ${firstError.message}` : ''),
          );
        } else {
          toast.success(`${response.imported} Settings tabs imported; ${response.recordsSkipped} existing list items were kept unchanged.`);
        }
      }
      setSettingsSession(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Could not ${settingsSession.mode} Settings.`);
    } finally {
      setSettingsBusy(false);
    }
  };

  const openFilePicker = (dataset: DataManagementDataset) => {
    setSelectedDatasetKey(dataset.key);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const dataset = datasets.find((candidate) => candidate.key === selectedDatasetKey);
    if (!file || !dataset) return;
    const lowerFileName = file.name.toLocaleLowerCase();
    const isZipPackage = lowerFileName.endsWith('.zip');
    const supportsPackage = dataset.key === 'products' || FINANCIAL_DATASET_KEYS.has(dataset.key);
    const isProductPackage = isZipPackage && dataset.key === 'products';
    const isFinancialPackage = isZipPackage && FINANCIAL_DATASET_KEYS.has(dataset.key);
    if (!lowerFileName.endsWith('.csv') && !isZipPackage) {
      toast.error(supportsPackage ? 'Select a MamePilot .zip package or .csv file.' : 'Select a .csv file.');
      return;
    }
    if (isZipPackage && !supportsPackage) {
      toast.error('ZIP packages are supported for Products, Orders, Bills, and Transactions.');
      return;
    }
    const maxFileSize = isZipPackage ? MAX_PRODUCT_PACKAGE_SIZE : MAX_CSV_SIZE;
    if (file.size > maxFileSize) {
      toast.error(isZipPackage ? 'MamePilot packages can be up to 100 MB.' : 'CSV files can be up to 25 MB.');
      return;
    }

    try {
      let importFileName = file.name;
      let csvText = isZipPackage ? '' : await file.text();
      let packageFiles: Record<string, Uint8Array> | null = null;
      const dependencies: ImportSession['dependencies'] = [];
      if (isZipPackage) {
        packageFiles = unzipSync(new Uint8Array(await file.arrayBuffer()));
        const datasetPattern = new RegExp(`(^|/)mamepilot-${dataset.key}-[^/]*\\.csv$`, 'i');
        const csvNames = Object.keys(packageFiles).filter((name) => datasetPattern.test(name));
        if (csvNames.length !== 1) {
          throw new Error(`The package must contain exactly one MamePilot ${dataset.label.toLocaleLowerCase()} CSV file.`);
        }
        importFileName = csvNames[0].split('/').pop() || csvNames[0];
        csvText = strFromU8(packageFiles[csvNames[0]]);

        if (isFinancialPackage) {
          const accountsDataset = datasets.find((candidate) => candidate.key === 'accounts');
          if (!accountsDataset) throw new Error('The Accounts import option is unavailable. Refresh the page and try again.');
          const accountNames = Object.keys(packageFiles).filter((name) => /(^|\/)mamepilot-accounts-[^/]*\.csv$/i.test(name));
          if (accountNames.length !== 1) {
            throw new Error('The financial package must contain exactly one MamePilot accounts CSV file.');
          }
          const parsedAccounts = parseCsv(strFromU8(packageFiles[accountNames[0]]));
          const accountMapping = createAutomaticDataMapping(accountsDataset, parsedAccounts.headers);
          const accountErrors = dataMappingErrors(accountsDataset, accountMapping);
          if (accountErrors.length > 0) {
            throw new Error(`The Accounts CSV is invalid: ${accountErrors.join(' ')}`);
          }
          dependencies.push({
            dataset: accountsDataset,
            records: parsedAccounts.rows.map((accountRow, rowIndex) => {
              const record: Record<string, string> = { _csvRow: String(rowIndex + 2), _dependencyMode: dataset.key };
              accountsDataset.fields.forEach((field) => {
                const mappedColumn = accountMapping[field.key];
                if (mappedColumn !== undefined) record[field.key] = accountRow[Number(mappedColumn)] ?? '';
              });
              return record;
            }),
          });
        }
      }

      const parsed = parseCsv(csvText);
      const mapping = createAutomaticDataMapping(dataset, parsed.headers);
      if (isProductPackage && packageFiles) {
        const imageColumn = mapping.image;
        if (imageColumn === undefined) throw new Error('The product package CSV is missing its Image URL column.');
        const packageEntries = new Map(
          Object.entries(packageFiles).map(([name, bytes]) => [name.replace(/\\/g, '/').replace(/^\.\//, ''), bytes])
        );
        for (const row of parsed.rows) {
          const imagePath = String(row[Number(imageColumn)] ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
          if (!imagePath || !imagePath.toLocaleLowerCase().startsWith('images/')) continue;
          if (imagePath.split('/').includes('..')) throw new Error('The product package contains an unsafe image path.');
          const imageBytes = packageEntries.get(imagePath);
          if (!imageBytes) throw new Error(`The product package is missing ${imagePath}.`);
          if (imageBytes.length === 0 || imageBytes.length > MAX_PACKAGED_IMAGE_SIZE) {
            throw new Error(`${imagePath} is empty or larger than 8 MB.`);
          }
          const mimeType = imageMimeType(imagePath);
          if (!mimeType) throw new Error(`${imagePath} is not a supported image type.`);
          row[Number(imageColumn)] = bytesToDataUrl(imageBytes, mimeType);
        }
      }
      setSession({
        dataset,
        fileName: file.name,
        headers: parsed.headers,
        rows: parsed.rows,
        mapping,
        appGenerated: isMamePilotDataExport(dataset, importFileName, parsed.headers),
        dependencies,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The CSV file could not be read.');
    }
  };

  const updateMapping = (fieldKey: string, columnIndex: string) => {
    setSession((current) => {
      if (!current) return current;
      const mapping = { ...current.mapping };
      if (columnIndex === '') {
        delete mapping[fieldKey];
      } else {
        Object.keys(mapping).forEach((key) => {
          if (key !== fieldKey && mapping[key] === columnIndex) delete mapping[key];
        });
        mapping[fieldKey] = columnIndex;
      }
      return { ...current, mapping };
    });
  };

  const startImport = async () => {
    if (!session || validationErrors.length > 0) return;
    const records = session.rows.map((csvRow, rowIndex) => {
      const record: Record<string, string> = {};
      session.dataset.fields.forEach((field) => {
        const mappedColumn = session.mapping[field.key];
        if (mappedColumn !== undefined) {
          record[field.key] = csvRow[Number(mappedColumn)] ?? '';
        }
      });
      record._csvRow = String(rowIndex + 2);
      return record;
    });

    let batches: Array<Array<Record<string, string>>>;
    try {
      const isPackagedProductImport = session.dataset.key === 'products' && session.fileName.toLocaleLowerCase().endsWith('.zip');
      batches = isPackagedProductImport
        ? createProductPackageBatches(records)
        : createDataImportBatches(session.dataset.key, records, IMPORT_BATCH_SIZE);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The CSV could not be divided into safe import batches.');
      return;
    }

    setIsImporting(true);
    setImportProgress(0);
    const aggregate: ImportSummary = {
      datasetLabel: session.dataset.label,
      fileName: session.fileName,
      processed: 0,
      created: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    try {
      let completedRows = 0;
      const totalRows = records.length + session.dependencies.reduce((sum, dependency) => sum + dependency.records.length, 0);
      for (const dependency of session.dependencies) {
        const dependencyBatches = createDataImportBatches(dependency.dataset.key, dependency.records, IMPORT_BATCH_SIZE);
        for (const batch of dependencyBatches) {
          const result = await importDataRecords(dependency.dataset.key, batch, 0);
          aggregate.processed += result.processed;
          aggregate.created += result.created;
          aggregate.skipped += result.skipped;
          aggregate.failed += result.failed;
          aggregate.errors.push(...result.errors);
          completedRows += batch.length;
          setImportProgress(Math.round((completedRows / totalRows) * 100));
        }
      }
      for (const batch of batches) {
        const result = await importDataRecords(session.dataset.key, batch, 0);
        aggregate.processed += result.processed;
        aggregate.created += result.created;
        aggregate.skipped += result.skipped;
        aggregate.failed += result.failed;
        aggregate.errors.push(...result.errors);
        completedRows += batch.length;
        setImportProgress(Math.round((completedRows / totalRows) * 100));
      }
    } catch (error) {
      aggregate.stoppedMessage = error instanceof Error ? error.message : 'The import stopped unexpectedly.';
    } finally {
      setIsImporting(false);
      setImportProgress(0);
      setSession(null);
      setSummary(aggregate);
      if (aggregate.created > 0) {
        queryClient.invalidateQueries();
      }
      if (aggregate.stoppedMessage || aggregate.failed > 0) {
        toast.warning(`${aggregate.created} added, ${aggregate.skipped} skipped, and ${aggregate.failed} rows failed${aggregate.stoppedMessage ? ' before the file finished' : ''}.`);
      } else {
        toast.success(`${aggregate.created} added and ${aggregate.skipped} existing records skipped.`);
      }
    }
  };

  if (loadingSchemas) {
    return (
      <div className="flex min-h-[380px] items-center justify-center text-sm font-semibold text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading data types...
      </div>
    );
  }

  if (schemaError) {
    return (
      <div className="rounded-xl border border-red-100 bg-red-50 p-5 text-sm font-semibold text-red-700">
        {schemaError}
      </div>
    );
  }

  return (
    <div className="space-y-7 animate-in fade-in duration-300">
      <input ref={fileInputRef} type="file" accept=".csv,.zip,text/csv,application/zip" className="hidden" onChange={handleFileSelected} />
      <input ref={settingsFileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleSettingsFileSelected} />

      <div className="border-b border-gray-100 pb-5">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-[#ebf4ff] p-3 text-[#0f2f57]">
            <Database size={22} />
          </div>
          <div>
            <h3 className="text-xl font-bold text-gray-800">Import and Export Data</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
              Download a complete CSV for a data type, or upload a CSV and map its columns before anything is saved.
              Imports only append new records: existing matches are skipped and never overwritten—no database IDs are needed.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-4 text-sm text-blue-800">
        <p className="font-bold">Start with a template, or use any CSV.</p>
        <p className="mt-1 text-xs font-medium leading-5 text-blue-700">
          Each template contains the correct columns and one realistic sample row. Templates and exported files map automatically; other CSVs open with likely matches preselected.
          Orders, bills, and transactions export with their accounts in one ZIP package and restore those accounts automatically.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="flex flex-col rounded-2xl border border-[#cfe0f2] bg-[#f8fbff] p-5 transition-shadow hover:shadow-sm">
          <div className="flex items-start gap-3">
            <div className="rounded-xl border border-blue-100 bg-white p-2.5 text-[#0f2f57]">
              <Database size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="font-black text-gray-900">Settings</h4>
              <p className="mt-1 text-xs font-medium leading-5 text-gray-500">
                Transfer selected Settings tabs in one secure JSON file. List items are appended; existing categories, methods, units, roles, and stores stay unchanged.
              </p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" icon={<Download size={16} />} onClick={openSettingsExport}>
              Export Settings
            </Button>
            <Button type="button" variant="primary" size="sm" icon={<Upload size={16} />} onClick={openSettingsImportPicker}>
              Import Settings
            </Button>
          </div>
        </section>
        {datasets.map((dataset) => (
          <section key={dataset.key} className="flex flex-col rounded-2xl border border-gray-100 bg-gray-50/50 p-5 transition-shadow hover:shadow-sm">
            <div className="flex items-start gap-3">
              <div className="rounded-xl border border-gray-100 bg-white p-2.5 text-gray-500">
                <FileSpreadsheet size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="font-black text-gray-900">{dataset.label}</h4>
                <p className="mt-1 text-xs font-medium leading-5 text-gray-500">{dataset.description}</p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                icon={<FileDown size={16} />}
                disabled={Boolean(exportingKey)}
                onClick={() => handleTemplateDownload(dataset)}
              >
                Download Template
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                icon={<Download size={16} />}
                loading={exportingKey === dataset.key}
                disabled={Boolean(exportingKey)}
                onClick={() => handleExport(dataset)}
              >
                {dataset.key === 'products' || FINANCIAL_DATASET_KEYS.has(dataset.key) ? 'Export Package' : 'Export CSV'}
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                icon={<Upload size={16} />}
                disabled={Boolean(exportingKey)}
                onClick={() => openFilePicker(dataset)}
              >
                {dataset.key === 'products' || FINANCIAL_DATASET_KEYS.has(dataset.key) ? 'Import CSV / Package' : 'Import CSV'}
              </Button>
            </div>
          </section>
        ))}
      </div>

      <Modal
        isOpen={Boolean(settingsSession)}
        onClose={() => {
          if (!settingsBusy) setSettingsSession(null);
        }}
        title={settingsSession?.mode === 'import' ? 'Choose Settings tabs to import' : 'Choose Settings tabs to export'}
        size="lg"
        footer={settingsSession ? (
          <>
            <Button type="button" variant="outline" onClick={() => setSettingsSession(null)} disabled={settingsBusy}>Cancel</Button>
            <Button
              type="button"
              onClick={runSettingsTransfer}
              loading={settingsBusy}
              disabled={settingsSession.selectedTabs.length === 0}
            >
              {settingsSession.mode === 'import' ? 'Import selected tabs' : 'Export selected tabs'}
            </Button>
          </>
        ) : undefined}
      >
        {settingsSession && (
          <div className="space-y-5">
            {settingsSession.fileName && (
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-bold text-gray-700">
                {settingsSession.fileName}
              </div>
            )}
            <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 text-xs font-semibold leading-5 text-amber-800">
              Settings exports can contain private provider tokens, webhook secrets, and passwords. Store the file securely and only import files you trust.
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-black uppercase tracking-widest text-gray-500">
                {settingsSession.selectedTabs.length} selected
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="text-xs font-bold text-[#0f2f57] hover:underline"
                  onClick={() => setSettingsSession((current) => current ? {
                    ...current,
                    selectedTabs: settingsTabs
                      .filter((tab) => current.mode === 'export' || current.settingsPackage?.tabs[tab.key])
                      .map((tab) => tab.key),
                  } : current)}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="text-xs font-bold text-gray-500 hover:underline"
                  onClick={() => setSettingsSession((current) => current ? { ...current, selectedTabs: [] } : current)}
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {settingsTabs
                .filter((tab) => settingsSession.mode === 'export' || settingsSession.settingsPackage?.tabs[tab.key])
                .map((tab) => {
                  const checked = settingsSession.selectedTabs.includes(tab.key);
                  return (
                    <label
                      key={tab.key}
                      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${checked ? 'border-[#c7dff5] bg-[#f8fbff]' : 'border-gray-100 bg-gray-50'}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSettingsTab(tab.key)}
                        disabled={settingsBusy}
                        className="mt-1 h-4 w-4 rounded border-gray-300 text-[#0f2f57] focus:ring-[#3c5a82]"
                      />
                      <span>
                        <span className="block text-sm font-black text-gray-900">{tab.label}</span>
                        <span className="mt-1 block text-xs font-medium leading-5 text-gray-500">{tab.description}</span>
                      </span>
                    </label>
                  );
                })}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={Boolean(session)}
        onClose={() => {
          if (!isImporting) setSession(null);
        }}
        title={session ? `Map columns for ${session.dataset.label}` : 'Map CSV columns'}
        size="xl"
        contentClassName="max-h-[68vh]"
        footer={session ? (
          <>
            <Button type="button" variant="outline" onClick={() => setSession(null)} disabled={isImporting}>Cancel</Button>
            <Button type="button" onClick={startImport} loading={isImporting} disabled={validationErrors.length > 0}>
              {isImporting ? `Importing ${importProgress}%` : `Import ${session.rows.length} rows`}
            </Button>
          </>
        ) : undefined}
      >
        {session && (
          <div className="space-y-6">
            <div className="flex flex-col gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-gray-900">{session.fileName}</p>
                <p className="mt-1 text-xs font-semibold text-gray-500">{session.rows.length} data rows · {session.headers.length} source columns</p>
              </div>
              {session.appGenerated ? (
                <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-700">
                  <CheckCircle2 size={13} /> MamePilot columns detected
                </span>
              ) : (
                <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-blue-100 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-blue-700">
                  {mappedFields.length} columns matched
                </span>
              )}
            </div>

            {session.dependencies.length > 0 && (
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-xs font-semibold leading-5 text-blue-800">
                This package includes {session.dependencies.reduce((sum, dependency) => sum + dependency.records.length, 0)} account records.
                They will be imported automatically before {session.dataset.label.toLocaleLowerCase()}; existing accounts will remain unchanged.
              </div>
            )}

            {validationErrors.length > 0 && (
              <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 text-xs font-semibold text-amber-800">
                <div className="flex items-center gap-2 font-black"><AlertTriangle size={16} /> Complete the required mappings</div>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {validationErrors.map((error) => <li key={error}>{error}</li>)}
                </ul>
              </div>
            )}

            <div className="overflow-hidden rounded-xl border border-gray-100">
              <div className="grid grid-cols-[minmax(180px,0.9fr)_minmax(220px,1.1fr)] gap-3 bg-gray-50 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-gray-400">
                <span>Required app field</span>
                <span>Column from your CSV</span>
              </div>
              <div className="divide-y divide-gray-100">
                {session.dataset.fields.map((field) => {
                  const mappedIndex = session.mapping[field.key];
                  const sample = mappedIndex === undefined
                    ? ''
                    : session.rows.find((row) => (row[Number(mappedIndex)] || '').trim() !== '')?.[Number(mappedIndex)] || '';
                  return (
                    <div key={field.key} className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[minmax(180px,0.9fr)_minmax(220px,1.1fr)] sm:items-center sm:gap-3">
                      <div>
                        <span className="text-sm font-bold text-gray-800">{field.label}</span>
                        {(field.required || field.requiredGroup) && (
                          <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-red-600">
                            {field.required ? 'Required' : 'Relationship'}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <select
                          value={mappedIndex ?? ''}
                          onChange={(event) => updateMapping(field.key, event.target.value)}
                          disabled={isImporting}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 outline-none focus:border-[#0f2f57]"
                        >
                          <option value="">Do not import this field</option>
                          {session.headers.map((header, index) => (
                            <option key={`${header}-${index}`} value={String(index)}>{header}</option>
                          ))}
                        </select>
                        {sample && <p className="mt-1 truncate text-[10px] font-medium text-gray-400" title={sample}>Example: {sample}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {mappedFields.length > 0 && (
              <div>
                <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Mapped preview</p>
                <div className="overflow-x-auto rounded-xl border border-gray-100">
                  <table className="min-w-full text-left text-xs">
                    <thead className="bg-gray-50 text-gray-500">
                      <tr>{mappedFields.slice(0, 6).map((field) => <th key={field.key} className="whitespace-nowrap px-3 py-2 font-black">{field.label}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {session.rows.slice(0, 3).map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {mappedFields.slice(0, 6).map((field) => (
                            <td key={field.key} className="max-w-[220px] truncate px-3 py-2 font-medium text-gray-600">
                              {row[Number(session.mapping[field.key])] || <span className="text-gray-300">Empty</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        isOpen={Boolean(summary)}
        onClose={() => setSummary(null)}
        title="Import result"
        size="lg"
        footer={<Button type="button" onClick={() => setSummary(null)}>Done</Button>}
      >
        {summary && (
          <div className="space-y-5">
            <div className={`rounded-xl border p-4 ${summary.failed === 0 && !summary.stoppedMessage ? 'border-emerald-100 bg-emerald-50' : 'border-amber-100 bg-amber-50'}`}>
              <div className="flex items-center gap-2">
                {summary.failed === 0 && !summary.stoppedMessage
                  ? <CheckCircle2 className="text-emerald-600" size={20} />
                  : <AlertTriangle className="text-amber-600" size={20} />}
                <p className="font-black text-gray-900">{summary.datasetLabel} import finished</p>
              </div>
              <p className="mt-2 break-all text-xs font-semibold text-gray-600">{summary.fileName}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Processed', summary.processed],
                ['Created', summary.created],
                ['Skipped existing', summary.skipped],
                ['Failed', summary.failed],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-center">
                  <p className="text-xl font-black text-gray-900">{value}</p>
                  <p className="mt-1 text-[9px] font-black uppercase tracking-widest text-gray-400">{label}</p>
                </div>
              ))}
            </div>
            {summary.stoppedMessage && (
              <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm font-semibold text-red-700">
                Import stopped: {summary.stoppedMessage}
              </div>
            )}
            {summary.errors.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-black uppercase tracking-widest text-gray-500">Rows that need attention</p>
                <div className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-gray-100 p-3">
                  {summary.errors.map((error, index) => (
                    <div key={`${error.row}-${index}`} className="flex gap-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                      <span className="shrink-0 font-black">Row {error.row}</span>
                      <span className="font-semibold">{error.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default DataManagementSettingsPanel;
