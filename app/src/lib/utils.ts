import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

/** Formats a dollar amount (not cents) as USD, e.g. 1200.5 -> "$1,200.50". */
export function formatCurrency(amountInDollars: number): string {
  return currencyFormatter.format(amountInDollars)
}
