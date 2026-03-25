import { getFilename } from "@liteai/util/path";
import { createMemo, Show } from "solid-js";
import { Dynamic } from "solid-js/web";

import { useFileComponent } from "../../context/file";
import { useI18n } from "../../context/i18n";
import { BasicTool } from "../basic-tool";
import { DiffChanges } from "../diff-changes";
import { getDirectory } from "../message-utils";
import { TextShimmer } from "../text-shimmer";
import { type ToolProps, ToolRegistry } from "../tool-registry";
import {
	DiagnosticsDisplay,
	getDiagnostics,
	ToolFileAccordion,
} from "./shared";

ToolRegistry.register({
	name: "edit",
	render(
		props: ToolProps & {
			input: { filePath?: string; oldString?: string; newString?: string };
			metadata: { diagnostics?: any; filediff?: any };
		},
	) {
		const i18n = useI18n();
		const fileComponent = useFileComponent();
		const diagnostics = createMemo(() =>
			getDiagnostics(props.metadata.diagnostics, props.input.filePath),
		);
		const path = createMemo(
			() => props.metadata?.filediff?.file || props.input.filePath || "",
		);
		const filename = () => getFilename(props.input.filePath ?? "");
		const pending = () =>
			props.status === "pending" || props.status === "running";
		return (
			<div data-component="edit-tool">
				<BasicTool
					{...props}
					icon="code-lines"
					defer
					trigger={
						<div data-component="edit-trigger">
							<div data-slot="message-part-title-area">
								<div data-slot="message-part-title">
									<span data-slot="message-part-title-text">
										<TextShimmer
											text={i18n.t("ui.messagePart.title.edit")}
											active={pending()}
										/>
									</span>
									<Show when={!pending()}>
										<span data-slot="message-part-title-filename">
											{filename()}
										</span>
									</Show>
								</div>
								<Show when={!pending() && props.input.filePath?.includes("/")}>
									<div data-slot="message-part-path">
										<span data-slot="message-part-directory">
											{getDirectory(props.input.filePath ?? "")}
										</span>
									</div>
								</Show>
							</div>
							<div data-slot="message-part-actions">
								<Show when={!pending() && props.metadata.filediff}>
									<DiffChanges changes={props.metadata.filediff} />
								</Show>
							</div>
						</div>
					}
				>
					<Show when={path()}>
						<ToolFileAccordion
							path={path()}
							actions={
								<Show when={!pending() && props.metadata.filediff}>
									<DiffChanges
										changes={
											props.metadata.filediff as {
												additions: number;
												deletions: number;
											}
										}
									/>
								</Show>
							}
						>
							<div data-component="edit-content">
								<Dynamic
									component={fileComponent}
									mode="diff"
									before={{
										name:
											props.metadata?.filediff?.file || props.input.filePath,
										contents:
											props.metadata?.filediff?.before || props.input.oldString,
									}}
									after={{
										name:
											props.metadata?.filediff?.file || props.input.filePath,
										contents:
											props.metadata?.filediff?.after || props.input.newString,
									}}
								/>
							</div>
						</ToolFileAccordion>
					</Show>
					<DiagnosticsDisplay diagnostics={diagnostics()} />
				</BasicTool>
			</div>
		);
	},
});
