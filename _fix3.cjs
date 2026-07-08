const fs = require('fs');
const path = require('path');

function fixCustomersPage() {
  const filePath = 'G:/Projects/React/MamePilot/pages/Customers.tsx';
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Replace the header section
  const oldHeader = `      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div />
        {canCreateCustomers && (
          <Button 
            onClick={() => navigate('/customers/new')}
            variant="primary"
            size="md"
            icon={ICONS.Plus}
          >
            New Customer
          </Button>
        )}
      </div>

      <DynamicFilterBar`;

  const newHeader = `      <div className="flex flex-col sm:flex-row sm:items-stretch justify-between gap-3 sm:gap-4">
        {canCreateCustomers && (
          <Button
            onClick={() => navigate('/customers/new')}
            variant="primary"
            size="md"
            icon={ICONS.Plus}
          >
            New Customer
          </Button>
        )}
        <div className="flex-1 min-w-0">
          <DynamicFilterBar`;

  if (content.includes(oldHeader)) {
    content = content.replace(oldHeader, newHeader);
    // Find the closing /> of DynamicFilterBar and add </div> after it
    // The pattern is: ... onApply={(appliedFilters) => { ... }} \n      />
    // We need to find the first /> after the DynamicFilterBar opening
    const dfbStart = content.indexOf('<DynamicFilterBar', content.indexOf('flex-1 min-w-0'));
    let depth = 0;
    let inCallback = false;
    let closeIdx = -1;
    for (let i = dfbStart; i < content.length; i++) {
      if (content[i] === '{') { depth++; inCallback = true; }
      if (content[i] === '}') depth--;
      if (inCallback && depth === 0) {
        // Find the next />
        closeIdx = content.indexOf('/>', i);
        break;
      }
    }
    if (closeIdx >= 0) {
      const afterClose = content.indexOf('\n', closeIdx);
      content = content.substring(0, afterClose + 1) + '        </div>\n' + content.substring(afterClose + 1);
    }
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Fixed: Customers.tsx');
  } else {
    console.log('SKIP Customers.tsx - pattern not found');
  }
}

function fixUsersPage() {
  const filePath = 'G:/Projects/React/MamePilot/pages/Users.tsx';
  let content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  // Find the header flex container with the role filter bar
  let headerIdx = -1;
  let headerCloseIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('flex flex-col gap-3 lg:flex-row') && lines[i].includes('justify-between')) {
      headerIdx = i;
    }
    if (headerIdx >= 0 && lines[i].trim() === '</div>' && i > headerIdx + 5) {
      headerCloseIdx = i;
      break;
    }
  }

  if (headerIdx === -1 || headerCloseIdx === -1) {
    console.log('SKIP Users.tsx - header not found');
    return;
  }

  // Find the Button and role filter bar
  let buttonStart = -1, buttonEnd = -1;
  let filterStart = -1, filterEnd = -1;
  
  for (let i = headerIdx + 1; i < headerCloseIdx; i++) {
    const t = lines[i].trim();
    if (t.startsWith('{isAdmin') || t.startsWith('<Button')) {
      if (buttonStart === -1) buttonStart = i;
    }
    if (t === '</Button>' && buttonStart >= 0 && buttonEnd === -1) {
      buttonEnd = i;
    }
    if (t.includes('bg-white rounded-xl shadow-sm') && filterStart === -1) {
      filterStart = i;
    }
  }
  // Find the end of the filter bar (the </div> that closes it)
  if (filterStart >= 0) {
    let divDepth = 0;
    for (let i = filterStart; i < headerCloseIdx; i++) {
      if (lines[i].includes('<div')) divDepth++;
      if (lines[i].includes('</div>')) divDepth--;
      if (divDepth === 0) { filterEnd = i; break; }
    }
  }

  // Collect button lines
  const btnLines = [];
  if (buttonStart >= 0 && buttonEnd >= 0) {
    for (let i = buttonStart; i <= buttonEnd; i++) btnLines.push(lines[i].trim());
  }

  // Build new structure
  const out = [];
  for (let i = 0; i < headerIdx; i++) out.push(lines[i]);
  
  out.push('      <div className="flex flex-col sm:flex-row sm:items-stretch justify-between gap-3 sm:gap-4">');
  
  // Button first
  if (btnLines.length > 0) {
    for (const bl of btnLines) out.push('        ' + bl);
  }

  // DynamicFilterBar wrapper
  out.push('        <div className="flex-1 min-w-0">');
  out.push('          <DynamicFilterBar');
  out.push('            filterDefinitions={userFilterDefinitions}');
  out.push('            initialFilters={initialFilters}');
  out.push('            onApply={(appliedFilters) => {');
  out.push('              setPage(1);');
  out.push('              const roleFilter = appliedFilters.find((f) => f.type === \'Role\' && f.operator === \'=\');');
  out.push('              handleRoleFilterChange(roleFilter?.value ?? \'All\');');
  out.push('            }}');
  out.push('          />');
  out.push('        </div>');
  out.push('      </div>');

  // Skip old header content and find the next element after headerCloseIdx
  let resumeIdx = headerCloseIdx + 1;
  while (resumeIdx < lines.length && lines[resumeIdx].trim() === '') resumeIdx++;

  for (let i = resumeIdx; i < lines.length; i++) out.push(lines[i]);

  // Now add the filter definitions and state variables
  // Find the imports to add DynamicFilterBar import
  let importIdx = -1;
  for (let i = 0; i < out.length; i++) {
    if (out[i].includes("import { Button") && out[i].includes("from '../components'")) {
      importIdx = i;
      break;
    }
  }
  if (importIdx >= 0) {
    out.splice(importIdx + 1, 0, "import DynamicFilterBar from '../components/DynamicFilterBar';");
  }

  // Add filter definitions after the roleFilters useMemo
  let roleFiltersIdx = -1;
  for (let i = 0; i < out.length; i++) {
    if (out[i].includes('const roleFilters: RoleFilter[]')) {
      // Find the end of this useMemo
      for (let j = i; j < out.length; j++) {
        if (out[j].trim() === '];') { roleFiltersIdx = j; break; }
      }
      break;
    }
  }
  if (roleFiltersIdx >= 0) {
    const filterDefs = [
      '',
      '  const userFilterDefinitions = useMemo(() => {',
      '    return [',
      '      {',
      "        type: 'Role',",
      "        operators: ['=', 'â‰ '] as const,",
      "        values: roleFilters.filter((r) => r !== 'All'),",
      '      },',
      '    ];',
      '  }, [roleFilters]);',
      '',
      '  const initialFilters = useMemo(() => {',
      '    const filters = [];',
      "    if (roleFilter !== 'All') {",
      "      filters.push({ id: 'role', type: 'Role', operator: '=' as const, value: roleFilter });",
      '    }',
      '    return filters;',
      '  }, [roleFilter]);',
    ];
    out.splice(roleFiltersIdx + 1, 0, ...filterDefs);
  }

  content = out.join('\n');
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Fixed: Users.tsx');
}

function fixSimplePage(filePath, pageName, buttonBlock, filterDefs, stateVars, filterLogic, extraImports) {
  let content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  // Find the header
  let headerIdx = -1;
  let headerCloseIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('flex flex-col') && lines[i].includes('justify-between') && lines[i].includes('gap-4')) {
      headerIdx = i;
    }
    if (headerIdx >= 0 && lines[i].trim() === '</div>' && i > headerIdx + 1) {
      headerCloseIdx = i;
      break;
    }
  }

  if (headerIdx === -1 || headerCloseIdx === -1) {
    console.log('SKIP ' + pageName + ' - header not found');
    return;
  }

  // Build new header
  const out = [];
  for (let i = 0; i < headerIdx; i++) out.push(lines[i]);
  
  out.push('      <div className="flex flex-col sm:flex-row sm:items-stretch justify-between gap-3 sm:gap-4">');
  out.push(...buttonBlock.map(l => '        ' + l));
  out.push('        <div className="flex-1 min-w-0">');
  out.push('          <DynamicFilterBar');
  out.push('            filterDefinitions={' + pageName.toLowerCase() + 'FilterDefinitions}');
  out.push('            initialFilters={initialFilters}');
  out.push('            onApply={(appliedFilters) => {');
  out.push('              setPage(1);');
  out.push(...filterLogic.map(l => '              ' + l));
  out.push('            }}');
  out.push('          />');
  out.push('        </div>');
  out.push('      </div>');

  // Skip old header
  let resumeIdx = headerCloseIdx + 1;
  while (resumeIdx < lines.length && lines[resumeIdx].trim() === '') resumeIdx++;
  for (let i = resumeIdx; i < lines.length; i++) out.push(lines[i]);

  // Add DynamicFilterBar import
  let importIdx = -1;
  for (let i = 0; i < out.length; i++) {
    if (out[i].includes("from '../components'") && out[i].includes('import')) {
      importIdx = i;
      break;
    }
  }
  if (importIdx >= 0) {
    out.splice(importIdx + 1, 0, "import DynamicFilterBar from '../components/DynamicFilterBar';");
  }

  // Add state variables and filter definitions after the last useState
  let lastStateIdx = -1;
  for (let i = 0; i < out.length; i++) {
    if (out[i].includes('useState<') && i > 20) lastStateIdx = i;
  }
  if (lastStateIdx >= 0) {
    // Find the end of the line
    out.splice(lastStateIdx + 1, 0, ...stateVars);
  }

  // Add filter definitions before the return statement
  let returnIdx = -1;
  for (let i = 0; i < out.length; i++) {
    if (out[i].trim().startsWith('return (') && i > 30) {
      returnIdx = i;
      break;
    }
  }
  if (returnIdx >= 0) {
    out.splice(returnIdx, 0, ...filterDefs, '');
  }

  content = out.join('\n');
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Fixed: ' + pageName);
}

// Fix Customers.tsx
fixCustomersPage();

// Fix Users.tsx
fixUsersPage();

// Fix Vendors.tsx
fixSimplePage(
  'G:/Projects/React/MamePilot/pages/Vendors.tsx',
  'vendor',
  [
    '<Button',
    '  onClick={() => navigate(\'/vendors/new\')}',
    '  variant="primary"',
    '  size="md"',
    '  icon={ICONS.Plus}',
    '>',
    '  New Vendor',
    '</Button>',
  ],
  [
    '  const vendorFilterDefinitions = useMemo(() => {',
    '    return [',
    '      {',
    "        type: 'Name',",
    "        operators: ['=', 'contains'] as const,",
    '        allowCustomValue: true,',
    '      },',
    '      {',
    "        type: 'Phone',",
    "        operators: ['=', 'contains'] as const,",
    '        allowCustomValue: true,',
    '      },',
    '    ];',
    '  }, []);',
    '',
    '  const initialFilters = useMemo(() => [], []);',
  ],
  [
    "  const [nameFilter, setNameFilter] = useState<string>('');",
    "  const [phoneFilter, setPhoneFilter] = useState<string>('');",
  ],
  [
    "const nameFilter = appliedFilters.find((f) => f.type === 'Name' && f.operator === '=');",
    "const nameContainsFilter = appliedFilters.find((f) => f.type === 'Name' && f.operator === 'contains');",
    "setNameFilter(nameFilter?.value ?? nameContainsFilter?.value ?? '');",
    "",
    "const phoneFilter = appliedFilters.find((f) => f.type === 'Phone' && f.operator === '=');",
    "const phoneContainsFilter = appliedFilters.find((f) => f.type === 'Phone' && f.operator === 'contains');",
    "setPhoneFilter(phoneFilter?.value ?? phoneContainsFilter?.value ?? '');",
  ]
);

// Fix Products.tsx
fixSimplePage(
  'G:/Projects/React/MamePilot/pages/Products.tsx',
  'product',
  [
    '{canCreateProducts && (',
    '  <Button',
    '    onClick={() => navigate(\'/products/new\')}',
    '    variant="primary"',
    '    size="md"',
    '    icon={ICONS.Plus}',
    '  >',
    '    Add Product',
    '  </Button>',
    ')}',
  ],
  [
    '  const productFilterDefinitions = useMemo(() => {',
    '    return [',
    '      {',
    "        type: 'Name',",
    "        operators: ['=', 'contains'] as const,",
    '        allowCustomValue: true,',
    '      },',
    '      {',
    "        type: 'Category',",
    "        operators: ['=', '!='] as const,",
    '        allowCustomValue: true,',
    '      },',
    '    ];',
    '  }, []);',
    '',
    '  const initialFilters = useMemo(() => [], []);',
  ],
  [
    "  const [nameFilter, setNameFilter] = useState<string>('');",
    "  const [categoryFilter, setCategoryFilter] = useState<string>('');",
  ],
  [
    "const nameFilter = appliedFilters.find((f) => f.type === 'Name' && f.operator === '=');",
    "const nameContainsFilter = appliedFilters.find((f) => f.type === 'Name' && f.operator === 'contains');",
    "setNameFilter(nameFilter?.value ?? nameContainsFilter?.value ?? '');",
    "",
    "const categoryFilter = appliedFilters.find((f) => f.type === 'Category' && f.operator === '=');",
    "setCategoryFilter(categoryFilter?.value ?? '');",
  ]
);

// Fix Banking.tsx
fixSimplePage(
  'G:/Projects/React/MamePilot/pages/Banking.tsx',
  'account',
  [
    '<Button',
    '  onClick={() => setShowAddModal(true)}',
    '  variant="primary"',
    '  size="md"',
    '  icon={ICONS.Plus}',
    '  disabled={createAccountMutation.isPending}',
    '>',
    '  Add Account',
    '</Button>',
  ],
  [
    '  const accountFilterDefinitions = useMemo(() => {',
    '    return [',
    '      {',
    "        type: 'Type',",
    "        operators: ['=', '!='] as const,",
    "        values: ['Bank', 'Cash'],",
    '      },',
    '      {',
    "        type: 'Name',",
    "        operators: ['=', 'contains'] as const,",
    '        allowCustomValue: true,',
    '      },',
    '    ];',
    '  }, []);',
    '',
    '  const initialFilters = useMemo(() => [], []);',
  ],
  [
    "  const [typeFilter, setTypeFilter] = useState<string>('');",
    "  const [nameFilter, setNameFilter] = useState<string>('');",
  ],
  [
    "const typeFilter = appliedFilters.find((f) => f.type === 'Type' && f.operator === '=');",
    "setTypeFilter(typeFilter?.value ?? '');",
    "",
    "const nameFilter = appliedFilters.find((f) => f.type === 'Name' && f.operator === '=');",
    "const nameContainsFilter = appliedFilters.find((f) => f.type === 'Name' && f.operator === 'contains');",
    "setNameFilter(nameFilter?.value ?? nameContainsFilter?.value ?? '');",
  ]
);
