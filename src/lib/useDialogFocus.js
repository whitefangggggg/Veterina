import { useEffect, useEffectEvent } from 'react'

// One stack keeps nested dialogs from fighting for focus or releasing the
// body's scroll lock while their parent is still open.
const dialogs = []
const controls = (dialog) => [...dialog.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')]
  .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled')
    && !element.closest('[hidden],[inert],[aria-hidden="true"]') && element.getClientRects().length)

export function useDialogFocus(ref, onClose, enabled = true) {
  const dismiss = useEffectEvent(() => onClose())
  useEffect(() => {
    if (!enabled || !ref.current) return
    const dialog = ref.current
    const previous = document.activeElement
    dialogs.push(dialog)
    document.body.classList.add('overlay-open')
    const focusFirst = () => (controls(dialog)[0] || dialog).focus({ preventScroll: true })
    focusFirst()

    const isTop = () => dialogs.at(-1) === dialog
    const keyDown = (event) => {
      if (!isTop() || event.defaultPrevented) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        dismiss()
      }
      if (event.key !== 'Tab') return
      const elements = controls(dialog)
      const first = elements[0], last = elements.at(-1)
      if (!first) { event.preventDefault(); dialog.focus(); return }
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first.focus()
      }
    }
    const containFocus = (event) => { if (isTop() && !dialog.contains(event.target)) focusFirst() }
    document.addEventListener('keydown', keyDown)
    document.addEventListener('focusin', containFocus)
    return () => {
      dialogs.splice(dialogs.indexOf(dialog), 1)
      document.removeEventListener('keydown', keyDown)
      document.removeEventListener('focusin', containFocus)
      if (!dialogs.length) document.body.classList.remove('overlay-open')
      if (previous?.isConnected && (!dialogs.length || dialogs.at(-1).contains(previous))) previous.focus({ preventScroll: true })
    }
  }, [enabled, ref])
}
