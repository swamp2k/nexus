const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const MAX_TAIL_BYTES = 128 * 1024;
const MAX_CENTRAL_DIRECTORY_BYTES = 64 * 1024 * 1024;
const MAX_INVENTORY_FILES = 100_000;
const MAX_ENTRY_UNCOMPRESSED_BYTES = 4 * 1024 * 1024;

export type ZipInventoryEntry = {
  path: string;
  sizeBytes: number | null;
  fileType: string | null;
};

export type ZipInventory = {
  entries: ZipInventoryEntry[];
  detectedFrom: string | null;
  detectedTo: string | null;
};

type CentralDirectoryInfo = {
  entryCount: number;
  size: number;
  offset: number;
};

type ZipEntryMeta = {
  path: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

function readUint64(view: DataView, offset: number): number {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("zip_value_too_large");
  return Number(value);
}

async function readRange(bucket: R2Bucket, key: string, offset: number, length: number): Promise<ArrayBuffer> {
  const object = await bucket.get(key, { range: { offset, length } });
  if (!object || !("body" in object) || !object.body) throw new Error("garmin_source_missing");
  return object.arrayBuffer();
}

function findEocd(buffer: ArrayBuffer): number {
  const view = new DataView(buffer);
  for (let offset = buffer.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  throw new Error("invalid_zip_eocd_missing");
}

async function readZip64CentralDirectory(
  bucket: R2Bucket,
  key: string,
  absoluteEocdOffset: number,
  tail: ArrayBuffer,
  eocdOffsetInTail: number,
): Promise<CentralDirectoryInfo> {
  const tailStart = absoluteEocdOffset - eocdOffsetInTail;
  const locatorAbsoluteOffset = absoluteEocdOffset - 20;
  const locatorOffsetInTail = locatorAbsoluteOffset - tailStart;

  let locator: ArrayBuffer;
  if (locatorOffsetInTail >= 0 && locatorOffsetInTail + 20 <= tail.byteLength) {
    locator = tail.slice(locatorOffsetInTail, locatorOffsetInTail + 20);
  } else {
    locator = await readRange(bucket, key, locatorAbsoluteOffset, 20);
  }

  const locatorView = new DataView(locator);
  if (locatorView.getUint32(0, true) !== ZIP64_LOCATOR_SIGNATURE) throw new Error("invalid_zip64_locator_missing");

  const zip64EocdOffset = readUint64(locatorView, 8);
  const zip64Header = await readRange(bucket, key, zip64EocdOffset, 56);
  const zip64View = new DataView(zip64Header);
  if (zip64View.getUint32(0, true) !== ZIP64_EOCD_SIGNATURE) throw new Error("invalid_zip64_eocd_missing");

  return {
    entryCount: readUint64(zip64View, 32),
    size: readUint64(zip64View, 40),
    offset: readUint64(zip64View, 48),
  };
}

async function locateCentralDirectory(bucket: R2Bucket, key: string, objectSize: number): Promise<CentralDirectoryInfo> {
  const tailLength = Math.min(objectSize, MAX_TAIL_BYTES);
  const tailOffset = objectSize - tailLength;
  const tail = await readRange(bucket, key, tailOffset, tailLength);
  const eocdOffset = findEocd(tail);
  const view = new DataView(tail);

  const entryCount = view.getUint16(eocdOffset + 10, true);
  const size = view.getUint32(eocdOffset + 12, true);
  const offset = view.getUint32(eocdOffset + 16, true);
  const isZip64 = entryCount === 0xffff || size === 0xffffffff || offset === 0xffffffff;
  const result = isZip64
    ? await readZip64CentralDirectory(bucket, key, tailOffset + eocdOffset, tail, eocdOffset)
    : { entryCount, size, offset };

  if (result.entryCount > MAX_INVENTORY_FILES) throw new Error("zip_too_many_files");
  if (result.size <= 0 || result.size > MAX_CENTRAL_DIRECTORY_BYTES) throw new Error("zip_central_directory_too_large");
  if (result.offset < 0 || result.offset + result.size > objectSize) throw new Error("invalid_zip_central_directory_range");
  return result;
}

function fileType(path: string): string | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0 || dot === path.length - 1) return null;
  const extension = path.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,12}$/.test(extension) ? extension : null;
}

function detectDate(path: string): string | null {
  const dashed = path.match(/(?:^|[^0-9])(20\d{2})[-_](0[1-9]|1[0-2])[-_]([0-2]\d|3[01])(?:[^0-9]|$)/);
  if (dashed) return `${dashed[1]}-${dashed[2]}-${dashed[3]}`;
  const compact = path.match(/(?:^|[^0-9])(20\d{2})(0[1-9]|1[0-2])([0-2]\d|3[01])(?:[^0-9]|$)/);
  return compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : null;
}

function decodeFilename(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(bytes).replace(/\\/g, "/");
}

function parseCentralEntries(buffer: ArrayBuffer, expectedEntries: number): ZipEntryMeta[] {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const entries: ZipEntryMeta[] = [];
  let offset = 0;

  while (offset + 46 <= buffer.byteLength && entries.length < expectedEntries) {
    if (view.getUint32(offset, true) !== CENTRAL_FILE_SIGNATURE) throw new Error("invalid_zip_central_directory_entry");
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const filenameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const recordLength = 46 + filenameLength + extraLength + commentLength;
    if (offset + recordLength > buffer.byteLength) throw new Error("truncated_zip_central_directory");
    const path = decodeFilename(bytes.subarray(offset + 46, offset + 46 + filenameLength));

    if (path && !path.endsWith("/")) {
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
        throw new Error("zip64_entry_not_supported");
      }
      entries.push({
        path,
        compressionMethod: view.getUint16(offset + 10, true),
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });
    }
    offset += recordLength;
  }
  return entries;
}

function inventoryFromEntries(entries: ZipEntryMeta[]): ZipInventory {
  const dates: string[] = [];
  const result = entries.map((entry) => {
    const date = detectDate(entry.path);
    if (date) dates.push(date);
    return { path: entry.path, sizeBytes: entry.uncompressedSize, fileType: fileType(entry.path) };
  });
  if (result.length === 0) throw new Error("zip_contains_no_files");
  dates.sort();
  return { entries: result, detectedFrom: dates[0] ?? null, detectedTo: dates.at(-1) ?? null };
}

async function allEntryMeta(bucket: R2Bucket, key: string): Promise<ZipEntryMeta[]> {
  const object = await bucket.head(key);
  if (!object) throw new Error("garmin_source_missing");
  if (object.size < 22) throw new Error("invalid_zip_too_small");
  const central = await locateCentralDirectory(bucket, key, object.size);
  const buffer = await readRange(bucket, key, central.offset, central.size);
  return parseCentralEntries(buffer, central.entryCount);
}

async function inflateRaw(buffer: ArrayBuffer): Promise<string> {
  // Cloudflare supports deflate-raw at runtime, while the generated TypeScript
  // definitions currently expose a narrower constructor union.
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("deflate-raw" as any));
  return new Response(stream).text();
}

async function readEntryText(bucket: R2Bucket, key: string, entry: ZipEntryMeta): Promise<string> {
  if (entry.uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES) throw new Error("zip_entry_too_large");
  const localHeader = await readRange(bucket, key, entry.localHeaderOffset, 30);
  const view = new DataView(localHeader);
  if (view.getUint32(0, true) !== LOCAL_FILE_SIGNATURE) throw new Error("invalid_zip_local_header");
  const filenameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);
  const dataOffset = entry.localHeaderOffset + 30 + filenameLength + extraLength;
  const compressed = await readRange(bucket, key, dataOffset, entry.compressedSize);

  if (entry.compressionMethod === 0) {
    return new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(compressed);
  }
  if (entry.compressionMethod === 8) return inflateRaw(compressed);
  throw new Error(`zip_compression_unsupported_${entry.compressionMethod}`);
}

export async function readZipTextEntries(bucket: R2Bucket, key: string, paths: string[]): Promise<Map<string, string>> {
  const wanted = new Set(paths);
  const meta = await allEntryMeta(bucket, key);
  const selected = meta.filter((entry) => wanted.has(entry.path));
  const result = new Map<string, string>();
  for (const entry of selected) result.set(entry.path, await readEntryText(bucket, key, entry));
  return result;
}

export async function inventoryZip(bucket: R2Bucket, key: string): Promise<ZipInventory> {
  return inventoryFromEntries(await allEntryMeta(bucket, key));
}
