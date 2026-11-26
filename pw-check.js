/* pw-check.js — CompliantUK password safety checks (client-side)
 * Supabase "leaked password protection" is a Pro-plan feature, so we do the same
 * check in the browser using the HaveIBeenPwned k-anonymity range API:
 * only the first 5 characters of the SHA-1 hash ever leave the device.
 * Usage: const err = await window.checkPasswordSafety(pw, email); if (err) show(err);
 */
(function () {
  var MIN = 10;
  async function sha1Hex(str) {
    var buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('').toUpperCase();
  }
  async function pwnedCount(pw) {
    var hash = await sha1Hex(pw);
    var prefix = hash.slice(0, 5), suffix = hash.slice(5);
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = ctrl ? setTimeout(function () { ctrl.abort(); }, 6000) : null;
    try {
      var r = await fetch('https://api.pwnedpasswords.com/range/' + prefix, { headers: { 'Add-Padding': 'true' }, signal: ctrl ? ctrl.signal : undefined });
      if (!r.ok) return 0;
      var text = await r.text();
      var lines = text.split('\n');
      for (var i = 0; i < lines.length; i++) {
        var parts = lines[i].trim().split(':');
        if (parts[0] === suffix) return parseInt(parts[1], 10) || 0;
      }
      return 0;
    } catch (e) {
      return 0; // network failure: do not block the user, length rules still apply
    } finally { if (t) clearTimeout(t); }
  }
  window.PW_MIN_LENGTH = MIN;
  window.checkPasswordSafety = async function (pw, email) {
    if (!pw || pw.length < MIN) return 'Password must be at least ' + MIN + ' characters.';
    if (/^(.)\1+$/.test(pw)) return 'Please choose a less predictable password.';
    var local = (email || '').split('@')[0].toLowerCase();
    if (local && local.length >= 4 && pw.toLowerCase().indexOf(local) !== -1) return 'Your password should not contain your email name.';
    var n = await pwnedCount(pw);
    if (n > 0) return 'This password has appeared in ' + n.toLocaleString('en-GB') + ' known data breaches. Please choose a different one.';
    return null;
  };
})();
