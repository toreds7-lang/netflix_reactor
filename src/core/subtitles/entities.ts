const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  lrm: '',
  rlm: '',
  zwj: '',
  zwnj: '',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code)) return m;
      if (code === 0x200e || code === 0x200f) return '';
      return String.fromCodePoint(code);
    }
    const named = NAMED[body.toLowerCase()];
    return named ?? m;
  });
}

/** Remove bidi control marks and normalize whitespace inside each line. */
export function tidyText(s: string): string {
  return s
    .replace(/[‎‏‪-‮]/g, '')
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter((l) => l.length > 0)
    .join('\n');
}
