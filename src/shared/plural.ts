/** "1 turn", "3 turns": a count with its noun, for status lines. */
export const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`
