import { ref } from 'vue'

const TUTORIAL_SEEN_KEY = 'networkmaster.tutorial-seen.v1'

export const TUTORIAL_STEPS = [
  'Pick a scenario and start a run — every network begins on a clean slate.',
  'Select a device, choose "Begin cable", then tap its destination to wire them together.',
  'Phones and tablets only join through Wi-Fi coverage; other end devices can use either a cable or Wi-Fi.',
  'Watch the canvas: packets animate along your cables. Orange links are over capacity — upgrade the link or add another route.',
  'Open Site Upgrades for discounted bulk upgrades, and check Run Stats for live delivery telemetry.',
]

/** The onboarding card shown once per browser (gated by `TUTORIAL_SEEN_KEY`). */
export function useTutorial() {
  const tutorialStep = ref(0)
  const tutorialActive = ref(localStorage.getItem(TUTORIAL_SEEN_KEY) === null)

  function dismissTutorial() {
    tutorialActive.value = false
    localStorage.setItem(TUTORIAL_SEEN_KEY, '1')
  }
  function advanceTutorial() {
    if (tutorialStep.value >= TUTORIAL_STEPS.length - 1) {
      dismissTutorial()
      return
    }
    tutorialStep.value++
  }

  return { tutorialStep, tutorialActive, dismissTutorial, advanceTutorial }
}
