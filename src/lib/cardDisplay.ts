import type { WireCard } from './tableStateCache';

export function formatWireCard(card: WireCard | undefined) {
  if (!card) return '';

  const value = card._value ?? card.value;
  const color = card._color ?? card.color;
  const valueLabel = value === 1 ? 'A' : value === 13 ? 'K' : value === 12 ? 'Q' : value === 11 ? 'J' : String(value ?? '?');
  const suit = color === 0 ? '♠' : color === 1 ? '♥' : color === 2 ? '♦' : '♣';

  return `${valueLabel}${suit}`;
}

export function isRedWireCard(card: WireCard | undefined) {
  const color = card?._color ?? card?.color;
  return color === 1 || color === 2;
}
