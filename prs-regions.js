// prs-regions.js
// Shared data + helpers for the Renters' Rights Act 2025 "Register your rental property" service.
// Source: GOV.UK — Register your rental property service: guidance for landlords (published 29 Oct 2026).
// Works in the browser (window.PRS) and in Node (module.exports) for tests.
(function (root) {
  function d(y, m, day) { return new Date(Date.UTC(y, m - 1, day)); }

  var REGIONS = [
    { name: 'West Midlands',            ons: ['West Midlands'],                                   start: d(2026, 12, 15), end: d(2027, 3, 14) },
    { name: 'East of England',          ons: ['East of England', 'East'],                         start: d(2027, 1, 15),  end: d(2027, 4, 14) },
    { name: 'East Midlands',            ons: ['East Midlands'],                                   start: d(2027, 2, 15),  end: d(2027, 5, 14) },
    { name: 'South East',               ons: ['South East'],                                      start: d(2027, 3, 15),  end: d(2027, 6, 14) },
    { name: 'Yorkshire and Humberside', ons: ['Yorkshire and The Humber', 'Yorkshire and the Humber', 'Yorkshire and Humberside'], start: d(2027, 4, 15), end: d(2027, 7, 14) },
    { name: 'North West',               ons: ['North West'],                                      start: d(2027, 5, 15),  end: d(2027, 8, 14) },
    { name: 'North East',               ons: ['North East'],                                      start: d(2027, 6, 15),  end: d(2027, 9, 14) },
    { name: 'London',                   ons: ['London'],                                          start: d(2027, 7, 15),  end: d(2027, 10, 14) },
    { name: 'South West',               ons: ['South West'],                                      start: d(2027, 8, 15),  end: d(2027, 11, 14) }
  ];
  var ANNUAL_FEE = 65;
  var CHARGING_STARTS = d(2027, 11, 15); // days before this are not charged during rollout
  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  function dayUTC(dt) { return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate())); }
  function daysBetween(a, b) { return Math.round((dayUTC(b) - dayUTC(a)) / 86400000); }
  function laterOf(a, b) { return a > b ? a : b; }
  function fmt(dt) { return dt.getUTCDate() + ' ' + MONTHS[dt.getUTCMonth()] + ' ' + dt.getUTCFullYear(); }
  function fmtShort(dt) { return dt.getUTCDate() + ' ' + MONTHS[dt.getUTCMonth()].slice(0, 3) + ' ' + dt.getUTCFullYear(); }
  function iso(dt) { return dt.toISOString().slice(0, 10); }

  function addYear(dt) {
    var y = dt.getUTCFullYear() + 1, m = dt.getUTCMonth(), day = dt.getUTCDate();
    var r = new Date(Date.UTC(y, m, day));
    if (r.getUTCMonth() !== m) r = new Date(Date.UTC(y, m + 1, 0)); // 29 Feb -> 28 Feb
    return r;
  }

  // GOV.UK formula: (fee / year_length) * (remaining_days - free_days), rounded down to 2dp.
  function estimateFee(regDate) {
    var date = dayUTC(regDate);
    var renewal = addYear(date);
    var yearLength = daysBetween(date, renewal);
    var free = Math.max(0, daysBetween(date, CHARGING_STARTS));
    var fee = (ANNUAL_FEE / yearLength) * Math.max(0, yearLength - free);
    fee = Math.floor(fee * 100 + 1e-9) / 100;
    return { date: date, dateISO: iso(date), fee: fee, yearLength: yearLength, freeDays: free };
  }

  function findRegion(onsName) {
    if (!onsName) return null;
    var n = String(onsName).toLowerCase();
    for (var i = 0; i < REGIONS.length; i++) {
      for (var j = 0; j < REGIONS[i].ons.length; j++) if (REGIONS[i].ons[j].toLowerCase() === n) return REGIONS[i];
    }
    return null;
  }

  function regionState(r, now) {
    var t = dayUTC(now || new Date());
    if (t < r.start) { var x = daysBetween(t, r.start); return 'Opens in ' + x + ' day' + (x === 1 ? '' : 's'); }
    if (t <= r.end) { var y = daysBetween(t, r.end) + 1; return 'Open now — ' + y + ' day' + (y === 1 ? '' : 's') + ' left'; }
    return 'Deadline passed — register now';
  }

  // Overall site status, used by banners/countdowns.
  function status(now) {
    var t = dayUTC(now || new Date());
    if (t < REGIONS[0].start) return { phase: 'pre', region: REGIONS[0], days: daysBetween(t, REGIONS[0].start) };
    var open = REGIONS.filter(function (r) { return t >= r.start && t <= r.end; });
    if (open.length) {
      open.sort(function (a, b) { return a.end - b.end; });
      return { phase: 'open', region: open[0], days: daysBetween(t, open[0].end) + 1, openRegions: open };
    }
    return { phase: 'post', region: null, days: 0 };
  }

  var api = { REGIONS: REGIONS, ANNUAL_FEE: ANNUAL_FEE, dayUTC: dayUTC, daysBetween: daysBetween, laterOf: laterOf, fmt: fmt, fmtShort: fmtShort, iso: iso, estimateFee: estimateFee, findRegion: findRegion, regionState: regionState, status: status };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PRS = api;
})(typeof window !== 'undefined' ? window : globalThis);
