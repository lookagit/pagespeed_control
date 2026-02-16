export function sanitizeFilenameFromUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname
      .replace(/^www\./, "")
      .toLowerCase()
      .replace(/[^a-z0-9.-]/g, "");
    return host.replace(/\./g, "-");
  } catch {
    return "lead";
  }
}