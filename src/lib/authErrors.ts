export function translateAuthError(message: string): string {
  const normalized = message.toLowerCase();

  if (normalized.includes('email not confirmed')) {
    return 'Compte non activé.';
  }

  if (normalized.includes('invalid login credentials')) {
    return 'Identifiants incorrects.';
  }

  if (normalized.includes('user already registered') || normalized.includes('already registered')) {
    return 'Un compte existe déjà avec cet email.';
  }

  if (normalized.includes('password should be at least') || normalized.includes('password')) {
    return 'Le mot de passe ne respecte pas les règles demandées.';
  }

  if (normalized.includes('signup is disabled')) {
    return 'La création de compte est désactivée.';
  }

  if (normalized.includes('invalid email')) {
    return 'Adresse email invalide.';
  }

  if (normalized.includes('rate limit') || normalized.includes('too many')) {
    return 'Trop de tentatives. Réessaie dans quelques instants.';
  }

  if (normalized.includes('expired')) {
    return 'Ce lien a expiré.';
  }

  if (normalized.includes('unauthorized')) {
    return 'Session expirée, reconnecte-toi.';
  }

  if (normalized.includes('network')) {
    return 'Erreur réseau. Vérifie ta connexion.';
  }

  return message;
}
