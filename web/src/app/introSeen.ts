// First-visit memory for the introduction screen (components/Welcome.tsx).
// A per-browser convenience only: storage can be blocked (private windows), so every access is guarded and
// the app works without it (the intro then simply shows on each visit).
export const INTRO_SEEN_KEY = 'global-sar.intro-seen';

function seen(): boolean {
  try {
    return localStorage.getItem(INTRO_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markIntroSeen(): void {
  try {
    localStorage.setItem(INTRO_SEEN_KEY, '1');
  } catch {
    // storage unavailable: nothing to remember
  }
}

/**
 * Show the intro on a first visit to the landing view. A shared link that names an investigation goes straight
 * to it: the reader asked for that content, not for a tour.
 */
export function shouldShowIntro(link: { event: string | null }): boolean {
  return !link.event && !seen();
}
