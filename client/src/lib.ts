export function bytesToGiB(bytes: string): string {
  const value = Number(bytes);
  if (!Number.isFinite(value)) {
    return "0";
  }
  return (value / 1024 ** 3).toFixed(2);
}

export function gibToBytes(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return "0";
  }
  return Math.round(parsed * 1024 ** 3).toString();
}

export function formatBytes(bytes: string): string {
  let value = Number(bytes);
  if (!Number.isFinite(value)) {
    return `${bytes} B`;
  }
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 2)} ${units[index]}`;
}

export function formatDate(value: string | null): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString();
}
