import { getFilename } from "@liteai/util/path";
import { createMemo, For } from "solid-js";

import { useData } from "../../context";
import { useI18n } from "../../context/i18n";
import { BasicTool } from "../basic-tool";
import { Icon } from "../icon";
import { relativizeProjectPath } from "../message-utils";
import { type ToolProps, ToolRegistry } from "../tool-registry";

ToolRegistry.register({
	name: "read",
	render(
		props: ToolProps & {
			input: { filePath?: string; offset?: number; limit?: number };
			metadata: { loaded?: unknown[] };
		},
	) {
		const data = useData();
		const i18n = useI18n();
		const args: string[] = [];
		if (props.input.offset) args.push(`offset=${props.input.offset}`);
		if (props.input.limit) args.push(`limit=${props.input.limit}`);
		const loaded = createMemo(() => {
			if (props.status !== "completed") return [];
			const value = props.metadata.loaded;
			if (!value || !Array.isArray(value)) return [];
			return value.filter((p): p is string => typeof p === "string");
		});
		return (
			<>
				<BasicTool
					{...props}
					icon="glasses"
					trigger={{
						title: i18n.t("ui.tool.read"),
						subtitle: props.input.filePath
							? getFilename(props.input.filePath)
							: "",
						args,
					}}
				/>
				<For each={loaded()}>
					{(filepath) => (
						<div data-component="tool-loaded-file">
							<Icon name="enter" size="small" />
							<span>
								{i18n.t("ui.tool.loaded")}{" "}
								{relativizeProjectPath(filepath, data.directory)}
							</span>
						</div>
					)}
				</For>
			</>
		);
	},
});
