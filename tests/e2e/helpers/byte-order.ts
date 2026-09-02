/**
 * v2.6.5 L16 byte-order contract: the Hex input/display is a byte stream in
 * the selected order (default LE = low byte first). To place the register
 * word `wordHex` (e.g. '0100') into the field, type its byte-swapped text
 * (e.g. '0001'); the field then echoes exactly that text (parse and display
 * are inverse transforms).
 */
export function leByteStreamText(wordHex: string): string {
  const digits = wordHex.toUpperCase().padStart(4, '0')
  return digits.slice(2) + digits.slice(0, 2)
}
