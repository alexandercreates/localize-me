/** `login.title` → `login_title`. Android erlaubt nur Java-Bezeichner als Namen. */
export function resourceName(key) {
  return key.replace(/[.\-]/g, "_");
}
