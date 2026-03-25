import { getFilename } from "@liteai/util/path";
import { animate } from "motion";
import { createMemo, For, type JSX, onMount, Show } from "solid-js";

import { useI18n } from "../../context/i18n";
import { Accordion } from "../accordion";
import { FileIcon } from "../file-icon";
import { Icon } from "../icon";
import { getDirectory, urls } from "../message-utils";
import { StickyAccordionHeader } from "../sticky-accordion-header";

export function ShellSubmessage(props: { text: string; animate?: boolean }) {
	let widthRef: HTMLSpanElement | undefined;
	let valueRef: HTMLSpanElement | undefined;

	onMount(() => {
		if (!props.animate) return;
		requestAnimationFrame(() => {
			if (widthRef) {
				animate(
					widthRef,
					{ width: "auto" },
					{ type: "spring", visualDuration: 0.25, bounce: 0 },
				);
			}
			if (valueRef) {
				animate(
					valueRef,
					{ opacity: 1, filter: "blur(0px)" },
					{ duration: 0.32, ease: [0.16, 1, 0.3, 1] },
				);
			}
		});
	});

	return (
		<span data-component="shell-submessage">
			<span
				ref={widthRef}
				data-slot="shell-submessage-width"
				style={{ width: props.animate ? "0px" : undefined }}
			>
				<span data-slot="basic-tool-tool-subtitle">
					<span
						ref={valueRef}
						data-slot="shell-submessage-value"
						style={
							props.animate ? { opacity: 0, filter: "blur(2px)" } : undefined
						}
					>
						{props.text}
					</span>
				</span>
			</span>
		</span>
	);
}

export interface Diagnostic {
	range: {
		start: { line: number; character: number };
		end: { line: number; character: number };
	};
	message: string;
	severity?: number;
}

export function getDiagnostics(
	diagnosticsByFile: Record<string, Diagnostic[]> | undefined,
	filePath: string | undefined,
): Diagnostic[] {
	if (!diagnosticsByFile || !filePath) return [];
	const diagnostics = diagnosticsByFile[filePath] ?? [];
	return diagnostics.filter((d) => d.severity === 1).slice(0, 3);
}

export function DiagnosticsDisplay(props: {
	diagnostics: Diagnostic[];
}): JSX.Element {
	const i18n = useI18n();
	return (
		<Show when={props.diagnostics.length > 0}>
			<div data-component="diagnostics">
				<For each={props.diagnostics}>
					{(diagnostic) => (
						<div data-slot="diagnostic">
							<span data-slot="diagnostic-label">
								{i18n.t("ui.messagePart.diagnostic.error")}
							</span>
							<span data-slot="diagnostic-location">
								[{diagnostic.range.start.line + 1}:
								{diagnostic.range.start.character + 1}]
							</span>
							<span data-slot="diagnostic-message">{diagnostic.message}</span>
						</div>
					)}
				</For>
			</div>
		</Show>
	);
}

export function ExaOutput(props: { output?: string }) {
	const links = createMemo(() => urls(props.output));

	return (
		<Show when={links().length > 0}>
			<div data-component="exa-tool-output">
				<div data-slot="exa-tool-links">
					<For each={links()}>
						{(url) => (
							<a
								data-slot="exa-tool-link"
								href={url}
								target="_blank"
								rel="noopener noreferrer"
								onClick={(event) => event.stopPropagation()}
							>
								{url}
							</a>
						)}
					</For>
				</div>
			</div>
		</Show>
	);
}

export function ToolFileAccordion(props: {
	path: string;
	actions?: JSX.Element;
	children: JSX.Element;
}) {
	const value = createMemo(() => props.path || "tool-file");

	return (
		<Accordion
			multiple
			data-scope="apply-patch"
			style={{ "--sticky-accordion-offset": "40px" }}
			defaultValue={[value()]}
		>
			<Accordion.Item value={value()}>
				<StickyAccordionHeader>
					<Accordion.Trigger>
						<div data-slot="apply-patch-trigger-content">
							<div data-slot="apply-patch-file-info">
								<FileIcon node={{ path: props.path, type: "file" }} />
								<div data-slot="apply-patch-file-name-container">
									<Show when={props.path.includes("/")}>
										<span data-slot="apply-patch-directory">{`\u202A${getDirectory(props.path)}\u202C`}</span>
									</Show>
									<span data-slot="apply-patch-filename">
										{getFilename(props.path)}
									</span>
								</div>
							</div>
							<div data-slot="apply-patch-trigger-actions">
								{props.actions}
								<Icon name="chevron-grabber-vertical" size="small" />
							</div>
						</div>
					</Accordion.Trigger>
				</StickyAccordionHeader>
				<Accordion.Content>{props.children}</Accordion.Content>
			</Accordion.Item>
		</Accordion>
	);
}
