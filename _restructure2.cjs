const fs = require('fs');

function restructure(filePath, config) {
  let content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  // Find the header flex container
  let headerStartIdx = -1;
  let headerCloseIdx = -1;
  let dfbIdx = -1;
  let dfbEndIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('<div') && t.includes('flex flex-col') && t.includes('justify-between')) {
      // Check if it has <div /> or is empty enough
      headerStartIdx = i;
    }
    if (headerStartIdx >= 0 && headerCloseIdx === -1 && t === '</div>' && i > headerStartIdx + 1) {
      // This could be the header close - check if DynamicFilterBar follows
      let nextNonEmpty = i + 1;
      while (nextNonEmpty < lines.length && lines[nextNonEmpty].trim() === '') nextNonEmpty++;
      if (nextNonEmpty < lines.length && lines[nextNonEmpty].trim().startsWith('<DynamicFilterBar')) {
        headerCloseIdx = i;
      }
    }
    if (t === '<DynamicFilterBar' && dfbIdx === -1) {
      dfbIdx = i;
    }
  }

  if (dfbIdx === -1) {
    console.log('ERROR: No DynamicFilterBar found in ' + filePath);
    return false;
  }

  // Find DynamicFilterBar closing />
  for (let i = dfbIdx; i < lines.length; i++) {
    if (lines[i].trim() === '/>') {
      dfbEndIdx = i;
      break;
    }
  }

  if (dfbEndIdx === -1) {
    console.log('ERROR: Cannot find DynamicFilterBar close in ' + filePath);
    return false;
  }

  // Collect the button block from the old header
  const buttonLines = [];
  if (headerStartIdx >= 0) {
    for (let i = headerStartIdx + 1; i < (headerCloseIdx || dfbIdx); i++) {
      const t = lines[i].trim();
      if (t === '<div />' || t === '') continue;
      if (t === '</div>') continue;
      buttonLines.push(lines[i]);
    }
  }

  // Build the new structure
  const newLines = [];
  
  // Everything before the header
  if (headerStartIdx >= 0) {
    for (let i = 0; i < headerStartIdx; i++) newLines.push(lines[i]);
  } else {
    // Find the line before DynamicFilterBar (skip blanks)
    let beforeDfb = dfbIdx - 1;
    while (beforeDfb >= 0 && lines[beforeDfb].trim() === '') beforeDfb--;
    for (let i = 0; i <= beforeDfb; i++) newLines.push(lines[i]);
  }

  // New flex container opening
  newLines.push('      <div className="flex flex-col sm:flex-row sm:items-stretch justify-between gap-3 sm:gap-4">');
  
  // Button first (above on mobile, right on desktop)
  if (buttonLines.length > 0) {
    // Adjust indent to 8 spaces
    for (const bl of buttonLines) {
      const trimmed = bl.trimStart();
      newLines.push('        ' + trimmed);
    }
  }

  // DynamicFilterBar wrapper
  newLines.push('        <div className="flex-1 min-w-0">');
  for (let i = dfbIdx; i <= dfbEndIdx; i++) {
    newLines.push('          ' + lines[i].trim());
  }
  newLines.push('        </div>');

  // Close flex container
  newLines.push('      </div>');

  // Skip everything from after header close (or after dfb) to dfbEndIdx + trailing blanks/close
  let resumeIdx = dfbEndIdx + 1;
  // Skip trailing blank lines and old closing </div> if it was after dfb
  while (resumeIdx < lines.length && (lines[resumeIdx].trim() === '' || lines[resumeIdx].trim() === '</div>')) {
    // Only skip </div> if it was the old header close that we already handled
    if (lines[resumeIdx].trim() === '</div>' && headerCloseIdx >= 0 && resumeIdx > dfbEndIdx) break;
    resumeIdx++;
  }

  // Actually, just resume from dfbEndIdx + 1, skip one blank line
  resumeIdx = dfbEndIdx + 1;
  if (resumeIdx < lines.length && lines[resumeIdx].trim() === '') resumeIdx++;

  for (let i = resumeIdx; i < lines.length; i++) {
    newLines.push(lines[i]);
  }

  content = newLines.join('\n');
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Updated: ' + filePath);
  return true;
}

// Users.tsx
restructure('G:/Projects/React/MamePilot/pages/Users.tsx', {
  button: `        {isAdmin && (
          <Button
            onClick={() => navigate('/users/new')}
            variant="primary"
            size="md"
            icon={ICONS.Plus}
          >
            Add User
          </Button>
        )}`
});

// Vendors.tsx
restructure('G:/Projects/React/MamePilot/pages/Vendors.tsx', {
  button: `        <Button
          onClick={() => navigate('/vendors/new')}
          variant="primary"
          size="md"
          icon={ICONS.Plus}
        >
          New Vendor
        </Button>`
});

// Customers.tsx
restructure('G:/Projects/React/MamePilot/pages/Customers.tsx', {
  button: `        {canCreateCustomers && (
          <Button
            onClick={() => navigate('/customers/new')}
            variant="primary"
            size="md"
            icon={ICONS.Plus}
          >
            New Customer
          </Button>
        )}`
});

// Products.tsx
restructure('G:/Projects/React/MamePilot/pages/Products.tsx', {
  button: `        {canCreateProducts && (
          <Button
            onClick={() => navigate('/products/new')}
            variant="primary"
            size="md"
            icon={ICONS.Plus}
          >
            Add Product
          </Button>
        )}`
});

// Banking.tsx
restructure('G:/Projects/React/MamePilot/pages/Banking.tsx', {
  button: `        <Button
          onClick={() => setShowAddModal(true)}
          variant="primary"
          size="md"
          icon={ICONS.Plus}
          disabled={createAccountMutation.isPending}
        >
          Add Account
        </Button>`
});
