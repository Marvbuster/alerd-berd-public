import { translateMessage } from "@/i18n/translate";

export function german<T>(value: T): T {
  if (typeof value === "string") return translateMessage("de", value) as T;
  if (Array.isArray(value)) return value.map(german) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, german(entry)])) as T;
  return value;
}
