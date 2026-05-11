import { readFileSync } from 'fs';
import vm from 'vm';

function extractFunction(code, functionName) {
  const start = code.indexOf(`function ${functionName}`);
  if (start < 0) throw new Error(`${functionName} not found`);
  let brace = code.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < code.length; i++) {
    if (code[i] === '{') depth++;
    if (code[i] === '}') depth--;
    if (depth === 0) return code.slice(start, i + 1);
  }
  throw new Error(`${functionName} body not closed`);
}

const html = readFileSync('bulk-upload.html', 'utf8');
const xlsxBundle = readFileSync('assets/vendor/xlsx.full.min.js', 'utf8');
const workbookBytes = readFileSync('/home/ubuntu/upload/Test1.xlsx');

const sandbox = {
  console,
  Uint8Array,
  ArrayBuffer,
  Buffer,
  window: {},
};
vm.createContext(sandbox);
vm.runInContext(`${xlsxBundle}; window.XLSX = XLSX; this.XLSX = XLSX;`, sandbox, { timeout: 5000 });

const functions = [
  'normaliseColumnKey',
  'addNormalisedColumnLookup',
  'workbookRowsLookProcessable',
  'extractWorkbookRows',
  'parsePropertyData',
].map(name => extractFunction(html, name)).join('\n');

vm.runInContext(`${functions}; this.extractWorkbookRows = extractWorkbookRows; this.parsePropertyData = parsePropertyData;`, sandbox);
const workbook = sandbox.XLSX.read(new Uint8Array(workbookBytes), { type: 'array', cellDates: false });
const rows = sandbox.extractWorkbookRows(workbook);
const result = sandbox.parsePropertyData(rows);

if (!rows.length) {
  throw new Error('No rows were extracted from Test1.xlsx');
}
if (result.properties.length !== 2) {
  throw new Error(`Expected 2 properties from Test1.xlsx, got ${result.properties.length}: ${JSON.stringify(result)}`);
}
if (result.report.skippedCount !== 0) {
  throw new Error(`Expected no skipped rows from Test1.xlsx, got ${JSON.stringify(result.report)}`);
}
if (result.report.processedTenants < 2) {
  throw new Error(`Expected at least 2 tenants from Test1.xlsx, got ${JSON.stringify(result.report)}`);
}
console.log(JSON.stringify({
  ok: true,
  workbookSheets: workbook.SheetNames,
  extractedRows: rows.length,
  properties: result.properties.length,
  processedTenants: result.report.processedTenants,
  skippedCount: result.report.skippedCount,
}, null, 2));
