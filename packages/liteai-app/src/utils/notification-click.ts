let nav: ((href: string) => void) | undefined

export const setNavigate = (fn: ((href: string) => void) | undefined) => {
  nav = fn
}

export const handleNotificationClick = (href?: string) => {
  window.focus()
  if (!href) return
  if (nav) return nav(href)
  console.warn("notification-click: navigate function not set, falling back to window.location.assign")
  window.location.assign(href)
}
