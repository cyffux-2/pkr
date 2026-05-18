export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  suit: Suit;
  rank: Rank;
}

export interface Player {
  id: string;
  username: string;
  avatar?: string;
  chips: number;
  isOnline: boolean;
}

export interface Table {
  id: string;
  name: string;
  players: number;
  maxPlayers: number;
  blinds: string;
  pot: number;
}

export type GameStatus = 'waiting' | 'playing' | 'finished';
