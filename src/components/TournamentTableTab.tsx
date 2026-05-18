import { formatWireCard, isRedWireCard } from '../lib/cardDisplay';
import { useTablePreview } from '../hooks/useTablePreview';

type TournamentTableTabClasses = Readonly<Record<string, string>>;

type TournamentTableTabProps = {
  tournamentName: string;
  tableId?: number | null;
  userId?: string | null;
  selected?: boolean;
  classes: TournamentTableTabClasses;
  onClick: () => void;
};

export function TournamentTableTab({
  tournamentName,
  tableId,
  userId,
  selected = false,
  classes,
  onClick,
}: TournamentTableTabProps) {
  const preview = useTablePreview(tableId, userId);

  const useFallbackCards = !tableId || !preview.tableState;
  const labels = preview.isEliminated
    ? ['K', 'O']
    : preview.heroHasCards
    ? [formatWireCard(preview.privateCards[0]) || '?', formatWireCard(preview.privateCards[1]) || '?']
    : useFallbackCards
      ? ['A', 'K']
      : ['', ''];
  const cards = preview.heroHasCards ? preview.privateCards : [];
  const title = preview.isEliminated
    ? `${tournamentName} - voir le résultat`
    : preview.isHeroTurn
      ? `${tournamentName} - à toi de jouer`
      : tournamentName;
  const ariaLabel = preview.isEliminated
    ? `Voir le résultat de ${tournamentName}`
    : preview.isHeroTurn
      ? `Reprendre ${tournamentName}, à toi de jouer`
      : `Reprendre ${tournamentName}`;

  return (
    <button
      className={[
        classes.cardsTab,
        preview.isEliminated ? classes.cardsTabEliminated : '',
        selected ? classes.cardsTabSelected : '',
        preview.isHeroTurn ? classes.cardsTabPulse : '',
      ].filter(Boolean).join(' ')}
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
    >
      {[0, 1].map(index => {
        const card = cards[index];
        const isFallbackRed = !preview.heroHasCards && useFallbackCards && index === 1;
        const isEmpty = !labels[index];

        return (
          <span
            key={index}
            className={[
              classes.card,
              isRedWireCard(card) || isFallbackRed ? classes.cardK : classes.cardA,
              isEmpty ? classes.cardEmpty : '',
            ].filter(Boolean).join(' ')}
          >
            {labels[index]}
          </span>
        );
      })}
    </button>
  );
}
