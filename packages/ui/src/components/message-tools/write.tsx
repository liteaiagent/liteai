import { checksum } from "@liteai/util/encode";
import { getFilename } from "@liteai/util/path";
import { createMemo, Show } from "solid-js";
import { Dynamic } from "solid-js/web";

import { useFileComponent } from "../../context/file";
import { useI18n } from "../../context/i18n";
import { BasicTool } from "../basic-tool";
import { getDirectory } from "../message-utils";
import { TextShimmer } from "../text-shimmer";
import { type ToolProps, ToolRegistry } from "../tool-registry";
import {
	DiagnosticsDisplay,
	getDiagnostics,
	ToolFileAccordion,
} from "./shared";

ToolRegistry.register({
	name: "write",
	render(
		props: ToolProps & {
			input: { filePath?: string; content?: string };
			metadata: { diagnostics?: any };
		},
	) {
		const i18n = useI18n();
		const fileComponent = useFileComponent();
		const diagnostics = createMemo(() =>
			getDiagnostics(props.metadata.diagnostics, props.input.filePath),
		);
		const path = createMemo(() => props.input.filePath || "");
		const filename = () => getFilename(props.input.filePath ?? "");
		const pending = () =>
			props.status === "pending" || props.status === "running";
		return (
			<div data-component="write-tool">
				<BasicTool
					{...props}
					icon="code-lines"
					defer
					trigger={
						<div data-component="write-trigger">
							<div data-slot="message-part-title-area">
								<div data-slot="message-part-title">
									<span data-slot="message-part-title-text">
										<TextShimmer
											text={i18n.t("ui.messagePart.title.write")}
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
								{/* <DiffChanges diff={diff} /> */}
							</div>
						</div>
					}
				>
					<Show when={props.input.content && path()}>
						<ToolFileAccordion path={path()}>
							<div data-component="write-content">
								<Dynamic
									component={fileComponent}
									mode="text"
									file={{
										name: props.input.filePath,
										contents: props.input.content,
										cacheKey: checksum(props.input.content || ""),
									}}
									overflow="scroll"
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
