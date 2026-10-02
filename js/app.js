/* The Department Handbook · page behaviour. no network, no storage. */
(function () {
  "use strict";
  var C = window.HandbookChecker;

  /* ---------------- address checker ---------------- */
  var EX = {
    zwsp: ["evm", "0x000000000000000000000000000000000000\u200bdEaD"],
    nbsp: ["solana", "\u00a011111111111111111111111111111111"],
    checksum: ["evm", "0x000000000000000000000000000000000000DeAd"],
    cyrillic: ["evm", "0x000000000000000000000000000000000000dE\u0430D"],
    short: ["solana", "1111111111111111111111111111"],
    base58: ["solana", "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA".replace("o", "0")],
    swap: ["solana", "0x000000000000000000000000000000000000dEaD"]
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function charToken(c, marked) {
    var ch = c.ch;
    if (c.bad) {
      var isLook = c.tag && /^(cyr|gre|arm|wide) /.test(c.tag);
      var m = el("mark", "tag", isLook ? c.tag.replace(/^cyr /, "cyrillic ").replace(/^gre /, "greek ").replace(/^arm /, "armenian ") : c.tag);
      m.title = "position " + c.pos;
      return m;
    }
    var shown = ch === " " ? "\u00b7" : ch === "\t" ? "\u21e5" : ch === "\n" ? "\u21b5" : ch === "\r" ? "" : ch;
    if (marked) { var mk = el("mark", "", shown); mk.title = "position " + c.pos; return mk; }
    if (/\s/.test(ch)) return el("span", "sp", shown);
    return document.createTextNode(ch);
  }

  function copyText(text, btn) {
    function done(ok) { var old = btn.textContent; btn.textContent = ok ? "copied" : "select it and copy"; setTimeout(function () { btn.textContent = old; }, 1600); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    else done(false);
  }

  function grow(input) {
    input.style.height = "auto";
    input.style.height = input.scrollHeight + 6 + "px";
  }

  function render(kind) {
    var input = document.getElementById("in-" + kind);
    grow(input);
    var out = document.getElementById("out-" + kind);
    var field = input.closest(".field");
    var raw = input.value;
    out.textContent = "";
    field.classList.remove("is-ok", "is-bad");
    input.removeAttribute("aria-invalid");
    if (!raw) return;
    var r = C.diagnose(raw, kind);
    if (r.empty) return;

    var slip = el("div", "slip " + (r.ok ? "ok" : "bad"));
    var stamp = el("span", "stamp slip-stamp", r.ok ? "format ok" : "returned");
    stamp.setAttribute("aria-hidden", "true");
    slip.appendChild(stamp);
    slip.appendChild(el("p", "slip-h", r.headline));
    field.classList.add(r.ok ? "is-ok" : "is-bad");
    if (!r.ok) input.setAttribute("aria-invalid", "true");

    if (!r.ok) {
      var marks = {};
      (r.marks || []).forEach(function (p) { marks[p] = true; });
      var anyMark = r.chars.some(function (c) { return c.bad || marks[c.pos]; });
      if (anyMark) {
        var strip = el("div", "strip");
        strip.setAttribute("aria-hidden", "true");
        var max = 140;
        r.chars.slice(0, max).forEach(function (c) { strip.appendChild(charToken(c, marks[c.pos])); });
        if (r.chars.length > max) strip.appendChild(document.createTextNode(" \u2026"));
        slip.appendChild(strip);
        slip.appendChild(el("p", "strip-cap", "your input, character by character. the highlighted bits are the problem."));
      }
      var ul = el("ul", "problems");
      r.problems.forEach(function (p) {
        var li = el("li");
        li.appendChild(el("span", "p-title", p.title));
        if (p.detail) li.appendChild(el("span", "p-detail", p.detail));
        ul.appendChild(li);
      });
      slip.appendChild(ul);
    } else {
      var good = el("ul", "good");
      r.good.forEach(function (g) { good.appendChild(el("li", "", g)); });
      slip.appendChild(good);
      var saved = el("p", "saved");
      saved.appendChild(document.createTextNode(kind === "evm" ? "the form saves it as: " : "the form reads it as: "));
      saved.appendChild(el("code", "", r.value));
      slip.appendChild(saved);
    }

    if (r.suggestion) {
      var box = el("div", "sugg");
      box.appendChild(el("p", "", r.suggestion.label));
      box.appendChild(el("code", "", r.suggestion.value));
      var use = el("button", "btn-small", "use this");
      use.type = "button";
      use.addEventListener("click", function () { input.value = r.suggestion.value; render(kind); input.focus(); });
      var cp = el("button", "btn-small", "copy");
      cp.type = "button";
      cp.addEventListener("click", function () { copyText(r.suggestion.value, cp); });
      box.appendChild(use);
      box.appendChild(document.createTextNode(" "));
      box.appendChild(cp);
      slip.appendChild(box);
    }

    if (r.tips.length) {
      slip.appendChild(el("p", "tipl", "tips"));
      var tl = el("ul", "tips");
      r.tips.forEach(function (t) { tl.appendChild(el("li", "", t)); });
      slip.appendChild(tl);
    }
    out.appendChild(slip);
  }

  function setupChecker() {
    if (!C) return;
    window.addEventListener("resize", function () { grow(document.getElementById("in-solana")); grow(document.getElementById("in-evm")); });
    ["solana", "evm"].forEach(function (kind) {
      var input = document.getElementById("in-" + kind);
      var t = null;
      input.addEventListener("input", function () { clearTimeout(t); t = setTimeout(function () { render(kind); }, 90); });
      // keep enter from adding a line break; the form is one line
      input.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); render(kind); } });
      if (input.value) render(kind);
    });
    document.querySelectorAll("[data-clear]").forEach(function (b) {
      b.addEventListener("click", function () {
        var k = b.getAttribute("data-clear");
        var input = document.getElementById("in-" + k);
        input.value = ""; render(k); input.focus();
      });
    });
    document.querySelectorAll("[data-example]").forEach(function (b) {
      b.addEventListener("click", function () {
        var ex = EX[b.getAttribute("data-example")];
        var input = document.getElementById("in-" + ex[0]);
        input.value = ex[1];
        render(ex[0]);
        var out = document.getElementById("out-" + ex[0]);
        var top = input.getBoundingClientRect().top;
        if (top < 70 || top > window.innerHeight * 0.6) input.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        out.setAttribute("tabindex", "-1");
      });
    });
  }

  /* ---------------- local times ---------------- */
  var MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function fmtLocal(d) {
    return MONTHS[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear() + ", " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function offsetLabel(d) {
    var m = -d.getTimezoneOffset();
    var sign = m >= 0 ? "+" : "-";
    m = Math.abs(m);
    return "utc" + sign + Math.floor(m / 60) + (m % 60 ? ":" + pad(m % 60) : "");
  }
  function setupTimes() {
    var nodes = document.querySelectorAll("time[data-local]");
    nodes.forEach(function (t) {
      var d = new Date(t.getAttribute("datetime"));
      if (isNaN(d)) return;
      t.textContent = fmtLocal(d);
      t.title = d.toUTCString().replace("GMT", "UTC");
    });
    var tz = "";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { tz = ""; }
    var lab = document.getElementById("tz-label");
    if (lab) lab.textContent = "your time zone (" + (tz ? tz.toLowerCase().replace(/_/g, " ") + ", " : "") + offsetLabel(new Date()) + ")";
  }

  function setupRaid() {
    var box = document.getElementById("raid-status");
    if (!box) return;
    var end = new Date("2026-10-03T07:58:00Z");
    function tick() {
      var now = Date.now();
      box.textContent = "";
      if (now >= end.getTime()) {
        box.appendChild(document.createTextNode("that raid ended " + fmtLocal(end) + " your time. watch the telegram channel for the next one."));
        return true;
      }
      var mins = Math.max(1, Math.round((end.getTime() - now) / 60000));
      var h = Math.floor(mins / 60), m = mins % 60;
      box.appendChild(document.createTextNode("that raid ends " + fmtLocal(end) + " your time, in about " + (h ? h + " h " : "") + m + " min."));
      return false;
    }
    if (!tick()) var iv = setInterval(function () { if (tick()) clearInterval(iv); }, 30000);
  }

  /* ---------------- the vent (original lines, not the department's) ---------------- */
  var LINES = [
    "psst. this page is unofficial. so am i.",
    "i don't know when mint is. nobody in the walls does.",
    "check your addresses below. the clerk hates a typo.",
    "if someone in the replies says they're the team, they aren't. the team doesn't reply.",
    "i live in a fan site now. the rent is reasonable.",
    "nobody here will ask you to connect a wallet. if someone does, it isn't us.",
    "the elevator is still taped off. i can hear the tape.",
    "still no news. i'd tell you. i tell everyone."
  ];
  function setupVent() {
    var vent = document.getElementById("vent");
    var said = document.getElementById("vent-said");
    if (!vent || !said) return;
    var i = 0, peekT = null;
    vent.addEventListener("click", function () {
      i = (i + 1) % LINES.length;
      said.textContent = LINES[i];
      said.classList.remove("pop"); void said.offsetWidth; said.classList.add("pop");
      vent.classList.add("peek");
      clearTimeout(peekT);
      peekT = setTimeout(function () { vent.classList.remove("peek"); }, 2600);
    });
  }

  /* ---------------- tabs ---------------- */
  function setupTabs() {
    var links = Array.prototype.slice.call(document.querySelectorAll(".tabs a"));
    if (!("IntersectionObserver" in window) || !links.length) return;
    var byId = {};
    links.forEach(function (a) { byId[a.getAttribute("href").slice(1)] = a; });
    var current = null;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var a = byId[e.target.id];
        if (!a || a === current) return;
        if (current) current.classList.remove("on");
        a.classList.add("on");
        current = a;
        var bar = a.closest("ol");
        var left = a.offsetLeft - bar.clientWidth / 2 + a.clientWidth / 2;
        bar.scrollTo({ left: left, behavior: "auto" });
      });
    }, { rootMargin: "-30% 0px -60% 0px" });
    Object.keys(byId).forEach(function (id) { var s = document.getElementById(id); if (s) io.observe(s); });
  }

  /* ---------------- offline ---------------- */
  function setupOffline() {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
  }

  setupChecker();
  setupTimes();
  setupRaid();
  setupVent();
  setupTabs();
  setupOffline();
})();
