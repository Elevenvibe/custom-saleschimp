import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Standard shadcn cn() — combine Tailwind class strings with merge. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
