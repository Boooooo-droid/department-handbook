// compares our rule with the original fomies.family address-format.js, if you have a local copy.
// ORIGINAL_ADDRESS_FORMAT=/path/to/address-format.js node --test tests/
// (the original file is not included in this repo.)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");
const C = require("../js/checker.js");

const path = process.env.ORIGINAL_ADDRESS_FORMAT || "/workspace/fomies/site/js/address-format.js";
const have = fs.existsSync(path);

test("matches the official rule on 40,000+ generated inputs", { skip: !have && "original address-format.js not found" }, () => {
  const ctx = { TextEncoder, TextDecoder, Uint8Array, Uint16Array, Uint32Array, Int8Array, BigInt, ArrayBuffer };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path, "utf8") + ";this.AF=AddressFormat;", ctx);
  const official = (s, kind) => { try { const v = ctx.AF.address(s, kind); return v ? { ok: true, value: v } : { ok: false }; } catch { return { ok: false }; } };

  const rnd = (n) => crypto.randomInt(n);
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const junk = [" ", "  ", "\t", "\n", "\r\n", "\u200b", "\u00a0", "\ufeff", "\u2060", "\u0430", "\u043e", "0", "O", "I", "l", "x", "X", "g", "-", ".", "1", "11", "a", "A", "f", "F", "\u{1F600}"];
  function mutate(s) {
    const n = rnd(4);
    for (let k = 0; k < n; k++) {
      const pos = rnd(s.length + 1);
      const j = junk[rnd(junk.length)];
      const op = rnd(5);
      if (op === 0) s = s.slice(0, pos) + j + s.slice(pos);
      else if (op === 1) s = s.slice(0, pos) + s.slice(pos + 1);
      else if (op === 2) s = s.slice(0, pos) + j + s.slice(pos + 1);
      else if (op === 3) { const c = s[pos] || ""; const f = c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase(); s = s.slice(0, pos) + f + s.slice(pos + 1); }
      else s = (rnd(2) ? " " : "") + s + (rnd(2) ? " " : "");
    }
    return s;
  }
  const inputs = ["", " ", "0x", "1".repeat(32), "1".repeat(31), "1".repeat(33), "1".repeat(44), "1".repeat(45), "0x" + "0".repeat(40), "x".repeat(129)];
  for (let i = 0; i < 6000; i++) {
    const len = [31, 32, 32, 32, 33, 64][rnd(6)];
    const bytes = crypto.randomBytes(len);
    if (rnd(4) === 0) bytes.fill(0, 0, rnd(4));
    const sol = C.b58encode(new Uint8Array(bytes));
    const h = crypto.randomBytes(20).toString("hex");
    const evmVariants = ["0x" + h, "0x" + h.toUpperCase(), C.toChecksum(h), h, "0X" + h];
    const evm = evmVariants[rnd(evmVariants.length)];
    inputs.push(sol, mutate(sol), evm, mutate(evm), mutate(C.toChecksum(h)));
    let r = ""; const rl = rnd(50); for (let k = 0; k < rl; k++) r += B58[rnd(58)];
    inputs.push(r);
  }
  let checked = 0;
  for (const s of inputs) for (const kind of ["solana", "evm"]) {
    const a = official(s, kind), b = C.siteRule(s, kind);
    assert.equal(b.ok, a.ok, `${JSON.stringify(s)} ${kind}: official ${a.ok} ours ${b.ok}`);
    if (a.ok) assert.equal(b.value, a.value, `${JSON.stringify(s)} ${kind}: saved value differs`);
    assert.equal(C.diagnose(s, kind).ok, a.ok);
    checked++;
  }
  assert.ok(checked > 40000);
});
