const fs = require('fs');
const filePath = 'G:/Projects/React/MamePilot/pages/Customers.tsx';
let content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');
let headerIdx = -1;
let dfbIdx = -1;
let dfbEndIdx = -1;

for (let i = 0; i < lines.length; i++) {
  const t = lines[i].trim();
  if (t.includes('flex flex-col sm:flex-row') && t.includes('justify-between') && headerIdx === -1) headerIdx = i;
  if (t === '<DynamicFilterBar' && dfbIdx === -1) dfbIdx = i;
}

for (let i = dfbIdx; i < lines.length; i++) {
  if (lines[i].trim() === '/>') { dfbEndIdx = i; break; }
}

let headerCloseIdx = -1;
for (let i = headerIdx + 1; i < dfbIdx; i++) {
  if (lines[i].trim() === '</div>') headerCloseIdx = i;
}

const btnLines = [];
for (let i = headerCloseIdx + 1; i < dfbIdx; i++) {
  if (lines[i].trim() === '' || lines[i].trim() === '<div />') continue;
  btnLines.push(lines[i].trim());
}

const out = [];
for (let i = 0; i < headerIdx; i++) out.push(lines[i]);

out.push('      <div className="flex flex-col sm:flex-row sm:items-stretch justify-between gap-3 sm:gap-4">');
for (const bl of btnLines) out.push('        ' + bl);
out.push('        <div className="flex-1 min-w-0">');
for (let i = dfbIdx; i <= dfbEndIdx; i++) out.push('          ' + lines[i].trim());
out.push('        </div>');
out.push('      </div>');

let resumeIdx = dfbEndIdx + 1;
if (resumeIdx < lines.length && lines[resumeIdx].trim() === '') resumeIdx++;
for (let i = resumeIdx; i < lines.length; i++) out.push(lines[i]);

fs.writeFileSync(filePath, out.join('\n'), 'utf8');
console.log('Fixed: Customers.tsx');
