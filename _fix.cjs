const fs = require('fs');

function fixPage(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  // Find the flex container opening line
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('flex flex-col') && lines[i].includes('justify-between') && lines[i].includes('gap-3')) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) {
    console.log('SKIP: No header found in ' + filePath);
    return;
  }

  // Find the flex-1 wrapper open, DynamicFilterBar, flex-1 wrapper close, button, header close
  let flex1Open = -1;
  let dfbStart = -1;
  let dfbEnd = -1;
  let flex1Close = -1;
  let headerClose = -1;
  let buttonStart = -1;
  let buttonEnd = -1;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.includes('flex-1 min-w-0') && flex1Open === -1) flex1Open = i;
    if (t === '<DynamicFilterBar' && dfbStart === -1) dfbStart = i;
    if (t === '</div>' && flex1Open >= 0 && flex1Close === -1 && dfbEnd >= 0 && i > dfbEnd) {
      flex1Close = i;
    }
    if (t === '/>' && dfbStart >= 0 && dfbEnd === -1 && i > dfbStart) dfbEnd = i;
  }

  // Button is between flex1Close and headerClose
  if (flex1Close >= 0) {
    buttonStart = flex1Close + 1;
    for (let i = buttonStart; i < lines.length; i++) {
      if (lines[i].trim() === '</div>') {
        buttonEnd = i - 1;
        headerClose = i;
        break;
      }
    }
  }

  if (headerIdx === -1 || dfbEnd === -1 || headerClose === -1) {
    console.log('ERROR: Could not parse structure in ' + filePath);
    return;
  }

  // Collect button lines
  const btnLines = [];
  for (let i = buttonStart; i <= buttonEnd; i++) {
    if (lines[i].trim() === '') continue;
    btnLines.push(lines[i]);
  }

  // Collect DynamicFilterBar lines
  const dfbLines = [];
  for (let i = dfbStart; i <= dfbEnd; i++) {
    dfbLines.push(lines[i]);
  }

  // Build new structure
  const newLines = [];

  // Before header
  for (let i = 0; i < headerIdx; i++) newLines.push(lines[i]);

  // New header opening with items-stretch
  const origLine = lines[headerIdx];
  const newHeaderLine = origLine
    .replace('lg:items-center', 'sm:items-stretch')
    .replace('sm:items-center', 'sm:items-stretch')
    .replace('gap-3 lg:flex-row', 'gap-3 sm:flex-row')
    .replace('lg:justify-between', 'sm:justify-between')
    .replace('gap-3 sm:gap-4', 'gap-3 sm:gap-4');
  newLines.push(newHeaderLine);

  // Button FIRST (above on mobile)
  for (const bl of btnLines) {
    newLines.push(bl);
  }

  // DynamicFilterBar wrapper
  newLines.push(lines[flex1Open]); // <div className="flex-1 min-w-0">
  for (const dl of dfbLines) {
    newLines.push('  ' + dl); // extra indent
  }
  newLines.push(lines[flex1Close]); // </div>

  // Header close
  newLines.push(lines[headerClose]);

  // Rest of file
  for (let i = headerClose + 1; i < lines.length; i++) {
    newLines.push(lines[i]);
  }

  content = newLines.join('\n');
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Fixed: ' + filePath);
}

fixPage('G:/Projects/React/MamePilot/pages/Users.tsx');
fixPage('G:/Projects/React/MamePilot/pages/Vendors.tsx');
fixPage('G:/Projects/React/MamePilot/pages/Customers.tsx');
fixPage('G:/Projects/React/MamePilot/pages/Products.tsx');
