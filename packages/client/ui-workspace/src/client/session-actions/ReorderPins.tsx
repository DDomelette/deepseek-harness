/**
 * The pinned block's pointer-free reorder route: two `sidebar.workspaces.session.menu.item`
 * rows over one injected move verb. Each row appears only while the Session it
 * belongs to is pinned and has somewhere to go, so a menu never offers a move
 * that does nothing; the drag gesture in the browser writes the same order.
 */
import { IconChevronDownOutlineRegular, IconChevronUpOutlineRegular, MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReorderPinMenuItemProps } from '../contract/slots.ts'

/**
 * Menu row (order 110): move the pinned Session one place toward the block start.
 * @param props - owner share, the reorder share, and the menu open state.
 * @returns the row, or null when the Session is unpinned or already first.
 */
export function MovePinUpMenuItem(props: ReorderPinMenuItemProps) {
  const { sessionId, usePinnedOrder, movePin, useMenuOpenState, t } = props
  const [, setMenuOpen] = useMenuOpenState()
  const order = usePinnedOrder(ids => ids)
  const at = order.indexOf(sessionId)
  if (at <= 0) return null
  return (
    <MenuItemButton
      icon={<IconChevronUpOutlineRegular />}
      onSelect={() => {
        setMenuOpen(false)
        movePin(sessionId, 'up')
      }}
    >
      {t('menu.movePinUp')}
    </MenuItemButton>
  )
}

/**
 * Menu row (order 120): move the pinned Session one place toward the block end.
 * @param props - owner share, the reorder share, and the menu open state.
 * @returns the row, or null when the Session is unpinned or already last.
 */
export function MovePinDownMenuItem(props: ReorderPinMenuItemProps) {
  const { sessionId, usePinnedOrder, movePin, useMenuOpenState, t } = props
  const [, setMenuOpen] = useMenuOpenState()
  const order = usePinnedOrder(ids => ids)
  const at = order.indexOf(sessionId)
  if (at === -1 || at === order.length - 1) return null
  return (
    <MenuItemButton
      icon={<IconChevronDownOutlineRegular />}
      onSelect={() => {
        setMenuOpen(false)
        movePin(sessionId, 'down')
      }}
    >
      {t('menu.movePinDown')}
    </MenuItemButton>
  )
}
