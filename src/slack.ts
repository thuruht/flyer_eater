export function detectVenue(text: string): 'farewell' | 'howdy' | null {
  // Case-insensitive search. Check "howdy" first — it is the less common
  // default and must not be masked by a partial "farewell" match.
  const t = text.toLowerCase();
  if (t.includes('howdy')) return 'howdy';
  if (t.includes('farewell') || t.includes('6515')) return 'farewell';
  return null;
}

export function parseEmbargoTimestamp(text: string): number | null {
  // Recognizes phrases like:
  //   "do not announce until January 15"
  //   "embargo: 2026-01-15"
  //   "hold until Jan 15, 2026"
  // Returns unix seconds or null if no embargo found.
  
  const regexes = [
    /do not announce until\s+([^\.]+)/i,
    /embargo:\s*([^\.]+)/i,
    /hold until\s+([^\.]+)/i
  ];

  for (const regex of regexes) {
    const match = text.match(regex);
    if (match && match[1]) {
      const dateStr = match[1].trim();
      const timestamp = Date.parse(dateStr);
      if (!isNaN(timestamp)) {
        return Math.floor(timestamp / 1000);
      }
    }
  }

  return null;
}
