/* cert-parse.js — reads dates, type and EPC rating from certificate text.
 * Runs in the browser (window.CertParse) and in Node (module.exports) for tests.
 * Text comes from pdf.js in the browser; nothing is sent to a server.
 */
(function (root) {
  var MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, sept:9, oct:10, nov:11, dec:12 };
  var EXPIRY_RE = /(valid\s+until|valid\s+to|expiry|expires|expiration|next\s+(?:inspection|check|safety\s+check|test)|recommended\s+date\s+for\s+(?:the\s+)?next|re-?inspect\w*|due\s+(?:date|by|before)|renewal\s+date|valid\s+until)/i;
  var ISSUE_RE = /(date\s+of\s+(?:inspection|check|assessment|certificate|issue|report|this\s+inspection|landlord'?s?\s+gas\s+safety)|inspection\s+date|date\s+of\s+the\s+inspection|issued?\s+(?:on|date)?|assessment\s+date|certificate\s+date|report\s+date|completed\s+on|date\s+(?:inspected|tested|carried\s+out)|check\s+date|date\s+of\s+completion)/i;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function mk(y, m, d) {
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return null;
    return y + '-' + pad(m) + '-' + pad(d);
  }
  function findDates(text) {
    var out = [], m;
    var reNum = /\b(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{4}|\d{2})\b/g;
    while ((m = reNum.exec(text))) { var a = mk(+m[3], +m[2], +m[1]); if (a) out.push({ iso: a, idx: m.index }); }
    var reIso = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
    while ((m = reIso.exec(text))) { var b = mk(+m[1], +m[2], +m[3]); if (b) out.push({ iso: b, idx: m.index }); }
    var reTxt = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})\b/gi;
    while ((m = reTxt.exec(text))) { var c = mk(+m[3], MONTHS[m[2].toLowerCase()], +m[1]); if (c) out.push({ iso: c, idx: m.index }); }
    var reUs = /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi;
    while ((m = reUs.exec(text))) { var e = mk(+m[3], MONTHS[m[1].toLowerCase()], +m[2]); if (e) out.push({ iso: e, idx: m.index }); }
    out.sort(function (x, y) { return x.idx - y.idx; });
    return out;
  }
  function detectType(t) {
    if (/gas\s+safety|cp\s?12|landlord'?s?\s+gas|gas\s+safe\s+register/i.test(t)) return 'gas';
    if (/electrical\s+installation\s+condition|\beicr\b|electrical\s+safety\s+(?:certificate|report)/i.test(t)) return 'eicr';
    if (/energy\s+performance\s+certificate|\bepc\b|energy\s+efficiency\s+rating/i.test(t)) return 'epc';
    if (/house\s+in\s+multiple\s+occupation|hmo\s+licen[cs]e|selective\s+licen[cs]e/i.test(t)) return 'licence';
    if (/deposit\s+protection|tenancy\s+deposit|\bdps\b|mydeposits|\btds\b/i.test(t)) return 'deposit';
    return null;
  }
  function detectRating(t) {
    var m = t.match(/energy\s+(?:efficiency\s+)?rating\s+(?:is\s+|of\s+)?([A-G])\b/i)
      || t.match(/current\s+(?:energy\s+)?rating[^A-Za-z]{0,20}([A-G])\b/i)
      || t.match(/\brated\s+([A-G])\b/);
    return m ? m[1].toUpperCase() : null;
  }
  function extract(text) {
    var t = String(text || '').replace(/\s+/g, ' ');
    var dates = findDates(t);
    var type = detectType(t);
    var issued = null, expires = null;
    for (var i = 0; i < dates.length; i++) {
      var ctx = t.slice(Math.max(0, dates[i].idx - 90), dates[i].idx);
      var lastExp = ctx.search(EXPIRY_RE) >= 0 ? lastIndex(ctx, EXPIRY_RE) : -1;
      var lastIss = ctx.search(ISSUE_RE) >= 0 ? lastIndex(ctx, ISSUE_RE) : -1;
      if (lastExp > lastIss && !expires) expires = dates[i].iso;
      else if (lastIss > lastExp && !issued) issued = dates[i].iso;
    }
    if (!issued && dates.length) {
      var sorted = dates.map(function (d) { return d.iso; }).sort();
      issued = sorted.filter(function (d) { return !expires || d < expires; })[0] || null;
      if (!expires && sorted.length > 1 && sorted[sorted.length - 1] > issued) {
        var latest = sorted[sorted.length - 1];
        // only treat a later date as expiry if it is plausibly a validity period (> 6 months later)
        if (monthsBetween(issued, latest) >= 6) expires = latest;
      }
    }
    if (issued && expires && expires <= issued) expires = null;
    return { type: type, issued: issued, expires: expires, rating: type === 'epc' || /energy/i.test(t) ? detectRating(t) : null, datesFound: dates.length };
  }
  function lastIndex(str, re) {
    var g = new RegExp(re.source, 'gi'), m, last = -1;
    while ((m = g.exec(str))) last = m.index;
    return last;
  }
  function monthsBetween(a, b) {
    var x = a.split('-').map(Number), y = b.split('-').map(Number);
    return (y[0] - x[0]) * 12 + (y[1] - x[1]);
  }
  var api = { extract: extract, findDates: findDates, detectType: detectType, detectRating: detectRating };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CertParse = api;
})(typeof window !== 'undefined' ? window : globalThis);
