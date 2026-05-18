export type BlindLevel = {
  level: number;
  duration: string;
  smallBlind: number;
  bigBlind: number;
  isCurrent: boolean;
};

const SIGNIFICANT_MULTIPLES = [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];

export function roundBlind(value: number) {
  const power = Math.pow(10, Math.floor(Math.log10(value)));

  return SIGNIFICANT_MULTIPLES.reduce((closest, multiple) => {
    const candidate = multiple * power;
    return Math.abs(candidate - value) < Math.abs(closest - value) ? candidate : closest;
  }, SIGNIFICANT_MULTIPLES[0] * power);
}

export function getLevelIndexFromPublishedBlinds(smallBlind: number | undefined, bigBlind: number | undefined) {
  const referenceBlind = smallBlind ?? (bigBlind ? bigBlind / 2 : undefined);
  if (!referenceBlind) return null;

  let currentSmallBlind = 25;
  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < 100; index += 1) {
    const distance = Math.abs(currentSmallBlind - referenceBlind);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
    if (distance <= Math.max(1, currentSmallBlind * 0.03)) return index;
    currentSmallBlind = roundBlind(currentSmallBlind * 1.25);
  }

  return closestIndex;
}

export function buildBlindLevels(minutes: number, startLevelIndex: number) {
  const rows: BlindLevel[] = [];
  let smallBlind = 25;

  for (let index = 0; index < startLevelIndex + 7; index += 1) {
    if (index >= startLevelIndex) {
      rows.push({
        level: index + 1,
        duration: `${minutes || 5}:00`,
        smallBlind,
        bigBlind: smallBlind * 2,
        isCurrent: index === startLevelIndex,
      });
    }

    smallBlind = roundBlind(smallBlind * 1.25);
  }

  return rows;
}
