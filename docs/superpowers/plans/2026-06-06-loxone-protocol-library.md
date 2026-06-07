# Loxone Protocol Library Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `lib/loxone/` — a MagicMirror-independent Node library that connects to a Loxone Miniserver using the current token-based protocol (RSA/AES command encryption, RFC6455 WebSocket, binary event tables), parses the structure file, and emits per-control semantic state.

**Architecture:** Small, single-responsibility modules with explicit interfaces, each unit-testable in isolation against fixtures and mock transports. Pure/deterministic units (crypto, binary decoders, frame assembler, name resolution) are tested with known vectors; the `LoxoneClient` integration is tested against a mock transport that simulates the handshake.

**Tech Stack:** Node 20+ (built-in `crypto`, `http`/`https`, `node:test`, `node:assert`), `ws` for the WebSocket client. No other runtime dependencies.

**Reference spec:** `docs/superpowers/specs/2026-06-06-mmm-loxone-rebuild-design.md` (esp. §7).

**Apply TDD throughout:** @superpowers:test-driven-development — write the failing test, watch it fail, implement minimally, watch it pass, commit.

**RSA testing note:** Node 20+ forbids `crypto.privateDecrypt` with `RSA_PKCS1_PADDING` (CVE-2023-46809). The Miniserver path only ever *encrypts* with the public key (`crypto.publicEncrypt`, PKCS#1 v1.5 — unaffected and what the Miniserver expects). Therefore RSA tests verify the encryption/public-key side only — ciphertext block size and public-key DER equality — and never call `privateDecrypt`. Do not reintroduce a `privateDecrypt(... RSA_PKCS1_PADDING)` round-trip (it throws on the Node 20+ target) and do not switch production to OAEP.

---

## Chunk 0: Project Setup

Establishes the package, test runner, lint, and directory skeleton for the library. No protocol logic yet.

### Task 0.1: Add `ws` dependency and npm scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Edit `package.json`**

Set `version` to `2.0.0`, add the `ws` runtime dependency, and add `test`/`lint` scripts. Replace the `dependencies` block and add a `scripts` block so the file reads:

```json
{
  "name": "MMM-Loxone",
  "version": "2.0.0",
  "description": "MMM-Loxone connects to your Loxone Miniserver and lets it communicate to your MagicMirror².",
  "main": "MMM-Loxone.js",
  "author": "David Gölzhäuser",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/lucienkerl/MMM-Loxone.git"
  },
  "scripts": {
    "test": "node --test",
    "lint": "eslint lib renderers MMM-Loxone.js node_helper.js"
  },
  "devDependencies": {
    "eslint": "^8.57.0"
  },
  "dependencies": {
    "ws": "^8.18.0"
  }
}
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: `node_modules/ws` exists, no errors.

- [ ] **Step 3: Verify the test runner is available**

Run: `node --test` (no tests yet)
Expected: exits 0 with "tests 0" (or "no test files found"); confirms Node 18+.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: switch deps to ws + node:test for v2 rewrite"
```

### Task 0.2: ESLint config for the library

**Files:**
- Modify: `.eslintrc.json`

- [ ] **Step 1: Update `.eslintrc.json`** so it lints modern Node modules (keep the existing tab/double-quote style):

```json
{
  "root": true,
  "parserOptions": { "ecmaVersion": 2022, "sourceType": "script" },
  "env": { "node": true, "browser": true, "es2022": true },
  "rules": {
    "indent": ["error", "tab", { "SwitchCase": 1 }],
    "quotes": ["error", "double"],
    "max-len": ["error", 250],
    "curly": "error",
    "no-trailing-spaces": ["error"],
    "no-irregular-whitespace": ["error"]
  }
}
```

- [ ] **Step 2: Run lint on the empty tree**

Run: `npx eslint lib 2>/dev/null; echo "exit $?"`
Expected: exit 0 (no files yet, no errors).

- [ ] **Step 3: Commit**

```bash
git add .eslintrc.json
git commit -m "build: eslint config for es2022 node modules"
```

### Task 0.3: Directory skeleton + sample-data placeholder

**Files:**
- Create: `lib/loxone/index.js`
- Create: `sample-data/README.md`
- Create: `test/.gitkeep`

- [ ] **Step 1: Create `lib/loxone/index.js`** as the public entry (filled in Chunk 6):

```js
"use strict";

// Public entry point for the Loxone client library.
// LoxoneClient is wired up in Chunk 6; re-exported here once it exists.
module.exports = {};
```

- [ ] **Step 2: Create `sample-data/README.md`**:

```markdown
# Sample data (test fixtures)

Place an **anonymized** `LoxAPP3.json` here (`sample-data/LoxAPP3.json`). Redact the
serial number / MAC, but keep `controls` (with their `type`, `states`, `details`),
`rooms`, and `cats` intact — the structure tests and the Wallbox/Energy-Flow renderer
bindings depend on these.

This directory is for fixtures only; it is not shipped with the module.
```

- [ ] **Step 3: Create `test/.gitkeep`** (empty file) so the test directory is tracked.

- [ ] **Step 4: Commit**

```bash
git add lib/loxone/index.js sample-data/README.md test/.gitkeep
git commit -m "chore: scaffold lib/loxone, sample-data, test dirs"
```

---

## Chunk 1: Crypto Core (`LoxoneCrypto`)

All cryptographic primitives the protocol needs, using Node's built-in `crypto`. Deterministic and fully unit-testable with known vectors. Spec §7.4.

### Task 1.1: Hashing and HMAC helpers

**Files:**
- Create: `lib/loxone/crypto/LoxoneCrypto.js`
- Test: `test/crypto.test.js`

- [ ] **Step 1: Write the failing test** — `test/crypto.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const C = require("../lib/loxone/crypto/LoxoneCrypto");

test("digestHex matches known SHA1/SHA256 vectors", () => {
	assert.equal(C.digestHex("SHA1", "abc"), "a9993e364706816aba3e25717850c26c9cd0d89d");
	assert.equal(C.digestHex("SHA256", "abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("hmacHex matches known RFC vectors", () => {
	const key = Buffer.from("key");
	const msg = "The quick brown fox jumps over the lazy dog";
	assert.equal(C.hmacHex("SHA1", key, msg), "de7c9b85b8b78aa6bc8a7a36f70a90701c9db4d9");
	assert.equal(C.hmacHex("SHA256", key, msg), "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
});

test("hexToBuf converts hex string to bytes", () => {
	assert.deepEqual(C.hexToBuf("0a0b0c"), Buffer.from([10, 11, 12]));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/crypto.test.js`
Expected: FAIL — cannot find module `LoxoneCrypto`.

- [ ] **Step 3: Write minimal implementation** — `lib/loxone/crypto/LoxoneCrypto.js`:

```js
"use strict";
const crypto = require("crypto");

function nodeAlg(hashAlg) {
	return hashAlg === "SHA256" ? "sha256" : "sha1";
}

function digestHex(hashAlg, input) {
	return crypto.createHash(nodeAlg(hashAlg)).update(input, "utf8").digest("hex");
}

function hmacHex(hashAlg, keyBuf, message) {
	return crypto.createHmac(nodeAlg(hashAlg), keyBuf).update(message, "utf8").digest("hex");
}

function hexToBuf(hex) {
	return Buffer.from(hex, "hex");
}

module.exports = { digestHex, hmacHex, hexToBuf };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/crypto.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/loxone/crypto/LoxoneCrypto.js test/crypto.test.js
git commit -m "feat(crypto): digestHex, hmacHex, hexToBuf with known vectors"
```

### Task 1.2: Loxone credential / password / token hashes

**Files:**
- Modify: `lib/loxone/crypto/LoxoneCrypto.js`
- Test: `test/crypto.test.js`

- [ ] **Step 1: Add failing tests** to `test/crypto.test.js`:

```js
test("passwordHash is uppercase HASH of '{pw}:{userSalt}'", () => {
	const expected = crypto.createHash("sha1").update("secret:abcd1234").digest("hex").toUpperCase();
	assert.equal(C.passwordHash("secret", "abcd1234", "SHA1"), expected);
});

test("credentialHash is HMAC('{user}:{pwHash}') keyed by hex key", () => {
	const pwHash = C.passwordHash("secret", "abcd1234", "SHA256");
	const keyHex = "00112233445566778899aabbccddeeff";
	const expected = crypto.createHmac("sha256", Buffer.from(keyHex, "hex")).update(`mirror:${pwHash}`).digest("hex");
	assert.equal(C.credentialHash("mirror", pwHash, keyHex, "SHA256"), expected);
});

test("tokenHash is HMAC(token) keyed by hex key", () => {
	const keyHex = "0011223344556677";
	const expected = crypto.createHmac("sha1", Buffer.from(keyHex, "hex")).update("the.jwt.token").digest("hex");
	assert.equal(C.tokenHash("the.jwt.token", keyHex, "SHA1"), expected);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/crypto.test.js`
Expected: FAIL — `passwordHash` is not a function.

- [ ] **Step 3: Implement** — append to `LoxoneCrypto.js` (before `module.exports`, then extend exports):

```js
function passwordHash(password, userSalt, hashAlg) {
	return digestHex(hashAlg, `${password}:${userSalt}`).toUpperCase();
}

function credentialHash(user, pwHashUpper, keyHex, hashAlg) {
	return hmacHex(hashAlg, hexToBuf(keyHex), `${user}:${pwHashUpper}`);
}

function tokenHash(token, keyHex, hashAlg) {
	return hmacHex(hashAlg, hexToBuf(keyHex), token);
}
```

Update `module.exports` to include `passwordHash, credentialHash, tokenHash`.

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/crypto.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/loxone/crypto/LoxoneCrypto.js test/crypto.test.js
git commit -m "feat(crypto): passwordHash, credentialHash, tokenHash"
```

### Task 1.3: RSA encrypt + AES-256-CBC zero-padding + session key / salt

**Files:**
- Modify: `lib/loxone/crypto/LoxoneCrypto.js`
- Test: `test/crypto.test.js`

- [ ] **Step 1: Add failing tests** to `test/crypto.test.js`:

```js
test("rsaEncryptBase64 produces a valid RSA-2048 PKCS#1 ciphertext", () => {
	// Node 20+ forbids privateDecrypt with PKCS1 padding (CVE-2023-46809); the Miniserver
	// path only encrypts. Verify the public-key encryption side instead of round-tripping.
	const { publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
	const pem = publicKey.export({ type: "spki", format: "pem" });
	const a = C.rsaEncryptBase64(pem, "deadbeef:cafebabe");
	const b = C.rsaEncryptBase64(pem, "deadbeef:cafebabe");
	assert.equal(Buffer.from(a, "base64").length, 256); // 2048-bit modulus -> 256-byte block
	assert.notEqual(a, b); // PKCS#1 v1.5 random padding -> ciphertext differs each time
});

test("aesEncryptBase64/aesDecryptString round-trip with zero padding (non-block-aligned)", () => {
	const key = Buffer.alloc(32, 7);
	const iv = Buffer.alloc(16, 9);
	const plain = "salt/ab12/jdev/sps/enablebinstatusupdate"; // not a multiple of 16
	const cipher = C.aesEncryptBase64(key, iv, plain);
	assert.equal(C.aesDecryptString(key, iv, cipher), plain);
});

test("aesEncryptBase64 is deterministic for fixed key/iv", () => {
	const key = Buffer.alloc(32, 1);
	const iv = Buffer.alloc(16, 2);
	assert.equal(C.aesEncryptBase64(key, iv, "hello"), C.aesEncryptBase64(key, iv, "hello"));
});

test("generateSessionKey yields 32-byte key + 16-byte iv as hex", () => {
	const s = C.generateSessionKey();
	assert.equal(s.keyHex.length, 64);
	assert.equal(s.ivHex.length, 32);
	assert.equal(s.keyBuf.length, 32);
	assert.equal(s.ivBuf.length, 16);
});

test("randomSalt returns hex of requested byte length", () => {
	assert.equal(C.randomSalt(2).length, 4);
	assert.notEqual(C.randomSalt(2), C.randomSalt(2));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/crypto.test.js`
Expected: FAIL — `rsaEncryptBase64` is not a function.

- [ ] **Step 3: Implement** — append to `LoxoneCrypto.js`:

```js
function rsaEncryptBase64(publicKeyPem, plaintext) {
	const enc = crypto.publicEncrypt(
		{ key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_PADDING },
		Buffer.from(plaintext, "utf8")
	);
	return enc.toString("base64");
}

function zeroPad(buf, block) {
	const size = block || 16;
	const rem = buf.length % size;
	return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(size - rem, 0)]);
}

function aesEncryptBase64(keyBuf, ivBuf, plaintext) {
	const cipher = crypto.createCipheriv("aes-256-cbc", keyBuf, ivBuf);
	cipher.setAutoPadding(false);
	const padded = zeroPad(Buffer.from(plaintext, "utf8"), 16);
	return Buffer.concat([cipher.update(padded), cipher.final()]).toString("base64");
}

function aesDecryptString(keyBuf, ivBuf, b64) {
	const decipher = crypto.createDecipheriv("aes-256-cbc", keyBuf, ivBuf);
	decipher.setAutoPadding(false);
	const out = Buffer.concat([decipher.update(Buffer.from(b64, "base64")), decipher.final()]);
	let end = out.length;
	while (end > 0 && out[end - 1] === 0) {
		end--;
	}
	return out.slice(0, end).toString("utf8");
}

function generateSessionKey() {
	const keyBuf = crypto.randomBytes(32);
	const ivBuf = crypto.randomBytes(16);
	return { keyBuf, ivBuf, keyHex: keyBuf.toString("hex"), ivHex: ivBuf.toString("hex") };
}

function randomSalt(bytes) {
	return crypto.randomBytes(bytes || 2).toString("hex");
}
```

Update `module.exports` to add `rsaEncryptBase64, aesEncryptBase64, aesDecryptString, zeroPad, generateSessionKey, randomSalt`.

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/crypto.test.js`
Expected: PASS (11 tests).

- [ ] **Step 5: Lint + commit**

```bash
npx eslint lib/loxone/crypto/LoxoneCrypto.js
git add lib/loxone/crypto/LoxoneCrypto.js test/crypto.test.js
git commit -m "feat(crypto): RSA encrypt, AES-CBC zero-pad, session key, salt"
```

---

## Chunk 2: Binary Protocol (`uuid`, `MessageHeader`, `FrameAssembler`, `EventParser`)

Decoders for the binary WebSocket protocol. Deterministic; tested with hand-built buffers. Spec §7.5, §7.2 (framing).

### Task 2.1: UUID byte→string conversion

**Files:**
- Create: `lib/loxone/protocol/uuid.js`
- Test: `test/uuid.test.js`

- [ ] **Step 1: Write the failing test** — `test/uuid.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { uuidFromBuffer, UUID_BYTES } = require("../lib/loxone/protocol/uuid");

test("uuidFromBuffer decodes Data1 LE / Data2 LE / Data3 LE / Data4[8]", () => {
	// 0d12f989-0060-c82f-ffff2083eaf2523c
	const buf = Buffer.from([
		0x89, 0xf9, 0x12, 0x0d, // Data1 = 0x0d12f989 (LE)
		0x60, 0x00,             // Data2 = 0x0060 (LE)
		0x2f, 0xc8,             // Data3 = 0xc82f (LE)
		0xff, 0xff, 0x20, 0x83, 0xea, 0xf2, 0x52, 0x3c // Data4
	]);
	assert.equal(uuidFromBuffer(buf, 0), "0d12f989-0060-c82f-ffff2083eaf2523c");
	assert.equal(UUID_BYTES, 16);
});

test("uuidFromBuffer honours the offset", () => {
	const buf = Buffer.concat([Buffer.alloc(4, 0), Buffer.from([
		0x01, 0x00, 0x00, 0x00, 0x02, 0x00, 0x03, 0x00, 0, 0, 0, 0, 0, 0, 0, 0
	])]);
	assert.equal(uuidFromBuffer(buf, 4), "00000001-0002-0003-0000000000000000");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/uuid.test.js`
Expected: FAIL — cannot find module `uuid`.

- [ ] **Step 3: Implement** — `lib/loxone/protocol/uuid.js`:

```js
"use strict";
const UUID_BYTES = 16;

function hex(n, width) {
	return n.toString(16).padStart(width, "0");
}

function uuidFromBuffer(buf, offset) {
	const o = offset || 0;
	const d1 = buf.readUInt32LE(o);
	const d2 = buf.readUInt16LE(o + 4);
	const d3 = buf.readUInt16LE(o + 6);
	let tail = "";
	for (let i = 0; i < 8; i++) {
		tail += buf[o + 8 + i].toString(16).padStart(2, "0");
	}
	return `${hex(d1, 8)}-${hex(d2, 4)}-${hex(d3, 4)}-${tail}`;
}

module.exports = { uuidFromBuffer, UUID_BYTES };
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/uuid.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/loxone/protocol/uuid.js test/uuid.test.js
git commit -m "feat(protocol): UUID buffer→string decoding"
```

### Task 2.2: Message header parser

**Files:**
- Create: `lib/loxone/protocol/MessageHeader.js`
- Test: `test/messageHeader.test.js`

- [ ] **Step 1: Write the failing test** — `test/messageHeader.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseHeader, TYPES } = require("../lib/loxone/protocol/MessageHeader");

function header(type, infoByte, len) {
	const b = Buffer.alloc(8);
	b[0] = 0x03;
	b[1] = type;
	b[2] = infoByte;
	b.writeUInt32LE(len, 4);
	return b;
}

test("parseHeader reads type, estimated flag, and LE length", () => {
	const h = parseHeader(header(TYPES.VALUE, 0x00, 240));
	assert.deepEqual(h, { type: 2, estimated: false, length: 240 });
});

test("parseHeader detects the estimated bit", () => {
	assert.equal(parseHeader(header(TYPES.TEXTSTATE, 0x01, 10)).estimated, true);
});

test("parseHeader returns null when first byte is not 0x03", () => {
	const b = header(TYPES.VALUE, 0, 24);
	b[0] = 0x00;
	assert.equal(parseHeader(b), null);
});

test("TYPES enumerates the eight message types", () => {
	assert.deepEqual(TYPES, { TEXT: 0, BINFILE: 1, VALUE: 2, TEXTSTATE: 3, DAYTIMER: 4, OOS: 5, KEEPALIVE: 6, WEATHER: 7 });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/messageHeader.test.js`
Expected: FAIL — cannot find module `MessageHeader`.

- [ ] **Step 3: Implement** — `lib/loxone/protocol/MessageHeader.js`:

```js
"use strict";
const TYPES = { TEXT: 0, BINFILE: 1, VALUE: 2, TEXTSTATE: 3, DAYTIMER: 4, OOS: 5, KEEPALIVE: 6, WEATHER: 7 };
const HEADER_BYTES = 8;

function parseHeader(buf) {
	if (!buf || buf.length < HEADER_BYTES || buf[0] !== 0x03) {
		return null;
	}
	return {
		type: buf[1],
		estimated: (buf[2] & 0x01) === 1,
		length: buf.readUInt32LE(4)
	};
}

module.exports = { parseHeader, TYPES, HEADER_BYTES };
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/messageHeader.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/loxone/protocol/MessageHeader.js test/messageHeader.test.js
git commit -m "feat(protocol): 8-byte message header parser"
```

### Task 2.3: Frame assembler (header→payload pairing)

The state machine that pairs an 8-byte header with its following payload message, drops *estimated* headers (an exact header always follows), emits zero-length messages immediately (keepalive/OOS), and routes text frames. Spec §7.2.

**Files:**
- Create: `lib/loxone/protocol/FrameAssembler.js`
- Test: `test/frameAssembler.test.js`

- [ ] **Step 1: Write the failing test** — `test/frameAssembler.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { FrameAssembler } = require("../lib/loxone/protocol/FrameAssembler");
const { TYPES } = require("../lib/loxone/protocol/MessageHeader");

function header(type, infoByte, len) {
	const b = Buffer.alloc(8);
	b[0] = 0x03; b[1] = type; b[2] = infoByte; b.writeUInt32LE(len, 4);
	return b;
}

test("pairs a value header with its payload", () => {
	const msgs = [];
	const fa = new FrameAssembler({ onText: () => {}, onMessage: (t, p) => msgs.push([t, p]) });
	fa.push(header(TYPES.VALUE, 0, 24), true);
	const payload = Buffer.alloc(24, 5);
	fa.push(payload, true);
	assert.equal(msgs.length, 1);
	assert.equal(msgs[0][0], TYPES.VALUE);
	assert.equal(msgs[0][1].length, 24);
});

test("emits zero-length messages (keepalive) immediately", () => {
	const msgs = [];
	const fa = new FrameAssembler({ onText: () => {}, onMessage: (t, p) => msgs.push([t, p]) });
	fa.push(header(TYPES.KEEPALIVE, 0, 0), true);
	assert.deepEqual(msgs.map((m) => m[0]), [TYPES.KEEPALIVE]);
	assert.equal(msgs[0][1].length, 0);
});

test("drops an estimated header and uses the following exact header", () => {
	const msgs = [];
	const fa = new FrameAssembler({ onText: () => {}, onMessage: (t, p) => msgs.push([t, p]) });
	fa.push(header(TYPES.VALUE, 0x01, 999), true); // estimated -> ignored
	fa.push(header(TYPES.VALUE, 0x00, 24), true);  // exact
	fa.push(Buffer.alloc(24, 1), true);
	assert.equal(msgs.length, 1);
	assert.equal(msgs[0][1].length, 24);
});

test("routes a text frame and clears any pending text header", () => {
	const texts = [];
	const fa = new FrameAssembler({ onText: (s) => texts.push(s), onMessage: () => {} });
	fa.push(header(TYPES.TEXT, 0, 13), true); // announces a text message
	fa.push(Buffer.from("{\"LL\":\"ok\"}"), false);
	assert.deepEqual(texts, ["{\"LL\":\"ok\"}"]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/frameAssembler.test.js`
Expected: FAIL — cannot find module `FrameAssembler`.

- [ ] **Step 3: Implement** — `lib/loxone/protocol/FrameAssembler.js`:

```js
"use strict";
const { parseHeader } = require("./MessageHeader");

class FrameAssembler {
	constructor(handlers) {
		this.onText = handlers.onText;
		this.onMessage = handlers.onMessage;
		this.pending = null;
	}

	push(data, isBinary) {
		if (!isBinary) {
			// A text frame; the header that announced it (if any) is consumed.
			this.pending = null;
			this.onText(Buffer.isBuffer(data) ? data.toString() : String(data));
			return;
		}
		const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
		if (!this.pending) {
			const h = parseHeader(buf);
			if (!h) {
				return; // unexpected non-header binary frame; ignore
			}
			if (h.estimated) {
				return; // an exact header always follows
			}
			if (h.length === 0) {
				this.onMessage(h.type, Buffer.alloc(0));
				return;
			}
			this.pending = h;
			return;
		}
		const h = this.pending;
		this.pending = null;
		this.onMessage(h.type, buf);
	}
}

module.exports = { FrameAssembler };
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/frameAssembler.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/loxone/protocol/FrameAssembler.js test/frameAssembler.test.js
git commit -m "feat(protocol): frame assembler (header/payload pairing)"
```

### Task 2.4: Event-table decoders (value + text)

**Files:**
- Create: `lib/loxone/protocol/EventParser.js`
- Test: `test/eventParser.test.js`

- [ ] **Step 1: Write the failing test** — `test/eventParser.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseValueEvents, parseTextEvents } = require("../lib/loxone/protocol/EventParser");

function uuidBytes(d1) {
	const b = Buffer.alloc(16);
	b.writeUInt32LE(d1, 0);
	return b;
}

test("parseValueEvents decodes 24-byte {uuid, double} records", () => {
	const rec = Buffer.concat([uuidBytes(0x11), Buffer.alloc(8)]);
	rec.writeDoubleLE(21.5, 16);
	const rec2 = Buffer.concat([uuidBytes(0x22), Buffer.alloc(8)]);
	rec2.writeDoubleLE(-1.25, 16);
	const events = parseValueEvents(Buffer.concat([rec, rec2]));
	assert.equal(events.length, 2);
	assert.equal(events[0].uuid, "00000011-0000-0000-0000000000000000");
	assert.equal(events[0].value, 21.5);
	assert.equal(events[1].value, -1.25);
});

test("parseTextEvents decodes {uuid, iconUuid, len, text} with 4-byte padding", () => {
	const text = "Hello"; // length 5 -> padded to 8
	const head = Buffer.concat([uuidBytes(0xaa), uuidBytes(0xbb), Buffer.alloc(4)]);
	head.writeUInt32LE(text.length, 32);
	const padded = Buffer.alloc(8);
	padded.write(text, 0, "utf8");
	const second = Buffer.concat([uuidBytes(0xcc), uuidBytes(0xdd), Buffer.alloc(4)]);
	second.writeUInt32LE(0, 32);
	const events = parseTextEvents(Buffer.concat([head, padded, second]));
	assert.equal(events.length, 2);
	assert.equal(events[0].uuid, "000000aa-0000-0000-0000000000000000");
	assert.equal(events[0].iconUuid, "000000bb-0000-0000-0000000000000000");
	assert.equal(events[0].text, "Hello");
	assert.equal(events[1].text, "");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/eventParser.test.js`
Expected: FAIL — cannot find module `EventParser`.

- [ ] **Step 3: Implement** — `lib/loxone/protocol/EventParser.js`:

```js
"use strict";
const { uuidFromBuffer } = require("./uuid");

const VALUE_RECORD = 24;
const TEXT_FIXED = 36; // uuid(16) + iconUuid(16) + len(4)

function parseValueEvents(buf) {
	const out = [];
	for (let o = 0; o + VALUE_RECORD <= buf.length; o += VALUE_RECORD) {
		out.push({ uuid: uuidFromBuffer(buf, o), value: buf.readDoubleLE(o + 16) });
	}
	return out;
}

function parseTextEvents(buf) {
	const out = [];
	let o = 0;
	while (o + TEXT_FIXED <= buf.length) {
		const uuid = uuidFromBuffer(buf, o);
		const iconUuid = uuidFromBuffer(buf, o + 16);
		const len = buf.readUInt32LE(o + 32);
		const textStart = o + TEXT_FIXED;
		if (textStart + len > buf.length) {
			break;
		}
		const text = buf.slice(textStart, textStart + len).toString("utf8");
		out.push({ uuid, iconUuid, text });
		let advance = TEXT_FIXED + len;
		if (advance % 4 !== 0) {
			advance += 4 - (advance % 4);
		}
		o += advance;
	}
	return out;
}

module.exports = { parseValueEvents, parseTextEvents, VALUE_RECORD };
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/eventParser.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Lint + commit**

```bash
npx eslint lib/loxone/protocol
git add lib/loxone/protocol/EventParser.js test/eventParser.test.js
git commit -m "feat(protocol): value + text event-table decoders"
```

---

## Chunk 3: Command Encryption Builder (`commands.js`)

Builds encrypted command strings over the negotiated session key, framing each command as `salt/{salt}/{cmd}` and rotating the salt with `nextSalt/{prev}/{next}/{cmd}` after a number of uses. Applies `encodeURIComponent` to the Base64 cipher (the crypto layer returns raw Base64). Spec §7.4.

### Task 3.1: `CommandCipher`

**Files:**
- Create: `lib/loxone/protocol/commands.js`
- Test: `test/commands.test.js`

- [ ] **Step 1: Write the failing test** — `test/commands.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { CommandCipher } = require("../lib/loxone/protocol/commands");
const { aesDecryptString } = require("../lib/loxone/crypto/LoxoneCrypto");

const KEY = Buffer.alloc(32, 3);
const IV = Buffer.alloc(16, 4);

function decode(cmd) {
	const cipher = cmd.replace(/^jdev\/sys\/f?enc\//, "");
	return aesDecryptString(KEY, IV, decodeURIComponent(cipher));
}

test("encrypt frames cmd as salt/{salt}/{cmd} under jdev/sys/enc/", () => {
	const cc = new CommandCipher(KEY, IV, { salt: "ab12" });
	const out = cc.encrypt("jdev/sps/enablebinstatusupdate");
	assert.ok(out.startsWith("jdev/sys/enc/"));
	assert.equal(decode(out), "salt/ab12/jdev/sps/enablebinstatusupdate");
});

test("rotates salt with nextSalt/{prev}/{next}/{cmd} after maxUses", () => {
	const cc = new CommandCipher(KEY, IV, { salt: "aaaa", maxUses: 1 });
	cc.encrypt("cmd1"); // consumes the initial salt
	const plain = decode(cc.encrypt("cmd2"));
	assert.match(plain, /^nextSalt\/aaaa\/[0-9a-f]{4}\/cmd2$/);
});

test("encryptFull uses the response-encrypting jdev/sys/fenc/ form", () => {
	const cc = new CommandCipher(KEY, IV, { salt: "ab12" });
	assert.ok(cc.encryptFull("cmd").startsWith("jdev/sys/fenc/"));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/commands.test.js`
Expected: FAIL — cannot find module `commands`.

- [ ] **Step 3: Implement** — `lib/loxone/protocol/commands.js`:

```js
"use strict";
const { aesEncryptBase64, randomSalt } = require("../crypto/LoxoneCrypto");

class CommandCipher {
	constructor(keyBuf, ivBuf, options) {
		const opts = options || {};
		this.keyBuf = keyBuf;
		this.ivBuf = ivBuf;
		this.salt = opts.salt || randomSalt(2);
		this.maxUses = opts.maxUses || 20;
		this.uses = 0;
	}

	_plaintextFor(cmd) {
		if (this.uses >= this.maxUses) {
			const prev = this.salt;
			const next = randomSalt(2);
			this.salt = next;
			this.uses = 1;
			return `nextSalt/${prev}/${next}/${cmd}`;
		}
		this.uses += 1;
		return `salt/${this.salt}/${cmd}`;
	}

	_wrap(prefix, cmd) {
		const cipher = encodeURIComponent(aesEncryptBase64(this.keyBuf, this.ivBuf, this._plaintextFor(cmd)));
		return `${prefix}/${cipher}`;
	}

	encrypt(cmd) {
		return this._wrap("jdev/sys/enc", cmd);
	}

	encryptFull(cmd) {
		return this._wrap("jdev/sys/fenc", cmd);
	}
}

module.exports = { CommandCipher };
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/commands.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Lint + commit**

```bash
npx eslint lib/loxone/protocol/commands.js
git add lib/loxone/protocol/commands.js test/commands.test.js
git commit -m "feat(protocol): encrypted command builder with salt rotation"
```

---

## Chunk 4: Authentication (`parseLL`, `TokenStore`, `Authenticator`)

Token acquisition and token-based authentication against a small `requester` interface (`command(cmd)` / `commandEncrypted(cmd)` → parsed `LL` response), plus token persistence. The real requester is built in Chunk 6; here everything is tested against a mock. Spec §7.3.

### Task 4.1: `parseLL` response helper

**Files:**
- Create: `lib/loxone/protocol/response.js`
- Test: `test/response.test.js`

- [ ] **Step 1: Write the failing test** — `test/response.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseLL } = require("../lib/loxone/protocol/response");

test("parseLL reads control, value, and numeric Code", () => {
	const r = parseLL("{\"LL\":{\"control\":\"dev/cfg/api\",\"value\":\"hi\",\"Code\":\"200\"}}");
	assert.deepEqual(r, { control: "dev/cfg/api", value: "hi", code: 200 });
});

test("parseLL accepts lowercase 'code' and object values", () => {
	const r = parseLL({ LL: { control: "c", value: { token: "t" }, code: 200 } });
	assert.equal(r.code, 200);
	assert.deepEqual(r.value, { token: "t" });
});

test("parseLL tolerates a missing LL envelope", () => {
	const r = parseLL({});
	assert.equal(r.code, undefined);
	assert.equal(r.value, undefined);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/response.test.js`
Expected: FAIL — cannot find module `response`.

- [ ] **Step 3: Implement** — `lib/loxone/protocol/response.js`:

```js
"use strict";

function parseLL(input) {
	const json = typeof input === "string" ? JSON.parse(input) : input;
	const ll = (json && (json.LL || json.ll)) || {};
	const codeRaw = ll.Code !== undefined ? ll.Code : ll.code;
	return {
		control: ll.control,
		value: ll.value,
		code: codeRaw !== undefined ? Number(codeRaw) : undefined
	};
}

module.exports = { parseLL };
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/response.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/loxone/protocol/response.js test/response.test.js
git commit -m "feat(protocol): parseLL response envelope helper"
```

### Task 4.2: `TokenStore` + token validity

**Files:**
- Create: `lib/loxone/auth/TokenStore.js`
- Test: `test/tokenStore.test.js`

- [ ] **Step 1: Write the failing test** — `test/tokenStore.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { TokenStore, isTokenUsable, LOX_EPOCH } = require("../lib/loxone/auth/TokenStore");

test("save/load/clear round-trips per host+user", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loxtok-"));
	const store = new TokenStore(path.join(dir, "tokens.json"));
	assert.equal(store.load("ms1", "mirror"), null);
	store.save("ms1", "mirror", { token: "t", validUntil: 123, hashAlg: "SHA256" });
	assert.deepEqual(store.load("ms1", "mirror"), { token: "t", validUntil: 123, hashAlg: "SHA256" });
	assert.equal(store.load("ms1", "other"), null); // scoped by user
	store.clear("ms1", "mirror");
	assert.equal(store.load("ms1", "mirror"), null);
});

test("isTokenUsable respects validUntil (Loxone epoch) and the threshold", () => {
	const nowMs = 1_700_000_000_000;
	const nowSec = Math.floor(nowMs / 1000);
	const future = { token: "t", validUntil: nowSec - LOX_EPOCH + 1000 };
	const past = { token: "t", validUntil: nowSec - LOX_EPOCH - 10 };
	assert.equal(isTokenUsable(future, nowMs, 60), true);
	assert.equal(isTokenUsable(past, nowMs, 60), false);
	assert.equal(isTokenUsable(null, nowMs, 60), false);
	assert.equal(isTokenUsable({ token: "t" }, nowMs, 60), false); // no validUntil
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/tokenStore.test.js`
Expected: FAIL — cannot find module `TokenStore`.

- [ ] **Step 3: Implement** — `lib/loxone/auth/TokenStore.js`:

```js
"use strict";
const fs = require("fs");
const path = require("path");

const LOX_EPOCH = Date.UTC(2009, 0, 1) / 1000; // seconds since unix epoch at 2009-01-01

class TokenStore {
	constructor(filePath) {
		this.filePath = filePath;
	}

	_all() {
		try {
			return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
		} catch (e) {
			return {};
		}
	}

	_write(all) {
		fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
		fs.writeFileSync(this.filePath, JSON.stringify(all, null, 2));
	}

	key(host, user) {
		return `${host}::${user}`;
	}

	load(host, user) {
		return this._all()[this.key(host, user)] || null;
	}

	save(host, user, record) {
		const all = this._all();
		all[this.key(host, user)] = record;
		this._write(all);
	}

	clear(host, user) {
		const all = this._all();
		delete all[this.key(host, user)];
		this._write(all);
	}
}

function tokenSecondsRemaining(validUntilLox, nowMs) {
	return (LOX_EPOCH + validUntilLox) - Math.floor(nowMs / 1000);
}

function isTokenUsable(record, nowMs, minRemainingSec) {
	if (!record || !record.token || typeof record.validUntil !== "number") {
		return false;
	}
	return tokenSecondsRemaining(record.validUntil, nowMs) > (minRemainingSec || 0);
}

module.exports = { TokenStore, tokenSecondsRemaining, isTokenUsable, LOX_EPOCH };
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/tokenStore.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/loxone/auth/TokenStore.js test/tokenStore.test.js
git commit -m "feat(auth): token persistence + validity check"
```

### Task 4.3: `Authenticator` (acquire + token auth)

**Files:**
- Create: `lib/loxone/auth/Authenticator.js`
- Test: `test/authenticator.test.js`

- [ ] **Step 1: Write the failing test** — `test/authenticator.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Auth = require("../lib/loxone/auth/Authenticator");
const C = require("../lib/loxone/crypto/LoxoneCrypto");

function mockRequester(responses) {
	const sent = [];
	return {
		sent,
		command(cmd) { sent.push(["plain", cmd]); return Promise.resolve(responses.shift()); },
		commandEncrypted(cmd) { sent.push(["enc", cmd]); return Promise.resolve(responses.shift()); }
	};
}

test("acquireToken does getkey2 then ENCRYPTED getjwt with the correct hash", async () => {
	const keyHex = "00112233445566778899aabbccddeeff";
	const userSalt = "5e3d";
	const req = mockRequester([
		{ code: 200, value: { key: keyHex, salt: userSalt, hashAlg: "SHA256" } },
		{ code: 200, value: { token: "jwt123", validUntil: 999, tokenRights: 4, unsecurePass: false, key: "newkey" } }
	]);
	const rec = await Auth.acquireToken(req, {
		user: "mirror", password: "pw", permission: "app", clientUuid: "uuid-1", clientInfo: "Mirror Test"
	});
	assert.equal(req.sent[0][1], "jdev/sys/getkey2/mirror");
	assert.equal(req.sent[1][0], "enc"); // getjwt MUST be encrypted (spec §7.3)
	const pwHash = C.passwordHash("pw", userSalt, "SHA256");
	const hash = C.credentialHash("mirror", pwHash, keyHex, "SHA256");
	assert.ok(req.sent[1][1].startsWith(`jdev/sys/getjwt/${hash}/mirror/4/uuid-1/`));
	assert.equal(rec.token, "jwt123");
	assert.equal(rec.validUntil, 999);
	assert.equal(rec.hashAlg, "SHA256");
});

test("authWithToken hashes the token with the getkey result", async () => {
	const keyHex = "0011223344556677";
	const req = mockRequester([
		{ code: 200, value: keyHex },
		{ code: 200, value: {} }
	]);
	const ok = await Auth.authWithToken(req, { user: "mirror", token: "jwt123", hashAlg: "SHA1" });
	assert.equal(req.sent[0][1], "jdev/sys/getkey");
	assert.equal(req.sent[1][1], `authwithtoken/${C.tokenHash("jwt123", keyHex, "SHA1")}/mirror`);
	assert.equal(ok, true);
});

test("authWithToken returns false on non-200", async () => {
	const req = mockRequester([{ code: 200, value: "00ff" }, { code: 401, value: {} }]);
	assert.equal(await Auth.authWithToken(req, { user: "m", token: "t", hashAlg: "SHA256" }), false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/authenticator.test.js`
Expected: FAIL — cannot find module `Authenticator`.

- [ ] **Step 3: Implement** — `lib/loxone/auth/Authenticator.js`:

```js
"use strict";
const C = require("../crypto/LoxoneCrypto");

const PERMISSION_IDS = { web: 2, app: 4 };

function normalizeAlg(alg) {
	return alg === "SHA256" ? "SHA256" : "SHA1";
}

async function acquireToken(requester, opts) {
	const { user, password, permission, clientUuid, clientInfo } = opts;
	const keyResp = await requester.command(`jdev/sys/getkey2/${encodeURIComponent(user)}`);
	const info = keyResp.value;
	const hashAlg = normalizeAlg(info.hashAlg);
	const pwHash = C.passwordHash(password, info.salt, hashAlg);
	const hash = C.credentialHash(user, pwHash, info.key, hashAlg);
	const permId = PERMISSION_IDS[permission] || PERMISSION_IDS.app;
	const cmd = `jdev/sys/getjwt/${hash}/${encodeURIComponent(user)}/${permId}/${clientUuid}/${encodeURIComponent(clientInfo)}`;
	const resp = await requester.commandEncrypted(cmd);
	const v = resp.value;
	return {
		token: v.token,
		validUntil: v.validUntil,
		tokenRights: v.tokenRights,
		unsecurePass: v.unsecurePass,
		key: v.key,
		hashAlg
	};
}

async function authWithToken(requester, opts) {
	const { user, token, hashAlg } = opts;
	const keyResp = await requester.command("jdev/sys/getkey");
	const keyHex = typeof keyResp.value === "string" ? keyResp.value : keyResp.value.key;
	const hash = C.tokenHash(token, keyHex, normalizeAlg(hashAlg));
	const resp = await requester.command(`authwithtoken/${hash}/${encodeURIComponent(user)}`);
	return resp.code === 200;
}

module.exports = { acquireToken, authWithToken, PERMISSION_IDS };
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/authenticator.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Lint + commit**

```bash
npx eslint lib/loxone/auth
git add lib/loxone/auth/Authenticator.js test/authenticator.test.js
git commit -m "feat(auth): token acquisition + token-based authentication"
```

---

## Chunk 5: Structure (`Structure` + name resolution)

Parses `LoxAPP3.json`, indexes controls/rooms/categories, resolves config entries (UUID or name, optionally room-qualified) to controls, and translates a control's raw state UUIDs into a named semantic-state object. Spec §7.6. Tests use a small inline fixture (the real `sample-data/LoxAPP3.json` is bound in Plan 2).

### Task 5.1: Structure parsing, indexing & name resolution

**Files:**
- Create: `lib/loxone/structure/Structure.js`
- Test: `test/structure.test.js`

- [ ] **Step 1: Write the failing test** — `test/structure.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Structure, NotFoundError, AmbiguousNameError, looksLikeUuid } = require("../lib/loxone/structure/Structure");

const U = (p) => `${p}-0000-0000-0000000000000000`;

function fixture() {
	const ROOM_WZ = U("00aa0001");
	const ROOM_TK = U("00aa0002");
	const ROOM_HID = U("00aa0003");
	const CAT_EN = U("00cc0001");
	return {
		lastModified: "2024-01-01 12:00:00",
		rooms: {
			[ROOM_WZ]: { uuid: ROOM_WZ, name: "Wohnzimmer" },
			[ROOM_TK]: { uuid: ROOM_TK, name: "Technik" },
			[ROOM_HID]: { uuid: ROOM_HID, name: "Versteckt" }
		},
		cats: { [CAT_EN]: { uuid: CAT_EN, name: "Energie" } },
		controls: {
			[U("11111111")]: { uuidAction: U("11111111"), name: "Wallbox", type: "Wallbox2", room: ROOM_TK, cat: CAT_EN,
				states: { power: U("aaaa1111"), sessionEnergy: U("aaaa2222") } },
			[U("22222222")]: { uuidAction: U("22222222"), name: "Licht", type: "Switch", room: ROOM_WZ,
				states: { active: U("bbbb1111") } },
			[U("33333333")]: { uuidAction: U("33333333"), name: "Licht", type: "Switch", room: ROOM_TK,
				states: { active: U("bbbb2222") } },
			[U("44444444")]: { uuidAction: U("44444444"), name: "Geheim", type: "", room: ROOM_HID, states: {} }
		},
		globalStates: { notifications: U("ffff0000") }
	};
}

test("looksLikeUuid distinguishes UUIDs from names", () => {
	assert.equal(looksLikeUuid(U("11111111")), true);
	assert.equal(looksLikeUuid("Wallbox"), false);
});

test("resolve by UUID returns the control", () => {
	const s = new Structure(fixture());
	assert.equal(s.resolve(U("11111111")).name, "Wallbox");
});

test("resolve by unique name returns the control (case-insensitive)", () => {
	const s = new Structure(fixture());
	assert.equal(s.resolve("  wallbox ").uuid, U("11111111"));
});

test("resolve of an ambiguous name throws with candidates incl. room", () => {
	const s = new Structure(fixture());
	assert.throws(() => s.resolve("Licht"), (e) => {
		assert.ok(e instanceof AmbiguousNameError);
		assert.equal(e.candidates.length, 2);
		assert.deepEqual(e.candidates.map((c) => c.room).sort(), ["Technik", "Wohnzimmer"]);
		return true;
	});
});

test("resolve of a room-qualified name disambiguates", () => {
	const s = new Structure(fixture());
	assert.equal(s.resolve("Wohnzimmer/Licht").uuid, U("22222222"));
	assert.equal(s.resolve("Technik: Licht").uuid, U("33333333"));
});

test("resolve of a missing name/uuid throws NotFoundError", () => {
	const s = new Structure(fixture());
	assert.throws(() => s.resolve("Nope"), NotFoundError);
	assert.throws(() => s.resolve(U("99999999")), NotFoundError);
});

test("controlsInRoom returns top-level controls by room name or uuid", () => {
	const s = new Structure(fixture());
	assert.deepEqual(s.controlsInRoom("Technik").map((c) => c.name).sort(), ["Licht", "Wallbox"]);
	assert.equal(s.controlsInRoom(U("00aa0001")).length, 1); // Wohnzimmer, by UUID key
});

test("excludes empty-type controls ('not visualized') from name resolution and room listings", () => {
	const s = new Structure(fixture());
	assert.throws(() => s.resolve("Geheim"), NotFoundError);
	assert.equal(s.controlsInRoom("Versteckt").length, 0);
});

test("statesForUuid maps a state UUID back to its control + state name", () => {
	const s = new Structure(fixture());
	assert.deepEqual(s.statesForUuid(U("aaaa1111")), [{ controlUuid: U("11111111"), stateName: "power" }]);
});

test("namedStates resolves a control's states from a value map (missing -> null)", () => {
	const s = new Structure(fixture());
	const values = new Map([[U("aaaa1111"), 11]]);
	assert.deepEqual(s.namedStates(U("11111111"), values), { power: 11, sessionEnergy: null });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/structure.test.js`
Expected: FAIL — cannot find module `Structure`.

- [ ] **Step 3: Implement** — `lib/loxone/structure/Structure.js`:

```js
"use strict";

class NotFoundError extends Error {
	constructor(entry) {
		super(`Loxone control not found: ${entry}`);
		this.name = "NotFoundError";
		this.entry = entry;
	}
}

class AmbiguousNameError extends Error {
	constructor(entry, candidates) {
		super(`Loxone control name is ambiguous: ${entry}`);
		this.name = "AmbiguousNameError";
		this.entry = entry;
		this.candidates = candidates;
	}
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{16}$/;

function looksLikeUuid(s) {
	return UUID_RE.test(String(s).trim());
}

function norm(s) {
	return String(s).trim().toLowerCase();
}

class Structure {
	constructor(json) {
		this.raw = json;
		this.lastModified = json.lastModified;
		this.rooms = json.rooms || {};
		this.cats = json.cats || {};
		this.globalStates = json.globalStates || {};
		this.controls = {};
		this._byName = new Map();
		this._stateIndex = new Map();
		this._index(json.controls || {});
	}

	_addControl(control, isSub) {
		const uuid = control.uuidAction || control.uuid;
		if (!uuid) {
			return;
		}
		control.uuid = uuid;
		control._top = !isSub;
		this.controls[uuid] = control;
		// Empty-type controls "should not be visualized" (Structure File doc) -> keep out of name index.
		if (!isSub && control.type) {
			const key = norm(control.name);
			if (!this._byName.has(key)) {
				this._byName.set(key, []);
			}
			this._byName.get(key).push(control);
		}
		const states = control.states || {};
		Object.keys(states).forEach((stateName) => {
			const su = states[stateName];
			const list = Array.isArray(su) ? su : [su];
			list.forEach((sUuid) => {
				if (typeof sUuid !== "string") {
					return;
				}
				if (!this._stateIndex.has(sUuid)) {
					this._stateIndex.set(sUuid, []);
				}
				this._stateIndex.get(sUuid).push({ controlUuid: uuid, stateName });
			});
		});
	}

	_index(controls) {
		Object.keys(controls).forEach((uuid) => {
			const c = controls[uuid];
			this._addControl(c, false);
			if (c.subControls) {
				Object.keys(c.subControls).forEach((sUuid) => this._addControl(c.subControls[sUuid], true));
			}
		});
	}

	getControl(uuid) {
		return this.controls[uuid] || null;
	}

	roomName(uuid) {
		return this.rooms[uuid] ? this.rooms[uuid].name : undefined;
	}

	catName(uuid) {
		return this.cats[uuid] ? this.cats[uuid].name : undefined;
	}

	resolve(entry) {
		const raw = String(entry).trim();
		if (looksLikeUuid(raw)) {
			const c = this.getControl(raw);
			if (!c) {
				throw new NotFoundError(entry);
			}
			return c;
		}
		let roomQualifier = null;
		let name = raw;
		// Room-qualifier split. Assumes control/room names do not themselves contain "/" or ":".
		const sepIdx = raw.indexOf("/") >= 0 ? raw.indexOf("/") : raw.indexOf(":");
		if (sepIdx >= 0) {
			roomQualifier = norm(raw.slice(0, sepIdx));
			name = raw.slice(sepIdx + 1).trim();
		}
		let candidates = this._byName.get(norm(name)) || [];
		if (roomQualifier) {
			candidates = candidates.filter((c) => norm(this.roomName(c.room) || "") === roomQualifier);
		}
		if (candidates.length === 0) {
			throw new NotFoundError(entry);
		}
		if (candidates.length > 1) {
			throw new AmbiguousNameError(entry, candidates.map((c) => ({ uuid: c.uuid, name: c.name, room: this.roomName(c.room) })));
		}
		return candidates[0];
	}

	_uuidByName(map, name) {
		const n = norm(name);
		return Object.keys(map).find((u) => norm(map[u].name) === n) || null;
	}

	controlsInRoom(roomEntry) {
		// Accept a direct room key (UUID) or a room name; skip non-visualized (empty-type) controls.
		const room = this.rooms[roomEntry] ? roomEntry : this._uuidByName(this.rooms, roomEntry);
		return Object.values(this.controls).filter((c) => c._top && c.type && c.room === room);
	}

	controlsInCategory(catEntry) {
		const cat = this.cats[catEntry] ? catEntry : this._uuidByName(this.cats, catEntry);
		return Object.values(this.controls).filter((c) => c._top && c.type && c.cat === cat);
	}

	statesForUuid(stateUuid) {
		return this._stateIndex.get(stateUuid) || [];
	}

	namedStates(controlUuid, valueByStateUuid) {
		const c = this.getControl(controlUuid);
		if (!c || !c.states) {
			return {};
		}
		const out = {};
		Object.keys(c.states).forEach((stateName) => {
			const su = c.states[stateName];
			const key = Array.isArray(su) ? su[0] : su;
			out[stateName] = valueByStateUuid.has(key) ? valueByStateUuid.get(key) : null;
		});
		return out;
	}
}

module.exports = { Structure, NotFoundError, AmbiguousNameError, looksLikeUuid };
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/structure.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Lint + commit**

```bash
npx eslint lib/loxone/structure
git add lib/loxone/structure/Structure.js test/structure.test.js
git commit -m "feat(structure): LoxAPP3.json parsing, indexing, name resolution"
```

---

## Chunk 6: Network Helpers & Transport (`net/`, `transport/`)

The pieces that talk to the wire: public-key normalization, apiKey value parsing, an HTTP JSON getter, reconnect backoff, the FIFO request/response correlator, and the real `ws`-based transport. These live under a new `lib/loxone/net/` subdir (the spec's §6 tree is illustrative; `net/` groups the HTTP + correlation helpers). Spec §7.1, §7.2.

### Task 6.1: `normalizePublicKey`

The Miniserver's `getPublicKey` returns the RSA public key wrapped in `CERTIFICATE` markers, often on a single line. Convert it to a PEM `PUBLIC KEY` that Node's `crypto.publicEncrypt` accepts. Spec §7.1, §7.4.

**Files:**
- Create: `lib/loxone/net/publicKey.js`
- Test: `test/publicKey.test.js`

- [ ] **Step 1: Write the failing test** — `test/publicKey.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { normalizePublicKey } = require("../lib/loxone/net/publicKey");

test("rebuilds a usable PEM from Loxone's single-line CERTIFICATE-wrapped key", () => {
	const { publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
	const spki = publicKey.export({ type: "spki", format: "pem" }).toString();
	const body = spki.replace(/-----BEGIN PUBLIC KEY-----/, "").replace(/-----END PUBLIC KEY-----/, "").replace(/\s+/g, "");
	const loxoneStyle = `-----BEGIN CERTIFICATE-----${body}-----END CERTIFICATE-----`;
	const pem = normalizePublicKey(loxoneStyle);
	assert.match(pem, /-----BEGIN PUBLIC KEY-----/);
	// Normalization must preserve the key: identical SPKI DER to the original (portable across Node versions).
	const origDer = crypto.createPublicKey(spki).export({ type: "spki", format: "der" });
	const normDer = crypto.createPublicKey(pem).export({ type: "spki", format: "der" });
	assert.ok(origDer.equals(normDer));
	// ...and the normalized PEM is usable for PKCS#1 encryption (256-byte block for RSA-2048).
	const enc = crypto.publicEncrypt({ key: pem, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from("k:v"));
	assert.equal(Buffer.from(enc).length, 256);
});

test("passes through an already-valid PEM", () => {
	const { publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
	const spki = publicKey.export({ type: "spki", format: "pem" }).toString();
	const pem = normalizePublicKey(spki);
	assert.doesNotThrow(() => crypto.publicEncrypt({ key: pem, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from("x")));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/publicKey.test.js`
Expected: FAIL — cannot find module `publicKey`.

- [ ] **Step 3: Implement** — `lib/loxone/net/publicKey.js`:

```js
"use strict";

function normalizePublicKey(raw) {
	let key = String(raw).trim()
		.replace(/-----BEGIN CERTIFICATE-----/g, "-----BEGIN PUBLIC KEY-----")
		.replace(/-----END CERTIFICATE-----/g, "-----END PUBLIC KEY-----");
	const body = key
		.replace(/-----BEGIN PUBLIC KEY-----/, "")
		.replace(/-----END PUBLIC KEY-----/, "")
		.replace(/\s+/g, "");
	if (!body) {
		return key;
	}
	const wrapped = (body.match(/.{1,64}/g) || [body]).join("\n");
	return `-----BEGIN PUBLIC KEY-----\n${wrapped}\n-----END PUBLIC KEY-----\n`;
}

module.exports = { normalizePublicKey };
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/publicKey.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/loxone/net/publicKey.js test/publicKey.test.js
git commit -m "feat(net): normalize Miniserver public key to usable PEM"
```

### Task 6.2: `parseApiKeyValue`

The `jdev/cfg/apiKey` response carries its payload as a string with **single quotes**. Parse it tolerantly. Spec §7.1.

**Files:**
- Create: `lib/loxone/net/apiKey.js`
- Test: `test/apiKey.test.js`

- [ ] **Step 1: Write the failing test** — `test/apiKey.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseApiKeyValue } = require("../lib/loxone/net/apiKey");

test("parses single-quoted Loxone apiKey payload", () => {
	const v = "{'snr': 'EE:11', 'version': '14.5.0.0', 'httpsStatus': 1, 'local': true}";
	assert.deepEqual(parseApiKeyValue(v), { snr: "EE:11", version: "14.5.0.0", httpsStatus: 1, local: true });
});

test("passes through standard JSON strings and objects", () => {
	assert.deepEqual(parseApiKeyValue("{\"a\":1}"), { a: 1 });
	assert.deepEqual(parseApiKeyValue({ a: 2 }), { a: 2 });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/apiKey.test.js`
Expected: FAIL — cannot find module `apiKey`.

- [ ] **Step 3: Implement** — `lib/loxone/net/apiKey.js`:

```js
"use strict";

function parseApiKeyValue(value) {
	if (value && typeof value === "object") {
		return value;
	}
	const s = String(value);
	try {
		return JSON.parse(s);
	} catch (e) {
		return JSON.parse(s.replace(/'/g, "\""));
	}
}

module.exports = { parseApiKeyValue };
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/apiKey.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/loxone/net/apiKey.js test/apiKey.test.js
git commit -m "feat(net): tolerant apiKey value parser"
```

### Task 6.3: `httpGetJson`

**Files:**
- Create: `lib/loxone/net/http.js`
- Test: `test/http.test.js`

- [ ] **Step 1: Write the failing test** — `test/http.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { httpGetJson } = require("../lib/loxone/net/http");

test("fetches and JSON-parses a response", async () => {
	const server = http.createServer((req, res) => {
		res.setHeader("Content-Type", "application/json");
		res.end(JSON.stringify({ LL: { control: req.url, value: "ok", Code: "200" } }));
	});
	await new Promise((r) => server.listen(0, r));
	const { port } = server.address();
	try {
		const json = await httpGetJson(`http://127.0.0.1:${port}/jdev/cfg/apiKey`);
		assert.equal(json.LL.value, "ok");
	} finally {
		server.close();
	}
});

test("rejects on invalid JSON", async () => {
	const server = http.createServer((req, res) => res.end("not json"));
	await new Promise((r) => server.listen(0, r));
	const { port } = server.address();
	try {
		await assert.rejects(() => httpGetJson(`http://127.0.0.1:${port}/x`), /Invalid JSON/);
	} finally {
		server.close();
	}
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/http.test.js`
Expected: FAIL — cannot find module `http` (our module).

- [ ] **Step 3: Implement** — `lib/loxone/net/http.js`:

```js
"use strict";
const http = require("http");
const https = require("https");

function httpGetJson(urlString) {
	return new Promise((resolve, reject) => {
		const lib = urlString.startsWith("https") ? https : http;
		const req = lib.get(urlString, (res) => {
			let data = "";
			res.setEncoding("utf8");
			res.on("data", (chunk) => {
				data += chunk;
			});
			res.on("end", () => {
				try {
					resolve(JSON.parse(data));
				} catch (e) {
					reject(new Error(`Invalid JSON from ${urlString}`));
				}
			});
		});
		req.on("error", reject);
	});
}

module.exports = { httpGetJson };
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/http.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/loxone/net/http.js test/http.test.js
git commit -m "feat(net): http(s) JSON getter for apiKey/getPublicKey"
```

### Task 6.4: `computeBackoff`

**Files:**
- Create: `lib/loxone/net/backoff.js`
- Test: `test/backoff.test.js`

- [ ] **Step 1: Write the failing test** — `test/backoff.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { computeBackoff } = require("../lib/loxone/net/backoff");

test("grows exponentially and caps at max", () => {
	assert.equal(computeBackoff(1, 60000, 1000), 1000);
	assert.equal(computeBackoff(2, 60000, 1000), 2000);
	assert.equal(computeBackoff(3, 60000, 1000), 4000);
	assert.equal(computeBackoff(20, 60000, 1000), 60000);
});

test("never below the base and tolerates attempt 0", () => {
	assert.equal(computeBackoff(0, 60000, 1000), 1000);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/backoff.test.js`
Expected: FAIL — cannot find module `backoff`.

- [ ] **Step 3: Implement** — `lib/loxone/net/backoff.js`:

```js
"use strict";

function computeBackoff(attempt, maxMs, baseMs) {
	const base = baseMs || 1000;
	const exp = base * Math.pow(2, Math.max(0, attempt - 1));
	return Math.min(maxMs, exp);
}

module.exports = { computeBackoff };
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/backoff.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/loxone/net/backoff.js test/backoff.test.js
git commit -m "feat(net): exponential reconnect backoff"
```

### Task 6.5: `Requester` (FIFO command/response correlation)

Sends text commands and resolves them, in order, against incoming text responses. `command` parses the `LL` envelope; `commandRaw` resolves the raw text (for the structure file, which is not an `LL` envelope); `commandEncrypted` wraps via the session `CommandCipher`. Spec §7.2, §8.1.

**Files:**
- Create: `lib/loxone/net/Requester.js`
- Test: `test/requester.test.js`

- [ ] **Step 1: Write the failing test** — `test/requester.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Requester } = require("../lib/loxone/net/Requester");

test("command resolves with parsed LL responses in FIFO order", async () => {
	const sent = [];
	const r = new Requester((c) => sent.push(c));
	const p1 = r.command("a");
	const p2 = r.command("b");
	assert.deepEqual(sent, ["a", "b"]);
	r.handleText("{\"LL\":{\"value\":\"1\",\"Code\":\"200\"}}");
	r.handleText("{\"LL\":{\"value\":\"2\",\"Code\":\"200\"}}");
	assert.equal((await p1).value, "1");
	assert.equal((await p2).value, "2");
});

test("commandRaw resolves with the raw text (e.g. structure file)", async () => {
	const r = new Requester(() => {});
	const p = r.commandRaw("data/LoxAPP3.json");
	r.handleText("{\"lastModified\":\"x\"}");
	assert.equal(await p, "{\"lastModified\":\"x\"}");
});

test("commandEncrypted rejects without a session cipher", async () => {
	const r = new Requester(() => {});
	await assert.rejects(() => r.commandEncrypted("x"), /session cipher/);
});

test("commandEncrypted sends the cipher-wrapped command", async () => {
	const sent = [];
	const r = new Requester((c) => sent.push(c));
	r.setCipher({ encrypt: (cmd) => `ENC(${cmd})` });
	const p = r.commandEncrypted("jdev/sys/getjwt/...");
	assert.equal(sent[0], "ENC(jdev/sys/getjwt/...)");
	r.handleText("{\"LL\":{\"value\":{\"token\":\"t\"},\"Code\":\"200\"}}");
	assert.deepEqual((await p).value, { token: "t" });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/requester.test.js`
Expected: FAIL — cannot find module `Requester`.

- [ ] **Step 3: Implement** — `lib/loxone/net/Requester.js`:

```js
"use strict";
const { parseLL } = require("../protocol/response");

class Requester {
	constructor(send) {
		this.send = send;
		this.queue = [];
		this.cipher = null;
	}

	setCipher(cipher) {
		this.cipher = cipher;
	}

	handleText(text) {
		const pending = this.queue.shift();
		if (!pending) {
			return;
		}
		try {
			pending.resolve(pending.raw ? text : parseLL(text));
		} catch (e) {
			pending.reject(e);
		}
	}

	_enqueue(cmd, raw) {
		return new Promise((resolve, reject) => {
			this.queue.push({ resolve, reject, raw });
			this.send(cmd);
		});
	}

	command(cmd) {
		return this._enqueue(cmd, false);
	}

	commandRaw(cmd) {
		return this._enqueue(cmd, true);
	}

	commandEncrypted(cmd) {
		if (!this.cipher) {
			return Promise.reject(new Error("No session cipher established"));
		}
		return this._enqueue(this.cipher.encrypt(cmd), false);
	}
}

module.exports = { Requester };
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/requester.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/loxone/net/Requester.js test/requester.test.js
git commit -m "feat(net): FIFO request/response correlator"
```

### Task 6.6: `WebSocketTransport`

Thin `ws` wrapper: opens with the `remotecontrol` subprotocol and emits every frame as `("frame", data, isBinary)` (text frames arrive with `isBinary=false` — the contract `FrameAssembler` relies on), plus `close`/`error`. Integration-tested against a local `ws` server.

**Files:**
- Create: `lib/loxone/transport/WebSocketTransport.js`
- Test: `test/webSocketTransport.test.js`

- [ ] **Step 1: Write the failing test** — `test/webSocketTransport.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { WebSocketServer } = require("ws");
const { WebSocketTransport } = require("../lib/loxone/transport/WebSocketTransport");

test("forwards text frames (isBinary=false) and binary frames (isBinary=true)", async () => {
	const wss = new WebSocketServer({ port: 0 });
	wss.on("connection", (socket) => {
		socket.send("hello-text");
		socket.send(Buffer.from([1, 2, 3]));
	});
	await new Promise((r) => wss.on("listening", r));
	const { port } = wss.address();
	const t = new WebSocketTransport();
	const frames = [];
	t.on("frame", (data, isBinary) => frames.push([isBinary, data]));
	await t.open(`ws://127.0.0.1:${port}`, "remotecontrol");
	await new Promise((r) => setTimeout(r, 150));
	t.close();
	wss.close();
	const text = frames.find((f) => f[0] === false);
	const bin = frames.find((f) => f[0] === true);
	assert.ok(text, "expected a text frame");
	assert.equal(text[1].toString(), "hello-text");
	assert.ok(bin, "expected a binary frame");
	assert.deepEqual(Buffer.from(bin[1]), Buffer.from([1, 2, 3]));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/webSocketTransport.test.js`
Expected: FAIL — cannot find module `WebSocketTransport`.

- [ ] **Step 3: Implement** — `lib/loxone/transport/WebSocketTransport.js`:

```js
"use strict";
const WebSocket = require("ws");
const EventEmitter = require("events");

class WebSocketTransport extends EventEmitter {
	constructor() {
		super();
		this.ws = null;
	}

	open(url, subprotocol) {
		return new Promise((resolve, reject) => {
			this.ws = new WebSocket(url, subprotocol);
			this.ws.on("open", () => resolve());
			this.ws.on("message", (data, isBinary) => this.emit("frame", data, isBinary));
			this.ws.on("close", (code, reason) => this.emit("close", { code, reason: reason ? reason.toString() : "" }));
			this.ws.on("error", (err) => {
				this.emit("error", err);
				reject(err);
			});
		});
	}

	sendText(text) {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(text);
		}
	}

	close() {
		if (this.ws) {
			this.ws.close();
		}
	}
}

module.exports = { WebSocketTransport };
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/webSocketTransport.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Lint + commit**

```bash
npx eslint lib/loxone/net lib/loxone/transport
git add lib/loxone/net lib/loxone/transport test/publicKey.test.js test/apiKey.test.js test/http.test.js test/backoff.test.js test/requester.test.js test/webSocketTransport.test.js
git commit -m "feat(transport): ws transport + net helpers (publicKey, apiKey, http, backoff, requester)"
```

---

## Chunk 7: `IconCache` + `LoxoneClient` (integration) + public entry

The capstone: the icon fetch/recolor cache, and the `LoxoneClient` state machine that wires every prior unit into the `connect → keyexchange → auth → structure → subscribe → live` flow, emitting per-control semantic state. Tested end-to-end against a fake transport that scripts the handshake. Spec §7.1, §7.3, §7.6, §7.7, §9.5.

### Task 7.1: `IconCache` + `recolorSvg`

**Files:**
- Create: `lib/loxone/IconCache.js`
- Test: `test/iconCache.test.js`

- [ ] **Step 1: Write the failing test** — `test/iconCache.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { IconCache, recolorSvg } = require("../lib/loxone/IconCache");

const U = (p) => `${p}-0000-0000-0000000000000000`;

test("recolorSvg swaps explicit fills for currentColor, keeps fill=none, fills the root", () => {
	const svg = "<svg viewBox=\"0 0 24 24\"><path fill=\"#ff0000\" d=\"M0 0\"/><path fill=\"none\" d=\"M1 1\"/></svg>";
	const out = recolorSvg(svg);
	assert.ok(out.includes("fill=\"currentColor\""));
	assert.ok(out.includes("fill=\"none\""));
	assert.ok(/<svg[^>]*fill="currentColor"/.test(out));
});

test("IconCache fetches over the requester, recolors, and caches by uuid", async () => {
	let calls = 0;
	const requester = { commandRaw: async () => { calls += 1; return "<svg><path fill=\"#123456\" d=\"M0 0\"/></svg>"; } };
	const cache = new IconCache(requester);
	const a = await cache.get(U("dddd0001"));
	const b = await cache.get(U("dddd0001"));
	assert.ok(a.includes("currentColor"));
	assert.equal(a, b);
	assert.equal(calls, 1);
});

test("IconCache returns null for a non-svg response or a falsy uuid", async () => {
	const cache = new IconCache({ commandRaw: async () => "not an svg" });
	assert.equal(await cache.get(U("dddd0002")), null);
	assert.equal(await cache.get(null), null);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/iconCache.test.js`
Expected: FAIL — cannot find module `IconCache`.

- [ ] **Step 3: Implement** — `lib/loxone/IconCache.js`:

```js
"use strict";

function recolorSvg(svg) {
	let out = String(svg).replace(/fill="(?!none)[^"]*"/g, "fill=\"currentColor\"");
	if (!/<svg[^>]*\bfill=/.test(out)) {
		out = out.replace("<svg", "<svg fill=\"currentColor\"");
	}
	return out;
}

class IconCache {
	constructor(requester) {
		this.requester = requester;
		this.cache = new Map();
	}

	async get(iconUuid) {
		if (!iconUuid) {
			return null;
		}
		if (this.cache.has(iconUuid)) {
			return this.cache.get(iconUuid);
		}
		let svg = null;
		try {
			const raw = await this.requester.commandRaw(`${iconUuid}.svg`);
			if (raw && raw.includes("<svg")) {
				svg = recolorSvg(raw);
			}
		} catch (e) {
			svg = null;
		}
		this.cache.set(iconUuid, svg);
		return svg;
	}
}

module.exports = { IconCache, recolorSvg };
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/iconCache.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/loxone/IconCache.js test/iconCache.test.js
git commit -m "feat(icons): node-side icon fetch + currentColor recolor cache"
```

### Task 7.2: `LoxoneClient` state machine

**Files:**
- Create: `lib/loxone/LoxoneClient.js`
- Test: `test/loxoneClient.test.js`

- [ ] **Step 1: Write the failing test** — `test/loxoneClient.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const EventEmitter = require("events");
const { LoxoneClient } = require("../lib/loxone/LoxoneClient");
const { TYPES } = require("../lib/loxone/protocol/MessageHeader");

const U = (p) => `${p}-0000-0000-0000000000000000`;
const POWER = U("aaaa1111");

function structureJson() {
	const ROOM = U("00aa0002");
	return JSON.stringify({
		lastModified: "2024-01-01 00:00:00",
		rooms: { [ROOM]: { uuid: ROOM, name: "Technik" } },
		cats: {},
		controls: {
			[U("11111111")]: { uuidAction: U("11111111"), name: "Wallbox", type: "Wallbox2", room: ROOM, states: { power: POWER } }
		},
		globalStates: {}
	});
}

function writeUuid(buf, off, uuid) {
	const [d1, d2, d3, tail] = uuid.split("-");
	buf.writeUInt32LE(parseInt(d1, 16), off);
	buf.writeUInt16LE(parseInt(d2, 16), off + 4);
	buf.writeUInt16LE(parseInt(d3, 16), off + 6);
	Buffer.from(tail, "hex").copy(buf, off + 8);
}

class FakeTransport extends EventEmitter {
	constructor() {
		super();
		this.sent = [];
	}
	open() {
		return Promise.resolve();
	}
	sendText(cmd) {
		this.sent.push(cmd);
		queueMicrotask(() => {
			const reply = (obj) => this.emit("frame", Buffer.from(JSON.stringify(obj)), false);
			if (cmd.includes("keyexchange")) {
				reply({ LL: { value: "ok", Code: "200" } });
			} else if (cmd.includes("getkey2")) {
				reply({ LL: { value: { key: "00ff", salt: "abcd", hashAlg: "SHA256" }, Code: "200" } });
			} else if (cmd.includes("jdev/sys/enc/")) { // encrypted getjwt
				reply({ LL: { value: { token: "jwt", validUntil: 9999999999, key: "00ff" }, Code: "200" } });
			} else if (cmd.includes("data/LoxAPP3.json")) {
				this.emit("frame", Buffer.from(structureJson()), false);
			} else if (cmd.includes("enablebinstatusupdate")) {
				reply({ LL: { value: "1", Code: "200" } });
			}
		});
	}
	close() {}
	pushValueEvent(stateUuid, value) {
		const header = Buffer.alloc(8);
		header[0] = 0x03;
		header[1] = TYPES.VALUE;
		header.writeUInt32LE(24, 4);
		const payload = Buffer.alloc(24);
		writeUuid(payload, 0, stateUuid);
		payload.writeDoubleLE(value, 16);
		this.emit("frame", header, true);
		this.emit("frame", payload, true);
	}
}

test("handshakes, loads structure, and emits controlState for a value event", async () => {
	const { publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
	const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
	const fake = new FakeTransport();
	const httpGetJson = async (url) => {
		if (url.includes("apiKey")) {
			return { LL: { value: "{'snr':'EE','version':'14.5','httpsStatus':1,'local':true}", Code: "200" } };
		}
		if (url.includes("getPublicKey")) {
			return { LL: { value: pubPem, Code: "200" } };
		}
		throw new Error(`unexpected url ${url}`);
	};
	const client = new LoxoneClient({
		host: "ms.local", user: "mirror", password: "pw",
		clientUuid: "uuid-1", clientInfo: "Test Mirror",
		controls: ["Wallbox"],
		deps: { createTransport: () => fake, httpGetJson, now: () => 1700000000000 }
	});

	const structureP = new Promise((r) => client.once("structure", r));
	await client.connect();
	await structureP;

	assert.ok(fake.sent.some((c) => c.includes("keyexchange")), "sent keyexchange");
	assert.ok(fake.sent.some((c) => c.includes("getkey2")), "sent getkey2");
	assert.ok(fake.sent.some((c) => c.includes("jdev/sys/enc/")), "sent ENCRYPTED getjwt");
	assert.ok(fake.sent.some((c) => c.includes("data/LoxAPP3.json")), "downloaded structure");
	assert.ok(fake.sent.some((c) => c.includes("enablebinstatusupdate")), "subscribed");

	const stateP = new Promise((r) => client.once("controlState", (id, states) => r({ id, states })));
	fake.pushValueEvent(POWER, 11);
	const evt = await stateP;
	assert.equal(evt.id, U("11111111"));
	assert.equal(evt.states.power, 11);

	client.stop();
});

test("emits a warning for an unresolved configured control", async () => {
	const { publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
	const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
	const fake = new FakeTransport();
	const httpGetJson = async (url) => (url.includes("apiKey")
		? { LL: { value: "{'local':true}", Code: "200" } }
		: { LL: { value: pubPem, Code: "200" } });
	const client = new LoxoneClient({
		host: "ms.local", user: "m", password: "p", clientUuid: "u", clientInfo: "i",
		controls: ["DoesNotExist"],
		deps: { createTransport: () => fake, httpGetJson, now: () => 1700000000000 }
	});
	const warnP = new Promise((r) => client.once("warnings", r));
	await client.connect();
	const warnings = await warnP;
	assert.equal(warnings[0].entry, "DoesNotExist");
	assert.equal(warnings[0].reason, "NotFoundError");
	client.stop();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/loxoneClient.test.js`
Expected: FAIL — cannot find module `LoxoneClient`.

- [ ] **Step 3: Implement** — `lib/loxone/LoxoneClient.js`:

```js
"use strict";
const EventEmitter = require("events");
const C = require("./crypto/LoxoneCrypto");
const { CommandCipher } = require("./protocol/commands");
const { FrameAssembler } = require("./protocol/FrameAssembler");
const { TYPES } = require("./protocol/MessageHeader");
const { parseValueEvents, parseTextEvents } = require("./protocol/EventParser");
const { parseLL } = require("./protocol/response");
const { Structure } = require("./structure/Structure");
const { Requester } = require("./net/Requester");
const { acquireToken, authWithToken } = require("./auth/Authenticator");
const { isTokenUsable } = require("./auth/TokenStore");
const { normalizePublicKey } = require("./net/publicKey");
const { parseApiKeyValue } = require("./net/apiKey");
const { httpGetJson } = require("./net/http");
const { WebSocketTransport } = require("./transport/WebSocketTransport");
const { computeBackoff } = require("./net/backoff");
const { IconCache } = require("./IconCache");

const DEFAULTS = { permission: "app", reconnectMaxBackoffMs: 60000, keepaliveMs: 120000, tokenMinRemainingSec: 600 };

class LoxoneClient extends EventEmitter {
	constructor(options) {
		super();
		this.opt = Object.assign({}, DEFAULTS, options);
		this.deps = Object.assign({ createTransport: () => new WebSocketTransport(), httpGetJson, now: () => Date.now() }, options.deps || {});
		this.tokenStore = options.tokenStore || null;
		this.state = "INIT";
		this.transport = null;
		this.requester = null;
		this.cipher = null;
		this.structure = null;
		this.iconCache = null;
		this.session = null;
		this.publicKey = null;
		this.apiInfo = null;
		this.valueMap = new Map();
		this.display = [];
		this.displaySet = new Set();
		this.stopped = false;
		this.attempt = 0;
		this.keepaliveTimer = null;
	}

	_setStatus(state, message) {
		this.state = state;
		this.emit("status", { state, message });
	}

	async connect() {
		this.stopped = false;
		try {
			await this._handshake();
			this.attempt = 0;
		} catch (e) {
			this.emit("error", e);
			this._scheduleReconnect();
		}
		return this;
	}

	async _handshake() {
		const { host } = this.opt;
		this._setStatus("connecting");
		const apiResp = await this.deps.httpGetJson(`http://${host}/jdev/cfg/apiKey`);
		this.apiInfo = parseApiKeyValue(parseLL(apiResp).value);
		const pkResp = await this.deps.httpGetJson(`http://${host}/jdev/sys/getPublicKey`);
		this.publicKey = normalizePublicKey(parseLL(pkResp).value);

		this.transport = this.deps.createTransport();
		const assembler = new FrameAssembler({
			onText: (t) => this.requester.handleText(t),
			onMessage: (type, payload) => this._onMessage(type, payload)
		});
		this.transport.on("frame", (data, isBinary) => assembler.push(data, isBinary));
		this.transport.on("close", (info) => this._onClose(info));
		this.transport.on("error", (e) => this.emit("error", e));
		this.requester = new Requester((cmd) => this.transport.sendText(cmd));
		await this.transport.open(`ws://${host}/ws/rfc6455`, "remotecontrol");

		this.session = C.generateSessionKey();
		const sessionKey = C.rsaEncryptBase64(this.publicKey, `${this.session.keyHex}:${this.session.ivHex}`);
		await this.requester.command(`jdev/sys/keyexchange/${encodeURIComponent(sessionKey)}`);
		this.cipher = new CommandCipher(this.session.keyBuf, this.session.ivBuf);
		this.requester.setCipher(this.cipher);

		await this._authenticate();
		await this._loadStructure();
		await this.requester.command("jdev/sps/enablebinstatusupdate");

		this._setStatus("online");
		this._startKeepalive();
		this.emit("structure", this.structure);
	}

	async _authenticate() {
		const { host, user, password, permission, clientUuid, clientInfo } = this.opt;
		const stored = this.tokenStore ? this.tokenStore.load(host, user) : null;
		if (isTokenUsable(stored, this.deps.now(), this.opt.tokenMinRemainingSec)) {
			const ok = await authWithToken(this.requester, { user, token: stored.token, hashAlg: stored.hashAlg });
			if (ok) {
				return;
			}
			if (this.tokenStore) {
				this.tokenStore.clear(host, user);
			}
		}
		const record = await acquireToken(this.requester, { user, password, permission, clientUuid, clientInfo });
		if (this.tokenStore) {
			this.tokenStore.save(host, user, record);
		}
	}

	async _loadStructure() {
		const raw = await this.requester.commandRaw("data/LoxAPP3.json");
		this.structure = new Structure(JSON.parse(raw));
		this.iconCache = new IconCache(this.requester);
		this._resolveDisplay();
	}

	_resolveDisplay() {
		const set = new Set();
		const warnings = [];
		const add = (control) => set.add(control.uuid);
		(this.opt.controls || []).forEach((entry) => {
			try {
				add(this.structure.resolve(entry));
			} catch (e) {
				warnings.push({ entry, reason: e.name, candidates: e.candidates });
			}
		});
		(this.opt.rooms || []).forEach((r) => this.structure.controlsInRoom(r).forEach(add));
		(this.opt.categories || []).forEach((c) => this.structure.controlsInCategory(c).forEach(add));
		this.displaySet = set;
		this.display = [...set];
		if (warnings.length) {
			this.emit("warnings", warnings);
		}
	}

	_onMessage(type, payload) {
		if (type === TYPES.VALUE) {
			parseValueEvents(payload).forEach((e) => this._applyState(e.uuid, e.value));
		} else if (type === TYPES.TEXTSTATE) {
			parseTextEvents(payload).forEach((e) => this._applyState(e.uuid, e.text));
		} else if (type === TYPES.OOS) {
			this.emit("oos", true);
		}
		// DAYTIMER, WEATHER, KEEPALIVE decoded elsewhere / ignored in v1
	}

	_applyState(stateUuid, value) {
		this.valueMap.set(stateUuid, value);
		const affected = new Set();
		this.structure.statesForUuid(stateUuid).forEach((owner) => {
			if (this.displaySet.has(owner.controlUuid)) {
				affected.add(owner.controlUuid);
			}
		});
		affected.forEach((controlUuid) => {
			this.emit("controlState", controlUuid, this.structure.namedStates(controlUuid, this.valueMap));
		});
	}

	_startKeepalive() {
		this._stopKeepalive();
		this.keepaliveTimer = setInterval(() => {
			if (this.transport) {
				this.transport.sendText("keepalive");
			}
		}, this.opt.keepaliveMs);
		if (this.keepaliveTimer.unref) {
			this.keepaliveTimer.unref();
		}
	}

	_stopKeepalive() {
		if (this.keepaliveTimer) {
			clearInterval(this.keepaliveTimer);
			this.keepaliveTimer = null;
		}
	}

	_onClose(info) {
		this._stopKeepalive();
		this.emit("close", info || {});
		if (!this.stopped) {
			this._setStatus("offline");
			this._scheduleReconnect();
		}
	}

	_scheduleReconnect() {
		if (this.stopped) {
			return;
		}
		this.attempt += 1;
		const delay = computeBackoff(this.attempt, this.opt.reconnectMaxBackoffMs);
		const timer = setTimeout(() => this.connect(), delay);
		if (timer.unref) {
			timer.unref();
		}
	}

	getControl(idOrName) {
		return this.structure ? this.structure.resolve(idOrName) : null;
	}

	stop() {
		this.stopped = true;
		this._stopKeepalive();
		if (this.transport) {
			this.transport.close();
		}
	}
}

module.exports = { LoxoneClient };
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/loxoneClient.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/loxone/LoxoneClient.js test/loxoneClient.test.js
git commit -m "feat(client): LoxoneClient connect/auth/subscribe/live state machine"
```

### Task 7.3: Public entry + full suite + lint

**Files:**
- Modify: `lib/loxone/index.js`

- [ ] **Step 1: Update `lib/loxone/index.js`**:

```js
"use strict";
const { LoxoneClient } = require("./LoxoneClient");
const { NotFoundError, AmbiguousNameError } = require("./structure/Structure");

module.exports = { LoxoneClient, NotFoundError, AmbiguousNameError };
```

- [ ] **Step 2: Add an entry smoke test** — `test/index.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const lib = require("../lib/loxone");

test("public entry exports LoxoneClient and the resolution errors", () => {
	assert.equal(typeof lib.LoxoneClient, "function");
	assert.equal(typeof lib.NotFoundError, "function");
	assert.equal(typeof lib.AmbiguousNameError, "function");
});
```

- [ ] **Step 3: Run the FULL suite**

Run: `node --test`
Expected: PASS — all test files green (crypto, uuid, messageHeader, frameAssembler, eventParser, commands, response, tokenStore, authenticator, structure, publicKey, apiKey, http, backoff, requester, webSocketTransport, iconCache, loxoneClient, index).

- [ ] **Step 4: Lint the whole library**

Run: `npx eslint lib`
Expected: exit 0, no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/loxone/index.js test/index.test.js
git commit -m "feat(loxone): public entry point + full library suite green"
```

---

## Done criteria (Plan 1)

- `node --test` is fully green across all files listed in Task 7.3.
- `npx eslint lib` passes.
- `lib/loxone` can be `require`d and a `LoxoneClient` constructed; the integration test proves the handshake, structure load, name resolution, and live `controlState` emission against a fake transport.
- **Next:** Plan 2 (MagicMirror module & rendering) builds the `node_helper` bridge, frontend shell, renderer registry, and the generic / Wallbox / Energy-Flow renderers on top of this library, binding the real `sample-data/LoxAPP3.json` (spec §15).

---
