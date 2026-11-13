// A minimal ZIP writer (stored, no compression), enough for .xlsx files. No dependencies.

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type ZipFile = { name: string; data: string | Uint8Array };

/** Fixed timestamp (1980-01-01) so the same input always gives the same bytes. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

export function zipStored(files: ZipFile[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const header = (size: number) => {
    const b = new Uint8Array(size);
    return { b, v: new DataView(b.buffer) };
  };

  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
    const crc = crc32(data);

    const local = header(30 + name.length);
    local.v.setUint32(0, 0x04034b50, true);
    local.v.setUint16(4, 20, true); // version needed
    local.v.setUint16(6, 0x0800, true); // UTF-8 names
    local.v.setUint16(8, 0, true); // stored
    local.v.setUint16(10, DOS_TIME, true);
    local.v.setUint16(12, DOS_DATE, true);
    local.v.setUint32(14, crc, true);
    local.v.setUint32(18, data.length, true);
    local.v.setUint32(22, data.length, true);
    local.v.setUint16(26, name.length, true);
    local.b.set(name, 30);
    chunks.push(local.b, data);

    const cen = header(46 + name.length);
    cen.v.setUint32(0, 0x02014b50, true);
    cen.v.setUint16(4, 20, true);
    cen.v.setUint16(6, 20, true);
    cen.v.setUint16(8, 0x0800, true);
    cen.v.setUint16(10, 0, true);
    cen.v.setUint16(12, DOS_TIME, true);
    cen.v.setUint16(14, DOS_DATE, true);
    cen.v.setUint32(16, crc, true);
    cen.v.setUint32(20, data.length, true);
    cen.v.setUint32(24, data.length, true);
    cen.v.setUint16(28, name.length, true);
    cen.v.setUint32(42, offset, true);
    cen.b.set(name, 46);
    central.push(cen.b);

    offset += local.b.length + data.length;
  }

  const centralSize = central.reduce((a, c) => a + c.length, 0);
  const end = header(22);
  end.v.setUint32(0, 0x06054b50, true);
  end.v.setUint16(8, files.length, true);
  end.v.setUint16(10, files.length, true);
  end.v.setUint32(12, centralSize, true);
  end.v.setUint32(16, offset, true);

  const all = [...chunks, ...central, end.b];
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}
