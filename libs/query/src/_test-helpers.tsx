import type { ReactElement } from 'react'
import { render as vitestRender } from 'vitest-browser-react'

export function render(element: ReactElement) {
  const screen = vitestRender(element)

  const click = async (testId: string) => {
    const el = screen.getByTestId(testId)
    await el.click()
  }

  const see = async (testId: string, text?: string) => {
    const el = screen.getByTestId(testId)
    if (text) {
      // @ts-expect-error - vitest-browser-react types are incorrect
      await expect.element(el).toHaveTextContent(text)
    } else {
      // @ts-expect-error - vitest-browser-react types are incorrect
      await expect.element(el).toBeVisible()
    }
  }

  return { click, see }
}
