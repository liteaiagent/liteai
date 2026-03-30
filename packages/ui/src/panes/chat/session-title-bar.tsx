import { Popover as KobaltePopover } from "@kobalte/core/popover"
import { createEffect, createMemo, type JSX, on, onCleanup, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Button } from "../../components/button"
import { Dialog } from "../../components/dialog"
import { DropdownMenu } from "../../components/dropdown-menu"
import { IconButton } from "../../components/icon-button"
import { InlineInput } from "../../components/inline-input"
import { Spinner } from "../../components/spinner"
import { TextField } from "../../components/text-field"
import { showToast } from "../../components/toast"
import { useDialog } from "../../context/dialog"
import { useLanguage } from "../shared/language"
import { usePlatform } from "../shared/platform"
import { useSDK } from "../shared/sdk"
import { useSync } from "../shared/sync"

export function SessionTitleBar(props: {
  sessionID: () => string | undefined
  projectID: () => string | undefined
  sessionKey: string
  centered: boolean
  working: boolean
  tint: string | undefined
  onNavigateSession?: (projectID: string, sessionID: string) => void
  onNavigateSessionList?: (projectID: string) => void
  /** Optional slot for session context usage indicator (e.g. token/cost display). Web-only. */
  contextUsage?: JSX.Element
}) {
  const sdk = useSDK()
  const sync = useSync()
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()

  // --- Spinner slot animation ---

  const [slot, setSlot] = createStore({
    open: false,
    show: false,
    fade: false,
  })

  let f: number | undefined
  const clear = () => {
    if (f !== undefined) window.clearTimeout(f)
    f = undefined
  }

  onCleanup(clear)
  createEffect(
    on(
      () => props.working,
      (on, prev) => {
        clear()
        if (on) {
          setSlot({ open: true, show: true, fade: false })
          return
        }
        if (prev) {
          setSlot({ open: false, show: true, fade: true })
          f = window.setTimeout(() => setSlot({ show: false, fade: false }), 260)
          return
        }
        setSlot({ open: false, show: false, fade: false })
      },
      { defer: true },
    ),
  )

  // --- Session info memos ---

  const info = createMemo(() => {
    const id = props.sessionID()
    if (!id) return
    return sync.session.get(id)
  })
  const titleValue = createMemo(() => info()?.title)
  const shareUrl = createMemo(() => info()?.share?.url)
  const shareEnabled = createMemo(() => sync.data.config.share !== "disabled")
  const parentID = createMemo(() => info()?.parentID)
  const showHeader = createMemo(() => !!(titleValue() || parentID()))

  // --- Title editing ---

  const [title, setTitle] = createStore({
    draft: "",
    editing: false,
    saving: false,
    menuOpen: false,
    pendingRename: false,
    pendingShare: false,
  })
  let titleRef: HTMLInputElement | undefined

  // --- Share state ---

  const [share, setShare] = createStore({
    open: false,
    dismiss: null as "escape" | "outside" | null,
  })

  let more: HTMLButtonElement | undefined

  const [req, setReq] = createStore({ share: false, unshare: false })

  const shareSession = () => {
    const id = props.sessionID()
    if (!id || req.share) return
    if (!shareEnabled()) return
    setReq("share", true)
    sdk.client.project.session
      .share({ sessionID: id, projectID: sdk.projectID })
      .catch((err: unknown) => {
        console.error("Failed to share session", err)
      })
      .finally(() => {
        setReq("share", false)
      })
  }

  const unshareSession = () => {
    const id = props.sessionID()
    if (!id || req.unshare) return
    if (!shareEnabled()) return
    setReq("unshare", true)
    sdk.client.project.session
      .unshare({ sessionID: id, projectID: sdk.projectID })
      .catch((err: unknown) => {
        console.error("Failed to unshare session", err)
      })
      .finally(() => {
        setReq("unshare", false)
      })
  }

  const viewShare = () => {
    const url = shareUrl()
    if (!url) return
    platform.openLink(url)
  }

  const errorMessage = (err: unknown) => {
    if (err && typeof err === "object" && "data" in err) {
      const data = (err as { data?: { message?: string } }).data
      if (data?.message) return data.message
    }
    if (err instanceof Error) return err.message
    return language.t("common.requestFailed")
  }

  // Title/share state is identity-local: reset when session key changes.
  // onCleanup fires before the next effect run and on disposal.
  createEffect(() => {
    props.sessionKey
    onCleanup(() => {
      setTitle({
        draft: "",
        editing: false,
        saving: false,
        menuOpen: false,
        pendingRename: false,
        pendingShare: false,
      })
      setShare({ open: false, dismiss: null })
    })
  })

  const openTitleEditor = () => {
    if (!props.sessionID()) return
    setTitle({ editing: true, draft: titleValue() ?? "" })
    requestAnimationFrame(() => {
      titleRef?.focus()
      titleRef?.select()
    })
  }

  const closeTitleEditor = () => {
    if (title.saving) return
    setTitle({ editing: false, saving: false })
  }

  const saveTitleEditor = async () => {
    const id = props.sessionID()
    if (!id) return
    if (title.saving) return

    const next = title.draft.trim()
    if (!next || next === (titleValue() ?? "")) {
      setTitle({ editing: false, saving: false })
      return
    }

    setTitle("saving", true)
    await sdk.client.project.session
      .update({ sessionID: id, title: next, projectID: sdk.projectID })
      .then(() => {
        sync.set(
          produce((draft) => {
            const index = draft.session.findIndex((s) => s.id === id)
            if (index !== -1) draft.session[index].title = next
          }),
        )
        setTitle({ editing: false, saving: false })
      })
      .catch((err) => {
        setTitle("saving", false)
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(err),
        })
      })
  }

  // --- Session operations ---

  const navigateAfterSessionRemoval = (sessionID: string, parentID?: string, nextSessionID?: string) => {
    if (props.sessionID() !== sessionID) return
    const projectID = props.projectID() ?? ""
    if (parentID) {
      props.onNavigateSession?.(projectID, parentID)
      return
    }
    if (nextSessionID) {
      props.onNavigateSession?.(projectID, nextSessionID)
      return
    }
    props.onNavigateSessionList?.(projectID)
  }

  const archiveSession = async (sessionID: string) => {
    const session = sync.session.get(sessionID)
    if (!session) return

    const sessions = sync.data.session ?? []
    const index = sessions.findIndex((s) => s.id === sessionID)
    const nextSession = index === -1 ? undefined : (sessions[index + 1] ?? sessions[index - 1])

    await sdk.client.project.session
      .update({ sessionID, time: { archived: Date.now() }, projectID: sdk.projectID })
      .then(() => {
        sync.set(
          produce((draft) => {
            const index = draft.session.findIndex((s) => s.id === sessionID)
            if (index !== -1) draft.session.splice(index, 1)
          }),
        )
        navigateAfterSessionRemoval(sessionID, session.parentID, nextSession?.id)
      })
      .catch((err) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(err),
        })
      })
  }

  const deleteSession = async (sessionID: string) => {
    const session = sync.session.get(sessionID)
    if (!session) return false

    const sessions = (sync.data.session ?? []).filter((s) => !s.parentID && !s.time?.archived)
    const index = sessions.findIndex((s) => s.id === sessionID)
    const nextSession = index === -1 ? undefined : (sessions[index + 1] ?? sessions[index - 1])

    const result = await sdk.client.project.session
      .delete({ sessionID, projectID: sdk.projectID })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("session.delete.failed.title"),
          description: errorMessage(err),
        })
        return false
      })

    if (!result) return false

    sync.set(
      produce((draft) => {
        const removed = new Set<string>([sessionID])

        const byParent = new Map<string, string[]>()
        for (const item of draft.session) {
          const parentID = item.parentID
          if (!parentID) continue
          const existing = byParent.get(parentID)
          if (existing) {
            existing.push(item.id)
            continue
          }
          byParent.set(parentID, [item.id])
        }

        const stack = [sessionID]
        while (stack.length) {
          const parentID = stack.pop()
          if (!parentID) continue

          const children = byParent.get(parentID)
          if (!children) continue

          for (const child of children) {
            if (removed.has(child)) continue
            removed.add(child)
            stack.push(child)
          }
        }

        draft.session = draft.session.filter((s) => !removed.has(s.id))
      }),
    )

    navigateAfterSessionRemoval(sessionID, session.parentID, nextSession?.id)
    return true
  }

  const navigateParent = () => {
    const id = parentID()
    if (!id) return
    props.onNavigateSession?.(props.projectID() ?? "", id)
  }

  function DialogDeleteSession(innerProps: { sessionID: string }) {
    const name = createMemo(() => sync.session.get(innerProps.sessionID)?.title ?? language.t("command.session.new"))
    const handleDelete = async () => {
      await deleteSession(innerProps.sessionID)
      dialog.close()
    }

    return (
      <Dialog title={language.t("session.delete.title")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">
              {language.t("session.delete.confirm", { name: name() })}
            </span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" onClick={handleDelete}>
              {language.t("session.delete.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  // --- Render ---

  return (
    <Show when={showHeader()}>
      <div
        data-session-title
        classList={{
          "sticky top-0 z-30 bg-[linear-gradient(to_bottom,var(--background-stronger)_48px,transparent)]": true,
          "w-full": true,
          "pb-4": true,
          "pl-2 pr-3 md:pl-4 md:pr-3": true,
          "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": props.centered,
        }}
      >
        <div class="h-12 w-full flex items-center justify-between gap-2">
          <div class="flex items-center gap-1 min-w-0 flex-1 pr-3">
            <Show when={parentID()}>
              <IconButton
                tabIndex={-1}
                icon="arrow-left"
                variant="ghost"
                onClick={navigateParent}
                aria-label={language.t("common.goBack")}
              />
            </Show>
            <div class="flex items-center min-w-0 grow-1">
              <div
                class="shrink-0 flex items-center justify-center overflow-hidden transition-[width,margin] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                style={{
                  width: slot.open ? "16px" : "0px",
                  "margin-right": slot.open ? "8px" : "0px",
                }}
                aria-hidden="true"
              >
                <Show when={slot.show}>
                  <div
                    class="transition-opacity duration-200 ease-out"
                    classList={{
                      "opacity-0": slot.fade,
                    }}
                  >
                    <Spinner class="size-4" style={{ color: props.tint ?? "var(--icon-interactive-base)" }} />
                  </div>
                </Show>
              </div>
              <Show when={titleValue() || title.editing}>
                <Show
                  when={title.editing}
                  fallback={
                    <h1 class="text-14-medium text-text-strong truncate grow-1 min-w-0" onDblClick={openTitleEditor}>
                      {titleValue()}
                    </h1>
                  }
                >
                  <InlineInput
                    ref={(el) => {
                      titleRef = el
                    }}
                    value={title.draft}
                    disabled={title.saving}
                    class="text-14-medium text-text-strong grow-1 min-w-0 rounded-[6px]"
                    style={{ "--inline-input-shadow": "var(--shadow-xs-border-select)" }}
                    onInput={(event) => setTitle("draft", event.currentTarget.value)}
                    onKeyDown={(event) => {
                      event.stopPropagation()
                      if (event.key === "Enter") {
                        event.preventDefault()
                        void saveTitleEditor()
                        return
                      }
                      if (event.key === "Escape") {
                        event.preventDefault()
                        closeTitleEditor()
                      }
                    }}
                    onBlur={closeTitleEditor}
                  />
                </Show>
              </Show>
            </div>
          </div>
          <Show when={props.sessionID()}>
            {(id) => (
              <div class="shrink-0 flex items-center gap-3">
                {props.contextUsage}
                <DropdownMenu
                  gutter={4}
                  placement="bottom-end"
                  open={title.menuOpen}
                  onOpenChange={(open) => {
                    setTitle("menuOpen", open)
                    if (open) return
                  }}
                >
                  <DropdownMenu.Trigger
                    as={IconButton}
                    icon="dot-grid"
                    variant="ghost"
                    class="size-6 rounded-md data-[expanded]:bg-surface-base-active"
                    classList={{
                      "bg-surface-base-active": share.open || title.pendingShare,
                    }}
                    aria-label={language.t("common.moreOptions")}
                    aria-expanded={title.menuOpen || share.open || title.pendingShare}
                    ref={(el: HTMLButtonElement) => {
                      more = el
                    }}
                  />
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      style={{ "min-width": "104px" }}
                      onCloseAutoFocus={(event) => {
                        if (title.pendingRename) {
                          event.preventDefault()
                          setTitle("pendingRename", false)
                          openTitleEditor()
                          return
                        }
                        if (title.pendingShare) {
                          event.preventDefault()
                          requestAnimationFrame(() => {
                            setShare({ open: true, dismiss: null })
                            setTitle("pendingShare", false)
                          })
                        }
                      }}
                    >
                      <DropdownMenu.Item
                        onSelect={() => {
                          setTitle("pendingRename", true)
                          setTitle("menuOpen", false)
                        }}
                      >
                        <DropdownMenu.ItemLabel>{language.t("common.rename")}</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                      <Show when={shareEnabled()}>
                        <DropdownMenu.Item
                          onSelect={() => {
                            setTitle({ pendingShare: true, menuOpen: false })
                          }}
                        >
                          <DropdownMenu.ItemLabel>{language.t("session.share.action.share")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                      </Show>
                      <DropdownMenu.Item onSelect={() => void archiveSession(id())}>
                        <DropdownMenu.ItemLabel>{language.t("common.archive")}</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator />
                      <DropdownMenu.Item onSelect={() => dialog.show(() => <DialogDeleteSession sessionID={id()} />)}>
                        <DropdownMenu.ItemLabel>{language.t("common.delete")}</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu>

                <KobaltePopover
                  open={share.open}
                  anchorRef={() => more}
                  placement="bottom-end"
                  gutter={4}
                  modal={false}
                  onOpenChange={(open) => {
                    if (open) setShare("dismiss", null)
                    setShare("open", open)
                  }}
                >
                  <KobaltePopover.Portal>
                    <KobaltePopover.Content
                      data-component="popover-content"
                      style={{ "min-width": "320px" }}
                      onEscapeKeyDown={(event) => {
                        setShare({ dismiss: "escape", open: false })
                        event.preventDefault()
                        event.stopPropagation()
                      }}
                      onPointerDownOutside={() => {
                        setShare({ dismiss: "outside", open: false })
                      }}
                      onFocusOutside={() => {
                        setShare({ dismiss: "outside", open: false })
                      }}
                      onCloseAutoFocus={(event) => {
                        if (share.dismiss === "outside") event.preventDefault()
                        setShare("dismiss", null)
                      }}
                    >
                      <div class="flex flex-col p-3">
                        <div class="flex flex-col gap-1">
                          <div class="text-13-medium text-text-strong">{language.t("session.share.popover.title")}</div>
                          <div class="text-12-regular text-text-weak">
                            {shareUrl()
                              ? language.t("session.share.popover.description.shared")
                              : language.t("session.share.popover.description.unshared")}
                          </div>
                        </div>
                        <div class="mt-3 flex flex-col gap-2">
                          <Show
                            when={shareUrl()}
                            fallback={
                              <Button
                                size="large"
                                variant="primary"
                                class="w-full"
                                onClick={shareSession}
                                disabled={req.share}
                              >
                                {req.share
                                  ? language.t("session.share.action.publishing")
                                  : language.t("session.share.action.publish")}
                              </Button>
                            }
                          >
                            <div class="flex flex-col gap-2">
                              <TextField
                                value={shareUrl() ?? ""}
                                readOnly
                                copyable
                                copyKind="link"
                                tabIndex={-1}
                                class="w-full"
                              />
                              <div class="grid grid-cols-2 gap-2">
                                <Button
                                  size="large"
                                  variant="secondary"
                                  class="w-full shadow-none border border-border-weak-base"
                                  onClick={unshareSession}
                                  disabled={req.unshare}
                                >
                                  {req.unshare
                                    ? language.t("session.share.action.unpublishing")
                                    : language.t("session.share.action.unpublish")}
                                </Button>
                                <Button
                                  size="large"
                                  variant="primary"
                                  class="w-full"
                                  onClick={viewShare}
                                  disabled={req.unshare}
                                >
                                  {language.t("session.share.action.view")}
                                </Button>
                              </div>
                            </div>
                          </Show>
                        </div>
                      </div>
                    </KobaltePopover.Content>
                  </KobaltePopover.Portal>
                </KobaltePopover>
              </div>
            )}
          </Show>
        </div>
      </div>
    </Show>
  )
}
