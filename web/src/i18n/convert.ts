import { SIMPLIFIED_CHARACTERS, SIMPLIFIED_PHRASES, TRADITIONAL_CHARACTERS } from './zh-hans-map';

// Same approach as Master Travel's passenger app: text is written once in
// Traditional Chinese and Simplified is derived from it.
let characters: Map<string, string> | undefined;
const converted = new Map<string, string>();
const CONVERTED_LIMIT = 2000;
export const HAS_CJK = /[㐀-鿿]/;

export function toSimplified(text: string): string {
  const cached = converted.get(text);
  if (cached !== undefined) return cached;
  if (!characters) {
    characters = new Map();
    for (let index = 0; index < TRADITIONAL_CHARACTERS.length; index += 1) {
      characters.set(TRADITIONAL_CHARACTERS[index], SIMPLIFIED_CHARACTERS[index]);
    }
  }
  // Whole words first: a few convert differently from their separate characters.
  let source = text;
  const kept: string[] = [];
  for (const [phrase, simplified] of SIMPLIFIED_PHRASES) {
    if (!source.includes(phrase)) continue;
    source = source.split(phrase).join(`\u0000${kept.length}\u0000`);
    kept.push(simplified);
  }
  let result = '';
  for (const char of source) result += characters.get(char) ?? char;
  if (kept.length) result = result.replace(/\u0000(\d+)\u0000/g, (_, index) => kept[Number(index)]);
  if (converted.size >= CONVERTED_LIMIT) converted.clear();
  converted.set(text, result);
  return result;
}
