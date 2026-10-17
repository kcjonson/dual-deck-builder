import type { Component } from '../../../engine/components/Component';
import { AtlasButton } from './AtlasButton';
import { AtlasSheet } from './AtlasSheet';
import { SectionTabs } from './SectionTabs';

/** What an atlas screen is built from, for tests: its sheets, its highways (visible ones), and its tab rows. */
export interface AtlasScreenParts {
	sheets: AtlasSheet[];
	highways: AtlasButton[];
	tabs: SectionTabs[];
}

/** Walks `root` for the parts every atlas screen holds to: one sheet, one highway at most (UI Art Direction, Components). */
export function atlasScreenParts(root: Component): AtlasScreenParts {
	const parts: AtlasScreenParts = { sheets: [], highways: [], tabs: [] };
	const walk = (node: Component): void => {
		if (!node.visible) return;
		if (node instanceof AtlasSheet) parts.sheets.push(node);
		if (node instanceof AtlasButton && node.variant === 'highway') parts.highways.push(node);
		if (node instanceof SectionTabs) parts.tabs.push(node);
		for (const child of node.children) walk(child);
	};
	walk(root);
	return parts;
}
