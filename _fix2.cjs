const fs = require('fs');

function fixPage(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  // Find the header flex container and DynamicFilterBar
  let headerIdx = -1;
  let dfbIdx = -1;
  let dfbEndIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('<div') && t.includes('flex flex-col') && t.includes('justify-between') && headerIdx === -1) {
      headerIdx = i;
    }
    if (t === '<DynamicFilterBar' && dfbIdx === -1) {
      dfbIdx = i;
    }
  }

  if (headerIdx === -1 || dfbIdx === -1) {
    console.log('SKIP: ' + filePath);
    return;
  }

  // Find DynamicFilterBar closing />
  for (let i = dfbIdx; i < lines.length; i++) {
    if (lines[i].trim() === '/>') {
      dfbEndIdx = i;
      break;
    }
  }

  // Find header closing </div> - look for </div> right before <DynamicFilterBar or between header and dfb
  let headerCloseIdx = -1;
  // Also find the empty <div /> placeholder if any
  let emptyDivIdx = -1;
  
  for (let i = headerIdx + 1; i < dfbIdx; i++) {
    const t = lines[i].trim();
    if (t === '<div />') emptyDivIdx = i;
    if (t === '</div>') headerCloseIdx = i;
  }

  // Collect button lines from inside the header (between <div /> or after opening, before </div>)
  const buttonLines = [];
  const buttonStart = emptyDivIdx >= 0 ? emptyDivIdx + 1 : headerIdx + 1;
  const buttonEnd = headerCloseIdx >= 0 ? headerCloseIdx - 1 : dfbIdx - 1;
  
  for (let i = buttonStart; i <= buttonEnd; i++) {
    const t = lines[i].trim();
    if (t === '' || t === '<div />') continue;
    buttonLines.push(t);
  }

  // Build new file
  const out = [];

  // Everything before header
  for (let i = 0; i < headerIdx; i++) out.push(lines[i]);

  // New header opening with sm:items-stretch, sm breakpoint
  out.push('      <div className="flex flex-col sm:flex-row sm:items-stretch justify-between gap-3 sm:gap-4">');

  // Button FIRST (above on mobile, right on desktop)
  if (buttonLines.length > 0) {
    for (const bl of buttonLines) {
      out.push('        ' + bl);
    }
  }

  // DynamicFilterBar wrapper
  out.push('        <div className="flex-1 min-w-0">');
  for (let i = dfbIdx; i <= dfbEndIdx; i++) {
    out.push('          ' + lines[i].trim());
  }
  out.push('        </div>');

  // Close header
  out.push('      </div>');

  // Skip old content: from after dfbEndIdx, skip blank lines and any trailing </div> from old header
  let resumeIdx = dfbEndIdx + 1;
  // Skip one blank line if present
  if (resumeIdx < lines.length && lines[resumeIdx].trim() === '') resumeIdx++;
  // Skip old header </div> if it was after dfb
  if (headerCloseIdx === -1 && resumeIdx < lines.length && lines[resumeIdx].trim() === '</div>') {
    // This might be the old header close - but only skip if there's another </div> nearby
    // Actually, let's not skip it blindly. Just resume from dfbEndIdx + 1
  }
  resumeIdx = dfbEndIdx + 1;

  for (let i = resumeIdx; i < lines.length; i++) {
    out.push(lines[i]);
  }

  fs.writeFileSync(filePath, out.join('\n'), 'utf8');
  console.log('Fixed: ' + filePath);
}

fixPage('G:/Projects/React/MamePilot/pages/Users.tsx');
fixPage('G:/Projects/React/MamePilot/pages/Vendors.tsx');
fixPage('G:/Projects/React/MamePilot/pages/Customers.tsx');
fixPage('G:/Projects/React/MamePilot/pages/Products.tsx');
fixPage('G:/Projects/React/MamePilot/pages/Banking.tsx');
