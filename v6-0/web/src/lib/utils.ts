import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Joins class names, later Tailwind classes winning over earlier ones they conflict with. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
