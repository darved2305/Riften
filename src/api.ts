// Browser storage is optional in private and embedded browsers.
const memory = new Map<string, string>();
export const preferences = {
  getItem(key: string) { try { return localStorage.getItem(key); } catch { return memory.get(key) ?? null; } },
  setItem(key: string, value: string) { memory.set(key, value); try { localStorage.setItem(key, value); } catch { /* Keep this session usable. */ } },
  removeItem(key: string) { memory.delete(key); try { localStorage.removeItem(key); } catch { /* Storage is optional. */ } },
};
// One-time preference migration after the product rename.
for (const suffix of ["page", "workspace", "assessment"]) {
  const oldKey = "metrik-" + suffix;
  const newKey = "riften-" + suffix;
  if (
    preferences.getItem(newKey) === null &&
    preferences.getItem(oldKey) !== null
  )
    preferences.setItem(newKey, preferences.getItem(oldKey)!);
  preferences.removeItem(oldKey);
}
export async function api(path: string, options: RequestInit = {}) {
  const response = await fetch("/api" + path, {
    ...options,
    headers:
      options.body instanceof FormData
        ? options.headers
        : { "Content-Type": "application/json", ...options.headers },
  });
  const data = await response
    .json()
    .catch(() => ({ detail: "Invalid server response" }));
  if (!response.ok)
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : JSON.stringify(data.detail || data),
    );
  return data;
}
export const post = (path: string, body: unknown = {}) =>
  api(path, { method: "POST", body: JSON.stringify(body) });
export const patch = (path: string, body: unknown) =>
  api(path, { method: "PATCH", body: JSON.stringify(body) });
export const label = (value: string = "") => value.replaceAll("_", " ");
export const time = (s: string) =>
  new Date(s).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
