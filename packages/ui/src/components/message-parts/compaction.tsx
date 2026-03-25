import { useI18n } from "../../context/i18n";

export function MessageDivider(props: { label: string }) {
	return (
		<div data-component="compaction-part">
			<div data-slot="compaction-part-divider">
				<span data-slot="compaction-part-line" />
				<span
					data-slot="compaction-part-label"
					class="text-12-regular text-text-weak"
				>
					{props.label}
				</span>
				<span data-slot="compaction-part-line" />
			</div>
		</div>
	);
}

export function CompactionPartDisplay() {
	const i18n = useI18n();
	return <MessageDivider label={i18n.t("ui.messagePart.compaction")} />;
}
