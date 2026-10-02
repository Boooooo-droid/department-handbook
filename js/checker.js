/*
 * The Department Handbook: address checker (unofficial)
 *
 * Mirrors the address rules in the fomies.family front-end:
 *   - raw input must be a string of at most 128 UTF-16 units
 *   - every character must be tab, newline, carriage return or printable ASCII (0x20-0x7e)
 *   - then the value is trimmed (String.prototype.trim) and must not be empty
 *   - solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, base58-decodes to exactly 32 bytes,
 *     and re-encodes to the same string
 *   - evm: /^0x[0-9a-fA-F]{40}$/; all-lowercase or all-uppercase hex passes,
 *     mixed case must match the EIP-55 checksum; saved as the checksummed form
 *
 * Runs entirely in the browser (or node, for tests). No network, no storage.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HandbookChecker = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------------- keccak-256 (original keccak padding, as used by ethereum) ---------------- */

  var M64 = (1n << 64n) - 1n;
  var RC = [
    0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
    0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
    0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
    0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
    0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
    0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n
  ];
  // rotation offsets, indexed x + 5y
  var ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];

  function rotl(v, n) {
    if (n === 0) return v;
    var b = BigInt(n);
    return ((v << b) | (v >> (64n - b))) & M64;
  }

  function keccakF(A) {
    var C = new Array(5), D = new Array(5), B = new Array(25);
    for (var round = 0; round < 24; round++) {
      var x, y;
      for (x = 0; x < 5; x++) C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
      for (x = 0; x < 5; x++) D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
      for (x = 0; x < 5; x++) for (y = 0; y < 5; y++) A[x + 5 * y] ^= D[x];
      for (x = 0; x < 5; x++)
        for (y = 0; y < 5; y++)
          B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(A[x + 5 * y], ROT[x + 5 * y]);
      for (x = 0; x < 5; x++)
        for (y = 0; y < 5; y++)
          A[x + 5 * y] = B[x + 5 * y] ^ ((~B[((x + 1) % 5) + 5 * y] & M64) & B[((x + 2) % 5) + 5 * y]);
      A[0] ^= RC[round];
    }
  }

  function keccak256(bytes, domain) {
    var rate = 136;
    var padLen = rate - (bytes.length % rate);
    var msg = new Uint8Array(bytes.length + padLen);
    msg.set(bytes);
    msg[bytes.length] ^= domain || 0x01; // 0x01 = keccak, 0x06 = sha3 (tests only)
    msg[msg.length - 1] ^= 0x80;
    var A = new Array(25).fill(0n);
    for (var off = 0; off < msg.length; off += rate) {
      for (var i = 0; i < rate / 8; i++) {
        var lane = 0n;
        for (var j = 7; j >= 0; j--) lane = (lane << 8n) | BigInt(msg[off + i * 8 + j]);
        A[i] ^= lane;
      }
      keccakF(A);
    }
    var out = new Uint8Array(32);
    for (var k = 0; k < 4; k++) {
      var v = A[k];
      for (var m = 0; m < 8; m++) { out[k * 8 + m] = Number(v & 0xffn); v >>= 8n; }
    }
    return out;
  }

  function toHex(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    return s;
  }

  function asciiBytes(str) {
    var b = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) b[i] = str.charCodeAt(i);
    return b;
  }

  /** EIP-55 checksum of 40 hex chars (any case). returns "0x" + checksummed */
  function toChecksum(hex40) {
    var lower = hex40.toLowerCase();
    var hash = toHex(keccak256(asciiBytes(lower)));
    var out = "";
    for (var i = 0; i < 40; i++) out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
    return "0x" + out;
  }

  /* ---------------- base58 (bitcoin alphabet, as used by solana) ---------------- */

  var B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  var B58MAP = {};
  for (var bi = 0; bi < B58.length; bi++) B58MAP[B58[bi]] = bi;

  function b58decode(str) {
    var bytes = [0];
    for (var i = 0; i < str.length; i++) {
      var v = B58MAP[str[i]];
      if (v === undefined) return null;
      var carry = v;
      for (var j = 0; j < bytes.length; j++) {
        carry += bytes[j] * 58;
        bytes[j] = carry & 0xff;
        carry >>= 8;
      }
      while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
    }
    // strip the placeholder zero(s) produced above, then add one zero byte per leading "1"
    while (bytes.length > 0 && bytes[bytes.length - 1] === 0) bytes.pop();
    var lead = 0;
    while (lead < str.length && str[lead] === "1") lead++;
    var out = new Uint8Array(lead + bytes.length);
    for (var k = 0; k < bytes.length; k++) out[out.length - 1 - k] = bytes[k];
    return out;
  }

  function b58encode(bytes) {
    var digits = [0];
    for (var i = 0; i < bytes.length; i++) {
      var carry = bytes[i];
      for (var j = 0; j < digits.length; j++) {
        carry += digits[j] << 8;
        digits[j] = carry % 58;
        carry = (carry / 58) | 0;
      }
      while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
    }
    while (digits.length > 0 && digits[digits.length - 1] === 0) digits.pop();
    var s = "";
    for (var z = 0; z < bytes.length && bytes[z] === 0; z++) s += "1";
    for (var k = digits.length - 1; k >= 0; k--) s += B58[digits[k]];
    return s;
  }

  /* ---------------- the site's exact rule, as a yes/no ---------------- */

  var ALLOWED_RAW = /[^\x09\x0a\x0d\x20-\x7e]/;
  var SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  var EVM_RE = /^0x[0-9a-fA-F]{40}$/;

  /**
   * Same decision the fomies.family form makes.
   * returns { ok: true, value } where value is what the form would save,
   * or { ok: false }. an empty or whitespace-only input is not ok.
   */
  function siteRule(raw, kind) {
    if (typeof raw !== "string" || raw.length > 128 || ALLOWED_RAW.test(raw)) return { ok: false };
    var v = raw.trim();
    if (!v) return { ok: false, empty: true };
    if (kind === "solana") {
      if (!SOL_RE.test(v)) return { ok: false };
      var d = b58decode(v);
      if (!d || d.length !== 32 || b58encode(d) !== v) return { ok: false };
      return { ok: true, value: v };
    }
    if (kind !== "evm" || !EVM_RE.test(v)) return { ok: false };
    var hex = v.slice(2);
    var sum = toChecksum(hex);
    if (hex !== hex.toLowerCase() && hex !== hex.toUpperCase() && "0x" + hex !== sum) return { ok: false };
    return { ok: true, value: sum };
  }

  /* ---------------- friendly diagnosis ---------------- */

  var NAMED = {
    0x00a0: "a non-breaking space",
    0x00ad: "a soft hyphen",
    0x034f: "a combining grapheme joiner",
    0x061c: "an arabic letter mark",
    0x115f: "a hangul filler",
    0x1160: "a hangul filler",
    0x180e: "a mongolian vowel separator",
    0x2000: "an en quad space", 0x2001: "an em quad space", 0x2002: "an en space", 0x2003: "an em space",
    0x2004: "a three-per-em space", 0x2005: "a four-per-em space", 0x2006: "a six-per-em space",
    0x2007: "a figure space", 0x2008: "a punctuation space", 0x2009: "a thin space", 0x200a: "a hair space",
    0x200b: "a zero-width space",
    0x200c: "a zero-width non-joiner",
    0x200d: "a zero-width joiner",
    0x200e: "a left-to-right mark",
    0x200f: "a right-to-left mark",
    0x2010: "a hyphen that isn't the keyboard one", 0x2011: "a non-breaking hyphen",
    0x2012: "a figure dash", 0x2013: "an en dash", 0x2014: "an em dash",
    0x2018: "a curly quote", 0x2019: "a curly quote", 0x201c: "a curly quote", 0x201d: "a curly quote",
    0x2026: "an ellipsis \u201c\u2026\u201d",
    0x2028: "a line separator", 0x2029: "a paragraph separator",
    0x202a: "a direction control", 0x202b: "a direction control",
    0x202c: "a direction control", 0x202d: "a direction control",
    0x202e: "a direction control",
    0x202f: "a narrow non-breaking space",
    0x205f: "a math space",
    0x2060: "a word joiner",
    0x2061: "an invisible function character", 0x2062: "an invisible times character",
    0x2063: "an invisible separator", 0x2064: "an invisible plus",
    0x2066: "a direction isolate", 0x2067: "a direction isolate",
    0x2068: "a direction isolate", 0x2069: "a direction isolate",
    0x3000: "an ideographic (wide) space",
    0x3164: "a hangul filler",
    0xfeff: "a byte order mark / zero-width no-break space",
    0xffa0: "a halfwidth hangul filler"
  };
  var INVISIBLE = {
    0x00ad: 1, 0x034f: 1, 0x061c: 1, 0x115f: 1, 0x1160: 1, 0x180e: 1, 0x200b: 1, 0x200c: 1,
    0x200d: 1, 0x200e: 1, 0x200f: 1, 0x202a: 1, 0x202b: 1, 0x202c: 1, 0x202d: 1, 0x202e: 1,
    0x2060: 1, 0x2061: 1, 0x2062: 1, 0x2063: 1, 0x2064: 1, 0x2066: 1, 0x2067: 1, 0x2068: 1,
    0x2069: 1, 0x3164: 1, 0xfeff: 1, 0xffa0: 1
  };
  // unicode spaces that look like a normal space
  var SPACELIKE = { 0x00a0: 1, 0x2000: 1, 0x2001: 1, 0x2002: 1, 0x2003: 1, 0x2004: 1, 0x2005: 1,
    0x2006: 1, 0x2007: 1, 0x2008: 1, 0x2009: 1, 0x200a: 1, 0x2028: 1, 0x2029: 1, 0x202f: 1,
    0x205f: 1, 0x3000: 1 };

  // common lookalikes: code point -> [script, latin it imitates]
  var LOOKALIKE = {};
  function addLook(script, pairs) {
    for (var i = 0; i < pairs.length; i += 2) LOOKALIKE[pairs.charCodeAt(i)] = [script, pairs[i + 1]];
  }
  addLook("cyrillic", "аaеeоoрpсcуyхxкkмmтTнHвBіiјjѕsԁdһhӏlԛqԝwАAВBЕEКKМMНHОOРPСCТTХXІIЈJЅSУYԌGԚQԜW");
  addLook("greek", "οoαaνvρpτtικkΟOΑAΒBΕEΖZΗHΙIΚKΜMΝNΡPΤTΧXΥYϲcϳj");
  addLook("armenian", "օoսuոnհhզqցg");

  function hexCp(cp) {
    var h = cp.toString(16).toUpperCase();
    while (h.length < 4) h = "0" + h;
    return "U+" + h;
  }

  function describeChar(cp) {
    var ch = String.fromCodePoint(cp);
    if (LOOKALIKE[cp]) {
      var l = LOOKALIKE[cp];
      return { kind: "lookalike", text: "a " + l[0] + " \u201c" + ch + "\u201d (" + hexCp(cp) + ") that looks like a latin \u201c" + l[1] + "\u201d", tag: l[0].slice(0, 3) + " " + ch, latin: l[1] };
    }
    if (cp >= 0xff01 && cp <= 0xff5e) {
      var latin = String.fromCharCode(cp - 0xfee0);
      return { kind: "lookalike", text: "a full-width \u201c" + ch + "\u201d (" + hexCp(cp) + ") that looks like \u201c" + latin + "\u201d", tag: "wide " + latin, latin: latin };
    }
    if (INVISIBLE[cp]) return { kind: "invisible", text: NAMED[cp] + " (" + hexCp(cp) + "), which is invisible", tag: shortTag(cp) };
    if (SPACELIKE[cp]) return { kind: "space", text: NAMED[cp] + " (" + hexCp(cp) + "), which looks like a normal space but isn't one", tag: shortTag(cp) };
    if (cp < 0x20 || cp === 0x7f) return { kind: "control", text: "a hidden control character (" + hexCp(cp) + ")", tag: hexCp(cp) };
    if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0000 && cp <= 0xe007f))
      return { kind: "invisible", text: "a combining or variation mark (" + hexCp(cp) + "), which is invisible", tag: hexCp(cp) };
    if (NAMED[cp]) return { kind: "other", text: NAMED[cp] + " (" + hexCp(cp) + ")", tag: shortTag(cp) };
    return { kind: "other", text: "\u201c" + ch + "\u201d (" + hexCp(cp) + "), which is not a plain keyboard character", tag: hexCp(cp) };
  }

  function shortTag(cp) {
    var t = { 0x00a0: "NBSP", 0x202f: "NNBSP", 0x200b: "ZWSP", 0x200c: "ZWNJ", 0x200d: "ZWJ", 0xfeff: "BOM",
      0x2060: "WJ", 0x00ad: "SHY", 0x200e: "LRM", 0x200f: "RLM", 0x3000: "WIDE SP", 0x2013: "EN DASH",
      0x2014: "EM DASH", 0x2026: "\u2026" }[cp];
    return t || hexCp(cp);
  }

  function ordinalPos(list) {
    if (list.length === 1) return "position " + list[0];
    if (list.length <= 6) return "positions " + list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
    return "positions " + list.slice(0, 5).join(", ") + " and " + (list.length - 5) + " more";
  }

  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }

  /**
   * full diagnosis for the UI.
   * returns {
   *   kind, ok, value (what the form would save, when ok),
   *   headline, problems: [{ title, detail }], tips: [string],
   *   suggestion: { label, value } | null, good: [string],
   *   chars: [{ ch, pos, bad, tag }]   (raw input, for the character strip)
   * }
   */
  function diagnose(raw, kind, mapPos) {
    raw = typeof raw === "string" ? raw : "";
    var P = mapPos || function (n) { return n; };
    var verdict = siteRule(raw, kind);
    var res = { P: P, kind: kind, ok: verdict.ok, value: verdict.value || null, headline: "", problems: [], tips: [], good: [], suggestion: null, chars: [], marks: [] };
    var cps = Array.from(raw);
    var label = kind === "solana" ? "solana" : "evm";

    // character strip + non-ascii scan (positions are 1-based, counted the way you see them)
    var badChars = [];
    var firstVisible = -1, lastVisible = -1;
    cps.forEach(function (ch, i) {
      var cp = ch.codePointAt(0);
      var allowed = cp === 0x09 || cp === 0x0a || cp === 0x0d || (cp >= 0x20 && cp <= 0x7e);
      var entry = { ch: ch, pos: i + 1, bad: !allowed, tag: null };
      if (!allowed) {
        var d = describeChar(cp);
        entry.tag = d.tag;
        badChars.push({ pos: P(i + 1), cp: cp, d: d });
        res.marks.push(P(i + 1));
      }
      if (allowed && !/\s/.test(ch)) { if (firstVisible < 0) firstVisible = i; lastVisible = i; }
      res.chars.push(entry);
    });

    if (!raw.trim() && !badChars.length) {
      res.empty = true;
      res.headline = "nothing to check yet.";
      res.tips.push(kind === "solana" ? "paste your solana address. no 0x at the start." : "paste your evm address. it starts with 0x.");
      delete res.P;
      return res;
    }

    if (raw.length > 128) {
      res.problems.push({ title: "this is too long for the form.", detail: "the form refuses anything over 128 characters before it even looks. " + (kind === "solana" ? "a solana address is 32 to 44 characters." : "an evm address is 42 characters.") + " did a whole sentence come along with it?" });
    }

    // 1. characters the form never accepts
    if (badChars.length) {
      var groups = {};
      badChars.forEach(function (b) {
        var key = b.d.text;
        (groups[key] = groups[key] || []).push(b.pos);
      });
      Object.keys(groups).forEach(function (text) {
        var where = groups[text];
        var atEdge = where.every(function (p) { return p - 1 < firstVisible || p - 1 > lastVisible; });
        var edgeNote = "";
        if (atEdge && firstVisible >= 0) {
          edgeNote = where.every(function (p) { return p - 1 < firstVisible; }) ? " it's sitting at the very start." :
            where.every(function (p) { return p - 1 > lastVisible; }) ? " it's sitting at the very end." : " they're at the edges.";
          edgeNote += " the form only trims normal spaces, not this one.";
        }
        var look = /lookalike|looks like a latin|full-width/.test(text) ? " to you it looks the same. to a computer it's a different letter." : "";
        res.problems.push({ title: text + ".", detail: ordinalPos(where) + "." + look + edgeNote });
      });
      var kinds = {};
      badChars.forEach(function (b) { kinds[b.d.kind] = true; });
      if (kinds.lookalike) {
        res.tips.push("lookalike letters from another alphabet never appear in real addresses. if you didn't type this yourself, don't trust wherever it came from. copy the address again from your own wallet app.");
      }
      if (kinds.invisible || kinds.space || kinds.control) {
        var invisTip = res.tips.push("invisible characters usually ride along when you copy from a chat, a web page or a notes app. copy it straight from your wallet's own copy button.") - 1;
      }
      if (badChars.some(function (b) { return b.cp === 0x2026; }))
        res.tips.push("an ellipsis usually means you copied the shortened version of an address, the kind wallets show like 0x5aAe\u2026eAed. copy the full address instead.");
      if (kinds.other) res.tips.push("only plain keyboard characters are allowed. no dashes, quotes or dots from fancy keyboards.");

      // offer a cleaned version only when we removed things nobody can see (never for lookalikes)
      if (!kinds.lookalike && !kinds.other) {
        var cleaned = cps.filter(function (ch) {
          var cp = ch.codePointAt(0);
          return cp === 0x09 || cp === 0x0a || cp === 0x0d || (cp >= 0x20 && cp <= 0x7e);
        }).join("").trim();
        var again = siteRule(cleaned, kind);
        if (again.ok) {
          res.suggestion = { label: "same thing with the invisible characters removed. this version passes:", value: again.value };
          if (invisTip !== undefined) res.tips[invisTip] = res.tips[invisTip].replace(/\.$/, ", or use the cleaned version below.");
        } else if (cleaned) {
          // remember where each kept character sat in the original, so positions stay true
          var kept = [];
          cps.forEach(function (ch, i) {
            var cp = ch.codePointAt(0);
            if (cp === 0x09 || cp === 0x0a || cp === 0x0d || (cp >= 0x20 && cp <= 0x7e)) kept.push(i + 1);
          });
          var keptStr = kept.map(function (p) { return cps[p - 1]; }).join("");
          var lead = keptStr.length - keptStr.replace(/^\s+/, "").length;
          var sub = diagnose(cleaned, kind, function (n) { return P(kept[n - 1 + lead]); });
          sub.problems.forEach(function (p) { res.problems.push({ title: "and even without it: " + p.title, detail: p.detail }); });
          res.marks = res.marks.concat(sub.marks || []);
          sub.tips.forEach(function (t) { if (res.tips.indexOf(t) < 0) res.tips.push(t); });
          if (sub.suggestion) res.suggestion = { label: "with the hidden characters removed too. " + sub.suggestion.label, value: sub.suggestion.value };
        }
      }
      res.headline = "returned. there's something in here you can't see.";
      if (kinds.lookalike) res.headline = "returned. one of these letters is an impostor.";
      else if (kinds.other && !kinds.invisible && !kinds.space) res.headline = "returned. there's a character in here the form won't take.";
      return finish(res);
    }

    // from here the raw input is plain ascii, so trim() only removes normal spaces, tabs and newlines
    var v = raw.trim();
    var inner = [];
    Array.from(v).forEach(function (ch, i) { if (/\s/.test(ch)) inner.push(P(raw.indexOf(v) + i + 1)); });
    res.marks = res.marks.concat(inner);
    if (inner.length) {
      res.problems.push({ title: "there's a gap inside the address.", detail: ordinalPos(inner) + (inner.length === 1 ? " is a space, tab or line break." : " are spaces, tabs or line breaks.") + " only spaces at the very start or end get trimmed. the inside has to be one solid piece." });
      var squashed = v.replace(/\s+/g, "");
      var s2 = siteRule(squashed, kind);
      if (s2.ok) res.suggestion = { label: "same thing with the gaps removed. this version passes:", value: s2.value };
      else res.tips.push("if it was split across two lines, copy it again in one go.");
      res.headline = "returned. it's in two pieces.";
      return finish(res);
    }

    if (kind === "solana") diagnoseSolana(v, raw, res);
    else diagnoseEvm(v, raw, res);
    return finish(res);

    function finish(r) {
      delete r.P;
      // the friendly layer must never disagree with the real rule
      if (r.ok && r.problems.length) r.problems = [];
      if (!r.ok && !r.problems.length) r.problems.push({ title: "the form would not accept this.", detail: "something about it doesn't fit the " + label + " format." });
      if (r.ok) r.headline = r.headline || "format ok.";
      return r;
    }
  }

  function leadOffset(raw) { return raw.length - raw.replace(/^\s+/, "").length; }

  function diagnoseSolana(v, raw, res) {
    var off = leadOffset(raw);
    if (/^0x/i.test(v)) {
      res.headline = "returned. wrong box.";
      res.problems.push({ title: "this looks like an evm address.", detail: "it starts with 0x. solana addresses never do. it belongs in the evm box." });
      return;
    }
    if (/\.sol$/i.test(v)) {
      res.headline = "returned. that's a name, not an address.";
      res.problems.push({ title: "that's a .sol name.", detail: "the form wants the actual address it points to. open your wallet and copy the address itself." });
      return;
    }
    var bad = [];
    var badSet = {};
    Array.from(v).forEach(function (ch, i) { if (B58MAP[ch] === undefined) { bad.push(res.P(i + 1 + off)); badSet[ch] = true; } });
    res.marks = res.marks.concat(bad);
    if (bad.length) {
      var conf = [];
      if (badSet["0"]) conf.push("0 (zero)");
      if (badSet["O"]) conf.push("O (capital o)");
      if (badSet["I"]) conf.push("I (capital i)");
      if (badSet["l"]) conf.push("l (lowercase L)");
      var others = Object.keys(badSet).filter(function (c) { return "0OIl".indexOf(c) < 0; });
      var detail = ordinalPos(bad) + (bad.length === 1 ? " is" : " are") + " not allowed. ";
      if (conf.length) detail += (conf.length > 1 ? "the culprits: " : "the culprit: ") + (conf.length > 1 ? conf.slice(0, -1).join(", ") + " and " + conf[conf.length - 1] : conf[0]) + ". base58 leaves out 0 (zero), O (capital o), I (capital i) and l (lowercase L) on purpose, because they're easy to mix up, so a real solana address never contains them. ";
      if (others.length) detail += "symbols like " + others.map(function (c) { return "\u201c" + c + "\u201d"; }).join(" ") + " don't belong in an address either. ";
      res.headline = "returned. not base58.";
      res.problems.push({ title: "this has characters base58 doesn't use.", detail: detail.trim() });
      res.tips.push("if you typed it by hand, that's the likely spot. copying is safer than typing.");
      return;
    }
    var bytes = b58decode(v);
    var n = v.length;
    if (n < 32 || n > 44) {
      res.headline = n < 32 ? "returned. it looks cut off." : "returned. too long for an address.";
      if (bytes && bytes.length === 64) {
        res.problems.push({ title: "this is 64 bytes, not an address.", detail: "that's the size of a private key or a transaction signature. an address decodes to 32 bytes." });
        res.tips.push("if this is your private key: don't paste it anywhere, including here. nobody legit ever needs it. move your funds to a fresh wallet to be safe.");
      } else {
        res.problems.push({ title: "wrong length.", detail: "solana addresses are 32 to 44 characters. this one is " + plural(n, "character") + "." + (n < 32 ? " part of it probably didn't get copied." : "") });
        res.tips.push("copy the whole address again with your wallet's copy button.");
      }
      return;
    }
    if (!bytes || bytes.length !== 32) {
      res.headline = "returned. right shape, wrong size.";
      res.problems.push({ title: "it decodes to " + plural(bytes ? bytes.length : 0, "byte") + ", not 32.", detail: "the characters are all valid base58, but a solana address is exactly 32 bytes once decoded. a character is probably missing, doubled or swapped." });
      res.tips.push("copy it again from your wallet instead of fixing it by hand.");
      return;
    }
    res.good.push("valid base58 characters only.");
    res.good.push("decodes to exactly 32 bytes.");
    if (/^1{32}$/.test(v)) res.good.push("heads up: this is the solana system program, not a wallet. please don't file it.");
  }

  function diagnoseEvm(v, raw, res) {
    var off = leadOffset(raw);
    if (/\.eth$/i.test(v)) {
      res.headline = "returned. that's a name, not an address.";
      res.problems.push({ title: "that's an ens name.", detail: "the form wants the 0x address it points to, not the name. copy the address from your wallet." });
      return;
    }
    var hasPrefix = v.slice(0, 2) === "0x";
    if (!hasPrefix && v.slice(0, 2) === "0X") {
      res.headline = "returned. the x is too tall.";
      res.problems.push({ title: "the x in 0x has to be lowercase.", detail: "0X with a capital X is refused. small x only." });
      var fix = siteRule("0x" + v.slice(2), "evm");
      if (fix.ok) res.suggestion = { label: "with a lowercase x it passes:", value: "0x" + v.slice(2) };
      return;
    }
    if (!hasPrefix) {
      if (/^[0-9a-fA-F]{40}$/.test(v)) {
        res.headline = "returned. missing its 0x.";
        res.problems.push({ title: "the 0x at the start is missing.", detail: "evm addresses are 0x followed by 40 characters. you have the 40." });
        var withX = siteRule("0x" + v, "evm");
        if (withX.ok) res.suggestion = { label: "with 0x added it passes:", value: "0x" + v };
        else {
          res.suggestion = { label: "with 0x added, in all lowercase:", value: "0x" + v.toLowerCase() };
          res.tips.push("the capitals in this one don't pass the checksum, which can mean a typo. compare it with your wallet before you use the lowercase version.");
        }
        return;
      }
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) {
        var d = b58decode(v);
        if (d && d.length === 32) {
          res.headline = "returned. wrong box.";
          res.problems.push({ title: "this looks like a solana address.", detail: "it goes in the solana box. evm addresses start with 0x." });
          return;
        }
      }
      res.headline = "returned. it needs to start with 0x.";
      res.problems.push({ title: "evm addresses start with 0x.", detail: "this one starts with \u201c" + v.slice(0, 2) + "\u201d." });
      return;
    }
    var body = v.slice(2);
    var nonHex = [];
    var nonHexSet = {};
    Array.from(body).forEach(function (ch, i) { if (!/[0-9a-fA-F]/.test(ch)) { nonHex.push(res.P(i + 3 + off)); nonHexSet[ch] = true; } });
    res.marks = res.marks.concat(nonHex);
    if (nonHex.length) {
      var extra = "";
      if (nonHexSet["o"] || nonHexSet["O"]) extra = " the letter o is not a zero.";
      else if (nonHexSet["x"] || nonHexSet["X"]) extra = " there may be a second 0x in there.";
      res.headline = "returned. not hex.";
      res.problems.push({ title: "after 0x, only 0-9 and a-f are allowed.", detail: ordinalPos(nonHex) + (nonHex.length === 1 ? " is " : " are ") + Object.keys(nonHexSet).map(function (c) { return "\u201c" + c + "\u201d"; }).join(" ") + "." + extra });
      return;
    }
    if (body.length !== 40) {
      res.headline = body.length < 40 ? "returned. it looks cut off." : "returned. too long for an address.";
      if (body.length === 64) {
        res.problems.push({ title: "64 characters after 0x is not an address.", detail: "that's the size of a private key or a transaction hash. an address has 40." });
        res.tips.push("if this is your private key: don't paste it anywhere, including here. nobody legit ever needs it. move your funds to a fresh wallet to be safe.");
      } else {
        res.problems.push({ title: "wrong length.", detail: "after 0x there should be exactly 40 characters. this one has " + body.length + "." });
        res.tips.push("copy the whole address again with your wallet's copy button.");
      }
      return;
    }
    var lower = body.toLowerCase(), upper = body.toUpperCase();
    var sum = toChecksum(body);
    if (body !== lower && body !== upper && "0x" + body !== sum) {
      var wrong = [];
      for (var i = 0; i < 40; i++) if (body[i] !== sum[i + 2]) wrong.push(res.P(i + 3 + off));
      res.marks = res.marks.concat(wrong);
      res.headline = "returned. the checksum doesn't match.";
      res.problems.push({ title: "mixed case, but the eip-55 checksum is wrong.", detail: "when an address mixes capitals and small letters, the capitals are a built-in typo check. here the case is off at " + ordinalPos(wrong) + "." });
      res.suggestion = { label: "the form accepts the all-lowercase version. paste this:", value: "0x" + lower };
      res.tips.push("only use the lowercase version if you copied the address straight from your own wallet. a failed checksum can also mean a character was mistyped, and lowercasing would hide that. when in doubt, copy it fresh.");
      return;
    }
    res.good.push("0x plus exactly 40 hex characters.");
    if (body === lower && body === upper) res.good.push("digits only, so there's no case to check.");
    else if (body === lower) res.good.push("all lowercase, so there's no checksum to check. that's allowed.");
    else if (body === upper) res.good.push("all uppercase, which also skips the checksum. that's allowed.");
    else res.good.push("mixed case and the eip-55 checksum matches.");
    if (/^0x0{40}$/i.test(v)) res.good.push("heads up: this is the zero address. nobody owns it. please don't file it.");
    else if (/^0x0{36}dead$/i.test(v)) res.good.push("heads up: this is the well-known burn address. nobody can use it. please don't file it.");
    res.saved = sum;
  }

  return {
    siteRule: siteRule,
    diagnose: diagnose,
    keccak256Hex: function (bytes) { return toHex(keccak256(bytes)); },
    _sha3_256Hex: function (bytes) { return toHex(keccak256(bytes, 0x06)); },
    toChecksum: toChecksum,
    b58decode: b58decode,
    b58encode: b58encode
  };
});
