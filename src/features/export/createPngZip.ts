/** Small dependency-free ZIP writer (stored PNG entries, CRC32 verified by unzip tools). */
export async function createPngZip(files: readonly File[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const directory: BlobPart[] = [];
  let offset = 0;
  const u16 = (view: DataView, at: number, value: number) => view.setUint16(at, value, true);
  const u32 = (view: DataView, at: number, value: number) => view.setUint32(at, value >>> 0, true);
  const crc32 = (bytes: Uint8Array): number => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  for (const file of files) {
    const name = encoder.encode(file.name);
    const fileBuffer = await file.arrayBuffer();
    const data = new Uint8Array(fileBuffer);
    const checksum = crc32(data);
    const local = new ArrayBuffer(30 + name.length);
    const lh = new DataView(local);
    u32(lh, 0, 0x04034b50); u16(lh, 4, 20); u16(lh, 6, 0x0800);
    u32(lh, 14, checksum); u32(lh, 18, data.length); u32(lh, 22, data.length);
    u16(lh, 26, name.length);
    new Uint8Array(local, 30).set(name);
    parts.push(local, fileBuffer);
    const central = new ArrayBuffer(46 + name.length);
    const ch = new DataView(central);
    u32(ch, 0, 0x02014b50); u16(ch, 4, 20); u16(ch, 6, 20); u16(ch, 8, 0x0800);
    u32(ch, 16, checksum); u32(ch, 20, data.length); u32(ch, 24, data.length);
    u16(ch, 28, name.length); u32(ch, 42, offset);
    new Uint8Array(central, 46).set(name);
    directory.push(central);
    offset += local.byteLength + data.length;
  }
  const directorySize = directory.reduce((sum, item) => sum + (item instanceof ArrayBuffer ? item.byteLength : 0), 0);
  const end = new ArrayBuffer(22); const eh = new DataView(end);
  u32(eh, 0, 0x06054b50); u16(eh, 8, files.length); u16(eh, 10, files.length);
  u32(eh, 12, directorySize); u32(eh, 16, offset);
  return new Blob([...parts, ...directory, end], { type: 'application/zip' });
}
