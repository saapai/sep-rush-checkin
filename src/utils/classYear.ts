const CLASS_LABELS: Record<number, string> = {
  2029: 'Freshman',
  2028: 'Sophomore',
  2027: 'Junior',
  2026: 'Senior',
};

export function getClassLabel(year: number | null, id?: string): string {
  if (!year) return '—';
  // Check if marked as transfer
  if (year === 2027 && id && isTransfer(id)) return '3rd Year Transfer';
  return CLASS_LABELS[year] || `Class of ${year}`;
}

export function isTransfer(id: string): boolean {
  try {
    const transfers: string[] = JSON.parse(sessionStorage.getItem('transfers') || '[]');
    return transfers.includes(id);
  } catch { return false; }
}

export function toggleTransfer(id: string): boolean {
  try {
    const transfers: string[] = JSON.parse(sessionStorage.getItem('transfers') || '[]');
    const idx = transfers.indexOf(id);
    if (idx >= 0) {
      transfers.splice(idx, 1);
    } else {
      transfers.push(id);
    }
    sessionStorage.setItem('transfers', JSON.stringify(transfers));
    return transfers.includes(id);
  } catch { return false; }
}
