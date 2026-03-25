import { createMemo, Show } from "solid-js";

import { useI18n } from "../../context/i18n";
import { BasicTool } from "../basic-tool";
import { TextShimmer } from "../text-shimmer";
import { ToolRegistry } from "../tool-registry";
import { ExaOutput } from "./shared";

ToolRegistry.register({
	name: "codesearch",
	render(props) {
		const i18n = useI18n();
		const pending = createMemo(
			() => props.status === "pending" || props.status === "running",
		);
		const query = createMemo(() => {
			const value = props.input.query;
			if (typeof value !== "string") return "";
			return value;
		});

		return (
			<BasicTool
				{...props}
				icon="code"
				trigger={
					<div data-slot="basic-tool-tool-info-structured">
						<div data-slot="basic-tool-tool-info-main">
							<span data-slot="basic-tool-tool-title">
								<TextShimmer
									text={i18n.t("ui.tool.codesearch")}
									active={pending()}
								/>
							</span>
							<Show when={query()}>
								<span
									data-slot="basic-tool-tool-subtitle"
									class="exa-tool-query"
								>
									{query()}
								</span>
							</Show>
						</div>
					</div>
				}
			>
				<ExaOutput output={props.output} />
			</BasicTool>
		);
	},
});
