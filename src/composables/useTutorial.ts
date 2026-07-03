import { ref } from 'vue'

const TUTORIAL_SEEN_KEY = 'networkmaster.tutorial-seen.v1'

/** Ordered onboarding copy displayed by the one-time quick-start card. */
export const TUTORIAL_STEPS = [
  'Pick a scenario and start a run — every network begins on a clean slate.',
  'Select a device, choose "Begin cable", then tap its destination to wire them together.',
  'Phones and tablets only join through Wi-Fi coverage; other end devices can use either a cable or Wi-Fi.',
  'Watch the canvas: packets animate along your cables. Orange links are over capacity — upgrade the link or add another route.',
  'Open Site Upgrades for discounted bulk upgrades, and check Run Stats for live delivery telemetry.',
]

/**
 * Owns onboarding state for the quick-start card shown once per browser.
 *
 * @returns Reactive tutorial state and navigation actions.
 */
export function useTutorial() {
  const tutorialStep = ref(0)
  const tutorialActive = ref(localStorage.getItem(TUTORIAL_SEEN_KEY) === null)

  /**
   * Permanently dismisses onboarding for the current browser profile.
   *
   * @returns Nothing; reactive and persisted tutorial state are updated.
   */
  function dismissTutorial() {
    tutorialActive.value = false
    localStorage.setItem(TUTORIAL_SEEN_KEY, '1')
  }
  /**
   * Advances to the next card, dismissing onboarding after the final step.
   *
   * @returns Nothing; the current step or dismissal state is updated.
   */
  function advanceTutorial() {
    if (tutorialStep.value >= TUTORIAL_STEPS.length - 1) {
      dismissTutorial()
      return
    }
    tutorialStep.value++
  }

  return { tutorialStep, tutorialActive, dismissTutorial, advanceTutorial }
}
