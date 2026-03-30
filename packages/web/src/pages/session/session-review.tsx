import type { Project, UserMessage } from "@liteai/sdk"
import { Button } from "@liteai/ui/button"
import { previewSelectedLines } from "@liteai/ui/pierre/selection-bridge"
import { Select } from "@liteai/ui/select"
import { showToast } from "@liteai/ui/toast"
import { checksum } from "@liteai/util/encode"
import { createEffect, createMemo, type JSX, on, Show, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import type { useComments } from "@/context/comments"
import type { FileSelection, SelectedLineRange, useFile } from "@/context/file"
import { selectionFromLines } from "@/context/file"
import type { useGlobalSync } from "@/context/global-sync"
import type { useLanguage } from "@/context/language"
import type { useLayout } from "@/context/layout"
import type { usePrompt } from "@/context/prompt"
import type { useSDK } from "@/context/sdk"
import type { useSync } from "@/context/sync"
import { createOpenReviewFile } from "@/pages/session/helpers"
import { type DiffStyle, SessionReviewTab, type SessionReviewTabProps } from "@/pages/session/review-tab"
import { formatServerError } from "@/utils/server-errors"

export interface SessionReviewInput {
  sessionID: () => string | undefined
  sessionKey: () => string
  info: () => { summary?: { files?: number }; revert?: { messageID: string } } | undefined
  diffs: () => import("@liteai/sdk").FileDiff[]
  lastUserMessage: () => UserMessage | undefined
  isDesktop: () => boolean
  desktopReviewOpen: () => boolean
  desktopFileTreeOpen: () => boolean
  activeTab: () => string
  mobileTab: () => "session" | "changes"
  changes: () => "session" | "turn"
  setChanges: (value: "session" | "turn") => void
  deferRender: () => boolean
  tabs: () => { open: (tab: string) => void; setActive: (tab: string | undefined) => void }
  // Contexts
  sync: ReturnType<typeof useSync>
  sdk: ReturnType<typeof useSDK>
  file: ReturnType<typeof useFile>
  comments: ReturnType<typeof useComments>
  language: ReturnType<typeof useLanguage>
  layout: ReturnType<typeof useLayout>
  prompt: ReturnType<typeof usePrompt>
  globalSync: ReturnType<typeof useGlobalSync>
  view: () => ReturnType<ReturnType<typeof useLayout>["view"]>
}

export function createSessionReview(input: SessionReviewInput) {
  const { sync, sdk, file, comments, language, layout, prompt, globalSync } = input

  // --- Review computations ---

  const reviewCount = createMemo(() => Math.max(input.info()?.summary?.files ?? 0, input.diffs().length))
  const hasReview = createMemo(() => reviewCount() > 0)

  const diffsReady = createMemo(() => {
    const id = input.sessionID()
    if (!id) return true
    if (!hasReview()) return true
    return sync.data.session_diff[id] !== undefined
  })

  const reviewEmptyKey = createMemo(() => {
    if (sync.data.config.snapshot === false) {
      const project = sync.project
      if (project && !project.vcs) return "session.review.noVcs"
      return "session.review.noSnapshot"
    }
    return "session.review.empty"
  })

  const turnDiffs = createMemo(() => input.lastUserMessage()?.summary?.diffs ?? [])
  const reviewDiffs = createMemo(() => (input.changes() === "session" ? input.diffs() : turnDiffs()))

  // --- Git init ---

  const [gitState, setGitState] = createStore({ loading: false })

  function upsert(next: Project) {
    const list = globalSync.data.project
    sync.set("project", next.id)
    const idx = list.findIndex((item) => item.id === next.id)
    if (idx >= 0) {
      globalSync.set(
        "project",
        list.map((item, i) => (i === idx ? { ...item, ...next } : item)),
      )
      return
    }
    const at = list.findIndex((item) => item.id > next.id)
    if (at >= 0) {
      globalSync.set("project", [...list.slice(0, at), next, ...list.slice(at)])
      return
    }
    globalSync.set("project", [...list, next])
  }

  function initGit() {
    if (gitState.loading) return
    setGitState("loading", true)
    void sdk.client.project
      .initGit({ directory: sdk.directory })
      .then((x) => {
        if (!x.data) return
        upsert(x.data)
      })
      .catch((err) => {
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: formatServerError(err, language.t),
        })
      })
      .finally(() => {
        setGitState("loading", false)
      })
  }

  // --- Comment integration ---

  const selectionPreview = (path: string, selection: FileSelection) => {
    const content = file.get(path)?.content?.content
    if (!content) return undefined
    return previewSelectedLines(content, { start: selection.startLine, end: selection.endLine })
  }

  const addCommentToContext = (commentInput: {
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
    origin?: "review" | "file"
  }) => {
    const selection = selectionFromLines(commentInput.selection)
    const preview = commentInput.preview ?? selectionPreview(commentInput.file, selection)
    const saved = comments.add({
      file: commentInput.file,
      selection: commentInput.selection,
      comment: commentInput.comment,
    })
    prompt.context.add({
      type: "file",
      path: commentInput.file,
      selection,
      comment: commentInput.comment,
      commentID: saved.id,
      commentOrigin: commentInput.origin,
      preview,
    })
  }

  const updateCommentInContext = (commentInput: {
    id: string
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
  }) => {
    comments.update(commentInput.file, commentInput.id, commentInput.comment)
    prompt.context.updateComment(commentInput.file, commentInput.id, {
      comment: commentInput.comment,
      ...(commentInput.preview ? { preview: commentInput.preview } : {}),
    })
  }

  const removeCommentFromContext = (commentInput: { id: string; file: string }) => {
    comments.remove(commentInput.file, commentInput.id)
    prompt.context.removeComment(commentInput.file, commentInput.id)
  }

  const reviewCommentActions = createMemo(() => ({
    moreLabel: language.t("common.moreOptions"),
    editLabel: language.t("common.edit"),
    deleteLabel: language.t("common.delete"),
    saveLabel: language.t("common.save"),
  }))

  // --- File tree ---

  const fileTreeTab = () => layout.fileTree.tab()
  const setFileTreeTab = (value: "changes" | "all") => layout.fileTree.setTab(value)

  const showAllFiles = () => {
    if (fileTreeTab() !== "changes") return
    setFileTreeTab("all")
  }

  const openReviewFile = createOpenReviewFile({
    showAllFiles,
    tabForPath: file.tab,
    openTab: (tab) => input.tabs().open(tab),
    setActive: (tab) => input.tabs().setActive(tab),
    loadFile: file.load,
  })

  // --- Review diff tree store and navigation ---

  const [tree, setTree] = createStore({
    reviewScroll: undefined as HTMLElement | undefined,
    pendingDiff: undefined as string | undefined,
    activeDiff: undefined as string | undefined,
  })

  const openReviewPanel = () => {
    if (!input.view().reviewPanel.opened()) input.view().reviewPanel.open()
  }

  const reviewDiffId = (path: string) => {
    const sum = checksum(path)
    if (!sum) return
    return `session-review-diff-${sum}`
  }

  const reviewDiffTop = (path: string) => {
    const root = tree.reviewScroll
    if (!root) return

    const id = reviewDiffId(path)
    if (!id) return

    const el = document.getElementById(id)
    if (!(el instanceof HTMLElement)) return
    if (!root.contains(el)) return

    const a = el.getBoundingClientRect()
    const b = root.getBoundingClientRect()
    return a.top - b.top + root.scrollTop
  }

  const scrollToReviewDiff = (path: string) => {
    const root = tree.reviewScroll
    if (!root) return false

    const top = reviewDiffTop(path)
    if (top === undefined) return false

    input.view().setScroll("review", { x: root.scrollLeft, y: top })
    root.scrollTo({ top, behavior: "auto" })
    return true
  }

  const focusReviewDiff = (path: string) => {
    openReviewPanel()
    input.view().review.openPath(path)
    setTree({ activeDiff: path, pendingDiff: path })
  }

  // --- Pending diff scroll effect ---

  createEffect(() => {
    const pending = tree.pendingDiff
    if (!pending) return
    if (!tree.reviewScroll) return
    if (!diffsReady()) return

    const attempt = (count: number) => {
      if (tree.pendingDiff !== pending) return
      if (count > 60) {
        setTree("pendingDiff", undefined)
        return
      }

      const root = tree.reviewScroll
      if (!root) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }

      if (!scrollToReviewDiff(pending)) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }

      const top = reviewDiffTop(pending)
      if (top === undefined) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }

      if (Math.abs(root.scrollTop - top) <= 1) {
        setTree("pendingDiff", undefined)
        return
      }

      requestAnimationFrame(() => attempt(count + 1))
    }

    requestAnimationFrame(() => attempt(0))
  })

  // --- Diff loading effects ---

  let diffFrame: number | undefined
  let diffTimer: number | undefined

  createEffect(() => {
    const id = input.sessionID()
    if (!id) return

    const wants = input.isDesktop()
      ? input.desktopFileTreeOpen() || (input.desktopReviewOpen() && input.activeTab() === "review")
      : input.mobileTab() === "changes"
    if (!wants) return
    if (sync.data.session_diff[id] !== undefined) return
    if (sync.status === "loading") return

    void sync.session.diff(id)
  })

  createEffect(
    on(
      () =>
        [
          input.sessionKey(),
          input.isDesktop()
            ? input.desktopFileTreeOpen() || (input.desktopReviewOpen() && input.activeTab() === "review")
            : input.mobileTab() === "changes",
        ] as const,
      ([key, wants]) => {
        if (diffFrame !== undefined) cancelAnimationFrame(diffFrame)
        if (diffTimer !== undefined) window.clearTimeout(diffTimer)
        diffFrame = undefined
        diffTimer = undefined
        if (!wants) return

        const id = input.sessionID()
        if (!id) return
        if (!untrack(() => sync.data.session_diff[id] !== undefined)) return

        diffFrame = requestAnimationFrame(() => {
          diffFrame = undefined
          diffTimer = window.setTimeout(() => {
            diffTimer = undefined
            if (input.sessionKey() !== key) return
            void sync.session.diff(id, { force: true })
          }, 0)
        })
      },
      { defer: true },
    ),
  )

  // --- File tree loading ---

  let treeDir: string | undefined
  createEffect(() => {
    const dir = sdk.directory
    if (!input.isDesktop()) return
    if (!layout.fileTree.opened()) return
    if (sync.status === "loading") return

    fileTreeTab()
    const refresh = treeDir !== dir
    treeDir = dir
    void (refresh ? file.tree.refresh("") : file.tree.list(""))
  })

  // --- Review content renderers ---

  const changesOptions = ["session", "turn"] as const
  const changesOptionsList = [...changesOptions]

  const changesTitle = (): JSX.Element | null => {
    if (!hasReview()) {
      return null
    }

    return Select({
      options: changesOptionsList,
      current: input.changes(),
      label: (option: string) =>
        option === "session" ? language.t("ui.sessionReview.title") : language.t("ui.sessionReview.title.lastTurn"),
      onSelect: (option: string | undefined) => option && input.setChanges(option as "session" | "turn"),
      variant: "ghost",
      size: "small",
      valueClass: "text-14-medium",
    }) as JSX.Element
  }

  const emptyTurn = (): JSX.Element =>
    (
      <div class="h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6">
        <div class="text-14-regular text-text-weak max-w-56">{language.t("session.review.noChanges")}</div>
      </div>
    ) as JSX.Element

  const reviewEmpty = (emptyInput: { loadingClass: string; emptyClass: string }): JSX.Element => {
    if (input.changes() === "turn") return emptyTurn()

    if (hasReview() && !diffsReady()) {
      return (<div class={emptyInput.loadingClass}>{language.t("session.review.loadingChanges")}</div>) as JSX.Element
    }

    if (reviewEmptyKey() === "session.review.noVcs") {
      return (
        <div class={emptyInput.emptyClass}>
          <div class="flex flex-col gap-3">
            <div class="text-14-medium text-text-strong">{language.t("session.review.noVcs.createGit.title")}</div>
            <div class="text-14-regular text-text-base max-w-md" style={{ "line-height": "var(--line-height-normal)" }}>
              {language.t("session.review.noVcs.createGit.description")}
            </div>
          </div>
          <Button size="large" disabled={gitState.loading} onClick={initGit}>
            {gitState.loading
              ? language.t("session.review.noVcs.createGit.actionLoading")
              : language.t("session.review.noVcs.createGit.action")}
          </Button>
        </div>
      ) as JSX.Element
    }

    return (
      <div class={emptyInput.emptyClass}>
        <div class="text-14-regular text-text-weak max-w-56">{language.t(reviewEmptyKey())}</div>
      </div>
    ) as JSX.Element
  }

  const reviewContent = (contentInput: {
    diffStyle: DiffStyle
    onDiffStyleChange?: (style: DiffStyle) => void
    classes?: SessionReviewTabProps["classes"]
    loadingClass: string
    emptyClass: string
  }): JSX.Element =>
    (
      <Show when={!input.deferRender()}>
        <SessionReviewTab
          title={changesTitle()}
          empty={reviewEmpty(contentInput)}
          diffs={reviewDiffs}
          view={input.view}
          diffStyle={contentInput.diffStyle}
          onDiffStyleChange={contentInput.onDiffStyleChange}
          onScrollRef={(el) => setTree("reviewScroll", el)}
          focusedFile={tree.activeDiff}
          onLineComment={(comment) => addCommentToContext({ ...comment, origin: "review" })}
          onLineCommentUpdate={updateCommentInContext}
          onLineCommentDelete={removeCommentFromContext}
          lineCommentActions={reviewCommentActions()}
          comments={comments.all()}
          focusedComment={comments.focus()}
          onFocusedCommentChange={comments.setFocus}
          onViewFile={openReviewFile}
          classes={contentInput.classes}
        />
      </Show>
    ) as JSX.Element

  const reviewPanel = (): JSX.Element =>
    (
      <div class="flex flex-col h-full overflow-hidden bg-background-stronger contain-strict">
        <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
          {reviewContent({
            diffStyle: layout.review.diffStyle(),
            onDiffStyleChange: layout.review.setDiffStyle,
            loadingClass: "px-6 py-4 text-text-weak",
            emptyClass: "h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6",
          })}
        </div>
      </div>
    ) as JSX.Element

  return {
    // Computations
    reviewCount,
    hasReview,
    diffsReady,
    reviewDiffs,

    // Tree state
    tree,
    setTree,

    // File tree
    showAllFiles,
    fileTreeTab,
    setFileTreeTab,
    openReviewFile,

    // Review diff navigation
    focusReviewDiff,

    // Renderers
    reviewContent,
    reviewPanel,

    // Cleanup
    cleanup() {
      if (diffFrame !== undefined) cancelAnimationFrame(diffFrame)
      if (diffTimer !== undefined) window.clearTimeout(diffTimer)
    },
  }
}
