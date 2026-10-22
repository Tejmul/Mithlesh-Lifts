// "Just booked" lives in this tab's sessionStorage, not the URL: /account stays a clean address
// and nothing in the link can be edited or shared. Expires after 30 minutes.
const KEY = "css_just_booked";
const TTL_MS = 30 * 60 * 1000;

export function markJustBooked() {
  try {
    window.sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* private mode: the account page simply shows the normal view */
  }
}

export function isJustBooked(): boolean {
  try {
    const at = Number(window.sessionStorage.getItem(KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < TTL_MS;
  } catch {
    return false;
  }
}

export function clearJustBooked() {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
