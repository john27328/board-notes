/** Local time matches the creation time the user sees in Obsidian. */
export function creationTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

export function cardBasename(title: string, timestamp?: string): string {
  const chars = Array.from(title.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-"));
  // Leave space for the timestamp, collision suffix and extension on common filesystems.
  while (new TextEncoder().encode(chars.join("")).length > 180) chars.pop();
  const safeTitle = chars.join("").replace(/[. ]+$/g, "") || "Новая заметка";
  return timestamp ? `${safeTitle} — ${timestamp}` : safeTitle;
}
