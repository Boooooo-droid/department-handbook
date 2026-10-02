# the department handbook

an unofficial, fan-made guide for applicants at the department of fomo ([fomies.family](https://fomies.family)).
not affiliated with, endorsed by or connected to fomies or the department of fomo.

live: https://boooooo-droid.github.io/department-handbook/

## what's in it

- how applying works, step by step
- an address checker (solana + evm) that uses the form's exact rules, offline
- fomies points, tasks, the common task errors, raids and referrals
- questions people keep asking
- glossary
- things to try in the office (spoilers folded)
- timeline of official posts and noticeboard memos, shown in your time zone
- scam alerts

## how it's built

- one static page. no build step, no backend, no analytics, no cookies.
- `js/checker.js` holds the address rules and a small keccak-256 (for eip-55). no outside libraries.
- the page's content security policy blocks all network requests (`connect-src 'none'`), so nothing you paste can leave the page.
- `sw.js` keeps an offline copy of the site's own files after your first visit.
- fonts, self-hosted: chewy (apache license 2.0), nunito and courier prime (sil open font license). licenses in `fonts/`.

## address rules (same as the form)

- raw input: at most 128 characters, only tab, line break and printable ascii. anything else (zero-width spaces, non-breaking spaces, letters from other alphabets) is refused.
- then leading and trailing whitespace is trimmed.
- solana: base58 alphabet, 32 to 44 characters, decodes to exactly 32 bytes.
- evm: `0x` + 40 hex. all lowercase or all uppercase passes. mixed case must match the eip-55 checksum. saved in checksummed form.

## tests

    node --test tests/

`tests/checker.test.js` covers keccak vectors, valid and invalid solana and evm addresses, invisible characters, nbsp, cyrillic lookalikes and the friendly messages.
`tests/differential.test.js` compares the rule against a local copy of the site's own `address-format.js` on 40,000+ generated inputs (set `ORIGINAL_ADDRESS_FORMAT=/path/to/address-format.js`). that file is not included here, so the test skips without it.

## run locally

    python3 -m http.server 8000

made by [@Boooooo1122](https://x.com/Boooooo1122).
