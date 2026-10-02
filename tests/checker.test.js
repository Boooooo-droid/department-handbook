// node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const C = require("../js/checker.js");

const te = new TextEncoder();
const hex = (s) => C.keccak256Hex(te.encode(s));

function solanaFromKeypair() {
  const { publicKey } = crypto.generateKeyPairSync("ed25519");
  const der = publicKey.export({ type: "spki", format: "der" });
  return C.b58encode(new Uint8Array(der.subarray(der.length - 32)));
}

test("keccak-256 known vectors", () => {
  assert.equal(C.keccak256Hex(new Uint8Array()), "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(hex("abc"), "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
  assert.equal(hex("The quick brown fox jumps over the lazy dog"), "4d741b6f1eb29cb2a9b9911c82f56fa8d73b04959d3d9d222895df6c0b28aa15");
});

test("valid solana addresses pass", () => {
  for (const a of [
    "11111111111111111111111111111111",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "So11111111111111111111111111111111111111112",
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    solanaFromKeypair(),
    solanaFromKeypair()
  ]) {
    const r = C.diagnose(a, "solana");
    assert.equal(r.ok, true, a);
    assert.equal(r.value, a);
    assert.equal(r.problems.length, 0);
  }
});

test("leading/trailing spaces, tabs and newlines are trimmed", () => {
  const a = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  assert.equal(C.diagnose("  " + a + " ", "solana").ok, true);
  assert.equal(C.diagnose("\t" + a + "\n", "solana").value, a);
  assert.equal(C.diagnose(" 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed\r\n", "evm").ok, true);
});

test("wrong-length solana is rejected with a length or byte-size message", () => {
  const short = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4"; // 31 chars
  const r1 = C.diagnose(short, "solana");
  assert.equal(r1.ok, false);
  assert.match(r1.problems[0].title, /wrong length/);
  assert.match(r1.problems[0].detail, /31 characters/);

  const dropped = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5D"; // last char missing, 42 chars
  const r2 = C.diagnose(dropped, "solana");
  assert.equal(r2.ok, false);
  assert.match(r2.problems[0].title, /decodes to 31 bytes, not 32/);

  const long = C.b58encode(crypto.randomBytes(64)); // private key / signature size
  const r3 = C.diagnose(long, "solana");
  assert.equal(r3.ok, false);
  assert.match(r3.problems[0].title, /64 bytes/);
  assert.ok(r3.tips.some((t) => /private key/.test(t)));
});

test("base58-invalid characters are rejected and located", () => {
  const a = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  for (const bad of ["0", "O", "I", "l"]) {
    const s = a.slice(0, 9) + bad + a.slice(10);
    const r = C.diagnose(s, "solana");
    assert.equal(r.ok, false, s);
    assert.match(r.problems[0].detail, /position 10 /);
  }
  const r = C.diagnose("EPjFWdd5-ufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "solana");
  assert.equal(r.ok, false);
  assert.match(r.problems[0].detail, /“-”/);
});

test("valid lowercase, uppercase and checksummed evm pass", () => {
  const lower = "0xde709f2102306220921060314715629080e2fb77";
  const upper = "0x52908400098527886E0F7030069857D2E4169EE7";
  for (const a of [lower, "0x27b1fdb04752bbc536007a920d24acb045561c26", upper, "0x8617E340B3D01FA5F11F306F4090FD50E238070D"]) {
    const r = C.diagnose(a, "evm");
    assert.equal(r.ok, true, a);
    assert.equal(r.value, C.toChecksum(a.slice(2)), "form saves the checksummed form");
  }
  for (const a of [
    "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
    "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
    "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb"
  ]) {
    const r = C.diagnose(a, "evm");
    assert.equal(r.ok, true, a);
    assert.equal(r.value, a);
    assert.ok(r.good.some((g) => /checksum matches/.test(g)));
  }
});

test("bad-checksum evm is rejected, with the lowercase fix and a caution", () => {
  const good = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
  const bad = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD"; // last letter flipped
  const r = C.diagnose(bad, "evm");
  assert.equal(r.ok, false);
  assert.match(r.problems[0].title, /checksum/);
  assert.match(r.problems[0].detail, /position 42\./);
  assert.equal(r.suggestion.value, good.toLowerCase());
  assert.equal(C.siteRule(r.suggestion.value, "evm").ok, true);
  assert.ok(r.tips.some((t) => /mistyped/.test(t)));
});

test("zero-width space is rejected and located, cleaned version offered", () => {
  const a = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
  const s = a.slice(0, 10) + "\u200b" + a.slice(10);
  const r = C.diagnose(s, "evm");
  assert.equal(r.ok, false);
  assert.match(r.problems[0].title, /zero-width space/);
  assert.match(r.problems[0].detail, /position 11\./);
  assert.equal(r.suggestion.value, a);
  // also for solana, at the very end
  const sol = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA\u200b";
  const r2 = C.diagnose(sol, "solana");
  assert.equal(r2.ok, false);
  assert.match(r2.problems[0].detail, /very end/);
});

test("NBSP is rejected even at the edges (only normal spaces are trimmed)", () => {
  const a = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const r = C.diagnose("\u00a0" + a, "solana");
  assert.equal(r.ok, false);
  assert.match(r.problems[0].title, /non-breaking space/);
  assert.match(r.problems[0].detail, /position 1\..*very start/);
  assert.equal(r.suggestion.value, a);
  const r2 = C.diagnose("0x5aAeb6053F3E94C9b9A0\u00a09f33669435E7Ef1BeAed", "evm");
  assert.equal(r2.ok, false);
  assert.match(r2.problems[0].detail, /position 23\./);
});

test("cyrillic lookalike is rejected, located, and no 'fixed' version is offered", () => {
  const evm = "0x5\u0430Aeb6053F3E94C9b9A09f33669435E7Ef1BeAed"; // cyrillic а at position 4
  const r = C.diagnose(evm, "evm");
  assert.equal(r.ok, false);
  assert.match(r.problems[0].title, /cyrillic “а”.*latin “a”/);
  assert.match(r.problems[0].detail, /position 4\./);
  assert.equal(r.suggestion, null);
  assert.match(r.headline, /impostor/);
  const sol = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5D\u0410"; // cyrillic А
  assert.equal(C.diagnose(sol, "solana").ok, false);
});

test("positions point at the original input, even after hidden characters", () => {
  const r = C.diagnose("\u200b 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD\u00a0", "evm");
  assert.equal(r.ok, false);
  assert.match(r.problems[0].detail, /position 1\./);
  assert.match(r.problems[1].detail, /position 45\./);
  assert.match(r.problems[2].title, /checksum/);
  assert.match(r.problems[2].detail, /position 44\./);
  assert.equal(r.suggestion.value, "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed");
});

test("other format mistakes get specific messages", () => {
  const e = (s) => C.diagnose(s, "evm");
  assert.match(e("0X5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed").problems[0].title, /lowercase/);
  const noX = e("5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed");
  assert.match(noX.problems[0].title, /0x at the start is missing/);
  assert.equal(noX.suggestion.value, "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed");
  assert.match(e("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAe").problems[0].detail, /has 39/);
  assert.match(e("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAoo").problems[0].detail, /letter o is not a zero/);
  assert.match(e("vitalik.eth").problems[0].title, /ens name/);
  assert.match(e("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").problems[0].title, /solana address/);
  assert.match(C.diagnose("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", "solana").problems[0].title, /evm address/);
  assert.match(C.diagnose("toly.sol", "solana").problems[0].title, /\.sol name/);
  const gap = C.diagnose("TokenkegQfeZyiNwAJbN bGKPFXCWuBvf9Ss623VQ5DA", "solana");
  assert.equal(gap.ok, false);
  assert.match(gap.problems[0].detail, /position 21 /);
  assert.equal(gap.suggestion.value, "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  assert.equal(C.diagnose("", "evm").empty, true);
  assert.equal(C.diagnose("   ", "solana").ok, false);
  assert.equal(C.diagnose("x".repeat(129), "evm").ok, false);
  const pk = e("0x" + "ab".repeat(32));
  assert.match(pk.problems[0].title, /64 characters/);
});

test("diagnose() never disagrees with the plain rule", () => {
  const samples = [];
  const base = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"];
  const junk = [" ", "\u200b", "\u00a0", "0", "O", "x", "\u0430", "\t", "1", "a", "A"];
  for (let i = 0; i < 3000; i++) {
    let s = base[i % 2];
    const n = 1 + (i % 3);
    for (let k = 0; k < n; k++) {
      const pos = (i * 31 + k * 17) % (s.length + 1);
      const op = (i + k) % 3;
      const j = junk[(i * 7 + k) % junk.length];
      s = op === 0 ? s.slice(0, pos) + j + s.slice(pos) : op === 1 ? s.slice(0, pos) + s.slice(pos + 1) : s.slice(0, pos) + j + s.slice(pos + 1);
    }
    samples.push(s);
  }
  for (const s of samples) for (const kind of ["solana", "evm"]) {
    assert.equal(C.diagnose(s, kind).ok, C.siteRule(s, kind).ok, JSON.stringify(s) + " " + kind);
  }
});
