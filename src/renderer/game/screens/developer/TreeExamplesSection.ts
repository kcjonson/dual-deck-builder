import { CatalogSection } from './CatalogSection';
import type { DeveloperSectionOptions } from './DeveloperSectionPanel';
import { tokens } from '../../../engine/theme/tokens';
import { TreeNode, TreeView } from '../../../engine/ui/TreeView';

const ROW = tokens.control.control_h_sm;
const VISIBLE_ROWS = 9;

const CONVOY: readonly TreeNode[] = [
	{
		id: 'convoy',
		label: 'Convoy',
		count: 3,
		expanded: true,
		children: [
			{
				id: 'rammer',
				label: 'Rammer',
				count: 3,
				expanded: true,
				children: [
					{ id: 'plating', label: 'Reinforced plating' },
					{ id: 'spike', label: 'Ram spike' },
					{ id: 'nitro', label: 'Nitro tank' },
				],
			},
			{ id: 'outrider', label: 'Outrider', count: 2, children: [{ id: 'mg', label: 'Twin machine gun' }, { id: 'smoke', label: 'Smoke dispenser' }] },
			{ id: 'hauler', label: 'Hauler', count: 1, children: [{ id: 'crane', label: 'Salvage crane' }] },
		],
	},
	{ id: 'raiders', label: 'Raiders', count: 2, children: [{ id: 'buzzard', label: 'Buzzard' }, { id: 'jackal', label: 'Jackal' }] },
	{ id: 'trunk', label: 'Trunk', count: 14 },
];

/**
 * R12.25's tree: a selectable convoy with two levels expanded and one
 * collapsed branch, chevrons for the branches, counts trailing. The view is
 * nine rows tall and culls the rest; the wheel scrolls, the arrows walk and
 * fold it.
 */
export class TreeExamplesSection extends CatalogSection {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_tree', title: 'Tree View', ...options });
		const tree = new TreeView({ id: 'dev_tree', nodes: CONVOY, width: 320, height: ROW * VISIBLE_ROWS, selectable: true });
		tree.select('spike');
		this.addRow('selectable, two levels open, one branch folded', tree);
	}
}
