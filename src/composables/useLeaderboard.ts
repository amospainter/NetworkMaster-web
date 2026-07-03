import { ref, watch, type Ref } from 'vue'
import type { GameState, LeaderboardEntry } from '../types'

const LEADERBOARD_STORAGE_KEY = 'networkmaster.leaderboard.v1'
/** Maximum number of locally persisted completed runs. */
export const LEADERBOARD_SIZE = 10

/**
 * Loads the personal leaderboard from local storage.
 *
 * @returns Parsed entries, or an empty array for missing/malformed storage.
 */
const loadLeaderboard = (): LeaderboardEntry[] => {
  try {
    const stored = JSON.parse(localStorage.getItem(LEADERBOARD_STORAGE_KEY) || '[]')
    return Array.isArray(stored) ? stored : []
  } catch {
    return []
  }
}

/**
 * Creates a leaderboard entry identifier.
 *
 * @returns A UUID or non-secure-context fallback identifier.
 */
const createEntryId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`

/**
 * Owns the local (unversioned, not part of `GameState`) personal leaderboard:
 * the 10 highest-scoring completed runs. Automatically records a new entry
 * exactly once per run, on the `phase` transition into `'gameover'`.
 *
 * @param game - Reactive current game state.
 * @returns Reactive leaderboard entries and an explicit recording function.
 */
export function useLeaderboard(game: Ref<GameState | null>) {
  const leaderboard = ref<LeaderboardEntry[]>(loadLeaderboard())

  /**
   * Appends a finished run to the local leaderboard, keeping the top scores.
   *
   * @param finishedGame - Completed game state to record.
   * @returns Nothing; reactive and persisted leaderboard state are updated.
   */
  function recordLeaderboardEntry(finishedGame: GameState) {
    leaderboard.value = [
      ...leaderboard.value,
      {
        id: createEntryId(),
        scenario: finishedGame.scenario,
        score: finishedGame.score,
        delivered: finishedGame.delivered,
        tick: finishedGame.tick,
        completedAt: Date.now(),
      },
    ]
      .sort((a, b) => b.score - a.score)
      .slice(0, LEADERBOARD_SIZE)
    localStorage.setItem(LEADERBOARD_STORAGE_KEY, JSON.stringify(leaderboard.value))
  }

  watch(
    () => game.value?.phase,
    (phase, previousPhase) => {
      if (phase !== 'gameover' || previousPhase === 'gameover' || !game.value) return
      recordLeaderboardEntry(game.value)
    },
  )

  return { leaderboard, recordLeaderboardEntry }
}
