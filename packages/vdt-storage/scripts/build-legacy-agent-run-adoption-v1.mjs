import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  writeSync
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";

const INVALID_ARGUMENTS = "legacy-agent-run-adoption builder: invalid arguments\n";
const argv = process.argv.slice(2);
const buildMode =
  argv.length === 5 &&
  argv[0] === "--build" &&
  argv[1] === "--output" &&
  argv[3] === "--vectors";
const verifyMode =
  argv.length === 5 &&
  argv[0] === "--verify" &&
  argv[1] === "--module" &&
  argv[3] === "--vectors";
if (!buildMode && !verifyMode) {
  process.stderr.write(INVALID_ARGUMENTS);
  process.exit(64);
}

class BuilderError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const fail = (code) => {
  throw new BuilderError(code);
};
const requireTrue = (condition, code) => {
  if (!condition) fail(code);
};

const ascii = (value) => [...Buffer.from(value, "ascii")];
const concat = (...values) => values.flat(Infinity);
const u32 = (input) => {
  let value = Number(input);
  requireTrue(Number.isInteger(value) && value >= 0 && value <= 0xffffffff, "module_build_invalid");
  const bytes = [];
  do {
    let byte = value & 0x7f;
    value = Math.floor(value / 128);
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return bytes;
};
const signedLeb = (input, bits) => {
  let value = BigInt(input);
  const minimum = -(1n << BigInt(bits - 1));
  const maximum = (1n << BigInt(bits - 1)) - 1n;
  requireTrue(value >= minimum && value <= maximum, "module_build_invalid");
  const bytes = [];
  while (true) {
    let byte = Number(value & 0x7fn);
    value >>= 7n;
    const done = (value === 0n && (byte & 0x40) === 0) || (value === -1n && (byte & 0x40) !== 0);
    if (!done) byte |= 0x80;
    bytes.push(byte);
    if (done) return bytes;
  }
};
const i32 = (value) => signedLeb(BigInt.asIntN(32, BigInt(value)), 32);
const i64 = (value) => signedLeb(BigInt.asIntN(64, BigInt(value)), 64);
const section = (id, payload) => [id, ...u32(payload.length), ...payload];
const vector = (items) => [...u32(items.length), ...items.flat()];
const name = (value) => [...u32(Buffer.byteLength(value, "utf8")), ...Buffer.from(value, "utf8")];

const op = {
  block: 0x02,
  if: 0x04,
  else: 0x05,
  end: 0x0b,
  br: 0x0c,
  br_if: 0x0d,
  return: 0x0f,
  get: 0x20,
  set: 0x21,
  tee: 0x22,
  load32: 0x28,
  load64: 0x29,
  load8: 0x2d,
  load16: 0x2f,
  store32: 0x36,
  store8: 0x3a,
  store16: 0x3b,
  const32: 0x41,
  const64: 0x42,
  eqz32: 0x45,
  eq32: 0x46,
  ne32: 0x47,
  lt32u: 0x49,
  gt32u: 0x4b,
  le32u: 0x4d,
  ge32u: 0x4f,
  eq64: 0x51,
  ne64: 0x52,
  lt64u: 0x54,
  gt64u: 0x56,
  le64u: 0x58,
  ge64u: 0x5a,
  add32: 0x6a,
  sub32: 0x6b,
  and32: 0x71,
  or32: 0x72
};
const get = (index) => [op.get, ...u32(index)];
const set = (index) => [op.set, ...u32(index)];
const c32 = (value) => [op.const32, ...i32(value)];
const c64 = (value) => [op.const64, ...i64(value)];
const memory = (opcode, alignment, offset) => [opcode, ...u32(alignment), ...u32(offset)];
const load = (address, opcode, alignment, offset) => [
  ...(typeof address === "function" ? address() : address),
  ...memory(opcode, alignment, offset)
];
const binary = (left, right, opcode) => [...left, ...right, opcode];
const and = (...conditions) =>
  conditions.reduce((left, right) => (left ? [...left, ...right, op.and32] : right), null);
const or = (...conditions) =>
  conditions.reduce((left, right) => (left ? [...left, ...right, op.or32] : right), null);
const ifReturn = (condition, returnCode) => [
  ...condition,
  op.if,
  0x40,
  ...c32(returnCode),
  op.return,
  op.end
];
const ifSet = (condition, localIndex, value) => [
  ...condition,
  op.if,
  0x40,
  ...c32(value),
  ...set(localIndex),
  op.end
];

const STATUS = [
  ["queued", 1, 2, 4, 1],
  ["running", 2, 2, 4, 1],
  ["needs_user_input", 3, 2, 4, 1],
  ["waiting_approval", 4, 2, 4, 1],
  ["succeeded", 5, 1, 1, 0],
  ["failed", 6, 1, 2, 0],
  ["cancelled", 7, 1, 3, 0]
];
const PHASE = [
  "classifying_request",
  "retrieving_skills",
  "reading_skills",
  "asking_clarifying_questions",
  "planning_decomposition",
  "building_graph",
  "previewing_mutation",
  "validating_graph",
  "repairing_graph",
  "applying_graph",
  "reporting"
];

function literalCondition(baseAddress, byteOffset, literal) {
  const bytes = Buffer.from(literal, "ascii");
  const conditions = [];
  let offset = 0;
  while (bytes.length - offset >= 4) {
    conditions.push(
      binary(
        load(baseAddress(), op.load32, 2, byteOffset + offset),
        c32(bytes.readInt32LE(offset)),
        op.eq32
      )
    );
    offset += 4;
  }
  if (bytes.length - offset >= 2) {
    conditions.push(
      binary(
        load(baseAddress(), op.load16, 1, byteOffset + offset),
        c32(bytes.readUInt16LE(offset)),
        op.eq32
      )
    );
    offset += 2;
  }
  if (bytes.length - offset === 1) {
    conditions.push(
      binary(load(baseAddress(), op.load8, 0, byteOffset + offset), c32(bytes[offset]), op.eq32)
    );
  }
  return and(...conditions);
}

function buildModule() {
  const body = [];
  const inputEnd = 4;
  const outputEnd = 5;
  const statusLength = 6;
  const phaseLength = 7;
  const statusOrdinal = 8;
  const phaseOrdinal = 9;
  const disposition = 10;
  const projectedStatus = 11;
  const phasePointer = 12;
  const createdAt = 14;
  const updatedAt = 15;
  const completedAt = 16;

  body.push(
    ...binary(get(0), get(1), op.add32),
    ...set(inputEnd),
    ...ifReturn(
      or(
        binary(get(inputEnd), get(0), op.lt32u),
        binary(get(inputEnd), c32(65536), op.gt32u)
      ),
      -1
    ),
    ...binary(get(2), get(3), op.add32),
    ...set(outputEnd),
    ...ifReturn(
      or(
        binary(get(outputEnd), get(2), op.lt32u),
        binary(get(outputEnd), c32(65536), op.gt32u)
      ),
      -2
    ),
    ...ifReturn(
      and(
        binary(get(1), c32(0), op.ne32),
        binary(get(3), c32(0), op.ne32),
        binary(get(0), get(outputEnd), op.lt32u),
        binary(get(2), get(inputEnd), op.lt32u)
      ),
      -3
    ),
    ...ifReturn(binary(get(3), c32(16), op.lt32u), -4),
    ...ifReturn(
      or(binary(get(1), c32(40), op.lt32u), binary(get(1), c32(83), op.gt32u)),
      -5
    ),
    ...ifReturn(
      or(
        binary(load(() => get(0), op.load32, 2, 0), c32(0x3152414c), op.ne32),
        binary(load(() => get(0), op.load8, 0, 4), c32(1), op.ne32)
      ),
      -6
    ),
    ...ifReturn(binary(load(() => get(0), op.load16, 1, 6), c32(40), op.ne32), -7),
    ...load(() => get(0), op.load8, 0, 12),
    ...set(statusLength),
    ...load(() => get(0), op.load8, 0, 13),
    ...set(phaseLength),
    ...ifReturn(
      or(
        binary(load(() => get(0), op.load32, 2, 8), get(1), op.ne32),
        binary(
          binary(binary(c32(40), get(statusLength), op.add32), get(phaseLength), op.add32),
          get(1),
          op.ne32
        )
      ),
      -8
    ),
    ...ifReturn(
      or(
        binary(load(() => get(0), op.load8, 0, 5), c32(1), op.gt32u),
        binary(load(() => get(0), op.load16, 1, 14), c32(0), op.ne32)
      ),
      -9
    ),
    ...ifReturn(
      or(
        binary(get(statusLength), c32(6), op.lt32u),
        binary(get(statusLength), c32(16), op.gt32u)
      ),
      -10
    ),
    ...ifReturn(
      or(
        binary(get(phaseLength), c32(9), op.lt32u),
        binary(get(phaseLength), c32(27), op.gt32u)
      ),
      -11
    )
  );

  for (const [literal, ordinal, dispositionCode, projectedCode] of STATUS) {
    body.push(
      ...ifSet(
        and(
          binary(get(statusLength), c32(Buffer.byteLength(literal)), op.eq32),
          literalCondition(() => get(0), 40, literal)
        ),
        statusOrdinal,
        ordinal
      )
    );
    body.push(
      ...ifSet(binary(get(statusOrdinal), c32(ordinal), op.eq32), disposition, dispositionCode),
      ...ifSet(binary(get(statusOrdinal), c32(ordinal), op.eq32), projectedStatus, projectedCode)
    );
  }
  body.push(
    ...ifReturn([ ...get(statusOrdinal), op.eqz32 ], -12),
    ...binary(binary(get(0), c32(40), op.add32), get(statusLength), op.add32),
    ...set(phasePointer)
  );
  for (let index = 0; index < PHASE.length; index += 1) {
    const literal = PHASE[index];
    body.push(
      ...ifSet(
        and(
          binary(get(phaseLength), c32(Buffer.byteLength(literal)), op.eq32),
          literalCondition(() => get(phasePointer), 0, literal)
        ),
        phaseOrdinal,
        index + 1
      )
    );
  }
  body.push(
    ...ifReturn([ ...get(phaseOrdinal), op.eqz32 ], -13),
    ...load(() => get(0), op.load64, 3, 16),
    ...set(createdAt),
    ...load(() => get(0), op.load64, 3, 24),
    ...set(updatedAt),
    ...load(() => get(0), op.load64, 3, 32),
    ...set(completedAt),
    ...ifReturn(
      or(
        binary(get(createdAt), c64(9007199254740991n), op.gt64u),
        binary(get(updatedAt), c64(9007199254740991n), op.gt64u),
        binary(get(completedAt), c64(9007199254740991n), op.gt64u)
      ),
      -14
    ),
    ...ifReturn(binary(get(createdAt), get(updatedAt), op.gt64u), -15),
    ...load(() => get(0), op.load8, 0, 5),
    op.eqz32,
    op.if,
    0x40,
    ...ifReturn(
      or(
        binary(get(createdAt), get(completedAt), op.gt64u),
        binary(get(completedAt), get(updatedAt), op.gt64u)
      ),
      -15
    ),
    op.end,
    ...ifReturn(
      or(
        and(
          binary(get(statusOrdinal), c32(4), op.le32u),
          or(
            binary(load(() => get(0), op.load8, 0, 5), c32(1), op.ne32),
            binary(get(completedAt), c64(0), op.ne64)
          )
        ),
        and(
          binary(get(statusOrdinal), c32(5), op.ge32u),
          binary(load(() => get(0), op.load8, 0, 5), c32(0), op.ne32)
        )
      ),
      -16
    )
  );

  const store = (opcode, alignment, offset, value) => [
    ...get(2),
    ...value,
    ...memory(opcode, alignment, offset)
  ];
  body.push(
    ...store(op.store32, 2, 0, c32(0x314f414c)),
    ...store(op.store8, 0, 4, c32(1)),
    ...store(op.store8, 0, 5, get(statusOrdinal)),
    ...store(op.store8, 0, 6, get(phaseOrdinal)),
    ...store(op.store8, 0, 7, get(disposition)),
    ...store(op.store8, 0, 8, get(projectedStatus)),
    ...store(op.store8, 0, 9, load(() => get(0), op.load8, 0, 5)),
    ...store(op.store16, 1, 10, c32(0)),
    ...store(op.store32, 2, 12, c32(16)),
    ...c32(16),
    op.end
  );

  const functionBody = [
    2,
    ...u32(10),
    0x7f,
    ...u32(3),
    0x7e,
    ...body
  ];
  const typeSection = section(1, vector([[0x60, 4, 0x7f, 0x7f, 0x7f, 0x7f, 1, 0x7f]]));
  const functionSection = section(3, vector([[0]]));
  const memorySection = section(5, vector([[1, 1, 1]]));
  const exportSection = section(
    7,
    vector([
      [...name("memory"), 0x02, 0],
      [...name("transform_row"), 0x00, 0]
    ])
  );
  const codeSection = section(10, vector([[...u32(functionBody.length), ...functionBody]]));
  return Buffer.from([
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    ...typeSection,
    ...functionSection,
    ...memorySection,
    ...exportSection,
    ...codeSection
  ]);
}

class Cursor {
  constructor(bytes) {
    this.bytes = bytes;
    this.offset = 0;
  }
  byte() {
    requireTrue(this.offset < this.bytes.length, "module_profile_invalid");
    return this.bytes[this.offset++];
  }
  bytesExact(length) {
    requireTrue(this.offset + length <= this.bytes.length, "module_profile_invalid");
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
  unsigned() {
    const start = this.offset;
    let value = 0;
    let shift = 0;
    for (let count = 0; count < 5; count += 1) {
      const byte = this.byte();
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) {
        requireTrue(
          Buffer.from(u32(value)).equals(this.bytes.subarray(start, this.offset)),
          "module_profile_invalid"
        );
        return value;
      }
      shift += 7;
    }
    fail("module_profile_invalid");
  }
  signed(bits) {
    const start = this.offset;
    let value = 0n;
    let shift = 0n;
    const maximumBytes = bits === 32 ? 5 : 10;
    let byte;
    for (let count = 0; count < maximumBytes; count += 1) {
      byte = this.byte();
      value |= BigInt(byte & 0x7f) << shift;
      shift += 7n;
      if ((byte & 0x80) === 0) {
        if ((byte & 0x40) !== 0) value |= -1n << shift;
        const encoded = bits === 32 ? i32(value) : i64(value);
        requireTrue(
          Buffer.from(encoded).equals(this.bytes.subarray(start, this.offset)),
          "module_profile_invalid"
        );
        return value;
      }
    }
    fail("module_profile_invalid");
  }
}

function validateStaticProfile(bytes) {
  requireTrue(WebAssembly.validate(bytes), "module_profile_invalid");
  const cursor = new Cursor(bytes);
  requireTrue(
    cursor.bytesExact(8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])),
    "module_profile_invalid"
  );
  const sections = [];
  while (cursor.offset < bytes.length) {
    const id = cursor.byte();
    const length = cursor.unsigned();
    sections.push([id, cursor.bytesExact(length)]);
  }
  requireTrue(
    sections.map(([id]) => id).join(",") === "1,3,5,7,10",
    "module_profile_invalid"
  );

  const type = new Cursor(sections[0][1]);
  requireTrue(type.unsigned() === 1 && type.byte() === 0x60, "module_profile_invalid");
  requireTrue(type.unsigned() === 4, "module_profile_invalid");
  for (let index = 0; index < 4; index += 1)
    requireTrue(type.byte() === 0x7f, "module_profile_invalid");
  requireTrue(type.unsigned() === 1 && type.byte() === 0x7f, "module_profile_invalid");
  requireTrue(type.offset === type.bytes.length, "module_profile_invalid");

  const functions = new Cursor(sections[1][1]);
  requireTrue(
    functions.unsigned() === 1 && functions.unsigned() === 0 && functions.offset === functions.bytes.length,
    "module_profile_invalid"
  );
  const memories = new Cursor(sections[2][1]);
  requireTrue(
    memories.unsigned() === 1 &&
      memories.unsigned() === 1 &&
      memories.unsigned() === 1 &&
      memories.unsigned() === 1 &&
      memories.offset === memories.bytes.length,
    "module_profile_invalid"
  );
  const exports = new Cursor(sections[3][1]);
  requireTrue(exports.unsigned() === 2, "module_profile_invalid");
  const readName = () => Buffer.from(exports.bytesExact(exports.unsigned())).toString("utf8");
  requireTrue(
    readName() === "memory" && exports.byte() === 2 && exports.unsigned() === 0,
    "module_profile_invalid"
  );
  requireTrue(
    readName() === "transform_row" && exports.byte() === 0 && exports.unsigned() === 0,
    "module_profile_invalid"
  );
  requireTrue(exports.offset === exports.bytes.length, "module_profile_invalid");

  const code = new Cursor(sections[4][1]);
  requireTrue(code.unsigned() === 1, "module_profile_invalid");
  const bodyLength = code.unsigned();
  const body = new Cursor(code.bytesExact(bodyLength));
  requireTrue(code.offset === code.bytes.length, "module_profile_invalid");
  const localGroups = body.unsigned();
  let localCount = 0;
  let i32Locals = 0;
  let i64Locals = 0;
  for (let index = 0; index < localGroups; index += 1) {
    const count = body.unsigned();
    const typeCode = body.byte();
    requireTrue(typeCode === 0x7f || typeCode === 0x7e, "module_profile_invalid");
    localCount += count;
    if (typeCode === 0x7f) i32Locals += count;
    else i64Locals += count;
  }
  requireTrue(i32Locals <= 16 && i64Locals <= 4, "module_profile_invalid");
  const allowed = new Set(Object.values(op));
  const controls = [{ kind: "function", elseSeen: false }];
  while (controls.length > 0) {
    const opcode = body.byte();
    requireTrue(allowed.has(opcode), "module_profile_invalid");
    if (opcode === op.block || opcode === op.if) {
      requireTrue(body.byte() === 0x40, "module_profile_invalid");
      controls.push({ kind: opcode === op.if ? "if" : "block", elseSeen: false });
    } else if (opcode === op.else) {
      const top = controls.at(-1);
      requireTrue(top.kind === "if" && !top.elseSeen, "module_profile_invalid");
      top.elseSeen = true;
    } else if (opcode === op.end) {
      controls.pop();
    } else if (opcode === op.br || opcode === op.br_if) {
      requireTrue(body.unsigned() < controls.length, "module_profile_invalid");
    } else if (opcode === op.get || opcode === op.set || opcode === op.tee) {
      requireTrue(body.unsigned() < 4 + localCount, "module_profile_invalid");
    } else if (
      [op.load32, op.load64, op.load8, op.load16, op.store32, op.store8, op.store16].includes(opcode)
    ) {
      const alignment = body.unsigned();
      const offset = body.unsigned();
      const natural = new Map([
        [op.load32, 2],
        [op.load64, 3],
        [op.load8, 0],
        [op.load16, 1],
        [op.store32, 2],
        [op.store8, 0],
        [op.store16, 1]
      ]).get(opcode);
      requireTrue(alignment <= natural && offset <= 65535, "module_profile_invalid");
    } else if (opcode === op.const32) {
      body.signed(32);
    } else if (opcode === op.const64) {
      body.signed(64);
    }
  }
  requireTrue(body.offset === body.bytes.length, "module_profile_invalid");
}

const rawSha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const canonicalize = (value) => {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number")
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(",")}}`;
};
const frame = (bytes) => {
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  return Buffer.concat([length, bytes]);
};
const hashFramed = (domain, schema, metadata, body) =>
  `sha256:${createHash("sha256")
    .update(frame(Buffer.from(domain)))
    .update(frame(Buffer.from(schema)))
    .update(frame(Buffer.from(canonicalize(metadata))))
    .update(frame(body))
    .digest("hex")}`;

function readRegular(path, code) {
  try {
    requireTrue(isAbsolute(path), "path_invalid");
    const listed = lstatSync(path, { bigint: true });
    requireTrue(listed.isFile() && !listed.isSymbolicLink() && listed.nlink === 1n, "path_invalid");
    requireTrue(realpathSync(path) === path, "path_invalid");
    requireTrue(listed.size >= 0n && listed.size <= 1073741824n, code);
    const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = fstatSync(descriptor, { bigint: true });
      const bytes = Buffer.alloc(Number(before.size) + 1);
      let count = 0;
      while (count < bytes.length) {
        const chunk = readSync(descriptor, bytes, count, bytes.length - count, count);
        if (chunk === 0) break;
        count += chunk;
      }
      const after = fstatSync(descriptor, { bigint: true });
      requireTrue(
        before.dev === after.dev &&
          before.ino === after.ino &&
          before.size === after.size &&
          before.mtimeNs === after.mtimeNs &&
          count === Number(before.size),
        code
      );
      return bytes.subarray(0, count);
    } finally {
      closeSync(descriptor);
    }
  } catch (error) {
    if (error instanceof BuilderError) throw error;
    fail(code);
  }
}

function exactKeys(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0")
  );
}

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const HEX_PATTERN = /^(?:[0-9a-f]{2})*$/;
const BLOCK_CODES = new Set([
  "LAR_HOST_COUNT_MISMATCH",
  "LAR_HOST_STORAGE_CLASS",
  "LAR_HOST_UTF8",
  "LAR_HOST_ID",
  "LAR_HOST_JSON_LENGTH",
  "LAR_HOST_TOTAL_JSON_BYTES",
  "LAR_HOST_JSON_SYNTAX",
  "LAR_HOST_JSON_DUPLICATE_KEY",
  "LAR_HOST_JSON_TOP_LEVEL",
  "LAR_HOST_JSON_DEPTH",
  "LAR_HOST_JSON_VALUE_COUNT",
  "LAR_HOST_JSON_UNICODE",
  "LAR_HOST_JSON_NUMBER",
  "LAR_HOST_STATUS",
  "LAR_HOST_PHASE",
  "LAR_HOST_TIMESTAMP",
  "LAR_HOST_WASM_ERROR",
  "LAR_HOST_WASM_OUTPUT"
]);
const isSafeNonnegative = (value) => Number.isSafeInteger(value) && value >= 0;
const isSha256 = (value) => typeof value === "string" && SHA256_PATTERN.test(value);
const isHex = (value, nonempty = false) =>
  typeof value === "string" && HEX_PATTERN.test(value) && (!nonempty || value.length > 0);

function validatePatch(patch) {
  requireTrue(
    exactKeys(patch, ["offset", "bytesHex"]) &&
      isSafeNonnegative(patch.offset) &&
      patch.offset <= 65535 &&
      isHex(patch.bytesHex, true) &&
      patch.offset + patch.bytesHex.length / 2 <= 65536,
    "vectors_schema_invalid"
  );
}

function validateHostBytes(bytes) {
  requireTrue(bytes && typeof bytes === "object" && !Array.isArray(bytes), "vectors_schema_invalid");
  if (bytes.kind === "hex") {
    requireTrue(exactKeys(bytes, ["kind", "hex"]) && isHex(bytes.hex), "vectors_schema_invalid");
  } else if (bytes.kind === "repeat") {
    requireTrue(
      exactKeys(bytes, ["kind", "prefixHex", "unitHex", "repeatCount", "suffixHex"]) &&
        isHex(bytes.prefixHex) &&
        isHex(bytes.unitHex, true) &&
        isSafeNonnegative(bytes.repeatCount) &&
        isHex(bytes.suffixHex),
      "vectors_schema_invalid"
    );
  } else if (bytes.kind === "nested_object") {
    requireTrue(
      exactKeys(bytes, ["kind", "objectDepth", "keyAscii", "leafAscii"]) &&
        Number.isSafeInteger(bytes.objectDepth) &&
        bytes.objectDepth > 0 &&
        bytes.keyAscii === "x" &&
        bytes.leafAscii === "0",
      "vectors_schema_invalid"
    );
  } else {
    requireTrue(
      bytes.kind === "integer_array_object" &&
        exactKeys(bytes, ["kind", "elementCount", "keyAscii", "integerLiteral"]) &&
        isSafeNonnegative(bytes.elementCount) &&
        bytes.keyAscii === "x" &&
        bytes.integerLiteral === "0",
      "vectors_schema_invalid"
    );
  }
}

function validateSqlValue(value) {
  requireTrue(value && typeof value === "object" && !Array.isArray(value), "vectors_schema_invalid");
  if (value.storageClass === "null") {
    requireTrue(exactKeys(value, ["storageClass"]), "vectors_schema_invalid");
  } else if (value.storageClass === "integer") {
    requireTrue(
      exactKeys(value, ["storageClass", "integerDecimal"]) &&
        typeof value.integerDecimal === "string" &&
        /^-?(?:0|[1-9][0-9]*)$/.test(value.integerDecimal),
      "vectors_schema_invalid"
    );
  } else if (value.storageClass === "real") {
    requireTrue(
      exactKeys(value, ["storageClass", "realCanonical"]) &&
        typeof value.realCanonical === "string" &&
        value.realCanonical.length > 0,
      "vectors_schema_invalid"
    );
  } else {
    requireTrue(
      (value.storageClass === "text" || value.storageClass === "blob") &&
        exactKeys(value, ["storageClass", "bytes"]),
      "vectors_schema_invalid"
    );
    validateHostBytes(value.bytes);
  }
}

function validateHostRow(row) {
  const columns = [
    "id",
    "project_id",
    "vdt_id",
    "conversation_id",
    "status",
    "phase",
    "request_json",
    "public_snapshot_json",
    "internal_state_json",
    "created_at",
    "updated_at",
    "completed_at"
  ];
  requireTrue(exactKeys(row, columns), "vectors_schema_invalid");
  for (const column of columns) validateSqlValue(row[column]);
}

function validateHostInput(input) {
  requireTrue(
    exactKeys(input, [
      "rowSet",
      "streamBehavior",
      "wasmBehavior",
      "expandedRowCount",
      "expandedInputRawSha256"
    ]) &&
      isSafeNonnegative(input.expandedRowCount) &&
      isSha256(input.expandedInputRawSha256),
    "vectors_schema_invalid"
  );
  const { rowSet, streamBehavior, wasmBehavior } = input;
  if (rowSet.kind === "literal") {
    requireTrue(exactKeys(rowSet, ["kind", "rows"]) && Array.isArray(rowSet.rows), "vectors_schema_invalid");
    for (const row of rowSet.rows) validateHostRow(row);
  } else {
    requireTrue(
      rowSet.kind === "series" &&
        exactKeys(rowSet, ["kind", "segments"]) &&
        Array.isArray(rowSet.segments),
      "vectors_schema_invalid"
    );
    for (const segment of rowSet.segments) {
      requireTrue(
        exactKeys(segment, [
          "count",
          "firstIndex",
          "decimalWidth",
          "runIdPrefix",
          "template"
        ]) &&
          isSafeNonnegative(segment.count) &&
          isSafeNonnegative(segment.firstIndex) &&
          segment.decimalWidth === 6 &&
          segment.runIdPrefix === "run_",
        "vectors_schema_invalid"
      );
      validateHostRow(segment.template);
    }
  }
  if (streamBehavior.kind === "normal") {
    requireTrue(exactKeys(streamBehavior, ["kind"]), "vectors_schema_invalid");
  } else if (streamBehavior.kind === "count_only") {
    requireTrue(
      exactKeys(streamBehavior, ["kind", "reportedCount"]) &&
        isSafeNonnegative(streamBehavior.reportedCount),
      "vectors_schema_invalid"
    );
  } else {
    requireTrue(
      streamBehavior.kind === "scripted" &&
        exactKeys(streamBehavior, ["kind", "reportedCount", "yieldedExpandedRowIndexes"]) &&
        isSafeNonnegative(streamBehavior.reportedCount) &&
        Array.isArray(streamBehavior.yieldedExpandedRowIndexes) &&
        streamBehavior.yieldedExpandedRowIndexes.every(isSafeNonnegative),
      "vectors_schema_invalid"
    );
  }
  if (wasmBehavior.kind === "exact_frozen_module") {
    requireTrue(exactKeys(wasmBehavior, ["kind"]), "vectors_schema_invalid");
  } else {
    requireTrue(
      wasmBehavior.kind === "isolated_test_double" &&
        exactKeys(wasmBehavior, ["kind", "returnValue", "memoryWrites"]) &&
        Number.isSafeInteger(wasmBehavior.returnValue) &&
        Array.isArray(wasmBehavior.memoryWrites),
      "vectors_schema_invalid"
    );
    for (const patch of wasmBehavior.memoryWrites) validatePatch(patch);
  }
}

function validateClosedVectorSchemas(vectors) {
  for (const vector of vectors.abiVectors) {
    requireTrue(
      exactKeys(vector, [
        "vectorId",
        "initialMemoryPatches",
        "initialMemoryRawSha256",
        "invocation",
        "expected"
      ]) &&
        typeof vector.vectorId === "string" &&
        vector.vectorId.length > 0 &&
        Array.isArray(vector.initialMemoryPatches) &&
        isSha256(vector.initialMemoryRawSha256) &&
        exactKeys(vector.invocation, ["inputPtr", "inputLen", "outputPtr", "outputCap"]),
      "vectors_schema_invalid"
    );
    for (const value of Object.values(vector.invocation))
      requireTrue(isSafeNonnegative(value) && value <= 0xffffffff, "vectors_schema_invalid");
    let previousPatchEnd = 0;
    for (const patch of vector.initialMemoryPatches) {
      validatePatch(patch);
      requireTrue(patch.offset >= previousPatchEnd, "vectors_schema_invalid");
      previousPatchEnd = patch.offset + patch.bytesHex.length / 2;
    }
    if (vector.expected.outcome === "success") {
      requireTrue(
        exactKeys(vector.expected, [
          "outcome",
          "returnValue",
          "outputHex",
          "outputRawSha256",
          "inputUnchanged",
          "finalMemoryRawSha256"
        ]) &&
          vector.expected.returnValue === 16 &&
          isHex(vector.expected.outputHex, true) &&
          vector.expected.outputHex.length === 32 &&
          isSha256(vector.expected.outputRawSha256) &&
          vector.expected.inputUnchanged === true &&
          isSha256(vector.expected.finalMemoryRawSha256),
        "vectors_schema_invalid"
      );
    } else {
      requireTrue(
        vector.expected.outcome === "error" &&
          exactKeys(vector.expected, [
            "outcome",
            "returnValue",
            "memoryUnchanged",
            "finalMemoryRawSha256"
          ]) &&
          Number.isInteger(vector.expected.returnValue) &&
          vector.expected.returnValue >= -16 &&
          vector.expected.returnValue <= -1 &&
          vector.expected.memoryUnchanged === true &&
          isSha256(vector.expected.finalMemoryRawSha256),
        "vectors_schema_invalid"
      );
    }
  }
  for (const vector of vectors.hostVectors) {
    requireTrue(
      exactKeys(vector, ["vectorId", "input", "expected"]) &&
        typeof vector.vectorId === "string" &&
        vector.vectorId.length > 0,
      "vectors_schema_invalid"
    );
    validateHostInput(vector.input);
    requireTrue(
      vector.input.wasmBehavior.kind !== "isolated_test_double" ||
        vector.vectorId.startsWith("host.error.wasm."),
      "vectors_schema_invalid"
    );
    if (vector.expected.outcome === "accepted") {
      requireTrue(
        exactKeys(vector.expected, [
          "outcome",
          "migrationApplicationId",
          "adoptionCanonicalJson",
          "legacyRowHashes",
          "transformResultHash",
          "persistedBlockedReason"
        ]) &&
          typeof vector.expected.migrationApplicationId === "string" &&
          Array.isArray(vector.expected.adoptionCanonicalJson) &&
          vector.expected.adoptionCanonicalJson.every((value) => typeof value === "string") &&
          Array.isArray(vector.expected.legacyRowHashes) &&
          vector.expected.legacyRowHashes.every(isSha256) &&
          vector.expected.adoptionCanonicalJson.length ===
            vector.expected.legacyRowHashes.length &&
          isSha256(vector.expected.transformResultHash) &&
          vector.expected.persistedBlockedReason === null,
        "vectors_schema_invalid"
      );
    } else {
      requireTrue(
        vector.expected.outcome === "blocked" &&
          exactKeys(vector.expected, [
            "outcome",
            "code",
            "failingRowIndex",
            "failingColumn",
            "persistedBlockedReason"
          ]) &&
          BLOCK_CODES.has(vector.expected.code) &&
          (vector.expected.failingRowIndex === null ||
            isSafeNonnegative(vector.expected.failingRowIndex)) &&
          (vector.expected.failingColumn === null ||
            typeof vector.expected.failingColumn === "string") &&
          vector.expected.persistedBlockedReason === "postcondition_failed",
        "vectors_schema_invalid"
      );
    }
  }
}

function validateVectors(bytes) {
  let vectors;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    vectors = JSON.parse(text);
    requireTrue(Buffer.from(canonicalize(vectors)).equals(bytes), "vectors_bytes_invalid");
  } catch (error) {
    if (error instanceof BuilderError) throw error;
    fail("vectors_bytes_invalid");
  }
  requireTrue(
    exactKeys(vectors, [
      "schemaVersion",
      "transformId",
      "transformVersion",
      "artifactFormat",
      "abiVersion",
      "fixtureMigrationIdentity",
      "fixtureCommitTimestamp",
      "abiVectorCount",
      "hostAcceptedVectorCount",
      "hostBlockedVectorCount",
      "hostVectorCount",
      "vectorCount",
      "abiVectors",
      "hostVectors",
      "vectorSetHash",
      "vectorResultSetHash"
    ]),
    "vectors_schema_invalid"
  );
  requireTrue(
    vectors.schemaVersion === "legacy_agent_run_adoption_golden_vectors.v1" &&
      vectors.transformId === "legacy-agent-run-adoption-v1" &&
      vectors.transformVersion === 1 &&
      vectors.artifactFormat === "wasm32-no-imports-v1" &&
      vectors.abiVersion === "legacy-agent-run-adoption-abi.v1" &&
      vectors.abiVectorCount === 55 &&
      vectors.hostAcceptedVectorCount === 36 &&
      vectors.hostBlockedVectorCount === 168 &&
      vectors.hostVectorCount === 204 &&
      vectors.vectorCount === 259 &&
      vectors.abiVectors.length === 55 &&
      vectors.hostVectors.length === 204,
    "vectors_count_invalid"
  );
  requireTrue(
    vectors.fixtureCommitTimestamp === "2026-07-24T00:00:00.000Z" &&
      exactKeys(vectors.fixtureMigrationIdentity, [
        "schemaVersion",
        "databaseId",
        "attemptId",
        "backupEvidenceId",
        "fenceOwnerToken",
        "fenceLeaseGeneration",
        "targetManifestHash",
        "sequence",
        "migrationId",
        "sqlChecksum",
        "transformId",
        "transformVersion",
        "moduleChecksum",
        "contractChecksum",
        "goldenVectorsChecksum"
      ]) &&
      vectors.fixtureMigrationIdentity.schemaVersion ===
        "migration_application_identity.v1" &&
      vectors.fixtureMigrationIdentity.databaseId === "db_test" &&
      vectors.fixtureMigrationIdentity.attemptId === "migration_attempt_test" &&
      vectors.fixtureMigrationIdentity.backupEvidenceId === "migration_backup_test" &&
      vectors.fixtureMigrationIdentity.fenceOwnerToken === "owner_test" &&
      vectors.fixtureMigrationIdentity.fenceLeaseGeneration === 1 &&
      vectors.fixtureMigrationIdentity.sequence === 3 &&
      vectors.fixtureMigrationIdentity.migrationId ===
        "003-durable-agent-run-coordination" &&
      vectors.fixtureMigrationIdentity.transformId ===
        "legacy-agent-run-adoption-v1" &&
      vectors.fixtureMigrationIdentity.transformVersion === 1 &&
      [
        "targetManifestHash",
        "sqlChecksum",
        "moduleChecksum",
        "contractChecksum",
        "goldenVectorsChecksum"
      ].every((key) => isSha256(vectors.fixtureMigrationIdentity[key])),
    "vectors_schema_invalid"
  );
  validateClosedVectorSchemas(vectors);
  requireTrue(
    vectors.hostVectors.filter((vector) => vector.expected.outcome === "accepted")
      .length === 36 &&
      vectors.hostVectors.filter((vector) => vector.expected.outcome === "blocked")
        .length === 168,
    "vectors_count_invalid"
  );
  const all = [
    ...vectors.abiVectors.map((vector) => ["abi", vector]),
    ...vectors.hostVectors.map((vector) => ["host", vector])
  ];
  const ids = all.map(([, vector]) => vector.vectorId);
  requireTrue(new Set(ids).size === 259, "vectors_count_invalid");
  for (const list of [vectors.abiVectors, vectors.hostVectors]) {
    requireTrue(
      list.every(
        (vector, index) =>
          index === 0 ||
          Buffer.compare(
            Buffer.from(list[index - 1].vectorId),
            Buffer.from(vector.vectorId)
          ) < 0
      ),
      "vectors_schema_invalid"
    );
  }
  const metadata = {
    transformId: vectors.transformId,
    transformVersion: vectors.transformVersion,
    artifactFormat: vectors.artifactFormat,
    abiVersion: vectors.abiVersion
  };
  const inputProjection = all
    .map(([kind, vector]) =>
      kind === "abi"
        ? {
            vectorKind: "abi",
            vectorId: vector.vectorId,
            input: {
              initialMemoryPatches: vector.initialMemoryPatches,
              initialMemoryRawSha256: vector.initialMemoryRawSha256,
              invocation: vector.invocation
            }
          }
        : { vectorKind: "host", vectorId: vector.vectorId, input: vector.input }
    )
    .sort((left, right) => Buffer.compare(Buffer.from(left.vectorId), Buffer.from(right.vectorId)));
  const resultProjection = all
    .map(([kind, vector]) => ({
      vectorKind: kind,
      vectorId: vector.vectorId,
      expected: vector.expected
    }))
    .sort((left, right) => Buffer.compare(Buffer.from(left.vectorId), Buffer.from(right.vectorId)));
  const vectorSetHash = hashFramed(
    "vdt-studio/migration-transform-vector-set",
    "migration_transform_vector_set_hash.v1",
    metadata,
    Buffer.from(canonicalize(inputProjection))
  );
  const vectorResultSetHash = hashFramed(
    "vdt-studio/migration-transform-vector-results",
    "migration_transform_vector_results_hash.v1",
    metadata,
    Buffer.from(canonicalize(resultProjection))
  );
  requireTrue(
    vectorSetHash === vectors.vectorSetHash &&
      vectorResultSetHash === vectors.vectorResultSetHash,
    "vectors_schema_invalid"
  );
  return { vectors, vectorSetHash, vectorResultSetHash };
}

function executeAbiVectors(moduleBytes, vectors) {
  let instance;
  try {
    instance = new WebAssembly.Instance(new WebAssembly.Module(moduleBytes));
  } catch {
    fail("module_profile_invalid");
  }
  const memoryBytes = new Uint8Array(instance.exports.memory.buffer);
  requireTrue(memoryBytes.length === 65536, "module_profile_invalid");
  for (const vector of vectors) {
    memoryBytes.fill(0);
    let previousEnd = 0;
    for (const patch of vector.initialMemoryPatches) {
      const bytes = Buffer.from(patch.bytesHex, "hex");
      requireTrue(
        bytes.length > 0 &&
          patch.offset >= previousEnd &&
          patch.offset + bytes.length <= 65536,
        "vectors_schema_invalid"
      );
      memoryBytes.set(bytes, patch.offset);
      previousEnd = patch.offset + bytes.length;
    }
    requireTrue(
      rawSha256(memoryBytes) === vector.initialMemoryRawSha256,
      "abi_vector_mismatch"
    );
    const before = Buffer.from(memoryBytes);
    const invocation = vector.invocation;
    const returnValue = instance.exports.transform_row(
      invocation.inputPtr,
      invocation.inputLen,
      invocation.outputPtr,
      invocation.outputCap
    );
    requireTrue(returnValue === vector.expected.returnValue, "abi_vector_mismatch");
    if (vector.expected.outcome === "error") {
      requireTrue(
        Buffer.from(memoryBytes).equals(before) &&
          vector.expected.memoryUnchanged === true &&
          rawSha256(memoryBytes) === vector.expected.finalMemoryRawSha256,
        "abi_vector_mismatch"
      );
    } else {
      const output = Buffer.from(
        memoryBytes.subarray(invocation.outputPtr, invocation.outputPtr + 16)
      );
      requireTrue(
        output.toString("hex") === vector.expected.outputHex &&
          rawSha256(output) === vector.expected.outputRawSha256 &&
          Buffer.from(
            memoryBytes.subarray(invocation.inputPtr, invocation.inputPtr + invocation.inputLen)
          ).equals(before.subarray(invocation.inputPtr, invocation.inputPtr + invocation.inputLen)) &&
          rawSha256(memoryBytes) === vector.expected.finalMemoryRawSha256,
        "abi_vector_mismatch"
      );
    }
  }
}

function writeExclusive(path, bytes) {
  try {
    requireTrue(isAbsolute(path), "path_invalid");
    const parent = dirname(path);
    const parentStat = lstatSync(parent, { bigint: true });
    requireTrue(parentStat.isDirectory() && !parentStat.isSymbolicLink(), "path_invalid");
    requireTrue(realpathSync(parent) === parent && resolve(path) === path, "path_invalid");
    let descriptor;
    try {
      descriptor = openSync(
        path,
        constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o644
      );
    } catch {
      fail("output_create_failed");
    }
    try {
      let offset = 0;
      while (offset < bytes.length) {
        const count = writeSync(descriptor, bytes, offset, bytes.length - offset, offset);
        requireTrue(count > 0, "output_write_failed");
        offset += count;
      }
      fsyncSync(descriptor);
      const readback = Buffer.alloc(bytes.length + 1);
      const count = readSync(descriptor, readback, 0, readback.length, 0);
      requireTrue(count === bytes.length && readback.subarray(0, count).equals(bytes), "output_write_failed");
    } catch (error) {
      if (error instanceof BuilderError) throw error;
      fail("output_write_failed");
    } finally {
      closeSync(descriptor);
    }
    const reopened = readRegular(path, "output_durability_failed");
    requireTrue(reopened.equals(bytes), "output_durability_failed");
    const parentDescriptor = openSync(parent, constants.O_RDONLY);
    try {
      fsyncSync(parentDescriptor);
    } finally {
      closeSync(parentDescriptor);
    }
  } catch (error) {
    if (error instanceof BuilderError) throw error;
    fail("output_create_failed");
  }
}

function selfCheckLeb() {
  for (const value of [0, 1, 127, 128, 255, 624485, 0xffffffff]) {
    const bytes = Buffer.from(u32(value));
    const cursor = new Cursor(bytes);
    requireTrue(cursor.unsigned() === value && cursor.offset === bytes.length, "module_build_invalid");
  }
  for (const [bits, values] of [
    [32, [-2147483648n, -16n, -1n, 0n, 16n, 2147483647n]],
    [64, [-(1n << 63n), -1n, 0n, 9007199254740991n, (1n << 63n) - 1n]]
  ]) {
    for (const value of values) {
      const bytes = Buffer.from(bits === 32 ? i32(value) : i64(value));
      const cursor = new Cursor(bytes);
      requireTrue(cursor.signed(bits) === value && cursor.offset === bytes.length, "module_build_invalid");
    }
  }
}

function main() {
  requireTrue(Number(process.versions.node.split(".")[0]) === 24, "node_major");
  const modulePath = argv[2];
  const vectorsPath = argv[4];
  requireTrue(isAbsolute(modulePath) && isAbsolute(vectorsPath), "path_invalid");
  const vectorBytes = readRegular(vectorsPath, "vectors_bytes_invalid");
  const { vectors, vectorSetHash, vectorResultSetHash } = validateVectors(vectorBytes);
  selfCheckLeb();
  const moduleBytes = buildModule();
  validateStaticProfile(moduleBytes);
  if (buildMode) {
    writeExclusive(modulePath, moduleBytes);
  } else {
    const existing = readRegular(modulePath, "path_invalid");
    requireTrue(existing.equals(moduleBytes), "module_mismatch");
  }
  executeAbiVectors(moduleBytes, vectors.abiVectors);
  process.stdout.write(
    `${canonicalize({
      schemaVersion: "legacy_agent_run_adoption_builder_result.v1",
      mode: buildMode ? "build" : "verify",
      moduleByteLength: moduleBytes.length,
      moduleRawSha256: rawSha256(moduleBytes),
      abiVectorCount: 55,
      vectorSetHash,
      vectorResultSetHash
    })}\n`
  );
}

try {
  main();
} catch (error) {
  const code = error instanceof BuilderError ? error.code : "internal";
  process.stderr.write(`legacy-agent-run-adoption builder: ${code}\n`);
  process.exit(1);
}
