type SpreadsheetRecord = Record<string, string>;

interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const textDecoder = new TextDecoder('utf-8');

function readUint16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (
      bytes[offset] === 0x50 &&
      bytes[offset + 1] === 0x4b &&
      bytes[offset + 2] === 0x05 &&
      bytes[offset + 3] === 0x06
    ) {
      return offset;
    }
  }
  throw new Error('This Excel file is not a readable XLSX workbook.');
}

function readZipEntries(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEndOfCentralDirectory(bytes);
  const entryCount = readUint16(view, endOffset + 10);
  const centralDirectoryOffset = readUint32(view, endOffset + 16);
  const entries = new Map<string, ZipEntry>();
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (readUint32(view, offset) !== 0x02014b50) break;
    const compressionMethod = readUint16(view, offset + 10);
    const compressedSize = readUint32(view, offset + 20);
    const uncompressedSize = readUint32(view, offset + 24);
    const fileNameLength = readUint16(view, offset + 28);
    const extraLength = readUint16(view, offset + 30);
    const commentLength = readUint16(view, offset + 32);
    const localHeaderOffset = readUint32(view, offset + 42);
    const name = textDecoder.decode(bytes.slice(offset + 46, offset + 46 + fileNameLength));

    entries.set(name, {
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Excel imports are not supported by this browser version. Please update the app or browser and try again.');
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = entry.localHeaderOffset;
  if (readUint32(view, offset) !== 0x04034b50) throw new Error(`Could not read ${entry.name} from this workbook.`);

  const fileNameLength = readUint16(view, offset + 26);
  const extraLength = readUint16(view, offset + 28);
  const dataOffset = offset + 30 + fileNameLength + extraLength;
  const compressed = bytes.slice(dataOffset, dataOffset + entry.compressedSize);

  if (entry.compressionMethod === 0) return compressed;
  if (entry.compressionMethod === 8) return inflateRaw(compressed);
  throw new Error('This XLSX workbook uses an unsupported compression format.');
}

function xmlDocument(xml: string): Document {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('Inkbound could not read the worksheet data in this Excel file.');
  return document;
}

function decodeXmlText(node: Element | null): string {
  return node?.textContent?.trim() ?? '';
}

function parseSharedStrings(xml: string): string[] {
  const document = xmlDocument(xml);
  return Array.from(document.getElementsByTagName('si')).map((item) =>
    Array.from(item.getElementsByTagName('t')).map((text) => text.textContent ?? '').join(''),
  );
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? 'A';
  let result = 0;
  for (const letter of letters) result = result * 26 + (letter.charCodeAt(0) - 64);
  return result - 1;
}

function worksheetRows(xml: string, sharedStrings: string[]): string[][] {
  const document = xmlDocument(xml);
  return Array.from(document.getElementsByTagName('row')).map((row) => {
    const values: string[] = [];
    for (const cell of Array.from(row.getElementsByTagName('c'))) {
      const reference = cell.getAttribute('r') ?? 'A1';
      const type = cell.getAttribute('t') ?? '';
      const targetIndex = columnIndex(reference);
      let value = '';

      if (type === 'inlineStr') {
        value = Array.from(cell.getElementsByTagName('t')).map((text) => text.textContent ?? '').join('');
      } else {
        const raw = decodeXmlText(cell.getElementsByTagName('v')[0] ?? null);
        if (type === 's') value = sharedStrings[Number(raw)] ?? '';
        else if (type === 'b') value = raw === '1' ? 'true' : 'false';
        else value = raw;
      }

      values[targetIndex] = value.trim();
    }
    return values;
  });
}

function rowsToRecords(rows: string[][]): SpreadsheetRecord[] {
  const meaningfulRows = rows.filter((row) => row.some((cell) => String(cell ?? '').trim()));
  if (meaningfulRows.length < 2) return [];

  const headers = meaningfulRows[0].map((header, index) => String(header ?? '').trim() || `Column ${index + 1}`);
  return meaningfulRows.slice(1).map((row) =>
    headers.reduce<SpreadsheetRecord>((record, header, index) => {
      record[header] = String(row[index] ?? '').trim();
      return record;
    }, {}),
  );
}

function firstWorksheetPath(workbookXml: string, relationshipsXml: string): string {
  const workbook = xmlDocument(workbookXml);
  const firstSheet = workbook.getElementsByTagName('sheet')[0];
  const relationshipId = firstSheet?.getAttribute('r:id') ?? firstSheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  if (!relationshipId) return 'xl/worksheets/sheet1.xml';

  const relationships = xmlDocument(relationshipsXml);
  const relationship = Array.from(relationships.getElementsByTagName('Relationship')).find((item) => item.getAttribute('Id') === relationshipId);
  const target = relationship?.getAttribute('Target');
  if (!target) return 'xl/worksheets/sheet1.xml';
  if (target.startsWith('/')) return target.slice(1);
  return target.startsWith('xl/') ? target : `xl/${target.replace(/^\.\//, '')}`;
}

export async function readXlsxRecords(file: File): Promise<SpreadsheetRecord[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = readZipEntries(bytes);
  const workbookEntry = entries.get('xl/workbook.xml');
  const relationshipsEntry = entries.get('xl/_rels/workbook.xml.rels');
  if (!workbookEntry || !relationshipsEntry) throw new Error('Inkbound could not find a worksheet in this Excel file.');

  const workbookXml = textDecoder.decode(await readZipEntry(bytes, workbookEntry));
  const relationshipsXml = textDecoder.decode(await readZipEntry(bytes, relationshipsEntry));
  const sheetPath = firstWorksheetPath(workbookXml, relationshipsXml);
  const sheetEntry = entries.get(sheetPath);
  if (!sheetEntry) throw new Error('Inkbound could not find the first worksheet in this Excel file.');

  const sharedStringsEntry = entries.get('xl/sharedStrings.xml');
  const sharedStrings = sharedStringsEntry
    ? parseSharedStrings(textDecoder.decode(await readZipEntry(bytes, sharedStringsEntry)))
    : [];
  const worksheetXml = textDecoder.decode(await readZipEntry(bytes, sheetEntry));
  return rowsToRecords(worksheetRows(worksheetXml, sharedStrings));
}
